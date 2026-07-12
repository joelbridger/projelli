use super::*;

/// Convert source-provided timestamps to the one safe wire form. A malformed
/// legacy date remains visible as raw source text, but is never invented or
/// replaced with an index timestamp.
fn source_date_from_raw(raw: &str, kind: SourceDateKind) -> SourceDate {
    use chrono::{DateTime, SecondsFormat, Utc};

    let raw = raw.trim();
    let parsed = DateTime::parse_from_rfc3339(raw)
        .map(|value| value.with_timezone(&Utc))
        .or_else(|_| {
            DateTime::parse_from_str(raw, "%Y-%m-%d %I:%M %p %z")
                .map(|value| value.with_timezone(&Utc))
        });
    match parsed {
        Ok(value) => SourceDate {
            value: Some(value.to_rfc3339_opts(SecondsFormat::Millis, true)),
            kind,
            raw_value: None,
            confidence: SourceDateConfidence::Source,
        },
        Err(_) => SourceDate {
            value: None,
            kind,
            raw_value: (!raw.is_empty()).then(|| raw.to_string()),
            confidence: SourceDateConfidence::Source,
        },
    }
}

/// Read local filesystem metadata. Modified wins because it reflects the
/// version that an advisor can open now; created is the honest fallback. This
/// is *derived* local metadata, not a date supplied by the document itself.
fn document_source_date(path: &str) -> Option<SourceDate> {
    use chrono::{DateTime, SecondsFormat, Utc};

    let metadata = std::fs::metadata(path).ok()?;
    let (time, kind) = metadata
        .modified()
        .map(|time| (time, SourceDateKind::DocumentModified))
        .or_else(|_| metadata.created().map(|time| (time, SourceDateKind::Created)))
        .ok()?;
    Some(SourceDate {
        value: Some(
            DateTime::<Utc>::from(time).to_rfc3339_opts(SecondsFormat::Millis, true),
        ),
        kind,
        raw_value: None,
        confidence: SourceDateConfidence::Derived,
    })
}

fn mail_source_date(received_date_time: Option<&str>) -> Option<SourceDate> {
    received_date_time
        .filter(|value| !value.trim().is_empty())
        .map(|value| source_date_from_raw(value, SourceDateKind::Received))
}

#[derive(Debug, Clone)]
struct SourceDateMetadata { source_date: Option<SourceDate>, dated_fact: Option<DatedFact> }

fn nonempty_json_string(json: &serde_json::Value, fields: &[&str]) -> Option<String> {
    fields.iter().find_map(|field| json.get(*field).and_then(serde_json::Value::as_str).map(str::trim).filter(|value| !value.is_empty()).map(str::to_string))
}

fn mail_dated_fact(record: &crate::commands::mail::store::MailRecord) -> Option<DatedFact> {
    let date = record.received_date_time.as_deref()?.trim();
    if date.is_empty() { return None; }
    let identity = record.internet_message_id.as_deref().map(str::trim).filter(|value| !value.is_empty()).unwrap_or(&record.id);
    Some(DatedFact { key: format!("mail-message:{identity}:received-date"), value: date.to_string(), authority_reason: None })
}

/// Notes and generic records are living CRM records: their last update is the
/// relevant date. Other object kinds remain created-first, with an update fallback.
fn crm_date_candidates(row: &crate::commands::crm::store::CrmObjectRow) -> [(SourceDateKind, Option<String>); 2] {
    let json = serde_json::from_str::<serde_json::Value>(&row.json).ok();
    let created = json.as_ref().and_then(|value| nonempty_json_string(value, &["created_at", "createdAt"]));
    let updated = json.as_ref().and_then(|value| nonempty_json_string(value, &["updated_at", "updatedAt"])).or_else(|| (!row.updated_at.trim().is_empty()).then(|| row.updated_at.trim().to_string()));
    match row.kind.trim().to_ascii_lowercase().as_str() {
        "note" | "notes" | "record" | "records" => [(SourceDateKind::Updated, updated), (SourceDateKind::Created, created)],
        _ => [(SourceDateKind::Created, created), (SourceDateKind::Updated, updated)],
    }
}

fn crm_source_date(row: &crate::commands::crm::store::CrmObjectRow) -> Option<SourceDate> {
    for (kind, value) in crm_date_candidates(row) {
        if let Some(value) = value { return Some(source_date_from_raw(&value, kind)); }
    }
    None
}

fn source_date_kind_name(kind: SourceDateKind) -> &'static str {
    match kind { SourceDateKind::Effective => "effective", SourceDateKind::Received => "received", SourceDateKind::Sent => "sent", SourceDateKind::Created => "created", SourceDateKind::Updated => "updated", SourceDateKind::EventStart => "event-start", SourceDateKind::DocumentModified => "document-modified", SourceDateKind::SnapshotExported => "snapshot-exported", SourceDateKind::Unknown => "unknown" }
}

