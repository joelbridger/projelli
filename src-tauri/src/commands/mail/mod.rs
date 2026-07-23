pub mod crypto;
pub mod fde;
pub mod gmail;
pub mod graph;
pub mod imap;
pub mod model;
pub mod normalize;
pub mod oauth;
pub mod provider;
pub mod store;
pub mod sync;
pub mod view;

#[cfg(test)]
pub(crate) mod verified_m4_credentials;
#[cfg(not(test))]
mod verified_m4_credentials;
mod verified_workspace_authority;

/// M4's Microsoft draft-handoff consent is intentionally separate from the
/// legacy connector's send-capable scopes.
pub(crate) const M4_MICROSOFT_DRAFT_SCOPE: &str = "openid offline_access User.Read Mail.ReadWrite";

/// Gmail's compose permission can technically send, so later sealed transport
/// remains the no-send wall for the M4 draft-handoff flow.
pub(crate) const M4_GMAIL_DRAFT_SCOPE: &str =
    "openid email https://www.googleapis.com/auth/gmail.compose";

mod backfill;
mod connect;
mod matter;
mod messages;
mod send;
mod state;

pub use self::backfill::*;
pub use self::connect::*;
pub use self::matter::*;
pub use self::messages::*;
pub use self::send::*;
pub use self::state::*;

#[cfg(test)]
pub(crate) use self::store::MailListQuery;

#[cfg(test)]
mod tests {
    use super::{
        await_redirect_code_or_cancel, effective_mail_matter, frontmatter_subject,
        get_message_with_key, resolve_effective_matter, resolve_mail_matter, should_sync_provider,
        yaml_unescape, MailMatterMapEntry,
    };
    use crate::commands::mail::store::EncryptedMailStore;
    use crate::commands::rag::store::UNASSIGNED_MATTER;
    use std::sync::atomic::{AtomicBool, Ordering};
    use std::sync::Arc;
    use std::time::Duration;

    // ── OAuth cancel — the "Reconnect hangs 5 minutes with no cancel" fix ────

    #[tokio::test]
    async fn await_redirect_code_or_cancel_returns_immediately_when_cancelled() {
        // Nobody ever connects to the listener (simulates the user closing the
        // OAuth popup, or never completing it) and the cancel flag is already
        // set — this must return quickly, NOT sit on the 300s server timeout.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cancel = Arc::new(AtomicBool::new(true));

        let started = tokio::time::Instant::now();
        let result = tokio::time::timeout(
            Duration::from_secs(2),
            await_redirect_code_or_cancel(listener, "state", Duration::from_secs(300), cancel),
        )
        .await
        .expect("must not hit the 2s outer test timeout — cancellation should be near-instant");

        assert!(
            result.is_err(),
            "a cancelled wait must return an error, not a code"
        );
        assert!(
            started.elapsed() < Duration::from_secs(1),
            "cancellation must be detected within one poll tick, not the full timeout"
        );
    }

    #[tokio::test]
    async fn await_redirect_code_or_cancel_returns_the_code_when_not_cancelled() {
        // The happy path must still work unchanged: a real redirect completes
        // normally when cancel is never set.
        use tokio::io::AsyncWriteExt;

        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let cancel = Arc::new(AtomicBool::new(false));

        let task = tokio::spawn(await_redirect_code_or_cancel(
            listener,
            "TEST_STATE",
            Duration::from_secs(5),
            cancel,
        ));

        let mut stream = tokio::net::TcpStream::connect(format!("127.0.0.1:{port}"))
            .await
            .unwrap();
        let request = "GET /?code=REALCODE&state=TEST_STATE HTTP/1.1\r\nHost: 127.0.0.1\r\n\r\n";
        stream.write_all(request.as_bytes()).await.unwrap();
        stream.flush().await.unwrap();

        let code = task
            .await
            .unwrap()
            .expect("must succeed when never cancelled");
        assert_eq!(code, "REALCODE");
    }

