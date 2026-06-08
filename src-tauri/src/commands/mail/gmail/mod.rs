pub mod oauth;
pub mod api;
pub mod normalize;

use async_trait::async_trait;
use crate::commands::mail::provider::{ChangePage, Cursor, MailProvider, RemoteFolder};
use crate::commands::mail::gmail::api::GmailClient;
use crate::commands::mail::gmail::normalize::from_gmail;

/// A parsed, typed Gmail sync cursor.
#[derive(Debug, PartialEq)]
enum GmailCursor {
    /// Start backfill from the beginning.
    Backfill,
    /// Continue a backfill at the given page token.
    Page(String),
    /// Start incremental history from the given historyId.
    Hist(String),
    /// Continue an incremental history page at the given (historyId, pageToken).
    HistPage(String, String),
}

/// Parse a provider-level `Cursor` into a typed `GmailCursor`.
///
/// Encoding:
/// - `Cursor::Backfill` or any unrecognised string -> `GmailCursor::Backfill`.
/// - `"page:<token>"` -> `GmailCursor::Page(token)`.
/// - `"hist:<id>"` -> `GmailCursor::Hist(id)`.
/// - `"histpage:<id>:<pageToken>"` -> `GmailCursor::HistPage(id, pageToken)`.
fn parse_gmail_cursor(cursor: &Cursor) -> GmailCursor {
    let s = match cursor {
        Cursor::Backfill => return GmailCursor::Backfill,
        Cursor::Resume(s) => s.as_str(),
    };
    if let Some(rest) = s.strip_prefix("page:") {
        return GmailCursor::Page(rest.to_string());
    }
    if let Some(rest) = s.strip_prefix("histpage:") {
        // Format: "histpage:<historyId>:<pageToken>"
        // Split on first ':' only.
        if let Some(colon) = rest.find(':') {
            let hist_id = &rest[..colon];
            let page_token = &rest[colon + 1..];
            return GmailCursor::HistPage(hist_id.to_string(), page_token.to_string());
        }
    }
    if let Some(rest) = s.strip_prefix("hist:") {
        return GmailCursor::Hist(rest.to_string());
    }
    // Unknown / malformed — restart backfill.
    GmailCursor::Backfill
}

/// Gmail implementation of `MailProvider`.
///
/// Sync strategy
/// -------------
/// **Backfill** (`Cursor::Backfill` or cursor `"page:<token>"`):
/// Uses `messages.list` to page through all messages in a label in batches of
/// 500, fetching each message full JSON and normalising it. When the last page
/// is consumed, the provider queries the mailbox's current `historyId` (via
/// `users.getProfile`) and records it as `"hist:<id>"` so the next call uses
/// incremental history.
///
/// **Incremental** (cursor `"hist:<id>"` or `"histpage:<id>:<pageToken>"`):
/// Uses `users.history` to retrieve only the changes since the saved
/// `historyId`. Added message ids are fetched in full; deleted message ids are
/// emitted as tombstone strings `"gmail:<account>:<id>"`. When the history
/// round finishes, the new `historyId` from the final history page is saved as
/// the next cursor.
///
/// **History-too-old fallback**:
/// If `users.history` returns HTTP 404 (historyId too old / expired), the
/// current `ChangePage` is returned as `done: true, next: None`. On the next
/// sync call with no cursor the sync layer will restart with `Cursor::Backfill`,
/// triggering a full re-backfill. A `log::warn!` is emitted so the event is
/// visible in app logs.
pub struct GmailProvider {
    client: GmailClient,
    account: String,
}

impl GmailProvider {
    /// Create a provider targeting the real Gmail API.
    pub fn new(access_token: String, account: String) -> Self {
        Self {
            client: GmailClient::new(access_token),
            account,
        }
    }

    /// Create a provider with a custom API base URL (for wiremock tests).
    pub fn new_with_base(access_token: String, account: String, base: String) -> Self {
        Self {
            client: GmailClient::new_with_base(access_token, base),
            account,
        }
    }
}

