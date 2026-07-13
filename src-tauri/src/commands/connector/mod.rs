//! Shared external connector foundation.
//!
//! Additive bridge for connector-owned records (OneDrive, e-signature,
//! meetings, and future external sources) that need to become encrypted,
//! matter-scoped RAG chunks without touching the working mail or CRM paths.

use std::path::{Path, PathBuf};

/// Internal external-connector RAG indexer — parameterized clone of
/// `crm::index_crm_text_internal`.
///
/// `source_id` is already formatted by the caller (for example
/// `esign:envelope:123`). Encrypts chunk text at rest under the vector-store
/// master key, deletes stale rows first (idempotent), and writes `source_type`
/// through `build_batch_external`. Validates `source_type` before any
/// destructive work, and clears stale rows for `source_id` even when the new
/// text is empty (a source whose content became empty must not keep old
/// chunks searchable); returns Ok(0) when there is nothing left to index.
#[allow(dead_code)]
pub async fn index_external_text_internal(
    workspace: &Path,
    source_id: &str,
    plaintext: &str,
    matter_id: &str,
    source_type: &str,
) -> anyhow::Result<u32> {
    use anyhow::Context;
    // Validate the connector source type BEFORE any destructive work: an
    // unsupported / typo type must fail fast and must never delete a
    // previously-good index first (build_batch_external would otherwise reject
    // it only after the stale-row delete below, wiping the source's chunks).
    crate::commands::rag::store::validate_external_source_type(source_type)
        .context("validate external connector source_type")?;

    let key = crate::commands::rag::crypto::get_or_create_master_key()
        .context("vectors master key for external connector RAG index")?;
    index_external_text_with_validated_source_type(
        workspace,
        source_id,
        plaintext,
        matter_id,
        source_type,
        &key,
    )
    .await
}

/// Same indexing path as `index_external_text_internal`, but with the vector
/// encryption key supplied by the caller. This mirrors the CRM backfill test
/// seam so headless tests can exercise the real delete/embed/store/retrieve
/// path without depending on an unlockable desktop keychain.
#[allow(dead_code)]
pub async fn index_external_text_with_key_internal(
    workspace: &Path,
    source_id: &str,
    plaintext: &str,
    matter_id: &str,
    source_type: &str,
    key: &[u8; 32],
) -> anyhow::Result<u32> {
    use anyhow::Context;
    crate::commands::rag::store::validate_external_source_type(source_type)
        .context("validate external connector source_type")?;
    index_external_text_with_validated_source_type(
        workspace,
        source_id,
        plaintext,
        matter_id,
        source_type,
        key,
    )
    .await
}

async fn index_external_text_with_validated_source_type(
    workspace: &Path,
    source_id: &str,
    plaintext: &str,
    matter_id: &str,
    source_type: &str,
    key: &[u8; 32],
) -> anyhow::Result<u32> {
    use anyhow::Context;
    let conn = crate::commands::rag::store::open_connection(workspace)
        .await
        .context("open lancedb for external connector indexing")?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .context("open/create chunks table")?;

    // Clear stale rows for this source_id FIRST and ALWAYS — including when the
    // new text is empty — so a re-sync that emptied a source removes its old
    // chunks from search instead of leaving them behind (idempotent re-index).
    crate::commands::rag::store::delete_path(&table, source_id, &key)
        .await
        .context("delete stale external connector chunks")?;

    let chunks = crate::commands::rag::chunker::chunk_text(source_id, plaintext);
    if chunks.is_empty() {
        return Ok(0);
    }

    let texts: Vec<String> = chunks.iter().map(|c| c.text.clone()).collect();
    // `embed_documents_batched` returns `Ok(None)` only when interrupted mid-batch
    // (a cancel flag was set). Never silently default that to an empty vector —
    // that would zip to zero rows and return Ok(0), reporting a SUCCESSFUL index
    // of a source that was in fact not indexed at all (the OneDrive
    // `unwrap_or_default()` silent-loss bug class). Propagate instead so the
    // caller surfaces or retries it.
    let vectors = crate::commands::rag::embedder::embed_documents_batched(&texts, None)
        .await
        .context("embed external connector chunks")?
        .ok_or_else(|| {
            anyhow::anyhow!("external connector embedding was interrupted before completion")
        })?;
    let rows: Vec<(crate::commands::rag::chunker::Chunk, Vec<f32>)> =
        chunks.into_iter().zip(vectors).collect();

    let batch = crate::commands::rag::store::build_batch_external(
        &rows,
        &key,
        matter_id,
        crate::commands::rag::store::PRIVILEGE_NONE,
        source_type,
    )
    .context("build external connector batch")?;
    let schema = batch.schema();
    use arrow_array::RecordBatchIterator;
    let _write = crate::commands::rag::store::acquire_write_access(&table).await?;
    table
        .add(Box::new(RecordBatchIterator::new(vec![Ok(batch)], schema)))
        .execute()
        .await
        .context("add external connector chunks to lancedb")?;

    Ok(rows.len() as u32)
}