    #[tokio::test]
    async fn await_redirect_code_or_cancel_notices_a_late_cancel() {
        // Cancel flips AFTER the wait has started (mirrors clicking Cancel
        // mid-wait, not just a pre-set flag) — must still bail out promptly
        // instead of waiting for the full timeout.
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let cancel = Arc::new(AtomicBool::new(false));
        let cancel_setter = cancel.clone();

        let task = tokio::spawn(await_redirect_code_or_cancel(
            listener,
            "state",
            Duration::from_secs(300),
            cancel,
        ));

        tokio::time::sleep(Duration::from_millis(50)).await;
        cancel_setter.store(true, Ordering::SeqCst);

        let result = tokio::time::timeout(Duration::from_secs(2), task)
            .await
            .expect("must not hit the 2s outer test timeout")
            .unwrap();
        assert!(result.is_err(), "a late cancel must still abort the wait");
    }

    #[test]
    fn resolve_effective_matter_real_override_wins_over_folder() {
        // BUG-013: a manual filing to a live matter beats the folder default.
        assert_eq!(
            resolve_effective_matter(Some("matter-acme"), "matter-folderdefault"),
            "matter-acme"
        );
    }

    #[test]
    fn resolve_effective_matter_no_override_uses_folder_default() {
        // Never manually filed → follow the folder mapping.
        assert_eq!(
            resolve_effective_matter(None, "matter-folderdefault"),
            "matter-folderdefault"
        );
    }

    #[test]
    fn resolve_effective_matter_unassigned_tombstone_stays_unassigned() {
        // BUG-042: the tombstone left when a filed-to matter is deleted must NOT
        // be re-absorbed into the folder's (different, live) matter — otherwise a
        // deleted matter's email would silently move into another matter.
        assert_eq!(
            resolve_effective_matter(Some(UNASSIGNED_MATTER), "matter-otherlive"),
            UNASSIGNED_MATTER
        );
    }

    #[test]
    fn should_sync_provider_scopes_to_one_when_set() {
        // A connector panel passes its own provider so connecting Microsoft 365
        // never runs (or fails on) a left-over Gmail token, and vice versa.
        assert!(should_sync_provider(&Some("m365".to_string()), "m365"));
        assert!(!should_sync_provider(&Some("m365".to_string()), "gmail"));
        assert!(!should_sync_provider(&Some("m365".to_string()), "imap"));
        assert!(should_sync_provider(&Some("gmail".to_string()), "gmail"));
    }

    #[test]
    fn should_sync_provider_allows_all_when_unscoped() {
        // None = a full refresh: every connected provider is in scope.
        assert!(should_sync_provider(&None, "m365"));
        assert!(should_sync_provider(&None, "imap"));
        assert!(should_sync_provider(&None, "gmail"));
    }

    fn entry(provider: &str, account: &str, folder: &str, matter: &str) -> MailMatterMapEntry {
        MailMatterMapEntry {
            provider: provider.into(),
            account: account.into(),
            folder_id: folder.into(),
            matter_id: matter.into(),
        }
    }

    #[test]
    fn resolve_mail_matter_falls_back_to_unassigned_when_unmapped() {
        let map = vec![entry("m365", "default", "inbox", "matter_a")];
        assert_eq!(
            resolve_mail_matter(&map, "m365", "default", "sent"),
            UNASSIGNED_MATTER
        );
        assert_eq!(
            resolve_mail_matter(&[], "m365", "default", "inbox"),
            UNASSIGNED_MATTER
        );
    }

    #[test]
    fn resolve_mail_matter_matches_exact_folder() {
        let map = vec![entry("m365", "default", "inbox", "matter_a")];
        assert_eq!(
            resolve_mail_matter(&map, "m365", "default", "inbox"),
            "matter_a"
        );
    }

