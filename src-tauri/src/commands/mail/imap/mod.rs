pub mod client;
pub mod normalize;
pub mod send;

use anyhow::Context as _;
use async_trait::async_trait;

use crate::commands::mail::provider::{ChangePage, Cursor, MailProvider, RemoteFolder};

use self::client::{connect, list_mailboxes, select_mailbox, uid_fetch_range, uid_search_all};
use self::normalize::from_rfc822;

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

/// Maximum messages fetched per `fetch_changes` call.
const BATCH: u32 = 200;

pub(crate) fn imap_message_id(
    account: &str,
    folder_id: &str,
    uidvalidity: u32,
    uid: u32,
) -> String {
    let folder_key = hex::encode(folder_id.as_bytes());
    format!("imap:{account}:{folder_key}:{uidvalidity}:{uid}")
}

// ─────────────────────────────────────────────────────────
// Pure cursor helpers (unit-tested; no network required)
// ─────────────────────────────────────────────────────────

/// Parse a resume cursor string of the form `"UIDVALIDITY:LASTUID"`.
///
/// Returns `(0, 0)` for any malformed or empty input so that callers treat
/// unexpected tokens as a fresh backfill rather than panicking.
pub fn parse_cursor(s: &str) -> (u32, u32) {
    let mut parts = s.splitn(2, ':');
    let v = parts.next().and_then(|p| p.parse::<u32>().ok());
    let u = parts.next().and_then(|p| p.parse::<u32>().ok());
    match (v, u) {
        (Some(v), Some(u)) => (v, u),
        _ => (0, 0),
    }
}

/// Format a resume cursor string from `(uidvalidity, last_uid)`.
pub fn format_cursor(uidvalidity: u32, last_uid: u32) -> String {
    format!("{uidvalidity}:{last_uid}")
}

/// Compute the next UID batch to fetch, or `None` if already caught up.
///
/// Returns `(first_uid, last_uid_inclusive, done)`. A UIDVALIDITY change (or a
/// stored validity of 0) resets to a full backfill from UID 1. `done` is true
/// when the batch reaches the highest existing UID (`uid_next - 1`).
///
/// The caller MUST advance the stored cursor to `last_uid_inclusive` (the end of
/// the processed range), NOT merely to the highest UID that returned a body.
/// `uid_fetch_range` collects the complete server response, so any UID in the
/// range that returned no body is expunged/unfetchable; advancing past it
/// guarantees forward progress and prevents an unbounded paging loop when a
/// whole batch yields nothing.
pub fn compute_batch_range(
    stored_uidvalidity: u32,
    last_uid: u32,
    current_uidvalidity: u32,
    uid_next: u32,
) -> Option<(u32, u32, bool)> {
    let effective_last = if stored_uidvalidity != current_uidvalidity {
        0
    } else {
        last_uid
    };
    let first = effective_last.saturating_add(1);
    let highest_existing = uid_next.saturating_sub(1);
    if first > highest_existing {
        return None; // caught up (also covers an empty mailbox)
    }
    let last = first.saturating_add(BATCH - 1).min(highest_existing);
    let done = last >= highest_existing;
    Some((first, last, done))
}

// ─────────────────────────────────────────────────────────
// ImapProvider
// ─────────────────────────────────────────────────────────

/// IMAP implementation of [`MailProvider`] using UID-based incremental sync.
///
/// Each `fetch_changes` call opens a fresh authenticated connection, performs
/// one SELECT, fetches up to [`BATCH`] new messages, and closes the session.
/// Connection reuse across calls is left for a future optimisation pass.
pub struct ImapProvider {
    pub host: String,
    pub port: u16,
    pub username: String,
    pub password: String,
    /// Display name / key used in stable message ids (e.g. the user's email address).
    pub account: String,
    pub policy: crate::network_policy::NetworkPolicy,
}

impl ImapProvider {
    async fn connect_authorized(&self) -> anyhow::Result<self::client::ImapSession> {
        let destination = format!("imaps://{}:{}", self.host, self.port);
        let authorized = crate::commands::connector_network::authorize_configured_host(
            &self.policy,
            &crate::network_policy::IMAP_SYNC,
            &destination,
            &self.host,
        )?;
        crate::commands::connector_network::await_authorized(&self.policy, &authorized, async {
            Ok(connect(&self.host, self.port, &self.username, &self.password).await?)
        })
        .await
    }
}