#[async_trait]
impl MailProvider for GmailProvider {
    fn kind(&self) -> &'static str {
        "gmail"
    }

    /// List all Gmail labels as `RemoteFolder` entries.
    async fn list_folders(&self) -> anyhow::Result<Vec<RemoteFolder>> {
        let labels = self.client.list_labels().await?;
        Ok(labels
            .into_iter()
            .map(|(id, name)| RemoteFolder { id, display_name: name })
            .collect())
    }

    /// Fetch one page of changes for `folder` starting from `cursor`.
    async fn fetch_changes(
        &self,
        folder: &RemoteFolder,
        cursor: &Cursor,
    ) -> anyhow::Result<ChangePage> {
        match parse_gmail_cursor(cursor) {
            // ── Backfill: no page token, start from the beginning ─────────────
            GmailCursor::Backfill => self.fetch_backfill_page(&folder.id, None).await,
            // ── Backfill: continue at the given page token ────────────────────
            GmailCursor::Page(page_token) => {
                let pt = if page_token.is_empty() { None } else { Some(page_token.as_str()) };
                self.fetch_backfill_page(&folder.id, pt).await
            }
            // ── Incremental: history from a historyId, first page ─────────────
            GmailCursor::Hist(hist_id) => {
                self.fetch_history_page(&hist_id, None).await
            }
            // ── Incremental: continue a history page ──────────────────────────
            GmailCursor::HistPage(hist_id, page_token) => {
                self.fetch_history_page(&hist_id, Some(page_token.as_str())).await
            }
        }
    }
}

impl GmailProvider {
    /// Fetch one page of the backfill (messages.list + get_message for each id).
    async fn fetch_backfill_page(
        &self,
        label_id: &str,
        page_token: Option<&str>,
    ) -> anyhow::Result<ChangePage> {
        let (ids, next_token) = self.client.list_message_ids(label_id, page_token).await?;

        let mut messages = Vec::new();
        for id in &ids {
            let json = self.client.get_message(id).await?;
            if let Some(msg) = from_gmail(&self.account, &json) {
                messages.push(msg);
            }
        }

        if let Some(t) = next_token {
            // More backfill pages remain.
            Ok(ChangePage {
                messages,
                removed_ids: vec![],
                next: Some(format!("page:{t}")),
                done: false,
            })
        } else {
            // Backfill complete — record the current historyId as the high-water
            // mark for incremental history on subsequent syncs.
            let hist_id = self.client.get_profile_history_id().await?;
            Ok(ChangePage {
                messages,
                removed_ids: vec![],
                next: Some(format!("hist:{hist_id}")),
                done: true,
            })
        }
    }

    /// Fetch one page of incremental history starting from `start_history_id`.
    async fn fetch_history_page(
        &self,
        start_history_id: &str,
        page_token: Option<&str>,
    ) -> anyhow::Result<ChangePage> {
        let resp = match self.client.history(start_history_id, page_token).await {
            Ok(v) => v,
            Err(e) => {
                // Gmail returns 404 when the historyId is too old (expired from
                // the server-side history log). In this case we cannot recover
                // incrementally. Return done=true, next=None so the next sync
                // call (with no cursor => Cursor::Backfill) performs a full
                // re-backfill.
                let msg = e.to_string();
                if msg.contains("HTTP 404") {
                    log::warn!(
                        "gmail history: historyId {} expired for account {}; \
                         a full re-backfill is required on the next sync",
                        start_history_id, self.account
                    );
                    return Ok(ChangePage {
                        messages: vec![],
                        removed_ids: vec![],
                        next: None,
                        done: true,
                    });
                }
                return Err(e);
            }
        };

        // Collect added and deleted message ids from the history array.
        let mut added_ids: Vec<String> = Vec::new();
        let mut deleted_ids: Vec<String> = Vec::new();

        if let Some(history) = resp.get("history").and_then(|h| h.as_array()) {
            for entry in history {
                // messagesAdded[].message.id
                if let Some(added) = entry.get("messagesAdded").and_then(|a| a.as_array()) {
                    for item in added {
                        if let Some(id) = item
                            .get("message")
                            .and_then(|m| m.get("id"))
                            .and_then(|s| s.as_str())
                        {
                            added_ids.push(id.to_string());
                        }
                    }
                }
                // messagesDeleted[].message.id
                if let Some(deleted) = entry.get("messagesDeleted").and_then(|d| d.as_array()) {
                    for item in deleted {
                        if let Some(id) = item
                            .get("message")
                            .and_then(|m| m.get("id"))
                            .and_then(|s| s.as_str())
                        {
                            deleted_ids.push(id.to_string());
                        }
                    }
                }
            }
        }

        // Fetch full message JSON for each added id and normalise.
        let mut messages = Vec::new();
        for id in &added_ids {
            let json = self.client.get_message(id).await?;
            if let Some(msg) = from_gmail(&self.account, &json) {
                messages.push(msg);
            }
        }

        // Tombstones use the same id scheme as from_gmail: "gmail:<account>:<id>".
        let removed_ids: Vec<String> = deleted_ids
            .iter()
            .map(|id| format!("gmail:{}:{}", self.account, id))
            .collect();

        // Determine the continuation cursor.
        let next_page_token = resp.get("nextPageToken").and_then(|t| t.as_str());
        let result_hist_id = resp
            .get("historyId")
            .and_then(|h| h.as_str())
            .unwrap_or(start_history_id);

        if let Some(npt) = next_page_token {
            Ok(ChangePage {
                messages,
                removed_ids,
                next: Some(format!("histpage:{start_history_id}:{npt}")),
                done: false,
            })
        } else {
            Ok(ChangePage {
                messages,
                removed_ids,
                next: Some(format!("hist:{result_hist_id}")),
                done: true,
            })
        }
    }
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    // ── parse_gmail_cursor unit tests ─────────────────────────────────────────