    #[test]
    fn resolve_mail_matter_account_level_matches_any_folder() {
        // Empty folder_id == account-level mapping for every folder in the account.
        let map = vec![entry("gmail", "default", "", "matter_g")];
        assert_eq!(
            resolve_mail_matter(&map, "gmail", "default", "INBOX"),
            "matter_g"
        );
        assert_eq!(
            resolve_mail_matter(&map, "gmail", "default", "Label_42"),
            "matter_g"
        );
        // Different account is not covered.
        assert_eq!(
            resolve_mail_matter(&map, "gmail", "other", "INBOX"),
            UNASSIGNED_MATTER
        );
    }

    #[test]
    fn resolve_mail_matter_folder_level_wins_over_account_level() {
        let map = vec![
            entry("m365", "default", "", "matter_account"),
            entry("m365", "default", "litigation", "matter_litigation"),
        ];
        // The more specific folder-level mapping takes precedence.
        assert_eq!(
            resolve_mail_matter(&map, "m365", "default", "litigation"),
            "matter_litigation"
        );
        // Other folders fall back to the account-level mapping.
        assert_eq!(
            resolve_mail_matter(&map, "m365", "default", "inbox"),
            "matter_account"
        );
    }

    // ── F2.6b: per-matter membership combines folder mapping + per-message filing ──

    /// Minimal stored record for the membership tests below (searchable columns
    /// blank — membership is decided by folder key + per-message filing, not text).
    fn rec(
        id: &str,
        provider: &str,
        account: &str,
        folder: &str,
    ) -> crate::commands::mail::store::MailRecord {
        crate::commands::mail::store::MailRecord {
            id: id.into(),
            folder_id: folder.into(),
            internet_message_id: None,
            relative_path: format!("x/{id}.enc"),
            received_date_time: Some("2026-06-01T00:00:00Z".into()),
            provider: provider.into(),
            account: account.into(),
            subject: String::new(),
            from_addr: String::new(),
            from_name: String::new(),
            snippet: String::new(),
            has_attachments: false,
            thread_id: None,
            auth_result: Default::default(),
            attachment_refs: Vec::new(),
            attachments_unsupported: false,
        }
    }

    #[test]
    fn list_messages_for_matter_honors_folder_mapping_filings_and_isolation() {
        use crate::commands::mail::store::MailStore;
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x51u8; 32];
        let store = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();

        // Two folders: m365/default/inbox → matter_acme, gmail/default/INBOX → matter_globex.
        let map = vec![
            entry("m365", "default", "inbox", "matter_acme"),
            entry("gmail", "default", "INBOX", "matter_globex"),
        ];

        // a,b live in acme's folder; c lives in globex's folder.
        store.upsert(&rec("a", "m365", "default", "inbox")).unwrap();
        store.upsert(&rec("b", "m365", "default", "inbox")).unwrap();
        store
            .upsert(&rec("c", "gmail", "default", "INBOX"))
            .unwrap();
        // d lives in an UNMAPPED folder (should never belong to any real matter).
        store.upsert(&rec("d", "m365", "default", "sent")).unwrap();

        // A manual filing overrides the folder default both ways:
        //  - b is filed to globex even though its folder maps to acme (moves OUT of acme, INTO globex)
        //  - c is filed to acme even though its folder maps to globex (moves OUT of globex, INTO acme)
        store.set_message_matter("b", "matter_globex").unwrap();
        store.set_message_matter("c", "matter_acme").unwrap();
        // e lives in the unmapped folder but is manually filed to acme.
        store.upsert(&rec("e", "m365", "default", "sent")).unwrap();
        store.set_message_matter("e", "matter_acme").unwrap();
        // f is a delete-tombstone (its matter was deleted): stays unassigned, never leaks.
        store.upsert(&rec("f", "m365", "default", "inbox")).unwrap();
        store.set_message_matter("f", UNASSIGNED_MATTER).unwrap();