/// Delete every RAG chunk for a single external connector `source_id`. Used when
/// a connector record stops mapping to any matter (its mapping disappeared) so
/// its previously-indexed chunks don't linger under the old matter
/// (matter-isolation hygiene). Idempotent: deleting a source with no chunks is a
/// no-op. Mirrors the stale-row delete inside the indexing path, but without
/// re-indexing anything.
#[allow(dead_code)]
pub async fn delete_external_source_with_key_internal(
    workspace: &Path,
    source_id: &str,
    key: &[u8; 32],
) -> anyhow::Result<()> {
    use anyhow::Context;
    let conn = crate::commands::rag::store::open_connection(workspace)
        .await
        .context("open lancedb for external connector source delete")?;
    let table = crate::commands::rag::store::open_or_create_table(&conn)
        .await
        .context("open/create chunks table for external connector source delete")?;
    crate::commands::rag::store::delete_path(&table, source_id, key)
        .await
        .context("delete external connector source chunks")
}

/// True if `host` is a syntactically valid DNS hostname: one or more
/// dot-separated labels of `[A-Za-z0-9-]`, each 1..=63 chars, not starting or
/// ending with a hyphen, total length <= 253. Crucially this REJECTS slashes,
/// `@`, `:`, whitespace, and every other character that could smuggle a path,
/// userinfo, or port into a host position — e.g. a connector "subdomain" of
/// `attacker.example/foo` that would otherwise build
/// `https://attacker.example/foo.<vendor>.com/...` and send credentials to
/// `attacker.example`. Connectors must validate their user-supplied host with
/// this BEFORE attaching any credential.
#[allow(dead_code)]
pub fn is_valid_hostname(host: &str) -> bool {
    if host.is_empty() || host.len() > 253 {
        return false;
    }
    host.split('.').all(|label| {
        !label.is_empty()
            && label.len() <= 63
            && !label.starts_with('-')
            && !label.ends_with('-')
            && label.bytes().all(|b| b.is_ascii_alphanumeric() || b == b'-')
    })
}

/// Verify a request URL targets the SAME origin (scheme + host + port) as the
/// connector's configured `base`, so a connector never attaches its credentials
/// to an unexpected host. Used to vet absolute pagination links (ShareFile
/// `odata.nextLink`, Addepar `links.next`) before following them with the user's
/// bearer/Basic token. Same-origin (not hardcoded-https) keeps test harnesses
/// that point a connector at a local mock server working.
#[allow(dead_code)]
pub fn assert_same_origin(base: &str, candidate: &str) -> anyhow::Result<()> {
    use anyhow::Context;
    let base_url = reqwest::Url::parse(base).context("parse connector base url")?;
    let cand = reqwest::Url::parse(candidate).context("parse connector request url")?;
    let same = cand.scheme() == base_url.scheme()
        && cand.host_str().is_some()
        && cand.host_str() == base_url.host_str()
        && cand.port_or_known_default() == base_url.port_or_known_default();
    if !same {
        anyhow::bail!(
            "refusing to send connector credentials to a different origin: {} (expected base host {})",
            cand.host_str().unwrap_or("<none>"),
            base_url.host_str().unwrap_or("<none>")
        );
    }
    Ok(())
}

