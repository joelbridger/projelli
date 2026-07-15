use super::*;

/// WS-B/C — verify a citation against the store so the app can REFUSE to present
/// an answer whose citation does not verify.
///
/// Inputs:
///   - `id`: the content-addressed chunk id the answer cites.
///   - `claimed_matter_id`: the matter the answer claims the chunk belongs to.
///   - `quoted_text`: the span the answer attributes to the chunk.
///
/// Algorithm (matches the proven spike):
///   1. Point-lookup the chunk by `id` SCOPED to `claimed_matter_id`
///      (prefiltered `id = .. AND matter_id = ..`).
///   2. If not found there, look up by `id` alone to distinguish a fabricated id
///      (`NotFound`) from one that exists under a DIFFERENT matter
///      (`MatterMismatch { actual_matter }` — a confidentiality lie).
///   3. If found in the claimed matter, decrypt the stored text (WS-VEC: chunk
///      text is encrypted at rest), then assert it CONTAINS `quoted_text`
///      (whitespace-normalized). Pass → `Verified`; fail → `TextMismatch`.
///
/// FAIL-CLOSED: if a chunk's text cannot be decrypted (keychain locked,
/// tampered), verification returns `TextMismatch` (treat as unverifiable, do not
/// pass) rather than falsely verifying.
#[tauri::command]
pub async fn rag_verify_citation(
    state: State<'_, RagState>,
    id: String,
    claimed_matter_id: String,
    quoted_text: String,
) -> Result<Verdict, String> {
    // BUG-099 fail-closed: if the durable tombstone file was unreadable on
    // workspace open, we cannot prove the cited chunk is not a stale row whose
    // cleanup failed — so verification cannot return Verified. Treat as NotFound
    // (the answer layer then refuses to present the citation). Cleared by a clean
    // re-index. This mirrors rag_retrieve's fail-closed behavior.
    if state.index_integrity_unknown.load(Ordering::SeqCst) {
        return Ok(Verdict::NotFound);
    }
    // Validate the claimed matter id before it touches a SQL filter.
    let claimed = store::validate_matter_id(&claimed_matter_id)
        .map_err(|e| format!("invalid claimed_matter_id: {e}"))?
        .to_string();

    let workspace = require_workspace(&state).await?;
    // Own-clients doorway: citation verification is a cross-matter presence /
    // attribution oracle (a mismatch discloses the real matter). When the flag is
    // on, refuse verification against a matter the member may not read, so it
    // cannot probe other members' clients. Deny-closed with no member. The
    // resolved scope is also carried into the fallback classification below so a
    // chunk that really lives OUTSIDE the member's scope is reported as NotFound
    // rather than disclosing its actual matter (re-review B Finding 4).
    use crate::commands::crm::features::permissions::commands as perms;
    let read_scope: Option<perms::MatterReadScope> =
        if perms::own_clients_permissions_enabled() {
            let current = perms::native_current_member();
            let crm_store = crate::commands::crm::core_store::CrmCoreStore::open(&workspace)
                .map_err(|error| error.to_string())?;
            let scope = perms::matter_read_scope(&crm_store, true, current.as_ref())
                .map_err(|e| e.to_string())?;
            if !scope.allows(&claimed) {
                return Err("Matter is outside the current member's client scope.".into());
            }
            Some(scope)
        } else {
            None
        };
    // P2.1 (Finding 4): reuse the cached open table handle. None = no index →
    // nothing can be verified.
    let Some(table) = cached_chunks_table(&state, &workspace).await? else {
        return Ok(Verdict::NotFound);
    };

    // BUG-099 tombstone: the exclusion set for citation verification is the
    // in-memory unsafe-token set (already at-rest HMAC tokens). A row from a
    // tombstoned path (cleanup failed → stale rows remain) must return NotFound,
    // not Verified — consistent with what retrieval hides. The `source_id`/`path`
    // columns hold that same token, so we compare the found record's source_id
    // against the set directly (no key, no conversion).
    let tombstoned_tokens: std::collections::HashSet<String> =
        state.unsafe_tokens.lock().await.clone();

    // 1. Scoped point lookup: id AND claimed matter.
    let scoped = store::lookup_by_id(&table, &id, Some(&claimed))
        .await
        .map_err(|e| format!("verify lookup: {e}"))?;

    let Some(record) = scoped else {
        // 2. Not in the claimed matter — does it exist under any matter?
        let any = store::lookup_by_id(&table, &id, None)
            .await
            .map_err(|e| format!("verify classify lookup: {e}"))?;
        return Ok(match any {
            Some(other) => {
                // If the found record is tombstoned, treat as NotFound (fail-closed).
                if tombstoned_tokens.contains(&other.source_id) {
                    Verdict::NotFound
                } else if read_scope
                    .as_ref()
                    .is_some_and(|scope| !scope.allows(&other.matter_id))
                {
                    // The chunk exists, but under a matter OUTSIDE the member's
                    // read scope. Disclosing its real matter is a cross-matter
                    // attribution leak — return NotFound so a foreign chunk is
                    // indistinguishable from a fabricated id (re-review B
                    // Finding 4).
                    Verdict::NotFound
                } else {
                    Verdict::MatterMismatch {
                        actual_matter: other.matter_id,
                    }
                }
            }
            None => Verdict::NotFound,
        });
    };

    // BUG-099 tombstone: a found record whose source is tombstoned must NOT
    // return Verified — it could be a stale row whose cleanup failed. Fail closed.
    if tombstoned_tokens.contains(&record.source_id) {
        return Ok(Verdict::NotFound);
    }

    // 3. Found in the claimed matter — resolve the stored text (WS-VEC: decrypt).
    let stored_text = if record.encrypted {
        // FAIL-CLOSED: a chunk we cannot decrypt is unverifiable.
        let Some(key) = crypto::get_or_create_master_key().ok() else {
            return Ok(Verdict::TextMismatch);
        };
        let decrypted = hex::decode(&record.text)
            .ok()
            .and_then(|bytes| crate::commands::mail::crypto::decrypt_with_key(&bytes, &key).ok())
            .and_then(|v| String::from_utf8(v).ok());
        match decrypted {
            Some(t) => t,
            None => return Ok(Verdict::TextMismatch),
        }
    } else {
        record.text
    };

    if text_contains_normalized(&stored_text, &quoted_text) {
        Ok(Verdict::Verified)
    } else {
        Ok(Verdict::TextMismatch)
    }
}

