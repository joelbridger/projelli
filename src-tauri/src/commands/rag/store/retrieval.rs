use super::*;

/// One raw query result before scoring.
#[derive(Debug, Clone)]
pub struct StoredHit {
    /// Content-addressed chunk id (sha256(path:paragraph_index)). WS-B/C: the
    /// citation key returned to the answer layer and used by verify.
    pub id: String,
    pub path: String,
    /// WS-B/C: confidentiality scope key. Absent only on pre-3.0 rows (which the
    /// migration re-indexes away), in which case None.
    pub matter_id: Option<String>,
    /// WS-B/C: originating source ("mail:<id>" or file path). None on pre-3.0 rows.
    pub source_id: Option<String>,
    pub paragraph_index: u32,
    pub text: String,
    /// Cosine distance from LanceDB. Lower is better.
    pub distance: f32,
    // A3 additions. None for pre-A3 rows that lack these columns.
    pub source_type: Option<String>,
    pub page_number: Option<u32>,
    // G4: true means `text` holds hex-encoded AES-256-GCM ciphertext; must
    // be decrypted before use. false (and null for pre-G4 rows) means plaintext.
    pub encrypted: bool,
    // WS-PRIV: the chunk's privilege status. None only on a pre-WS-PRIV row
    // (which the version-4 migration re-indexes away). Default retrieval only
    // returns "none"; this is surfaced so the UI can label an explicitly-
    // included privileged hit.
    pub privilege: Option<String>,
    // VG-2: "ocr" when the chunk text was read from a scanned page by the
    // local OCR engine; None on native chunks (and pre-V8 rows).
    pub extraction: Option<String>,
    // VG-2: mean OCR word confidence (0-100) for the chunk's page; None on
    // native chunks. Disclosed in citations below OCR_LOW_CONFIDENCE = 60.
    pub extraction_confidence: Option<f32>,
    // VG-3c: page:line locator for certified transcript chunks
    // ("startPage:startLine-endPage:endLine"); None on every other source
    // (and pre-V9 rows). Citations read it as "Tr. 45:12-46:3".
    pub locator: Option<String>,
    // VG-6e: hex AES-256-GCM ciphertext of the REAL source path. Present on
    // every V10 row; None only on a pre-V10 row (whose `path` is then the raw
    // plaintext — the migration re-indexes those away). Consumers (the
    // rag_retrieve command, the MCP search tool, the test harnesses) decrypt
    // this to recover the display path; `path`/`source_id` above hold the
    // opaque keyed token on V10 rows.
    pub path_enc: Option<String>,
}

/// Compose the LanceDB `only_if` PREFILTER predicate for a retrieval query from
/// the matter scope, the privilege rule, and the per-path tombstone exclusion
/// (BUG-099 fail-closed). This is the single place ALL three safety boundaries
/// are AND-ed together, so the composition is auditable and tested as a unit.
///
/// WS-B/C — matter scope:
///   - `scope = Some(matter_id)` → `matter_id = '<escaped>'`
///   - `scope = None`            → no matter clause (deliberate cross-matter)
///
/// WS-PRIV — privilege rule (litigation safety):
///   - `include_privileged = false` (the DEFAULT) → `privilege = 'none'`, so
///     attorney-client / work-product rows are never even candidates.
///   - `include_privileged = true` (deliberate)   → no privilege clause.
///
/// BUG-099 tombstone — per-path unsafe exclusion:
///   - `tombstoned_tokens` is a slice of HMAC path tokens for files whose
///     cleanup DELETE failed. Those files' stale rows MUST NOT be returned as
///     citations. Each token is the same opaque string stored in the `path`
///     column (computed by `crypto::path_token`), so the exclusion can be
///     pushed as a SQL prefilter: `path NOT IN ('tok1', 'tok2', ...)`.
///   - An empty slice means no exclusion (the normal case on a healthy index).
///
/// Both matter and privilege clauses are validated + SQL-escaped before
/// interpolation. Returns `None` only when ALL three are absent — a fully
/// unconstrained scan that callers must reach via explicit choices.
pub fn build_retrieval_predicate(
    scope: Option<&str>,
    include_privileged: bool,
    tombstoned_tokens: &[String],
) -> Result<Option<String>> {
    let mut clauses: Vec<String> = Vec::with_capacity(3);
    if let Some(matter_id) = scope {
        let matter_id = validate_matter_id(matter_id)?;
        clauses.push(format!("matter_id = '{}'", sql_escape(matter_id)));
    }
    if !include_privileged {
        // Default exclusion: only non-privileged content. PRIVILEGE_NONE is a
        // fixed constant, but escape it anyway so the predicate-building rule is
        // uniform and future-proof.
        clauses.push(format!("privilege = '{}'", sql_escape(PRIVILEGE_NONE)));
    }
    // BUG-099: exclude any path whose cleanup failed (stale rows that we could
    // not delete). The tokens are already HMAC-opaque — safe to embed directly
    // in the SQL literal list without escaping (they are hex strings).
    if !tombstoned_tokens.is_empty() {
        let list: String = tombstoned_tokens
            .iter()
            .map(|t| format!("'{}'", sql_escape(t)))
            .collect::<Vec<_>>()
            .join(", ");
        clauses.push(format!("path NOT IN ({})", list));
    }
    Ok(if clauses.is_empty() {
        None
    } else {
        Some(clauses.join(" AND "))
    })
}

