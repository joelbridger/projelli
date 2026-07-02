use super::*;

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
    Ok(hits)
}