    #[test]
    fn backfill_cursor_gives_backfill() {
        assert_eq!(parse_gmail_cursor(&Cursor::Backfill), GmailCursor::Backfill);
    }

    #[test]
    fn resume_with_page_prefix_gives_page() {
        let c = Cursor::Resume("page:tok_abc".into());
        assert_eq!(parse_gmail_cursor(&c), GmailCursor::Page("tok_abc".into()));
    }

    #[test]
    fn resume_with_empty_page_prefix_gives_page_empty() {
        let c = Cursor::Resume("page:".into());
        assert_eq!(parse_gmail_cursor(&c), GmailCursor::Page("".into()));
    }

    #[test]
    fn resume_with_hist_prefix_gives_hist() {
        let c = Cursor::Resume("hist:98765".into());
        assert_eq!(parse_gmail_cursor(&c), GmailCursor::Hist("98765".into()));
    }

    #[test]
    fn resume_with_histpage_prefix_gives_histpage() {
        let c = Cursor::Resume("histpage:12300:pageXYZ".into());
        assert_eq!(
            parse_gmail_cursor(&c),
            GmailCursor::HistPage("12300".into(), "pageXYZ".into())
        );
    }

    #[test]
    fn unknown_string_falls_back_to_backfill() {
        let c = Cursor::Resume("garbage:stuff".into());
        assert_eq!(parse_gmail_cursor(&c), GmailCursor::Backfill);
    }

    #[test]
    fn empty_string_falls_back_to_backfill() {
        let c = Cursor::Resume("".into());
        assert_eq!(parse_gmail_cursor(&c), GmailCursor::Backfill);
    }

    // ── list_folders wiremock test ────────────────────────────────────────────