/// Nearest-neighbor search. Returns up to `top_k` raw hits.
///
/// WS-B/C — `scope` is the confidentiality boundary:
///   - `Some(matter_id)` constrains results to that matter via a store-level
///     LanceDB PREFILTER (`only_if`). LanceDB defaults `prefilter = true`, so
///     the SQL predicate is pushed into the scan and the vector search runs ONLY
///     over rows already in scope — an out-of-scope row can never be a candidate,
///     so similarity cannot surface it. This is the matter-isolation guarantee.
///   - `None` searches ALL matters (a deliberate, caller-audited cross-matter
///     path — never the silent default; the `rag_retrieve` command requires an
///     explicit scope and only reaches `None` via the named `AllMatters` action).
///
/// WS-PRIV — `include_privileged` is the litigation-safety boundary, composed
/// into the SAME prefilter as the matter scope:
///   - `false` (DEFAULT) appends `AND privilege = 'none'`, so attorney-client /
///     work-product chunks are never candidates — they cannot surface even if
///     they are the single most semantically relevant row.
///   - `true` is a deliberate, separately-named capability (mirrors AllMatters)
///     that omits the privilege clause so privileged content can be retrieved.
///
/// BUG-099 tombstone — `tombstoned_tokens` is a slice of HMAC path tokens for
/// paths whose cleanup DELETE failed after a skip. Those paths' stale rows are
/// excluded from the vector search prefilter. Pass `&[]` (the normal case) to
/// apply no tombstone exclusion. See `build_retrieval_predicate` for the design.
///
/// SECURITY: we NEVER call `.postfilter()` here. Postfilter runs the vector
/// search first and filters afterward, which can both drop in-scope hits and
/// admit ranking approximation. The scoped path must stay prefilter-only.
pub async fn nearest(
    table: &Table,
    query_vec: &[f32],
    top_k: usize,
    scope: Option<&str>,
    include_privileged: bool,
    tombstoned_tokens: &[String],
) -> Result<Vec<StoredHit>> {
    use futures_util::TryStreamExt;
    let mut query = table
        .query()
        .nearest_to(query_vec)
        .context("nearest_to failed")?
        .limit(top_k);
    // WS-B/C + WS-PRIV + BUG-099: compose all safety predicates. They are part
    // of the query PLAN (prefilter), not a post-hoc filter on the returned Vec.
    if let Some(predicate) =
        build_retrieval_predicate(scope, include_privileged, tombstoned_tokens)?
    {
        query = query.only_if(predicate);
    }
    let mut stream = query.execute().await.context("query execute failed")?;

    let mut out: Vec<StoredHit> = Vec::with_capacity(top_k);
    while let Some(batch) = stream
        .try_next()
        .await
        .context("query stream try_next failed")?
    {
        let path_col = batch
            .column_by_name("path")
            .context("missing path column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("path column is not StringArray")?;
        // WS-B/C: id is the citation key; matter_id/source_id are nullable here
        // only to tolerate a pre-3.0 row sneaking through (the migration prevents
        // that), so we read them defensively rather than requiring the columns.
        let id_col = batch
            .column_by_name("id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let matter_col = batch
            .column_by_name("matter_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let source_col = batch
            .column_by_name("source_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let pi_col = batch
            .column_by_name("paragraph_index")
            .context("missing paragraph_index column")?
            .as_any()
            .downcast_ref::<UInt32Array>()
            .context("paragraph_index column is not UInt32Array")?;
        let text_col = batch
            .column_by_name("text")
            .context("missing text column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("text column is not StringArray")?;
        // LanceDB exposes the distance as `_distance`. Falls back to 0
        // (best score) if the column is missing — should not happen on
        // a vector query but keeps us robust.
        let dist_col = batch
            .column_by_name("_distance")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::Float32Array>());

        // A3: read nullable source_type and page_number columns.
        // These are absent on pre-A3 tables so we fall back to None.
        let st_col = batch
            .column_by_name("source_type")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let pn_col = batch
            .column_by_name("page_number")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>());
        // G4: read nullable encrypted column. Absent on pre-G4 rows → false (plaintext).
        let enc_col = batch
            .column_by_name("encrypted")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::BooleanArray>());
        // WS-PRIV: read the privilege column. Absent on pre-WS-PRIV rows → None.
        let priv_col = batch
            .column_by_name("privilege")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        // VG-2: read the nullable extraction columns. Absent on pre-V8 rows → None.
        let ext_col = batch
            .column_by_name("extraction")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let ext_conf_col = batch
            .column_by_name("extraction_confidence")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::Float32Array>());
        // VG-3c: read the nullable locator column. Absent on pre-V9 rows → None.
        let loc_col = batch
            .column_by_name("locator")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        // VG-6e: read the encrypted-path column. Absent on pre-V10 tables →
        // None (the raw `path` is then plaintext and passes through).
        let penc_col = batch
            .column_by_name("path_enc")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());

        for i in 0..batch.num_rows() {
            let distance = dist_col.map(|c| c.value(i)).unwrap_or(0.0);
            let source_type = st_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let page_number = pn_col.filter(|c| !c.is_null(i)).map(|c| c.value(i));
            // G4: null or absent encrypted column → false (pre-G4 plaintext row).
            let encrypted = enc_col
                .map(|c| !c.is_null(i) && c.value(i))
                .unwrap_or(false);
            let id = id_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string())
                .unwrap_or_default();
            let matter_id = matter_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let source_id = source_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let privilege = priv_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let extraction = ext_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let extraction_confidence = ext_conf_col.filter(|c| !c.is_null(i)).map(|c| c.value(i));
            let locator = loc_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let path_enc = penc_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            out.push(StoredHit {
                id,
                path: path_col.value(i).to_string(),
                matter_id,
                source_id,
                paragraph_index: pi_col.value(i),
                text: text_col.value(i).to_string(),
                distance,
                source_type,
                page_number,
                encrypted,
                privilege,
                extraction,
                extraction_confidence,
                locator,
                path_enc,
            });
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// WS3d-B: hybrid (BM25 keyword) retrieval support.
// ---------------------------------------------------------------------------

/// Cap on how many ids a single `fetch_by_ids_scoped` call will interpolate. The
/// hybrid path proposes at most a few hundred keyword candidates (the overfetch
/// budget), so this generous cap only guards against a corrupt keyword index or a
/// future bug feeding an unbounded id list into the SQL filter.
const MAX_FETCH_BY_IDS: usize = 512;

/// WS3d-B — strict validation for a content-addressed chunk id before it is
/// interpolated into an `id IN (...)` predicate. A chunk id is
/// `hex(sha256(path:paragraph_index))` — exactly 64 lowercase hex chars. Anything
/// else (a corrupt keyword-index entry, a future-format id, an injection attempt)
/// is rejected so it can never reach the SQL filter.
pub fn is_valid_chunk_id(id: &str) -> bool {
    id.len() == 64
        && id
            .bytes()
            .all(|b| b.is_ascii_digit() || (b'a'..=b'f').contains(&b))
}

/// WS3d-B — read EVERY non-tombstoned chunk's keyword facets for a full rebuild
/// of the BM25 keyword index. Returns `(chunk_id, path_token, matter_id,
/// privilege, text_plaintext)` per chunk.
///
/// Tombstoned rows (BUG-099) are excluded AT THE SOURCE via the shared retrieval
/// predicate, so unsafe content never enters the keyword ranking. All matters and
/// privilege levels ARE read (with their facets), because per-query scope
/// filtering happens inside the keyword index using those facets; the
/// authoritative boundary stays the scoped re-fetch (`fetch_by_ids_scoped`). The
/// `vector` column is deliberately NOT selected (it is large and unused here). A
/// row whose text cannot be decrypted is skipped (it simply won't be
/// keyword-searchable) rather than failing the whole rebuild.
pub async fn read_all_for_keyword_index(
    table: &Table,
    key: &[u8; 32],
    tombstoned_tokens: &[String],
) -> Result<Vec<(String, String, String, String, String)>> {
    use futures_util::TryStreamExt;
    let mut query = table.query();
    if let Some(predicate) = build_retrieval_predicate(None, true, tombstoned_tokens)? {
        query = query.only_if(predicate);
    }
    let mut stream = query
        .select(Select::columns(&[
            "id",
            "path",
            "matter_id",
            "privilege",
            "text",
            "encrypted",
        ]))
        .execute()
        .await
        .context("read_all_for_keyword_index query execute failed")?;

    let mut out: Vec<(String, String, String, String, String)> = Vec::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("read_all_for_keyword_index stream try_next failed")?
    {
        let id_col = batch
            .column_by_name("id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let path_col = batch
            .column_by_name("path")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let text_col = batch
            .column_by_name("text")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let (Some(id_col), Some(path_col), Some(text_col)) = (id_col, path_col, text_col) else {
            continue;
        };
        let matter_col = batch
            .column_by_name("matter_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let priv_col = batch
            .column_by_name("privilege")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let enc_col = batch
            .column_by_name("encrypted")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::BooleanArray>());
        for i in 0..batch.num_rows() {
            if id_col.is_null(i) || path_col.is_null(i) {
                continue;
            }
            let id = id_col.value(i).to_string();
            let path_token = path_col.value(i).to_string();
            let matter_id = matter_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string())
                .unwrap_or_default();
            let privilege = priv_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string())
                .unwrap_or_else(|| PRIVILEGE_NONE.to_string());
            let encrypted = enc_col.map(|c| !c.is_null(i) && c.value(i)).unwrap_or(false);
            let raw = text_col.value(i);
            let text = if encrypted {
                match hex::decode(raw)
                    .ok()
                    .and_then(|b| crate::commands::mail::crypto::decrypt_with_key(&b, key).ok())
                    .and_then(|v| String::from_utf8(v).ok())
                {
                    Some(t) => t,
                    None => continue, // undecryptable → not keyword-searchable
                }
            } else {
                raw.to_string()
            };
            out.push((id, path_token, matter_id, privilege, text));
        }
    }
    Ok(out)
}

/// WS3d-B — re-fetch specific chunks BY ID, applying the IDENTICAL retrieval
/// prefilter the vector pass uses (matter / privilege / tombstone via
/// `build_retrieval_predicate`). THIS is the authoritative scope boundary for
/// keyword-proposed candidates: any id that fails the predicate (wrong matter,
/// privileged-and-not-included, tombstoned) or no longer exists is simply absent
/// from the result. The keyword index never decides visibility; this does.
///
/// `ids` are validated (must be 64-hex chunk ids), de-duplicated, and capped
/// before interpolation. The returned `StoredHit`s carry a SENTINEL `distance`
/// of `1.0` (the worst cosine distance): these rows came from a point lookup, not
/// a vector query, so their distance is meaningless — the hybrid caller orders
/// them by the fused score and never by distance. The sentinel ensures that even
/// if some path did sort by distance, a keyword-only hit can never masquerade as
/// a perfect (distance 0) vector match.
pub async fn fetch_by_ids_scoped(
    table: &Table,
    ids: &[String],
    scope: Option<&str>,
    include_privileged: bool,
    tombstoned_tokens: &[String],
) -> Result<Vec<StoredHit>> {
    use futures_util::TryStreamExt;
    // Validate + dedupe + cap. Invalid ids are dropped, never interpolated.
    let mut seen: HashSet<&str> = HashSet::new();
    let mut valid: Vec<&str> = Vec::new();
    for id in ids {
        if is_valid_chunk_id(id) && seen.insert(id.as_str()) {
            valid.push(id.as_str());
            if valid.len() >= MAX_FETCH_BY_IDS {
                break;
            }
        }
    }
    if valid.is_empty() {
        return Ok(Vec::new());
    }
    // Safe to interpolate without sql_escape: every id passed is_valid_chunk_id
    // (64 chars of [0-9a-f] only), so it cannot contain a quote or any SQL meta.
    let id_list = valid
        .iter()
        .map(|i| format!("'{i}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let id_clause = format!("id IN ({id_list})");
    let predicate = match build_retrieval_predicate(scope, include_privileged, tombstoned_tokens)? {
        Some(p) => format!("({p}) AND ({id_clause})"),
        None => id_clause,
    };
    let mut stream = table
        .query()
        .only_if(predicate)
        // Skip the large `vector` column; the hybrid caller needs only the
        // citation/display columns.
        .select(Select::columns(&[
            "id",
            "path",
            "matter_id",
            "source_id",
            "paragraph_index",
            "text",
            "source_type",
            "page_number",
            "encrypted",
            "privilege",
            "extraction",
            "extraction_confidence",
            "locator",
            "path_enc",
        ]))
        .limit(valid.len())
        .execute()
        .await
        .context("fetch_by_ids_scoped query execute failed")?;

    let mut out: Vec<StoredHit> = Vec::with_capacity(valid.len());
    while let Some(batch) = stream
        .try_next()
        .await
        .context("fetch_by_ids_scoped stream try_next failed")?
    {
        // Mirrors `nearest`'s row reader (kept separate so `nearest` — the merged
        // baseline path — stays byte-for-byte untouched). The only difference is
        // the sentinel distance, since a point lookup has no `_distance`.
        let path_col = batch
            .column_by_name("path")
            .context("missing path column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("path column is not StringArray")?;
        let id_col = batch
            .column_by_name("id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let matter_col = batch
            .column_by_name("matter_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let source_col = batch
            .column_by_name("source_id")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let pi_col = batch
            .column_by_name("paragraph_index")
            .context("missing paragraph_index column")?
            .as_any()
            .downcast_ref::<UInt32Array>()
            .context("paragraph_index column is not UInt32Array")?;
        let text_col = batch
            .column_by_name("text")
            .context("missing text column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("text column is not StringArray")?;
        let st_col = batch
            .column_by_name("source_type")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let pn_col = batch
            .column_by_name("page_number")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>());
        let enc_col = batch
            .column_by_name("encrypted")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::BooleanArray>());
        let priv_col = batch
            .column_by_name("privilege")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let ext_col = batch
            .column_by_name("extraction")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let ext_conf_col = batch
            .column_by_name("extraction_confidence")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::Float32Array>());
        let loc_col = batch
            .column_by_name("locator")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());
        let penc_col = batch
            .column_by_name("path_enc")
            .and_then(|c| c.as_any().downcast_ref::<StringArray>());

        for i in 0..batch.num_rows() {
            let source_type = st_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let page_number = pn_col.filter(|c| !c.is_null(i)).map(|c| c.value(i));
            let encrypted = enc_col.map(|c| !c.is_null(i) && c.value(i)).unwrap_or(false);
            let id = id_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string())
                .unwrap_or_default();
            let matter_id = matter_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let source_id = source_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let privilege = priv_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let extraction = ext_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let extraction_confidence = ext_conf_col.filter(|c| !c.is_null(i)).map(|c| c.value(i));
            let locator = loc_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            let path_enc = penc_col
                .filter(|c| !c.is_null(i))
                .map(|c| c.value(i).to_string());
            out.push(StoredHit {
                id,
                path: path_col.value(i).to_string(),
                matter_id,
                source_id,
                paragraph_index: pi_col.value(i),
                text: text_col.value(i).to_string(),
                // Sentinel: worst cosine distance. Never used for ordering on the
                // hybrid path (fused score governs); guards against any accidental
                // distance-based sort treating a keyword-only hit as a perfect match.
                distance: 1.0,
                source_type,
                page_number,
                encrypted,
                privilege,
                extraction,
                extraction_confidence,
                locator,
                path_enc,
            });
        }
    }
    Ok(out)
}

// ---------------------------------------------------------------------------
// WS-B/C: point lookup for citation verification.
// ---------------------------------------------------------------------------

/// A single row located by an exact `id` lookup, used by citation verification.
/// Carries the stored matter_id and (decrypt-pending) text so the caller can
/// assert scope and quoted-text containment.
#[derive(Debug, Clone)]
pub struct ChunkRecord {
    pub id: String,
    pub matter_id: String,
    pub source_id: String,
    pub paragraph_index: u32,
    /// Raw stored text. If `encrypted` is true this is hex-encoded ciphertext
    /// the caller must decrypt before comparing.
    pub text: String,
    pub encrypted: bool,
    /// WS-PRIV: the chunk's privilege status (None only on a pre-WS-PRIV row).
    /// Verification does NOT filter on privilege — a privileged source must still
    /// verify for an explicitly-included query — but the value is surfaced so the
    /// caller can audit/label it.
    pub privilege: Option<String>,
    /// VG-6e: hex AES-256-GCM ciphertext of the real source path (the
    /// `source_id` field above holds the keyed token on V10 rows). None on a
    /// pre-V10 row. Verification itself never needs the path; surfaced so a
    /// caller that wants to display the verified source can decrypt it.
    pub path_enc: Option<String>,
}

/// Look up at most one chunk by its content-addressed `id`. Optionally
/// constrain to a matter (`scope`) — verification uses this to require that the
/// chunk both exists AND lives in the claimed matter (a prefiltered point read).
/// Returns None if no row matches. SECURITY: id + matter_id are escaped before
/// interpolation.
pub async fn lookup_by_id(
    table: &Table,
    id: &str,
    scope: Option<&str>,
) -> Result<Option<ChunkRecord>> {
    use futures_util::TryStreamExt;
    let predicate = match scope {
        Some(matter_id) => {
            let matter_id = validate_matter_id(matter_id)?;
            format!(
                "id = '{}' AND matter_id = '{}'",
                sql_escape(id),
                sql_escape(matter_id)
            )
        }
        None => format!("id = '{}'", sql_escape(id)),
    };
    let mut stream = table
        .query()
        .only_if(predicate)
        .limit(1)
        .execute()
        .await
        .context("lookup_by_id query execute failed")?;

    while let Some(batch) = stream
        .try_next()
        .await
        .context("lookup_by_id stream try_next failed")?
    {
        if batch.num_rows() == 0 {
            continue;
        }
        let str_col = |name: &str| -> Option<&StringArray> {
            batch
                .column_by_name(name)
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
        };
        let id_v = str_col("id")
            .map(|c| c.value(0).to_string())
            .unwrap_or_default();
        let matter_v = str_col("matter_id")
            .map(|c| c.value(0).to_string())
            .unwrap_or_default();
        let source_v = str_col("source_id")
            .map(|c| c.value(0).to_string())
            .unwrap_or_default();
        let text_v = str_col("text")
            .map(|c| c.value(0).to_string())
            .unwrap_or_default();
        let pi_v = batch
            .column_by_name("paragraph_index")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>())
            .map(|c| c.value(0))
            .unwrap_or(0);
        let enc_v = batch
            .column_by_name("encrypted")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::BooleanArray>())
            .map(|c| !c.is_null(0) && c.value(0))
            .unwrap_or(false);
        let priv_v = str_col("privilege")
            .filter(|c| !c.is_null(0))
            .map(|c| c.value(0).to_string());
        // VG-6e: absent on pre-V10 tables → None.
        let penc_v = str_col("path_enc")
            .filter(|c| !c.is_null(0))
            .map(|c| c.value(0).to_string());
        return Ok(Some(ChunkRecord {
            id: id_v,
            matter_id: matter_v,
            source_id: source_v,
            paragraph_index: pi_v,
            text: text_v,
            encrypted: enc_v,
            privilege: priv_v,
            path_enc: penc_v,
        }));
    }
    Ok(None)
}