        // Query returns a large page in id order-independent form; we assert the id set.
        let q = super::MailListQuery {
            keyword: None,
            folder_id: None,
            provider: None,
            account: None,
            date_from: None,
            date_to: None,
            has_attachments: None,
            sort_by: "date".into(),
            sort_desc: true,
            limit: 200,
            offset: 0,
        };
        let list = |matter: &str| {
            let page = store
                .list_messages_for_matter(&q, matter, |ov, k| effective_mail_matter(&map, ov, k))
                .unwrap();
            let mut ids: Vec<String> = page.items.iter().map(|i| i.id.clone()).collect();
            ids.sort();
            (ids, page.total)
        };

        let (acme, acme_total) = list("matter_acme");
        // a (folder), c (filing), e (filing) — NOT b (filed away), NOT f (tombstone), NOT d (unmapped).
        assert_eq!(
            acme,
            vec!["a".to_string(), "c".to_string(), "e".to_string()]
        );
        assert_eq!(acme_total, 3);

        let (globex, globex_total) = list("matter_globex");
        // b (filing) — c moved to acme; the globex folder had only c.
        assert_eq!(globex, vec!["b".to_string()]);
        assert_eq!(globex_total, 1);

        // A matter with no mail → empty page (no cross-client leak).
        let (empty, empty_total) = list("matter_empty");
        assert!(empty.is_empty());
        assert_eq!(empty_total, 0);
    }

    #[test]
    fn get_message_with_key_decrypts_and_parses_fields() {
        use crate::commands::mail::model::{BodyContentType, MailMessage, Recipient};
        use crate::commands::mail::normalize::to_markdown;
        use crate::commands::mail::store::{MailRecord, MailStore};

        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];
        let store = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();

        let msg = MailMessage {
            id: "AAMk-xyz".into(),
            conversation_id: Some("c1".into()),
            internet_message_id: Some("<m@x>".into()),
            subject: "Closing date".into(),
            received_date_time: Some("2026-05-01T14:30:00Z".into()),
            from_name: Some("Pat H".into()),
            from_address: Some("pat@hender.com".into()),
            to: vec![Recipient {
                name: Some("Me".into()),
                address: Some("me@firm.com".into()),
            }],
            cc: vec![],
            folders: vec![],
            thread_id: Some("c1".into()),
            provider: "m365".into(),
            account: "default".into(),
            has_attachments: false,
            attachments_unsupported: false,
            auth_result: Default::default(),
            attachments: Vec::new(),
            body_content_type: BodyContentType::Text,
            body_text: "Confirming May 14.".into(),
        };
        let markdown = to_markdown(&msg);
        // Write the encrypted blob + register the record (mirrors apply_messages_enc).
        let rel = store
            .write_blob_with_key("AAMk-xyz", markdown.as_bytes(), &key)
            .unwrap();
        store
            .upsert(&MailRecord {
                id: "AAMk-xyz".into(),
                folder_id: "inbox".into(),
                internet_message_id: Some("<m@x>".into()),
                relative_path: rel,
                received_date_time: Some("2026-05-01T14:30:00Z".into()),
                provider: "m365".into(),
                account: "default".into(),
                subject: "Closing date".into(),
                from_addr: "pat@hender.com".into(),
                from_name: "Pat H".into(),
                snippet: "Confirming May 14.".into(),
                has_attachments: false,
                thread_id: Some("c1".into()),
                auth_result: Default::default(),
                attachment_refs: Vec::new(),
                attachments_unsupported: false,
            })
            .unwrap();

        // Fetch by raw id and by "mail:" prefixed citation id — both must work.
        for query in ["AAMk-xyz", "mail:AAMk-xyz"] {
            let v = get_message_with_key(dir.path(), query, &key)
                .unwrap()
                .expect("message present");
            assert_eq!(v.id, "AAMk-xyz");
            assert_eq!(v.subject, "Closing date");
            assert_eq!(v.from, "Pat H <pat@hender.com>");
            assert_eq!(v.to, vec!["Me <me@firm.com>"]);
            assert_eq!(v.date.as_deref(), Some("2026-05-01T14:30:00Z"));
            assert_eq!(v.body, "Confirming May 14.");
        }
    }

    #[test]
    fn get_message_with_key_returns_none_for_unknown_id() {
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];
        // Create an (empty) store so the DB exists.
        let _ = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();
        let got = get_message_with_key(dir.path(), "does-not-exist", &key).unwrap();
        assert!(got.is_none());
    }

    #[test]
    fn frontmatter_subject_is_unquoted_and_clean() {
        let md = "---\nmessage_id: \"m1\"\nsubject: \"Closing date\"\nfrom: \"a@b.com\"\n---\n\n# Closing date\n\nbody subject: not this one\n";
        assert_eq!(frontmatter_subject(md), "Closing date");
    }

    #[test]
    fn frontmatter_subject_unescapes_and_ignores_body() {
        // Escaped quote in the subject, plus a body line that also says "subject:".
        let md = "---\nsubject: \"Re: \\\"urgent\\\" matter\"\n---\n\n# x\n\nsubject: decoy\n";
        assert_eq!(frontmatter_subject(md), "Re: \"urgent\" matter");
    }

    #[test]
    fn frontmatter_subject_collapses_escaped_newlines() {
        let md = "---\nsubject: \"line one\\nline two\"\n---\n\n# x\n";
        assert_eq!(frontmatter_subject(md), "line one line two");
    }

    #[test]
    fn yaml_unescape_distinguishes_escaped_backslash_from_newline() {
        // `\\n` (escaped backslash then literal n) must stay backslash+n,
        // while `\n` (escaped newline) becomes a space.
        assert_eq!(yaml_unescape("a\\\\nb"), "a\\nb");
        assert_eq!(yaml_unescape("a\\nb"), "a b");
    }

    // Option B — mail RAG backfill marker mechanics ---------------------------

    #[test]
    fn embed_error_routing_detects_model_not_ready_through_context_chain() {
        use super::embed_error_is_model_not_ready;
        // Mirrors the real failure shape: the gate's bail!() root cause gets
        // wrapped by `.context("embed mail chunks")` in
        // index_mail_text_internal. Plain Display shows only the outermost
        // context and LOSES the marker — that is exactly why the helper
        // matches on the full `{:#}` chain.
        let root = anyhow::anyhow!(
            "{}: the search model is not downloaded yet",
            crate::commands::rag::embedder::MODEL_NOT_READY
        );
        let wrapped = root.context("embed mail chunks");
        assert!(
            !format!("{wrapped}").contains(crate::commands::rag::embedder::MODEL_NOT_READY),
            "Display alone must lose the marker (the premise of using the full chain)"
        );
        assert!(embed_error_is_model_not_ready(&wrapped));

        // Unwrapped root error also routes.
        let bare = anyhow::anyhow!(
            "{}: indexing deferred until the model downloads",
            crate::commands::rag::embedder::MODEL_NOT_READY
        );
        assert!(embed_error_is_model_not_ready(&bare));

        // Other failures never set the backfill marker.
        let other = anyhow::anyhow!("lance dataset panic").context("embed mail chunks");
        assert!(!embed_error_is_model_not_ready(&other));
    }

    #[test]
    fn backfill_marker_set_is_idempotent_and_clearable() {
        use super::backfill::MARKED_THIS_SESSION_TEST_LOCK;
        use super::{mark_rag_backfill_needed, MARKED_THIS_SESSION, RAG_BACKFILL_NEEDED_KEY};
        use std::sync::atomic::Ordering;
        // MARKED_THIS_SESSION is a process-global static; hold this lock for
        // the whole test so it can never interleave with the sibling test
        // below that also manipulates it.
        let _latch_guard = MARKED_THIS_SESSION_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let dir = tempfile::TempDir::new().unwrap();
        let key = [0x42u8; 32];

        // Start from a known state so test order can't matter.
        MARKED_THIS_SESSION.store(false, Ordering::SeqCst);

        // Setting the marker creates the store (meta table included) + the row.
        mark_rag_backfill_needed(dir.path(), &key).unwrap();
        let store = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();
        assert_eq!(
            store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap().as_deref(),
            Some("1")
        );

        // Marking again (every failed message during a sync calls this) is
        // idempotent — and short-circuits on the session latch, so a burst of
        // failures doesn't open one SQLCipher connection per message.
        mark_rag_backfill_needed(dir.path(), &key).unwrap();
        assert_eq!(
            store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap().as_deref(),
            Some("1")
        );

        // Proof of the short-circuit: delete the row out from under the latch;
        // a re-mark while the latch is still set must NOT rewrite it...
        store.delete_meta(RAG_BACKFILL_NEEDED_KEY).unwrap();
        mark_rag_backfill_needed(dir.path(), &key).unwrap();
        assert_eq!(store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap(), None);

        // ...while after the latch reset that mail_backfill_rag performs when
        // it clears the marker, a later incident in the same session re-marks.
        MARKED_THIS_SESSION.store(false, Ordering::SeqCst);
        mark_rag_backfill_needed(dir.path(), &key).unwrap();
        assert_eq!(
            store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap().as_deref(),
            Some("1")
        );

        // mail_backfill_rag clears it after a terminal pass.
        store.delete_meta(RAG_BACKFILL_NEEDED_KEY).unwrap();
        assert_eq!(store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap(), None);

        // Leave the latch clean for any future test in this process.
        MARKED_THIS_SESSION.store(false, Ordering::SeqCst);
    }

    #[test]
    fn vector_rebuild_marker_skips_missing_store_and_bypasses_stale_latch() {
        use super::backfill::MARKED_THIS_SESSION_TEST_LOCK;
        use super::{
            mark_rag_backfill_needed_after_vector_rebuild, MARKED_THIS_SESSION,
            RAG_BACKFILL_NEEDED_KEY,
        };
        use std::sync::atomic::Ordering;
        // See backfill_marker_set_is_idempotent_and_clearable: this must not
        // interleave with that test's manipulation of the same latch.
        let _latch_guard = MARKED_THIS_SESSION_TEST_LOCK
            .lock()
            .unwrap_or_else(|poisoned| poisoned.into_inner());
        let key = [0x24u8; 32];

        let no_mail = tempfile::TempDir::new().unwrap();
        MARKED_THIS_SESSION.store(true, Ordering::SeqCst);
        assert!(!EncryptedMailStore::db_path(no_mail.path()).exists());
        assert_eq!(
            mark_rag_backfill_needed_after_vector_rebuild(no_mail.path(), &key).unwrap(),
            false
        );
        assert!(
            !EncryptedMailStore::db_path(no_mail.path()).exists(),
            "missing mail store must not be created just to plant a marker"
        );

        let dir = tempfile::TempDir::new().unwrap();
        let store = EncryptedMailStore::open_with_key(dir.path(), &key).unwrap();
        store.delete_meta(RAG_BACKFILL_NEEDED_KEY).unwrap();
        MARKED_THIS_SESSION.store(true, Ordering::SeqCst);

        assert_eq!(
            mark_rag_backfill_needed_after_vector_rebuild(dir.path(), &key).unwrap(),
            true
        );
        assert_eq!(
            store.get_meta(RAG_BACKFILL_NEEDED_KEY).unwrap().as_deref(),
            Some("1"),
            "a vector rebuild must persist the marker even when the session latch was stale"
        );

        MARKED_THIS_SESSION.store(false, Ordering::SeqCst);
    }

    /// The pure end-of-pass policy: the marker survives ONLY a model
    /// regression; terminal (non-model) failures never pin it.
    #[test]
    fn backfill_marker_disposition_covers_all_four_buckets() {
        use super::backfill_marker_disposition;
        use super::BackfillMarkerDisposition::{Clear, Retain};
        // Clean pass → clear.
        assert_eq!(backfill_marker_disposition(0, 0), Clear);
        // Terminal (non-model) failures only → clear anyway; retrying every
        // boot would never fix them (they are logged loudly instead).
        assert_eq!(backfill_marker_disposition(0, 3), Clear);
        // Model regressed mid-pass → retain; a retry after the model returns
        // heals the remainder.
        assert_eq!(backfill_marker_disposition(2, 0), Retain);
        // Mixed → the model bucket wins; retain.
        assert_eq!(backfill_marker_disposition(2, 3), Retain);
    }
}