#[async_trait]
impl MailProvider for ImapProvider {
    fn kind(&self) -> &'static str {
        "imap"
    }

    async fn list_folders(&self) -> anyhow::Result<Vec<RemoteFolder>> {
        let mut session = self
            .connect_authorized()
            .await
            .context("ImapProvider::list_folders: connect")?;

        let names = list_mailboxes(&mut session)
            .await
            .context("ImapProvider::list_folders: LIST")?;

        let _ = session.logout().await; // best-effort; ignore errors

        Ok(names
            .into_iter()
            .map(|n| RemoteFolder {
                id: n.clone(),
                display_name: n,
            })
            .collect())
    }

    async fn fetch_changes(
        &self,
        folder: &RemoteFolder,
        cursor: &Cursor,
    ) -> anyhow::Result<ChangePage> {
        // ── Decode the stored cursor ──────────────────────────────────────
        let (stored_uidvalidity, last_uid) = match cursor {
            Cursor::Backfill => (0u32, 0u32),
            Cursor::Resume(s) => parse_cursor(s),
        };

        // ── Connect and SELECT ────────────────────────────────────────────
        let mut session = self
            .connect_authorized()
            .await
            .context("ImapProvider::fetch_changes: connect")?;

        let info = select_mailbox(&mut session, &folder.id)
            .await
            .context("ImapProvider::fetch_changes: SELECT")?;

        let current_uidvalidity = info.uid_validity;

        // ── Compute the next UID batch (handles UIDVALIDITY reset + paging) ─
        let (first_new, batch_last, done) = match compute_batch_range(
            stored_uidvalidity,
            last_uid,
            current_uidvalidity,
            info.uid_next,
        ) {
            Some(range) => range,
            None => {
                // Already caught up. Record the current validity so a future
                // sync does not re-detect a "change" against a stale 0.
                let resume = if stored_uidvalidity != current_uidvalidity {
                    0
                } else {
                    last_uid
                };
                let _ = session.logout().await;
                return Ok(ChangePage {
                    messages: vec![],
                    removed_ids: vec![],
                    next: Some(format_cursor(current_uidvalidity, resume)),
                    done: true,
                });
            }
        };

        // ── UID FETCH ─────────────────────────────────────────────────────
        let raw_pairs = uid_fetch_range(&mut session, first_new, batch_last)
            .await
            .context("ImapProvider::fetch_changes: UID FETCH")?;

        let _ = session.logout().await; // best-effort

        let mut messages = Vec::with_capacity(raw_pairs.len());
        for (uid, raw) in raw_pairs {
            // Stable, account+folder-scoped message id.
            let id = imap_message_id(&self.account, &folder.id, current_uidvalidity, uid);
            if let Some(msg) = from_rfc822(&id, &self.account, &folder.id, &raw) {
                messages.push(msg);
            }
        }

        // IMAP has no delta/history token, so this call cannot report
        // deletions inline. Server-side deletions are reconciled separately
        // by `sync_folder_provider` (sync.rs), which diffs `current_ids`
        // against local storage once the folder is caught up.
        let removed_ids: Vec<String> = vec![];

        // Advance the cursor to the END of the processed range (not just the
        // highest UID with a body) so paging always makes forward progress.
        Ok(ChangePage {
            messages,
            removed_ids,
            next: Some(format_cursor(current_uidvalidity, batch_last)),
            done,
        })
    }

    /// Returns every message id currently present on the server for `folder`,
    /// via `UID SEARCH ALL`. Used by `sync_folder_provider` to diff against
    /// locally-known ids and tombstone anything that was deleted/expunged
    /// server-side (IMAP has no delta/history token to report this inline).
    async fn current_ids(&self, folder: &RemoteFolder) -> anyhow::Result<Option<Vec<String>>> {
        let mut session = connect(&self.host, self.port, &self.username, &self.password)
            .await
            .context("ImapProvider::current_ids: connect")?;

        let info = select_mailbox(&mut session, &folder.id)
            .await
            .context("ImapProvider::current_ids: SELECT")?;

        let uids = uid_search_all(&mut session)
            .await
            .context("ImapProvider::current_ids: UID SEARCH ALL")?;

        let _ = session.logout().await; // best-effort

        let ids = uids
            .into_iter()
            .map(|uid| imap_message_id(&self.account, &folder.id, info.uid_validity, uid))
            .collect();

        Ok(Some(ids))
    }
}