/// P2.1 (Finding 2) — batch sibling of `lookup_by_id` for BATCH citation
/// verification. Given many chunk ids, run ONE `id IN (...)` query and return
/// EVERY matching row as a `ChunkRecord`, rather than issuing one (or two)
/// point lookups per citation. The table is opened once by the caller.
///
/// SEMANTICS — deliberately UNSCOPED. Like `lookup_by_id(.., None)`, this
/// applies NO matter / privilege / tombstone predicate: the caller
/// (`rag_verify_citations_batch`) reproduces the exact single-citation
/// classification in memory — pick the row under the CLAIMED matter first
/// (Verified/TextMismatch), else any row (MatterMismatch), and treat a
/// tombstoned source as NotFound. Returning all rows (including a same-id row
/// under another matter, and tombstoned rows) is what lets the caller make that
/// three-way call without a second round-trip. It NEVER widens what a scoped
/// retrieval returns — it feeds verification, which only ever refuses or
/// downgrades a citation, never surfaces new content.
///
/// A single `id` can legitimately match MORE THAN ONE row (e.g. the same file
/// left a stale row after a failed cleanup, or was retagged to a new matter), so
/// we do NOT cap the row count with `.limit()` — every match is returned so the
/// caller sees the same rows `lookup_by_id` would have. The id list itself is
/// validated (64-hex only), deduped, and capped at `MAX_FETCH_BY_IDS` before it
/// reaches the SQL predicate, exactly like `fetch_by_ids_scoped`.
pub async fn fetch_records_by_ids(table: &Table, ids: &[String]) -> Result<Vec<ChunkRecord>> {
    use futures_util::TryStreamExt;
    let mut seen: HashSet<&str> = HashSet::new();
    let mut valid: Vec<&str> = Vec::new();
    for id in ids {
        if is_valid_chunk_id(id) && seen.insert(id.as_str()) {
            valid.push(id.as_str());
            if valid.len() >= MAX_FETCH_BY_IDS {
                break;
            }
        }
    }
    if valid.is_empty() {
        return Ok(Vec::new());
    }
    // Safe to interpolate without sql_escape: every id is 64 chars of [0-9a-f].
    let id_list = valid
        .iter()
        .map(|i| format!("'{i}'"))
        .collect::<Vec<_>>()
        .join(", ");
    let predicate = format!("id IN ({id_list})");
    // Skip the large `vector` column — verification needs only citation columns.
    let mut stream = table
        .query()
        .only_if(predicate)
        .select(Select::columns(&[
            "id",
            "matter_id",
            "source_id",
            "paragraph_index",
            "text",
            "encrypted",
            "privilege",
            "path_enc",
        ]))
        .execute()
        .await
        .context("fetch_records_by_ids query execute failed")?;

    let mut out: Vec<ChunkRecord> = Vec::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("fetch_records_by_ids stream try_next failed")?
    {
        let str_col = |name: &str| -> Option<&StringArray> {
            batch
                .column_by_name(name)
                .and_then(|c| c.as_any().downcast_ref::<StringArray>())
        };
        let id_col = str_col("id");
        let matter_col = str_col("matter_id");
        let source_col = str_col("source_id");
        let text_col = str_col("text");
        let priv_col = str_col("privilege");
        let penc_col = str_col("path_enc");
        let pi_col = batch
            .column_by_name("paragraph_index")
            .and_then(|c| c.as_any().downcast_ref::<UInt32Array>());
        let enc_col = batch
            .column_by_name("encrypted")
            .and_then(|c| c.as_any().downcast_ref::<arrow_array::BooleanArray>());
        for i in 0..batch.num_rows() {
            out.push(ChunkRecord {
                id: id_col
                    .filter(|c| !c.is_null(i))
                    .map(|c| c.value(i).to_string())
                    .unwrap_or_default(),
                matter_id: matter_col
                    .filter(|c| !c.is_null(i))
                    .map(|c| c.value(i).to_string())
                    .unwrap_or_default(),
                source_id: source_col
                    .filter(|c| !c.is_null(i))
                    .map(|c| c.value(i).to_string())
                    .unwrap_or_default(),
                paragraph_index: pi_col.map(|c| c.value(i)).unwrap_or(0),
                text: text_col
                    .filter(|c| !c.is_null(i))
                    .map(|c| c.value(i).to_string())
                    .unwrap_or_default(),
                encrypted: enc_col.map(|c| !c.is_null(i) && c.value(i)).unwrap_or(false),
                privilege: priv_col
                    .filter(|c| !c.is_null(i))
                    .map(|c| c.value(i).to_string()),
                path_enc: penc_col
                    .filter(|c| !c.is_null(i))
                    .map(|c| c.value(i).to_string()),
            });
        }
    }
    Ok(out)
}