fn crm_dated_fact(row: &crate::commands::crm::store::CrmObjectRow) -> Option<DatedFact> {
    let (kind, date) = crm_date_candidates(row).into_iter().find_map(|(kind, value)| value.map(|value| (kind, value)))?;
    let json = serde_json::from_str::<serde_json::Value>(&row.json).ok();
    let identity = json.as_ref().and_then(|value| nonempty_json_string(value, &["external_id", "externalId", "id"])).unwrap_or_else(|| row.id.clone());
    Some(DatedFact { key: format!("crm-record:{}:{}:{}-date", row.kind.trim().to_ascii_lowercase(), identity, source_date_kind_name(kind)), value: date, authority_reason: None })
}

/// Fill dates from the authoritative local source after paths have been
/// decrypted but before the result crosses IPC. This deliberately never uses
/// `indexed_at`: search timing is not evidence timing.
fn attach_source_dates(workspace: &std::path::Path, hits: &mut [Hit]) {
    use crate::commands::mail::store::MailStore;

    let has_mail = hits.iter().any(|hit| hit.source_type.as_deref() == Some("mail"));
    let has_crm = hits.iter().any(|hit| hit.source_type.as_deref() == Some("crm"));
    let mail_store = has_mail
        .then(|| crate::commands::mail::store::EncryptedMailStore::db_path(workspace))
        .filter(|path| path.exists())
        .and_then(|_| crate::commands::mail::store::EncryptedMailStore::open(workspace).ok());
    let crm_store = has_crm
        .then(|| crate::commands::crm::store::CrmStore::db_path(workspace))
        .filter(|path| path.exists())
        .and_then(|_| crate::commands::crm::store::CrmStore::open(workspace).ok());

    for hit in hits.iter_mut() {
        let metadata = match hit.source_type.as_deref() {
            Some("mail") => hit
                .source_id
                .as_deref()
                .and_then(|source_id| source_id.strip_prefix("mail:"))
                .and_then(|id| mail_store.as_ref()?.get_record(id).ok().flatten())
                .map(|record| SourceDateMetadata { source_date: mail_source_date(record.received_date_time.as_deref()), dated_fact: mail_dated_fact(&record) }),
            Some("crm") => hit
                .source_id
                .as_deref()
                .and_then(|source_id| source_id.strip_prefix("crm:"))
                .and_then(|id| crm_store.as_ref()?.get_object(id).ok().flatten())
                .map(|record| SourceDateMetadata { source_date: crm_source_date(&record), dated_fact: crm_dated_fact(&record) }),
            _ => Some(SourceDateMetadata { source_date: document_source_date(&hit.path), dated_fact: None }),
        };
        hit.source_date = metadata.as_ref().and_then(|metadata| metadata.source_date.clone());
        hit.dated_fact = metadata.and_then(|metadata| metadata.dated_fact);
    }
    attach_date_conflicts(hits);
}

fn normalized_claim_part(value: &str) -> String { value.split_whitespace().collect::<Vec<_>>().join(" ").to_ascii_lowercase() }
/// Date warnings are deliberately limited to matching imported copies of one
/// mail or CRM record. Do not turn two documents that happen to mention
/// different business facts into a detected conflict; that needs a future
/// cross-document fact-extraction feature.
fn is_same_record_timestamp_key(value: &str) -> bool {
    let value = value.trim();
    (value.starts_with("mail-message:") && value.ends_with(":received-date"))
        || (value.starts_with("crm-record:")
            && (value.ends_with(":created-date") || value.ends_with(":updated-date")))
}
fn hit_source_id(hit: &Hit) -> String { hit.source_id.clone().or_else(|| hit.id.clone()).unwrap_or_else(|| format!("{}#{}", hit.path, hit.paragraph_index)) }
fn source_date_timestamp(date: &SourceDate) -> Option<chrono::DateTime<chrono::Utc>> { date.value.as_deref().and_then(|value| chrono::DateTime::parse_from_rfc3339(value).ok()).map(|value| value.with_timezone(&chrono::Utc)) }