/// Disconnect ordering guard: run `purge` FIRST and only run `forget_credential`
/// if the purge SUCCEEDS. This keeps a connector's credential (so it still shows
/// as connected and can be retried) when the data purge fails, instead of
/// deleting the credential first and leaving imported chunks searchable behind a
/// connector that now looks disconnected.
#[allow(dead_code)]
pub async fn purge_then_forget<P, Fut, D>(purge: P, forget_credential: D) -> Result<(), String>
where
    P: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
    D: FnOnce() -> Result<(), String>,
{
    purge().await?;
    forget_credential()
}

/// Disconnect that is SAFE against an in-flight sync. Acquires the connector's
/// `is_syncing` lock the same way the sync command does (compare-and-swap); if a
/// sync currently holds it, REFUSES — an in-flight sync still holds token/store/
/// RAG handles and could write chunks AFTER a purge. Callers set the cancel flag
/// before calling this so the running sync stops and the user can retry. On a
/// successful acquire the lock is held across the purge (so a new sync can't start
/// mid-purge) and released on exit (incl. panic), then `purge_then_forget` runs.
#[allow(dead_code)]
pub async fn purge_then_forget_guarded<P, Fut, D>(
    is_syncing: &std::sync::atomic::AtomicBool,
    purge: P,
    forget_credential: D,
) -> Result<(), String>
where
    P: FnOnce() -> Fut,
    Fut: std::future::Future<Output = Result<(), String>>,
    D: FnOnce() -> Result<(), String>,
{
    use std::sync::atomic::Ordering;
    if is_syncing
        .compare_exchange(false, true, Ordering::SeqCst, Ordering::SeqCst)
        .is_err()
    {
        return Err("a sync is in progress; stop it and try disconnecting again".into());
    }
    struct Release<'a>(&'a std::sync::atomic::AtomicBool);
    impl Drop for Release<'_> {
        fn drop(&mut self) {
            self.0.store(false, std::sync::atomic::Ordering::SeqCst);
        }
    }
    let _release = Release(is_syncing);
    purge_then_forget(purge, forget_credential).await
}

/// Cap on concurrent external connector RAG indexing tasks.
#[allow(dead_code)]
static EXTERNAL_INDEX_SEMAPHORE: tokio::sync::Semaphore = tokio::sync::Semaphore::const_new(4);