/// Collect the PLAINTEXT path key ("mail:<id>") of EVERY mail chunk into a
/// set — one scan — so the mail RAG backfill can answer "is this message
/// already indexed?" by set membership instead of issuing a `count_rows`
/// query per message. Paths repeat once per chunk; the set collapses them to
/// one entry per message.
///
/// VG-6e: the `path` column holds opaque tokens now, so the former
/// `path LIKE 'mail:%'` prefix scan is impossible BY DESIGN (a token kills
/// prefixes). Mail rows are selected on the existing plaintext
/// `source_type = 'mail'` column instead, and the plaintext "mail:<id>" keys
/// are recovered by decrypting `path_enc` under the vector master `key` —
/// the SAME plaintext the backfill's `format!("mail:{id}")` probes with, so
/// set membership keeps working. A row whose path_enc is missing or fails to
/// decrypt is skipped: the backfill then just re-indexes that message
/// (delete-then-insert is idempotent — redundant work, never a gap).
pub async fn list_indexed_mail_paths(table: &Table, key: &[u8; 32]) -> Result<HashSet<String>> {
    use futures_util::TryStreamExt;
    let mut stream = table
        .query()
        .only_if("source_type = 'mail'")
        .select(Select::columns(&["path_enc"]))
        .execute()
        .await
        .context("list_indexed_mail_paths query execute failed")?;

    let mut out = HashSet::new();
    while let Some(batch) = stream
        .try_next()
        .await
        .context("list_indexed_mail_paths stream try_next failed")?
    {
        let penc_col = batch
            .column_by_name("path_enc")
            .context("missing path_enc column")?
            .as_any()
            .downcast_ref::<StringArray>()
            .context("path_enc column is not StringArray")?;
        for i in 0..penc_col.len() {
            if penc_col.is_null(i) {
                continue;
            }
            let decrypted = hex::decode(penc_col.value(i))
                .ok()
                .and_then(|blob| crate::commands::mail::crypto::decrypt_with_key(&blob, key).ok())
                .and_then(|v| String::from_utf8(v).ok());
            match decrypted {
                Some(p) => {
                    out.insert(p);
                }
                None => log::warn!(
                    "list_indexed_mail_paths: a mail row's path_enc did not decrypt; \
                     the backfill will re-index that message"
                ),
            }
        }
    }
    Ok(out)
}

