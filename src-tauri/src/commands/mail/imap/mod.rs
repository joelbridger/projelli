pub mod client;
pub mod normalize;

use anyhow::Context as _;
use async_trait::async_trait;

use crate::commands::mail::provider::{ChangePage, Cursor, MailProvider, RemoteFolder};

use self::client::{connect, list_mailboxes, select_mailbox, uid_fetch_range};
use self::normalize::from_rfc822;

// ─────────────────────────────────────────────────────────
// Constants
// ─────────────────────────────────────────────────────────

/// Maximum messages fetched per `fetch_changes` call.
const BATCH: u32 = 200;

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
}

#[async_trait]
impl MailProvider for ImapProvider {
    fn kind(&self) -> &'static str {
        "imap"
    }

    async fn list_folders(&self) -> anyhow::Result<Vec<RemoteFolder>> {
        let mut session = connect(&self.host, self.port, &self.username, &self.password)
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
        let (stored_uidvalidity, mut last_uid) = match cursor {
            Cursor::Backfill => (0u32, 0u32),
            Cursor::Resume(s) => parse_cursor(s),
        };

        // ── Connect and SELECT ────────────────────────────────────────────
        let mut session = connect(&self.host, self.port, &self.username, &self.password)
            .await
            .context("ImapProvider::fetch_changes: connect")?;

        let info = select_mailbox(&mut session, &folder.id)
            .await
            .context("ImapProvider::fetch_changes: SELECT")?;

        let current_uidvalidity = info.uid_validity;
        let uid_next = info.uid_next;

        // ── Detect UIDVALIDITY change (re-backfill) ───────────────────────
        if stored_uidvalidity != current_uidvalidity {
            // Mailbox was recreated or this is first sync.  Start from the top.
            last_uid = 0;
        }

        // ── Compute fetch range ───────────────────────────────────────────
        // Fetch UIDs in (last_uid+1 ..= uid_next-1), capped to BATCH.
        // uid_next is the *next to be assigned*, so the highest existing UID is
        // uid_next - 1.  If uid_next == 0 (empty box) or last_uid >= uid_next-1
        // there is nothing to fetch.
        let first_new = last_uid.saturating_add(1);
        let highest_existing = uid_next.saturating_sub(1);

        if first_new > highest_existing {
            // Already caught up.
            let _ = session.logout().await;
            return Ok(ChangePage {
                messages: vec![],
                removed_ids: vec![],
                next: Some(format_cursor(current_uidvalidity, last_uid)),
                done: true,
            });
        }

        // Fetch at most BATCH messages at a time (lowest UIDs first).
        let batch_last = (first_new + BATCH - 1).min(highest_existing);
        let done = batch_last >= highest_existing;

        // ── UID FETCH ─────────────────────────────────────────────────────
        let raw_pairs = uid_fetch_range(&mut session, first_new, batch_last)
            .await
            .context("ImapProvider::fetch_changes: UID FETCH")?;

        let _ = session.logout().await; // best-effort

        // Track the highest UID we actually received so the cursor advances
        // only as far as confirmed data.
        let mut highest_fetched = last_uid;
        let mut messages = Vec::with_capacity(raw_pairs.len());

        for (uid, raw) in raw_pairs {
            // Stable, account+folder-scoped message id.
            let id = format!(
                "imap:{}:{}:{}",
                self.account, current_uidvalidity, uid
            );
            if let Some(msg) = from_rfc822(&id, &self.account, &folder.id, &raw) {
                messages.push(msg);
            }
            if uid > highest_fetched {
                highest_fetched = uid;
            }
        }

        // TODO(phase-2): UID-diff to detect server-side deletions.
        let removed_ids: Vec<String> = vec![];

        Ok(ChangePage {
            messages,
            removed_ids,
            next: Some(format_cursor(current_uidvalidity, highest_fetched)),
            done,
        })
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
}