/// P2.1 (Finding 2) — one citation to verify in a batch call. Mirrors the three
/// arguments of `rag_verify_citation`; serde camelCase over IPC.
#[derive(Serialize, Deserialize, Debug, Clone)]
#[serde(rename_all = "camelCase")]
pub struct CitationToVerify {
    pub id: String,
    pub claimed_matter_id: String,
    pub quoted_text: String,
}

/// P2.1 (Finding 2) — verify MANY citations in ONE call. The chat path used to
/// loop `rag_verify_citation` once per citation, and EACH call re-opened the
/// LanceDB connection + table and issued one or two point lookups — an N+1 that
/// cost ~100–500 ms on a typical 5–8 citation answer. This opens the table ONCE,
/// reads every cited chunk in ONE `id IN (...)` query, and classifies each
/// citation in memory with the SAME logic as the single command.
///
/// Verdicts are returned in the SAME ORDER as the input `citations`, one per
/// input, so the caller can zip them back to its citations. The classification
/// is byte-for-byte equivalent to calling `rag_verify_citation` per citation on
/// the normal one-row-per-id corpus; where an id legitimately matches several
/// rows (a stale row after a failed cleanup, or a retag), it prefers a
/// non-tombstoned row — which only ever refuses or downgrades a citation, never
/// upgrades a bad one to Verified. FAIL-CLOSED throughout (unknown integrity,
/// missing table, invalid claimed matter, undecryptable text all resolve to a
/// non-Verified verdict), exactly like the single command.
#[tauri::command]
pub async fn rag_verify_citations_batch(
    state: State<'_, RagState>,
    citations: Vec<CitationToVerify>,
) -> Result<Vec<Verdict>, String> {
    if citations.is_empty() {
        return Ok(Vec::new());
    }
    // Fail-closed: if the durable tombstone file was unreadable on workspace
    // open, we cannot prove any cited chunk isn't a stale row → NotFound for all.
    if state.index_integrity_unknown.load(Ordering::SeqCst) {
        return Ok(vec![Verdict::NotFound; citations.len()]);
    }

    let workspace = require_workspace(&state).await?;

    // Own-clients doorway (re-review A Finding 1 / re-review B Finding 4): the
    // batch classifies citations across matters exactly like the single verifier,
    // so it must apply the SAME scope. Resolve the member's read scope once.
    // Deny-closed: with the flag on and no bound member, `matter_read_scope`
    // errors and the whole batch fails (the frontend treats a failed batch as
    // unverified). None = enforcement off → no scoping, legacy behavior.
    use crate::commands::crm::features::permissions::commands as perms;
    let read_scope: Option<perms::MatterReadScope> =
        if perms::own_clients_permissions_enabled() {
            let current = perms::native_current_member();
            let crm_store = crate::commands::crm::core_store::CrmCoreStore::open(&workspace)
                .map_err(|error| error.to_string())?;
            Some(
                perms::matter_read_scope(&crm_store, true, current.as_ref())
                    .map_err(|e| e.to_string())?,
            )
        } else {
            None
        };

    // P2.1 (Finding 4): reuse the cached open table handle. None = no index →
    // nothing can be verified.
    let Some(table) = cached_chunks_table(&state, &workspace).await? else {
        return Ok(vec![Verdict::NotFound; citations.len()]);
    };

    let tombstoned_tokens: std::collections::HashSet<String> =
        state.unsafe_tokens.lock().await.clone();

    // ONE read for every cited chunk id (unscoped — classification below scopes
    // each in memory). `fetch_records_by_ids` validates/dedupes/caps the ids.
    let ids: Vec<String> = citations.iter().map(|c| c.id.clone()).collect();
    let records = store::fetch_records_by_ids(&table, &ids)
        .await
        .map_err(|e| format!("verify batch fetch: {e}"))?;

    // Group rows by id so each citation is classified against exactly the rows
    // the single command's two point lookups would have seen.
    let mut by_id: std::collections::HashMap<&str, Vec<&store::ChunkRecord>> =
        std::collections::HashMap::new();
    for r in &records {
        by_id.entry(r.id.as_str()).or_default().push(r);
    }

    let enc_key = crypto::get_or_create_master_key().ok();

    let verdicts = citations
        .iter()
        .map(|c| {
            // Validate the claimed matter as the single command does; an invalid
            // one can't verify → fail-closed NotFound (the frontend treats any
            // non-Verified verdict as "not verified" identically).
            let claimed = match store::validate_matter_id(&c.claimed_matter_id) {
                Ok(s) => s.to_string(),
                Err(_) => return Verdict::NotFound,
            };
            let rows: &[&store::ChunkRecord] =
                by_id.get(c.id.as_str()).map(|v| v.as_slice()).unwrap_or(&[]);
            classify_citation(
                rows,
                &claimed,
                &c.quoted_text,
                &tombstoned_tokens,
                enc_key.as_ref(),
                read_scope.as_ref(),
            )
        })
        .collect();

    Ok(verdicts)
}