fn attach_date_conflicts(hits: &mut [Hit]) {
    use std::collections::HashMap;
    let mut groups: HashMap<String, Vec<usize>> = HashMap::new();
    for (index, hit) in hits.iter().enumerate() {
        let (Some(fact), Some(date)) = (hit.dated_fact.as_ref(), hit.source_date.as_ref()) else { continue };
        if source_date_timestamp(date).is_none() { continue; }
        let key = normalized_claim_part(&fact.key);
        if !key.is_empty() && is_same_record_timestamp_key(&key) { groups.entry(key).or_default().push(index); }
    }
    for (fact_key, indexes) in groups {
        let values = indexes.iter().filter_map(|index| hits[*index].dated_fact.as_ref()).map(|fact| normalized_claim_part(&fact.value)).collect::<std::collections::HashSet<_>>();
        if values.len() < 2 { continue; }
        let mut dated_evidence: Vec<(chrono::DateTime<chrono::Utc>, DatedEvidence)> = indexes.iter().filter_map(|index| {
            let hit = &hits[*index]; let fact = hit.dated_fact.as_ref()?; let source_date = hit.source_date.as_ref()?;
            Some((source_date_timestamp(source_date)?, DatedEvidence { source_id: hit_source_id(hit), path: hit.path.clone(), value: fact.value.clone(), source_date: source_date.clone(), authority_reason: fact.authority_reason.clone() }))
        }).collect();
        dated_evidence.sort_by(|left, right| left.0.cmp(&right.0).then_with(|| left.1.source_id.cmp(&right.1.source_id)));
        let Some((_, newest)) = dated_evidence.last() else { continue };
        let newest_source_id = newest.source_id.clone();
        let evidence: Vec<DatedEvidence> = dated_evidence.into_iter().map(|(_, evidence)| evidence).collect();
        for index in indexes {
            hits[index].date_conflict = Some(DateConflictFlag { kind: DateConflictKind::ConflictingDatedEvidence, fact_key: fact_key.clone(), relation: if hit_source_id(&hits[index]) == newest_source_id { DateConflictRelation::NewerConflictsWithOlder } else { DateConflictRelation::OlderConflictsWithNewer }, evidence: evidence.clone() });
        }
    }
}

/// F-510 — per-source diversity cap. A single large low-signal file can
/// dominate a broad retrieval feed (huge-notes.md fed all four of finder
/// attempt 1's findings; rubric 0/5). Keep hits in descending-score order,
/// admit at most `cap` per source (source_id, falling back to path), stop
/// at `top_k`. `cap == 0` means "no cap" so a default-constructed call can
/// never silently empty the feed.
///
/// Pure, deterministic, and rank-preserving: the input order IS the ranking
/// and the output is a subsequence of it (the map below only counts — it
/// never reorders). `pub` so the leg-1 harness
/// (tests/rag_deposition_contradictions.rs) proves the PRODUCTION cap over
/// the real fixture corpus instead of a reimplementation.
pub fn cap_per_source(hits: Vec<Hit>, cap: usize, top_k: usize) -> Vec<Hit> {
    if cap == 0 {
        let mut out = hits;
        out.truncate(top_k);
        return out;
    }
    let mut admitted: std::collections::HashMap<String, usize> = std::collections::HashMap::new();
    let mut out: Vec<Hit> = Vec::with_capacity(top_k.min(hits.len()));
    for hit in hits {
        if out.len() >= top_k {
            break;
        }
        let key = hit
            .source_id
            .clone()
            .unwrap_or_else(|| hit.path.clone());
        let count = admitted.entry(key).or_insert(0);
        if *count < cap {
            *count += 1;
            out.push(hit);
        }
    }
    out
}