/// Spawn external connector RAG indexing, bounded by the semaphore, and RETURN
/// the `JoinHandle` so the caller can collect the per-source outcome
/// (`Ok(indexed_count)` / `Err`) instead of discarding it.
///
/// The prior version was `let _ = tokio::task::spawn(...)`, which dropped the
/// handle — a task-level failure was invisible except via a `log::warn!`, so a
/// source that failed to index looked, to any caller, exactly like one that
/// succeeded. Returning the handle lets a caller `.await` it (or join a batch of
/// them) to know what actually indexed and surface a partial failure. The inner
/// `log::warn!` is kept for a truly detached caller. The live connectors
/// (jotform/zocks/addepar/docusign/calendly) call `index_external_text_*`
/// directly and already collect the awaited outcome; this helper is for a
/// caller that wants bounded, spawned indexing without losing the result.
#[allow(dead_code)]
pub fn spawn_external_rag_index(
    workspace: PathBuf,
    source_id: String,
    text: String,
    matter_id: String,
    source_type: String,
) -> tokio::task::JoinHandle<anyhow::Result<u32>> {
    tokio::task::spawn(async move {
        let _permit = EXTERNAL_INDEX_SEMAPHORE.acquire().await.ok();
        let result =
            index_external_text_internal(&workspace, &source_id, &text, &matter_id, &source_type)
                .await;
        if let Err(e) = &result {
            log::warn!(
                "external connector RAG index failed for {} ({}): {:#}",
                source_id,
                source_type,
                e
            );
        }
        result
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn valid_hostnames_accepted() {
        for h in [
            "acme",
            "acme.sf-api.com",
            "my-firm.addepar.com",
            "a.b.c.d",
            "x1-2y",
        ] {
            assert!(is_valid_hostname(h), "{h} should be a valid hostname");
        }
    }

    #[test]
    fn invalid_hostnames_rejected() {
        for h in [
            "",
            "attacker.example/foo",          // path smuggling (Addepar P1-B)
            "attacker.example/x.sf-api.com", // path smuggling (ShareFile P1-B)
            "evil.com:8443",                 // port
            "user@evil.com",                 // userinfo
            "has space",
            "-leadinghyphen",
            "trailinghyphen-",
            "double..dot",
            "under_score",
            "back\\slash",
        ] {
            assert!(!is_valid_hostname(h), "{h:?} must be rejected");
        }
    }

    #[tokio::test]
    async fn guarded_disconnect_rejects_and_purges_nothing_while_syncing() {
        // A disconnect must REFUSE while a sync is active: neither the purge nor
        // the credential deletion may run, and the sync's lock is left intact.
        let is_syncing = std::sync::atomic::AtomicBool::new(true);
        let purged = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let forgot = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let (p, f) = (purged.clone(), forgot.clone());
        let res = purge_then_forget_guarded(
            &is_syncing,
            || async move {
                p.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
            || {
                f.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
        )
        .await;
        assert!(res.is_err());
        assert!(
            !purged.load(std::sync::atomic::Ordering::SeqCst),
            "purge must NOT run while a sync is active"
        );
        assert!(
            !forgot.load(std::sync::atomic::Ordering::SeqCst),
            "credential must NOT be deleted while a sync is active"
        );
        assert!(
            is_syncing.load(std::sync::atomic::Ordering::SeqCst),
            "the active sync's lock must be left untouched"
        );
    }

    #[tokio::test]
    async fn guarded_disconnect_purges_and_releases_when_idle() {
        let is_syncing = std::sync::atomic::AtomicBool::new(false);
        let purged = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let p = purged.clone();
        let res = purge_then_forget_guarded(
            &is_syncing,
            || async move {
                p.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
            || Ok(()),
        )
        .await;
        assert!(res.is_ok());
        assert!(purged.load(std::sync::atomic::Ordering::SeqCst));
        assert!(
            !is_syncing.load(std::sync::atomic::Ordering::SeqCst),
            "the lock must be released after a successful disconnect"
        );
    }

    #[tokio::test]
    async fn purge_then_forget_keeps_credential_when_purge_fails() {
        // The credential must survive a failed purge, so a connector never looks
        // disconnected while its imported chunks remain searchable.
        let forgot = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let f = forgot.clone();
        let res = purge_then_forget(
            || async { Err::<(), String>("purge failed".to_string()) },
            || {
                f.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
        )
        .await;
        assert!(res.is_err());
        assert!(
            !forgot.load(std::sync::atomic::Ordering::SeqCst),
            "credential must NOT be forgotten when the purge fails"
        );
    }

    #[tokio::test]
    async fn purge_then_forget_forgets_credential_when_purge_succeeds() {
        let forgot = std::sync::Arc::new(std::sync::atomic::AtomicBool::new(false));
        let f = forgot.clone();
        let res = purge_then_forget(
            || async { Ok::<(), String>(()) },
            || {
                f.store(true, std::sync::atomic::Ordering::SeqCst);
                Ok(())
            },
        )
        .await;
        assert!(res.is_ok());
        assert!(forgot.load(std::sync::atomic::Ordering::SeqCst));
    }

    #[test]
    fn same_origin_accepts_matching_and_rejects_foreign() {
        let base = "https://acme.sf-api.com/sf/v3";
        // Same host (any path) is accepted.
        assert!(assert_same_origin(base, "https://acme.sf-api.com/sf/v3/Items?$top=1").is_ok());
        // Different host with the user's token attached must be refused.
        assert!(assert_same_origin(base, "https://evil.example.com/sf/v3/Items").is_err());
        // Scheme downgrade to the same host must be refused.
        assert!(assert_same_origin(base, "http://acme.sf-api.com/sf/v3/Items").is_err());
        // A look-alike host is refused.
        assert!(assert_same_origin(base, "https://acme.sf-api.com.evil.com/x").is_err());
        // Local mock-server origins (http) still validate against an http base.
        assert!(assert_same_origin("http://127.0.0.1:9000", "http://127.0.0.1:9000/page2").is_ok());
        assert!(assert_same_origin("http://127.0.0.1:9000", "http://127.0.0.1:9999/page2").is_err());
    }
}