#[cfg(test)]
mod mail_retag_message_tests {
    use super::backfill_marker_disposition;
    use super::BackfillMarkerDisposition;
    use super::SyncProgress;
    use super::{mail_indexing_in_flight, MAIL_INDEX_COMPLETED, MAIL_INDEX_SPAWNED};
    use std::sync::atomic::Ordering;

    // The terminal "done" outcome must report "indexing pending" while any mail
    // index task is still spawned-but-not-finished (queued behind the semaphore),
    // and flip to "searchable" only once the completed count catches up. This
    // guards the honesty fix: a large import must not claim "all searchable" while
    // per-message indexing is still draining.
    #[test]
    fn mail_indexing_in_flight_tracks_spawned_minus_completed() {
        // Balanced to start (whatever the absolute counts): assert on the delta.
        MAIL_INDEX_SPAWNED.fetch_add(3, Ordering::SeqCst);
        assert!(
            mail_indexing_in_flight(),
            "3 tasks spawned, 0 completed → indexing is in flight (pending)"
        );
        MAIL_INDEX_COMPLETED.fetch_add(2, Ordering::SeqCst);
        assert!(
            mail_indexing_in_flight(),
            "2 of 3 completed → still one in flight (pending)"
        );
        MAIL_INDEX_COMPLETED.fetch_add(1, Ordering::SeqCst);
        assert!(
            !mail_indexing_in_flight(),
            "all completed → nothing in flight (searchable)"
        );
    }