/// Embed `query` and return the top-k nearest stored chunks, scoped to a matter.
///
/// WS-B/C — THE SECURITY CORE. `scope` is REQUIRED (no implicit cross-matter
/// search):
///   - `Matter { matter_id }` constrains the query with a LanceDB PREFILTER on
///     `matter_id` (prefilter defaults to true). The vector search runs only
///     over in-scope rows, so a Matter-A query can never surface a Matter-B
///     chunk — even under an adversarial confusable term, even at large top_k.
///   - `AllMatters` is a deliberate, separately-named cross-matter capability;
///     it is the ONLY way to search across matters and is never the default.
///
/// WS-PRIV — `include_privileged` is the litigation-safety boundary. It defaults
/// to `false` (via `#[serde(default)]`) so a caller that omits it gets the safe
/// behaviour: attorney-client / work-product chunks are EXCLUDED. Passing `true`
/// is a deliberate, separately-named decision (analogous to `AllMatters`) that
/// composes into the SAME prefilter — never a silent default. Default retrieval
/// therefore never returns privileged content.
///
/// WS-VEC: every chunk's `text` column is encrypted at rest under the vector-
/// store key. This function decrypts in memory before returning; plaintext is
/// never persisted. If decryption fails (key unavailable, tampered data), the
/// chunk text is returned as "[content unavailable]" — retrieval never panics or
/// fails due to a single bad chunk.
///
/// F-510 — `per_source_cap` (camelCase `perSourceCap` over IPC) is an OPTIONAL
/// per-source diversity cap: absent (every existing caller) = behavior
/// unchanged. `Some(cap > 0)` overfetches `top_k * 4` (defensively capped at
/// 200), then `cap_per_source` admits at most `cap` hits per source and
/// truncates to `top_k`. The privilege/matter PREFILTER above is untouched —
/// the cap runs over already-scoped hits, so it can only NARROW a feed, never
/// widen it; it cannot weaken isolation. Today only the contradiction finder
/// passes a cap (perSourceCap: 4); chat retrieval is unchanged.
/// WS3d-A — `enable_reranker` (camelCase `enableReranker` over IPC) is the
/// OPTIONAL cross-encoder reranking layer. DEFAULT OFF: absent or `false`
/// leaves retrieval byte-for-byte the vector-only path (same fetch size, same
/// scores, same order). Only an explicit `true` turns it on, and even then it
/// re-orders ONLY within the already-scoped, already-prefiltered candidate set
/// `nearest()` returned — it can never widen scope, re-admit a prefiltered-out
/// chunk, or change which matters/privilege are visible (re-ranking ≠
/// re-retrieval). If the reranker model isn't downloaded or fails to load,
/// retrieval transparently falls back to the vector-only order — never crashes,
/// never blocks an answer.
#[tauri::command]
pub async fn rag_retrieve(
    state: State<'_, RagState>,
    query: String,
    top_k: u32,
    scope: RetrievalScope,
    include_privileged: Option<bool>,
    per_source_cap: Option<u32>,
    enable_reranker: Option<bool>,
    enable_hybrid_search: Option<bool>,
) -> Result<Vec<Hit>, String> {
    if query.trim().is_empty() || top_k == 0 {
        return Ok(Vec::new());
    }
    // BUG-099 fail-closed: if the durable tombstone file was unreadable on
    // workspace open, the real unsafe-token set is unknown, so we cannot prove a
    // result is not stale. Refuse to serve (typed error the frontend surfaces as
    // "memory needs rebuilding") rather than risk citing a stale row. Cleared by
    // a clean full re-index, which rewrites the tombstone file.
    if state.index_integrity_unknown.load(Ordering::SeqCst) {
        return Err(
            "memory integrity is uncertain (the safety record could not be read); \
             re-index this workspace before searching"
                .to_string(),
        );
    }
    // WS-PRIV: absent (legacy callers) or false → EXCLUDE privileged content.
    // Only an explicit `true` flips it. The default is the safe one.
    let include_privileged = include_privileged.unwrap_or(false);
    // F-510: cap == 0 (or absent) = no cap. With a cap we OVERFETCH so the
    // per-source filter has candidates from other sources to fill from.
    let cap = per_source_cap.unwrap_or(0) as usize;
    // WS3d-A: default OFF. When ON, we likewise OVERFETCH so the cross-encoder
    // can promote a strongly-relevant chunk the vector pass ranked just outside
    // top_k into the final set, then we truncate back to top_k after re-sort.
    // Every overfetched candidate still went through the SAME matter/privilege/
    // tombstone prefilter inside nearest() — overfetch widens depth, never scope.
    //
    // EXACT fallback: we only overfetch when the reranker is actually going to
    // run — i.e. the flag is on AND the model is present and loads
    // (`ensure_ready`). If it's absent or fails to load, `want_rerank` is false
    // and `fetch_k` stays `top_k`, so retrieval is byte-for-byte the vector-only
    // path — never a top-K skimmed off a larger ANN query whose candidate
    // exploration / tie order could differ. (Codex review, P2.)
    let enable_reranker = enable_reranker.unwrap_or(false);
    let want_rerank = enable_reranker && reranker::ensure_ready().await;
    // WS3d-B: hybrid (BM25 keyword + vector) search, default OFF. When ON we
    // overfetch the vector side too, so the fusion has depth to promote a keyword
    // hit the vector pass ranked just outside top_k. OFF (the shipped default) is
    // a TRUE no-op below: no keyword index touched, byte-for-byte the vector path.
    let enable_hybrid = enable_hybrid_search.unwrap_or(false);
    let fetch_k = if cap > 0 || want_rerank || enable_hybrid {
        (top_k as usize).saturating_mul(4).min(200)
    } else {
        top_k as usize
    };
    // Resolve + validate the scope into the store-level filter argument BEFORE
    // any work. Matter ids are validated here (defence-in-depth before the SQL
    // prefilter). AllMatters → None (no filter; deliberate cross-matter).
    let scope_filter: Option<String> = match &scope {
        RetrievalScope::Matter { matter_id } => Some(
            store::validate_matter_id(matter_id)
                .map(|s| s.to_string())
                .map_err(|e| format!("invalid scope matter_id: {e}"))?,
        ),
        RetrievalScope::AllMatters => None,
    };
    let workspace = require_workspace(&state).await?;
    // P2.1 (Finding 4): reuse the cached open table handle (opens once per
    // workspace, not once per Ask). None = no table yet → empty result so
    // first-launch callers get a clean fall-through.
    let Some(table) = cached_chunks_table(&state, &workspace).await? else {
        return Ok(Vec::new());
    };

    // {e:#} = full anyhow chain, so the typed model-not-ready marker at the
    // root cause survives any .context() wrapping when it crosses IPC (the
    // frontend routes its refusal message on that marker).
    let qvec = embedder::embed_query(&query)
        .await
        .map_err(|e| format!("embed query: {e:#}"))?;

    // BUG-099 tombstone: the in-memory unsafe set already holds the at-rest HMAC
    // path TOKENS (the `path` column value), so we exclude them directly as SQL
    // `path NOT IN (...)` — no key needed, no plaintext→token conversion. This is
    // the single enforcer: a stale citation is IMPOSSIBLE after a cleanup failure
    // because the row's token is excluded at the prefilter level. The set is kept
    // durable on disk and re-hydrated on workspace open, so it holds across restart.
    let tombstoned_tokens: Vec<String> = {
        let guard = state.unsafe_tokens.lock().await;
        guard.iter().cloned().collect()
    };

    let raw = store::nearest(
        &table,
        &qvec,
        fetch_k,
        scope_filter.as_deref(),
        include_privileged,
        &tombstoned_tokens,
    )
    .await
    .map_err(|e| format!("nearest: {e}"))?;

    // WS-VEC: get the vector-store master key for the per-hit text/path decrypt
    // below. If the keychain is unavailable, encrypted chunks fall through to the
    // "[content unavailable]" placeholder — retrieval still works for plaintext rows.
    let enc_key = crypto::get_or_create_master_key().ok();

    // WS3d-B: hoisted into a named closure so the SAME decrypt → Hit mapping is
    // reused for keyword-only candidates re-fetched on the hybrid path below.
    let to_hit = |h: store::StoredHit| -> Hit {
            let chunk_text = if h.encrypted {
                // WS-VEC: decrypt the hex-encoded ciphertext in memory.
                // On any failure (bad key, tampered, keychain locked): return
                // a placeholder string — do NOT crash or skip the chunk.
                if let Some(ref k) = enc_key {
                    hex::decode(&h.text)
                        .ok()
                        .and_then(|bytes| {
                            crate::commands::mail::crypto::decrypt_with_key(&bytes, k).ok()
                        })
                        .and_then(|v| String::from_utf8(v).ok())
                        .unwrap_or_else(|| "[content unavailable]".to_string())
                } else {
                    "[content unavailable — keychain locked]".to_string()
                }
            } else {
                // Pre-WS-VEC plaintext row (migration re-indexes these): as-is.
                h.text
            };
            // VG-6e: the stored path/source_id columns hold keyed tokens; the
            // real path rides the encrypted path_enc column. Decrypt it here
            // so the frontend keeps receiving real paths for display and
            // click-through. FAIL-CLOSED placeholder (the chunk-text pattern)
            // when the keychain is locked or the blob is bad; a legacy
            // pre-V10 row (no path_enc) passes its raw plaintext column
            // through — the migration re-indexes those away anyway.
            let (path, source_id) = match h.path_enc.as_deref() {
                Some(enc) => {
                    let decrypted = enc_key.as_ref().and_then(|k| {
                        hex::decode(enc)
                            .ok()
                            .and_then(|bytes| {
                                crate::commands::mail::crypto::decrypt_with_key(&bytes, k).ok()
                            })
                            .and_then(|v| String::from_utf8(v).ok())
                    });
                    match decrypted {
                        Some(p) => (p.clone(), Some(p)),
                        None => (
                            "[path unavailable]".to_string(),
                            Some("[path unavailable]".to_string()),
                        ),
                    }
                }
                None => (h.path, h.source_id),
            };
            Hit {
                path,
                chunk_text,
                score: embedder::cosine_distance_to_score(h.distance),
                paragraph_index: h.paragraph_index,
                // WS-B/C: carry the citation key + scope + source for the answer layer.
                id: if h.id.is_empty() { None } else { Some(h.id) },
                matter_id: h.matter_id,
                source_id,
                source_type: h.source_type,
                page_number: h.page_number,
                // WS-PRIV: carry the privilege status so an explicitly-included
                // privileged hit can be labelled. Default retrieval only returns "none".
                privilege: h.privilege,
                // VG-2: carry the OCR disclosure so citations can say
                // "scanned" / "low-confidence scan".
                extraction: h.extraction,
                extraction_confidence: h.extraction_confidence,
                // VG-3c: carry the page:line locator so transcript citations
                // can read "Tr. 45:12-46:3".
                locator: h.locator,
                source_date: None,
                dated_fact: None,
                date_conflict: None,
            }
    };
    let mut hits: Vec<Hit> = raw.into_iter().map(&to_hit).collect();

    // WS3d-B — THE HYBRID (BM25 keyword) SEAM. Default OFF: when `enable_hybrid`
    // is false this whole block is skipped, nothing touches the keyword index, and
    // the code below is byte-for-byte the vector-only path. When ON: (1) ensure
    // the keyword index reflects the live LanceDB version (lazily load from disk,
    // else rebuild from the store — covering every writer, since any write bumps
    // the table version); (2) keyword-search WITHIN the same scope; (3) re-fetch
    // the keyword-only candidates through the IDENTICAL scoped predicate
    // (`fetch_by_ids_scoped` — the authoritative boundary; any out-of-scope /
    // privileged / tombstoned / deleted id is dropped there); (4) fuse the vector
    // and keyword rankings with RRF and write the fused score onto each hit. This
    // can BROADEN which in-scope chunks surface (keyword recall) but can NEVER
    // surface a chunk the vector prefilter would exclude. GRACEFUL FALLBACK: any
    // failure (keychain locked, rebuild error, fetch error) leaves the vector-only
    // hits untouched — an answer is never blocked on keyword search.
    if enable_hybrid && enc_key.is_some() {
        let ek = enc_key.as_ref().unwrap();
        let dataset_dir = store::dataset_path(&workspace);
        let current_version = table.version().await.ok();

        // P2.1 (Finding 3): the query path NEVER rebuilds the keyword index
        // synchronously anymore. It searches an already-fresh in-memory or on-disk
        // index; if none is fresh, it returns no keyword hits (→ vector-only for
        // this query) and triggers ONE background rebuild so the NEXT query is
        // hybrid. `needs_warm` records whether we must kick that rebuild off (done
        // AFTER releasing the `bm25` lock, so the spawn can't deadlock on it).
        let mut needs_warm = false;
        let keyword_ranked: Vec<String> = {
            let mut guard = state.bm25.lock().await;
            // FRESH means: built at the live table version AND for THIS workspace.
            // Pairing the version with the workspace path stops a different
            // workspace's in-memory index (RagState is process-global) from being
            // reused just because its table happens to share a version number.
            let want_for = dataset_dir.as_path();
            let is_fresh = |g: &bm25_index::Bm25Index| {
                current_version.is_some_and(|v| g.is_fresh_for(v))
                    && g.built_for() == Some(want_for)
            };
            // `usable` tracks whether the in-memory index is safe to SEARCH for
            // this call. A stale index must NOT be searched — we degrade to
            // vector-only rather than rank on a stale snapshot.
            let mut usable = is_fresh(&guard);
            if !usable {
                // Warm start: load THIS workspace's on-disk index when the in-memory
                // one is for another workspace or was never populated. This is a
                // CHEAP deserialize (no full-corpus scan). (A stale same-workspace
                // index skips disk — the disk copy would be stale too.)
                if guard.built_for() != Some(want_for) || guard.is_empty() {
                    let (loaded, _) = bm25_index::Bm25Index::load(&dataset_dir, ek);
                    *guard = loaded;
                    usable = is_fresh(&guard);
                }
                // Still not fresh → do NOT scan+rebuild on the hot path. Fall back
                // to vector-only for this query and warm in the background.
                if !usable {
                    needs_warm = true;
                }
            }
            if usable && !guard.is_empty() {
                guard
                    .search(
                        &query,
                        fetch_k,
                        scope_filter.as_deref(),
                        include_privileged,
                        &tombstoned_tokens,
                    )
                    .into_iter()
                    .map(|(id, _)| id)
                    .collect()
            } else {
                Vec::new()
            }
        };
        if needs_warm {
            spawn_bm25_warm(
                &state,
                table.clone(),
                *ek,
                tombstoned_tokens.clone(),
                dataset_dir.clone(),
                current_version.unwrap_or(0),
                dataset_dir.clone(),
            );
        }

        if !keyword_ranked.is_empty() {
            // Vector ranking = current best-first hit order (nearest returns by
            // ascending distance = descending score).
            let vector_ranked: Vec<String> = hits.iter().filter_map(|h| h.id.clone()).collect();
            let have: std::collections::HashSet<&str> =
                hits.iter().filter_map(|h| h.id.as_deref()).collect();
            let keyword_only: Vec<String> = keyword_ranked
                .iter()
                .filter(|id| !have.contains(id.as_str()))
                .cloned()
                .collect();

            // Re-fetch keyword-only candidates through the authoritative scoped
            // predicate, then map them to Hits with the same decrypt closure.
            if !keyword_only.is_empty() {
                match store::fetch_by_ids_scoped(
                    &table,
                    &keyword_only,
                    scope_filter.as_deref(),
                    include_privileged,
                    &tombstoned_tokens,
                )
                .await
                {
                    Ok(extra) => hits.extend(extra.into_iter().map(&to_hit)),
                    Err(e) => log::warn!(
                        "rag_retrieve: hybrid keyword re-fetch failed ({e:#}); \
                         using vector hits only"
                    ),
                }
            }

            // Fuse and write the normalized fused score onto each id-bearing hit.
            let fused = bm25_index::rrf_fuse(&vector_ranked, &keyword_ranked, bm25_index::RRF_K);
            let max = fused
                .iter()
                .map(|(_, s)| *s)
                .fold(0.0f32, f32::max)
                .max(f32::EPSILON);
            let fused_scores: std::collections::HashMap<String, f32> = fused.into_iter().collect();
            for h in hits.iter_mut() {
                if let Some(id) = h.id.as_deref() {
                    if let Some(s) = fused_scores.get(id) {
                        h.score = s / max;
                    }
                }
            }
            // Establish a deterministic order now (score desc, id asc); the stable
            // sort shared with the vector/reranker paths below preserves it.
            hits.sort_by(|a, b| {
                b.score
                    .partial_cmp(&a.score)
                    .unwrap_or(std::cmp::Ordering::Equal)
                    .then_with(|| a.id.cmp(&b.id))
            });
        }
    }
    // WS3d-A — THE RERANKER SEAM. Default OFF: when `want_rerank` is false
    // (flag off, or the model is absent / failed to load) this whole block is
    // skipped, no overfetch happened above, and the code below is byte-for-byte
    // the historical vector-only path. When ON (flag set AND model ready),
    // re-score the already-decrypted, already-scoped `hits` with the
    // cross-encoder and overwrite each hit's score IN PLACE (the sort below then
    // re-orders by it). This re-orders WITHIN the prefiltered set only — it
    // cannot widen scope or re-admit a filtered-out chunk. GRACEFUL FALLBACK:
    // any failure (model absent, load error, inference error) is logged and the
    // existing vector scores are left untouched, so retrieval degrades to
    // vector-only rather than failing — an answer is never blocked on the
    // reranker.
    if want_rerank && !hits.is_empty() {
        let texts: Vec<String> = hits.iter().map(|h| h.chunk_text.clone()).collect();
        match reranker::rescore(&query, texts).await {
            Ok(scores) if scores.len() == hits.len() => {
                for (h, s) in hits.iter_mut().zip(scores) {
                    h.score = s;
                }
            }
            Ok(_) => {
                log::warn!(
                    "rag_retrieve: reranker returned a mismatched score count; \
                     falling back to vector-only order"
                );
            }
            Err(e) => {
                log::warn!(
                    "rag_retrieve: reranker unavailable ({e:#}); \
                     falling back to vector-only order"
                );
            }
        }
    }
    // LanceDB returns by ascending distance, which corresponds to
    // descending score, but sort defensively. With the reranker ON this is the
    // re-sort over the cross-encoder scores assigned just above.
    hits.sort_by(|a, b| b.score.partial_cmp(&a.score).unwrap_or(std::cmp::Ordering::Equal));
    // F-510: apply the per-source diversity cap AFTER decrypt/sort, over the
    // already-scoped overfetched candidates, then truncate to the caller's
    // top_k. No cap requested = the overfetch never happened (fetch_k ==
    // top_k) and this is a no-op — UNLESS the reranker overfetched, in which
    // case the explicit truncate below trims the candidate pool back to top_k.
    if cap > 0 {
        hits = cap_per_source(hits, cap, top_k as usize);
    } else {
        // No-op when fetch_k == top_k (reranker OFF, no cap); trims the
        // reranker's overfetched pool back to the caller's top_k when ON.
        hits.truncate(top_k as usize);
    }
    // File stats and the encrypted mail/CRM stores are blocking local I/O. Run
    // them off the async executor, then attach only authoritative source dates.
    let date_workspace = workspace.clone();
    hits = tokio::task::spawn_blocking(move || {
        attach_source_dates(&date_workspace, &mut hits);
        hits
    })
    .await
    .map_err(|error| format!("retrieve source dates join: {error}"))?;
    Ok(hits)
}