// ─────────────────────────────────────────────────────────
// Unit tests — pure helpers only (no network)
// ─────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // live IMAP coverage is exercised by a manual #[ignore]d test added in a later task

    #[test]
    fn cursor_roundtrips() {
        assert_eq!(parse_cursor(&format_cursor(42, 1000)), (42, 1000));
    }

    #[test]
    fn cursor_parse_handles_garbage() {
        assert_eq!(parse_cursor(""), (0, 0));
        assert_eq!(parse_cursor("nonsense"), (0, 0));
        assert_eq!(parse_cursor("42"), (0, 0)); // missing second field -> default
        assert_eq!(parse_cursor("42:1000"), (42, 1000));
    }

    #[test]
    fn cursor_zero_roundtrips() {
        assert_eq!(parse_cursor(&format_cursor(0, 0)), (0, 0));
    }

    #[test]
    fn cursor_max_u32_roundtrips() {
        assert_eq!(
            parse_cursor(&format_cursor(u32::MAX, u32::MAX)),
            (u32::MAX, u32::MAX)
        );
    }

    #[test]
    fn format_cursor_produces_colon_separated_string() {
        assert_eq!(format_cursor(99, 5), "99:5");
        assert_eq!(format_cursor(1, 0), "1:0");
    }

    #[test]
    fn parse_cursor_three_colons_returns_default() {
        // "10:20:30" — second token is "20:30" which is not a valid u32,
        // so parse_cursor returns the safe default (0, 0).
        // Real cursors are always two-field "UIDVALIDITY:LASTUID".
        assert_eq!(parse_cursor("10:20:30"), (0, 0));
    }

    // ── compute_batch_range ────────────────────────────────────────────────

    #[test]
    fn batch_backfill_small_box_done_in_one_page() {
        // validity 0 stored => backfill; uid_next 5 => highest existing UID is 4.
        assert_eq!(compute_batch_range(0, 0, 42, 5), Some((1, 4, true)));
    }

    #[test]
    fn batch_resume_mid_box() {
        assert_eq!(compute_batch_range(42, 2, 42, 5), Some((3, 4, true)));
    }

    #[test]
    fn batch_caught_up_returns_none() {
        assert_eq!(compute_batch_range(42, 4, 42, 5), None);
    }

    #[test]
    fn batch_empty_mailbox_returns_none() {
        // uid_next 1 => no messages yet.
        assert_eq!(compute_batch_range(0, 0, 42, 1), None);
    }

    #[test]
    fn imap_message_id_is_folder_scoped_for_uid_collisions() {
        let inbox = imap_message_id("lawyer@example.com", "INBOX", 123, 42);
        let sent = imap_message_id("lawyer@example.com", "Sent", 123, 42);

        assert_ne!(
            inbox, sent,
            "same UID in different folders must not collapse"
        );
        assert!(
            inbox.contains("494e424f58"),
            "folder id must be encoded into the stable id"
        );
        assert!(
            sent.contains("53656e74"),
            "folder id must be encoded into the stable id"
        );
    }

    #[test]
    fn batch_uidvalidity_change_forces_full_backfill() {
        // stored validity 41 != current 42 => last_uid reset to 0, refetch from 1.
        assert_eq!(compute_batch_range(41, 100, 42, 5), Some((1, 4, true)));
    }

    #[test]
    fn batch_paging_advances_and_terminates() {
        // 999 existing UIDs, BATCH=200: pages must cover 1..=999 and only the
        // final page is done. Crucially `first` strictly increases each call,
        // so paging always terminates (no unbounded loop).
        let page1 = compute_batch_range(1, 0, 1, 1000).unwrap();
        assert_eq!(page1, (1, 200, false));
        let page2 = compute_batch_range(1, page1.1, 1, 1000).unwrap();
        assert_eq!(page2, (201, 400, false));
        // ... last page
        let last = compute_batch_range(1, 800, 1, 1000).unwrap();
        assert_eq!(last, (801, 999, true));
        // After the last page the cursor is 999 => caught up.
        assert_eq!(compute_batch_range(1, 999, 1, 1000), None);
    }
}