    #[test]
    fn backfill_marker_disposition_model_failure_retains() {
        assert_eq!(
            backfill_marker_disposition(1, 0),
            BackfillMarkerDisposition::Retain
        );
    }

    #[test]
    fn backfill_marker_disposition_other_failure_clears() {
        assert_eq!(
            backfill_marker_disposition(0, 5),
            BackfillMarkerDisposition::Clear
        );
    }

    #[test]
    fn backfill_marker_disposition_clean_run_clears() {
        assert_eq!(
            backfill_marker_disposition(0, 0),
            BackfillMarkerDisposition::Clear
        );
    }

    // ── Terminal sync-event wire contract ────────────────────────────────────
    // The frontend's honest-outcome UI + the durable `mail.sync` audit row read
    // `backfillPending`, `tokenWarning`, and (on error) `error` off this event.
    // These guard the exact JSON keys (camelCase) and that a raw error message
    // NEVER rides along on a success event.

    #[test]
    fn done_event_serializes_backfill_and_token_flags_as_camelcase() {
        let v = serde_json::to_value(SyncProgress {
            status: "done".into(),
            provider: "m365".into(),
            folder: None,
            written: 42,
            removed: 3,
            error: None,
            backfill_pending: true,
            token_warning: true,
        })
        .unwrap();
        assert_eq!(v["status"], "done");
        assert_eq!(v["written"], 42);
        assert_eq!(v["backfillPending"], true);
        assert_eq!(v["tokenWarning"], true);
        // A success event must never carry an `error` field (skipped when None),
        // so the audit path can't mistake a success for a failure.
        assert!(v.get("error").is_none());
    }

    #[test]
    fn error_event_carries_error_message_for_the_owner() {
        let v = serde_json::to_value(SyncProgress {
            status: "error".into(),
            provider: "gmail".into(),
            folder: None,
            written: 0,
            removed: 0,
            error: Some("graph 500".into()),
            backfill_pending: false,
            token_warning: false,
        })
        .unwrap();
        assert_eq!(v["status"], "error");
        assert_eq!(v["error"], "graph 500");
    }
}