#[cfg(test)]
mod date_producer_tests {
    use super::*;

    fn dated_hit(source_id: &str, source_type: &str, source_date: SourceDate, dated_fact: DatedFact) -> Hit {
        Hit { path: source_id.to_string(), chunk_text: "retrieved passage".to_string(), score: 1.0, paragraph_index: 0, id: Some(format!("chunk-{source_id}")), matter_id: Some("matter-1".to_string()), source_id: Some(source_id.to_string()), source_type: Some(source_type.to_string()), page_number: None, privilege: None, extraction: None, extraction_confidence: None, locator: None, source_date: Some(source_date), dated_fact: Some(dated_fact), date_conflict: None }
    }

    #[test]
    fn mail_message_date_becomes_a_received_source_date() {
        let date = mail_source_date(Some("2026-07-10T14:30:00Z"))
            .expect("mail date must be carried to the hit");
        assert_eq!(date.value.as_deref(), Some("2026-07-10T14:30:00.000Z"));
        assert_eq!(date.kind, SourceDateKind::Received);
        assert_eq!(date.confidence, SourceDateConfidence::Source);
    }

    #[test]
    fn document_metadata_becomes_a_modified_source_date() {
        let file = tempfile::NamedTempFile::new().expect("temporary document");
        let date = document_source_date(file.path().to_str().expect("utf-8 path"))
            .expect("document metadata date");
        assert_eq!(date.kind, SourceDateKind::DocumentModified);
        assert_eq!(date.confidence, SourceDateConfidence::Derived);
        assert!(date.value.is_some(), "filesystem time must cross to the hit");
    }