    #[tokio::test]
    async fn list_folders_maps_labels_to_remote_folders() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/labels"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "labels": [
                    { "id": "INBOX", "name": "INBOX", "type": "system" },
                    { "id": "Label_42", "name": "Legal", "type": "user" }
                ]
            })))
            .mount(&server)
            .await;

        let provider = GmailProvider::new_with_base("AT".into(), "user@gmail.com".into(), server.uri());
        let folders = provider.list_folders().await.expect("list_folders");
        assert_eq!(folders.len(), 2);
        assert_eq!(folders[0], RemoteFolder { id: "INBOX".into(), display_name: "INBOX".into() });
        assert_eq!(folders[1], RemoteFolder { id: "Label_42".into(), display_name: "Legal".into() });
    }

    // ── backfill: single page (no nextPageToken) -> done=true + hist: cursor ─

    #[tokio::test]
    async fn backfill_single_page_returns_messages_and_hist_cursor() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        // messages.list — single page, no nextPageToken
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "messages": [{ "id": "msg1", "threadId": "t1" }],
                "resultSizeEstimate": 1
            })))
            .mount(&server)
            .await;

        // get_message for msg1
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/messages/msg1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "msg1",
                "threadId": "t1",
                "labelIds": ["INBOX"],
                "payload": {
                    "mimeType": "text/plain",
                    "headers": [
                        { "name": "Subject", "value": "Hello" },
                        { "name": "From", "value": "sender@example.com" },
                        { "name": "Date", "value": "Mon, 01 Jan 2026 00:00:00 +0000" }
                    ],
                    "body": { "data": "SGVsbG8h" }
                }
            })))
            .mount(&server)
            .await;

        // get_profile (historyId)
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/profile"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "emailAddress": "user@gmail.com",
                "historyId": "55000"
            })))
            .mount(&server)
            .await;

        let provider = GmailProvider::new_with_base("AT".into(), "user@gmail.com".into(), server.uri());
        let folder = RemoteFolder { id: "INBOX".into(), display_name: "INBOX".into() };
        let page = provider.fetch_changes(&folder, &Cursor::Backfill).await.expect("fetch_changes");

        assert_eq!(page.messages.len(), 1);
        assert_eq!(page.messages[0].id, "gmail:user@gmail.com:msg1");
        assert!(page.done, "single-page backfill must be done=true");
        assert_eq!(page.next, Some("hist:55000".into()));
        assert!(page.removed_ids.is_empty());
    }

    // ── backfill: nextPageToken present -> done=false + page: cursor ──────────

    #[tokio::test]
    async fn backfill_with_next_page_token_returns_page_cursor() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        // messages.list — has a nextPageToken
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "messages": [{ "id": "msg2", "threadId": "t2" }],
                "nextPageToken": "next_tok_999",
                "resultSizeEstimate": 500
            })))
            .mount(&server)
            .await;

        // get_message for msg2
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/messages/msg2"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "msg2",
                "threadId": "t2",
                "labelIds": ["INBOX"],
                "payload": {
                    "mimeType": "text/plain",
                    "headers": [
                        { "name": "Subject", "value": "Page 1" },
                        { "name": "From", "value": "a@b.com" },
                        { "name": "Date", "value": "Mon, 01 Jan 2026 00:00:00 +0000" }
                    ],
                    "body": { "data": "SGVsbG8h" }
                }
            })))
            .mount(&server)
            .await;

        let provider = GmailProvider::new_with_base("AT".into(), "user@gmail.com".into(), server.uri());
        let folder = RemoteFolder { id: "INBOX".into(), display_name: "INBOX".into() };
        let page = provider.fetch_changes(&folder, &Cursor::Backfill).await.expect("fetch_changes");

        assert_eq!(page.messages.len(), 1);
        assert!(!page.done, "must be done=false when nextPageToken present");
        assert_eq!(page.next, Some("page:next_tok_999".into()));
    }

    // ── incremental: hist: cursor returns added messages + new hist: cursor ───

    #[tokio::test]
    async fn incremental_hist_returns_added_messages_and_new_hist_cursor() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;

        // users.history
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/history"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "history": [
                    {
                        "id": "101",
                        "messagesAdded": [{ "message": { "id": "new_msg_1" } }]
                    },
                    {
                        "id": "102",
                        "messagesDeleted": [{ "message": { "id": "del_msg_1" } }]
                    }
                ],
                "historyId": "103"
            })))
            .mount(&server)
            .await;

        // get_message for new_msg_1
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/messages/new_msg_1"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "new_msg_1",
                "threadId": "t3",
                "labelIds": ["INBOX"],
                "payload": {
                    "mimeType": "text/plain",
                    "headers": [
                        { "name": "Subject", "value": "New email" },
                        { "name": "From", "value": "x@y.com" },
                        { "name": "Date", "value": "Mon, 01 Jan 2026 00:00:00 +0000" }
                    ],
                    "body": { "data": "SGVsbG8h" }
                }
            })))
            .mount(&server)
            .await;

        let provider = GmailProvider::new_with_base("AT".into(), "user@gmail.com".into(), server.uri());
        let folder = RemoteFolder { id: "INBOX".into(), display_name: "INBOX".into() };
        let cursor = Cursor::Resume("hist:100".into());
        let page = provider.fetch_changes(&folder, &cursor).await.expect("fetch_changes");

        assert_eq!(page.messages.len(), 1);
        assert_eq!(page.messages[0].id, "gmail:user@gmail.com:new_msg_1");
        assert_eq!(page.removed_ids, vec!["gmail:user@gmail.com:del_msg_1".to_string()]);
        assert!(page.done, "must be done=true when no nextPageToken");
        assert_eq!(page.next, Some("hist:103".into()));
    }
}