/// P2.1 (Finding 2) — the shared, in-memory citation classifier used by the
/// batch command. `rows` are every stored row whose `id` equals the cited id
/// (already fetched). Reproduces `rag_verify_citation`'s decision tree, always at
/// least as conservative as (never less strict than) the single path:
///   1. Rows in the CLAIMED matter → if ANY is tombstoned, NotFound (the single
///      `lookup_by_id(id, Some(claimed)).limit(1)` could pick the stale row and
///      fail closed); otherwise verify the quoted text (Verified / TextMismatch).
///      A tombstoned row under ANOTHER matter is invisible to the scoped lookup
///      and does NOT block a live in-scope verify.
///   2. No row in the claimed matter → if ANY row for the id is tombstoned,
///      NotFound (the single `lookup_by_id(id, None).limit(1)` could pick it, and
///      we never disclose the actual matter of a chunk whose cleanup failed);
///      otherwise a row under ANOTHER matter is a scope lie (MatterMismatch). No
///      row → NotFound.
pub(crate) fn classify_citation(
    rows: &[&store::ChunkRecord],
    claimed_matter: &str,
    quoted_text: &str,
    tombstoned: &std::collections::HashSet<String>,
    enc_key: Option<&[u8; 32]>,
    read_scope: Option<&crate::commands::crm::features::permissions::commands::MatterReadScope>,
) -> Verdict {
    // Own-clients: with enforcement on, a CLAIMED matter outside the member's
    // scope is refused before any probe — fail-closed NotFound, the per-citation
    // equivalent of the single verifier returning an out-of-scope error
    // (re-review A Finding 1 / re-review B Finding 4).
    if let Some(scope) = read_scope {
        if !scope.allows(claimed_matter) {
            return Verdict::NotFound;
        }
    }
    // SCOPED lookup: consider only rows in the claimed matter — this mirrors the
    // single verifier's `lookup_by_id(id, Some(claimed))`, which the SQL prefilter
    // restricts to the claimed matter (a tombstoned row under ANOTHER matter is
    // invisible here and must NOT block a legitimate in-scope verify).
    let scoped_rows: Vec<&&store::ChunkRecord> =
        rows.iter().filter(|r| r.matter_id == claimed_matter).collect();
    if !scoped_rows.is_empty() {
        // FAIL-CLOSED on a scoped stale duplicate: if ANY claimed-matter row is
        // tombstoned, the single verifier's `limit(1)` lookup could pick that row
        // and return NotFound, so we must too — never Verify from a live duplicate
        // while an unresolved stale row for this exact id+scope still exists.
        if scoped_rows
            .iter()
            .any(|r| tombstoned.contains(&r.source_id))
        {
            return Verdict::NotFound;
        }
        // Every claimed-matter row is live — verify the quoted text against one.
        let record = scoped_rows[0];
        let stored_text = if record.encrypted {
            // FAIL-CLOSED: a chunk we cannot decrypt is unverifiable.
            let Some(key) = enc_key else {
                return Verdict::TextMismatch;
            };
            match hex::decode(&record.text)
                .ok()
                .and_then(|bytes| crate::commands::mail::crypto::decrypt_with_key(&bytes, key).ok())
                .and_then(|v| String::from_utf8(v).ok())
            {
                Some(t) => t,
                None => return Verdict::TextMismatch,
            }
        } else {
            record.text.clone()
        };
        return if text_contains_normalized(&stored_text, quoted_text) {
            Verdict::Verified
        } else {
            Verdict::TextMismatch
        };
    }

    // Not in the claimed matter. FAIL-CLOSED on any tombstoned duplicate: if ANY
    // row for this id is tombstoned, return NotFound rather than disclosing a
    // cross-matter `MatterMismatch{actual_matter}`. The single verifier's
    // `lookup_by_id(id, None).limit(1)` picks ONE arbitrary row and returns
    // NotFound if that row is tombstoned, so on a stale duplicate its result is
    // NotFound-or-MatterMismatch nondeterministically; choosing NotFound whenever
    // a tombstone is present is always at least as conservative as the single
    // path and never leaks the actual matter of a chunk whose cleanup failed.
    if rows.iter().any(|r| tombstoned.contains(&r.source_id)) {
        return Verdict::NotFound;
    }
    match rows.first() {
        Some(other) => {
            // The chunk lives under a matter OUTSIDE the member's read scope:
            // disclosing its actual matter is a cross-matter attribution leak, so
            // report NotFound (indistinguishable from a fabricated id). When
            // enforcement is off (`read_scope` None) the actual matter is
            // disclosed as before (re-review B Finding 4).
            if read_scope.is_some_and(|scope| !scope.allows(&other.matter_id)) {
                Verdict::NotFound
            } else {
                Verdict::MatterMismatch {
                    actual_matter: other.matter_id.clone(),
                }
            }
        }
        None => Verdict::NotFound,
    }
}

/// Canonicalized containment for citation verification. The SAME transform
/// is applied to both sides (direction-safe): Unicode-lowercase, curly
/// quotes straightened (\u{2018}\u{2019} -> ' ; \u{201C}\u{201D} -> "),
/// whitespace runs collapsed. Mirrors the TS grounding normalization
/// (legalAnalysis.ts normalizeQuote) so a quote that grounds also verifies.
/// NOT fuzzy: no other characters are altered or removed; containment
/// direction is unchanged; an empty normalized quote never verifies.
pub(crate) fn text_contains_normalized(stored: &str, quoted: &str) -> bool {
    fn canon(s: &str) -> String {
        let lowered = s.to_lowercase();
        let straightened: String = lowered
            .chars()
            .map(|c| match c {
                '\u{2018}' | '\u{2019}' => '\'',
                '\u{201C}' | '\u{201D}' => '"',
                other => other,
            })
            .collect();
        straightened.split_whitespace().collect::<Vec<_>>().join(" ")
    }
    let q = canon(quoted);
    if q.is_empty() {
        return false;
    }
    canon(stored).contains(&q)
}