    #[test]
    fn crm_notes_prefer_updated_timestamp_over_created_timestamp() {
        let row = crate::commands::crm::store::CrmObjectRow {
            id: "note:42".to_string(),
            kind: "note".to_string(),
            household_id: "household:7".to_string(),
            updated_at: "2026-07-11T00:00:00Z".to_string(),
            content_hash: String::new(),
            json: r#"{"created_at":"2026-07-10T14:30:00Z","updated_at":"2026-07-11T00:00:00Z"}"#
                .to_string(),
            deleted: false,
        };
        let date = crm_source_date(&row).expect("CRM record timestamp");
        assert_eq!(date.kind, SourceDateKind::Updated);
        assert_eq!(date.value.as_deref(), Some("2026-07-11T00:00:00.000Z"));
    }

    #[test]
    fn adapter_owned_mail_and_crm_facts_trigger_a_real_same_fact_conflict() {
        let first_crm = crate::commands::crm::store::CrmObjectRow { id: "note:local-copy".to_string(), kind: "note".to_string(), household_id: "household:7".to_string(), updated_at: "2026-07-10T14:30:00Z".to_string(), content_hash: String::new(), json: r#"{"external_id":"shared-note-42","created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-10T14:30:00Z"}"#.to_string(), deleted: false };
        let second_crm = crate::commands::crm::store::CrmObjectRow { id: "note:connector-copy".to_string(), updated_at: "2026-07-11T14:30:00Z".to_string(), json: r#"{"external_id":"shared-note-42","created_at":"2026-07-01T00:00:00Z","updated_at":"2026-07-11T14:30:00Z"}"#.to_string(), ..first_crm.clone() };
        let first_date = crm_source_date(&first_crm).expect("first CRM date"); let second_date = crm_source_date(&second_crm).expect("second CRM date");
        let first_fact = crm_dated_fact(&first_crm).expect("first CRM fact"); let second_fact = crm_dated_fact(&second_crm).expect("second CRM fact");
        assert_eq!(first_fact.key, second_fact.key); assert_ne!(first_fact.value, second_fact.value);
        let mut crm_hits = vec![dated_hit("crm:note:local-copy", "crm", first_date, first_fact), dated_hit("crm:note:connector-copy", "crm", second_date, second_fact)];
        attach_date_conflicts(&mut crm_hits);
        assert_eq!(crm_hits[0].date_conflict.as_ref().map(|flag| flag.relation), Some(DateConflictRelation::OlderConflictsWithNewer));
        assert_eq!(crm_hits[1].date_conflict.as_ref().map(|flag| flag.relation), Some(DateConflictRelation::NewerConflictsWithOlder));

        let first_mail = crate::commands::mail::store::MailRecord { id: "mail-copy-1".to_string(), folder_id: "inbox".to_string(), internet_message_id: Some("<shared@example.test>".to_string()), relative_path: "mail-copy-1.eml".to_string(), received_date_time: Some("2026-07-10T14:30:00Z".to_string()), provider: "m365".to_string(), account: "advisor@example.test".to_string(), subject: String::new(), from_addr: String::new(), from_name: String::new(), snippet: String::new(), has_attachments: false, thread_id: None, auth_result: Default::default(), attachment_refs: Vec::new(), attachments_unsupported: false };
        let second_mail = crate::commands::mail::store::MailRecord { id: "mail-copy-2".to_string(), received_date_time: Some("2026-07-11T14:30:00Z".to_string()), ..first_mail.clone() };
        let mut mail_hits = vec![dated_hit("mail:mail-copy-1", "mail", mail_source_date(first_mail.received_date_time.as_deref()).unwrap(), mail_dated_fact(&first_mail).unwrap()), dated_hit("mail:mail-copy-2", "mail", mail_source_date(second_mail.received_date_time.as_deref()).unwrap(), mail_dated_fact(&second_mail).unwrap())];
        attach_date_conflicts(&mut mail_hits);
        assert!(mail_hits.iter().all(|hit| hit.date_conflict.is_some()));
    }

    #[test]
    fn malformed_dates_and_missing_adapter_stores_stay_honest_and_empty() {
        let malformed = source_date_from_raw("last Tuesday", SourceDateKind::Received);
        assert_eq!(malformed.value, None); assert_eq!(malformed.raw_value.as_deref(), Some("last Tuesday"));
        let workspace = tempfile::tempdir().expect("temporary workspace");
        let mut hits = vec![Hit { path: "mail:missing".to_string(), chunk_text: String::new(), score: 1.0, paragraph_index: 0, id: None, matter_id: None, source_id: Some("mail:missing".to_string()), source_type: Some("mail".to_string()), page_number: None, privilege: None, extraction: None, extraction_confidence: None, locator: None, source_date: None, dated_fact: None, date_conflict: None }];
        attach_source_dates(workspace.path(), &mut hits);
        assert_eq!(hits[0].source_date, None); assert_eq!(hits[0].dated_fact, None);
    }
}
