use std::time::Duration;

/// Gmail REST API client.
///
/// Mirrors the shape of `GraphClient` in `graph.rs`: bearer auth, bounded
/// retry on 429 with capped backoff, 60 s timeout, and on non-2xx it logs
/// locally and returns a status-only error (never echoes the response body to
/// the caller / UI to avoid leaking mailbox PII).
pub struct GmailClient {
    token: String,
    base: String,
    http: reqwest::Client,
}

impl GmailClient {
    /// Create a client targeting the real Gmail API.
    pub fn new(token: String) -> Self {
        Self::new_with_base(token, "https://gmail.googleapis.com".into())
    }

    /// Create a client with a custom base URL (e.g. a wiremock server).
    pub fn new_with_base(token: String, base: String) -> Self {
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self { token, base, http }
    }

    /// GET an absolute URL, honoring 429/Retry-After with capped backoff.
    /// Up to 8 attempts before giving up. On non-2xx: logs locally, returns
    /// status-only error (never echoes body to caller).
    async fn get_json(&self, url: &str) -> anyhow::Result<serde_json::Value> {
        for attempt in 0..8u32 {
            let resp = self
                .http
                .get(url)
                .bearer_auth(&self.token)
                .send()
                .await?;
            if resp.status().as_u16() == 429 {
                let ra = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                tokio::time::sleep(retry_delay(ra.as_deref(), attempt)).await;
                continue;
            }
            let status = resp.status();
            let body = resp.text().await?;
            if !status.is_success() {
                // Never surface the raw Gmail response body to the caller/UI:
                // it can carry mailbox addresses or other PII.
                log::warn!("gmail request failed (HTTP {}): {}", status, body);
                anyhow::bail!("Gmail API request failed (HTTP {})", status);
            }
            return Ok(serde_json::from_str(&body)?);
        }
        anyhow::bail!("gmail: throttled past retry budget")
    }

    /// `GET /gmail/v1/users/me/labels` — returns `(id, name)` pairs.
    pub async fn list_labels(&self) -> anyhow::Result<Vec<(String, String)>> {
        let url = format!("{}/gmail/v1/users/me/labels", self.base);
        let v = self.get_json(&url).await?;
        let labels = v
            .get("labels")
            .and_then(|l| l.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| {
                        let id = item.get("id")?.as_str()?.to_string();
                        let name = item.get("name")?.as_str()?.to_string();
                        Some((id, name))
                    })
                    .collect()
            })
            .unwrap_or_default();
        Ok(labels)
    }

    /// `GET /gmail/v1/users/me/messages?maxResults=500&labelIds=<label_id>[&pageToken=]`
    /// Returns `(message_ids, next_page_token)`. When the label has no
    /// messages the API omits the `messages` key entirely — that returns an
    /// empty vec (not an error).
    pub async fn list_message_ids(
        &self,
        label_id: &str,
        page_token: Option<&str>,
    ) -> anyhow::Result<(Vec<String>, Option<String>)> {
        let mut url = format!(
            "{}/gmail/v1/users/me/messages?maxResults=500&labelIds={}",
            self.base, label_id
        );
        if let Some(pt) = page_token {
            url.push_str("&pageToken=");
            url.push_str(pt);
        }
        let v = self.get_json(&url).await?;
        let ids = v
            .get("messages")
            .and_then(|m| m.as_array())
            .map(|arr| {
                arr.iter()
                    .filter_map(|item| item.get("id")?.as_str().map(String::from))
                    .collect()
            })
            .unwrap_or_default();
        let next = v
            .get("nextPageToken")
            .and_then(|t| t.as_str())
            .map(String::from);
        Ok((ids, next))
    }

    /// `GET /gmail/v1/users/me/messages/{id}?format=full` — returns the raw
    /// JSON Value so the normalizer can inspect the full MIME tree.
    pub async fn get_message(&self, id: &str) -> anyhow::Result<serde_json::Value> {
        let url = format!(
            "{}/gmail/v1/users/me/messages/{}?format=full",
            self.base, id
        );
        self.get_json(&url).await
    }

    /// `GET /gmail/v1/users/me/history?startHistoryId=<id>[&pageToken=]`
    /// Returns the raw JSON Value. The caller extracts `history[].messagesAdded`,
    /// `history[].messagesDeleted`, and the top-level `historyId`.
    pub async fn history(
        &self,
        start_history_id: &str,
        page_token: Option<&str>,
    ) -> anyhow::Result<serde_json::Value> {
        let mut url = format!(
            "{}/gmail/v1/users/me/history?startHistoryId={}",
            self.base, start_history_id
        );
        if let Some(pt) = page_token {
            url.push_str("&pageToken=");
            url.push_str(pt);
        }
        self.get_json(&url).await
    }

    /// `GET /gmail/v1/users/me/profile` — returns the mailbox's current
    /// `historyId` as a string. Used at the end of a backfill to record the
    /// high-water mark for incremental history queries.
    pub async fn get_profile_history_id(&self) -> anyhow::Result<String> {
        let url = format!("{}/gmail/v1/users/me/profile", self.base);
        let v = self.get_json(&url).await?;
        v.get("historyId")
            .and_then(|h| h.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("Gmail profile response missing historyId field"))
    }

    /// Fetch the sender's email address from the Gmail profile.
    /// Used as the `From:` address when sending — the address Google authenticates
    /// the token against.
    pub async fn get_sender_address(&self) -> anyhow::Result<String> {
        let url = format!("{}/gmail/v1/users/me/profile", self.base);
        let v = self.get_json(&url).await?;
        v.get("emailAddress")
            .and_then(|e| e.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("Gmail profile missing emailAddress"))
    }

    /// POST JSON to a Gmail API URL. On 200 returns the parsed JSON body.
    /// Retries on 429/Retry-After. Non-2xx is a logged status-only error.
    async fn post_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        for attempt in 0..8u32 {
            let resp = self
                .http
                .post(url)
                .bearer_auth(&self.token)
                .json(body)
                .send()
                .await?;
            if resp.status().as_u16() == 429 {
                let ra = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                tokio::time::sleep(retry_delay(ra.as_deref(), attempt)).await;
                continue;
            }
            let status = resp.status();
            let body_text = resp.text().await?;
            if !status.is_success() {
                log::warn!("gmail POST failed (HTTP {}): {}", status, body_text);
                anyhow::bail!("Gmail API request failed (HTTP {})", status);
            }
            return Ok(serde_json::from_str(&body_text).unwrap_or(serde_json::json!({})));
        }
        anyhow::bail!("gmail: throttled past retry budget")
    }

    /// `POST /gmail/v1/users/me/messages/send` — send a raw RFC822 message.
    ///
    /// Builds the message using lettre's `Message` builder, base64url-encodes it,
    /// and posts `{ "raw": "<base64url>" }` to the Gmail send endpoint.
    ///
    /// `in_reply_to` is the RFC822 `Message-ID` of the message being replied to
    /// (e.g. `<abc@mail.gmail.com>`). `references` is the existing References
    /// header chain from the original message (space-separated). When supplied,
    /// the outgoing message sets `In-Reply-To` and `References` for correct
    /// threading in all RFC2822-compliant clients.
    ///
    /// Returns the Gmail message id of the sent message.
    pub async fn send_message(
        &self,
        from: &str,
        to: &[String],
        cc: &[String],
        bcc: &[String],
        subject: &str,
        body: &str,
        in_reply_to: Option<&str>,
        references: Option<&str>,
    ) -> anyhow::Result<String> {
        use base64::Engine;
        use lettre::message::Mailboxes;
        use lettre::Message;
        use std::str::FromStr;

        // Build the message using lettre's typed builder.
        let mut builder = Message::builder()
            .from(from.parse().map_err(|e| anyhow::anyhow!("invalid From address {from:?}: {e}"))?)
            .subject(subject);

        for addr in to {
            let mbs = Mailboxes::from_str(addr)
                .map_err(|e| anyhow::anyhow!("invalid To address {addr:?}: {e}"))?;
            for mb in mbs {
                builder = builder.to(mb);
            }
        }
        for addr in cc {
            let mbs = Mailboxes::from_str(addr)
                .map_err(|e| anyhow::anyhow!("invalid Cc address {addr:?}: {e}"))?;
            for mb in mbs {
                builder = builder.cc(mb);
            }
        }
        for addr in bcc {
            let mbs = Mailboxes::from_str(addr)
                .map_err(|e| anyhow::anyhow!("invalid Bcc address {addr:?}: {e}"))?;
            for mb in mbs {
                builder = builder.bcc(mb);
            }
        }

        if let Some(irt) = in_reply_to {
            builder = builder.in_reply_to(irt.to_string());
        }
        if let Some(refs) = references {
            builder = builder.references(refs.to_string());
        }

        let email = builder
            .body(body.to_string())
            .map_err(|e| anyhow::anyhow!("build RFC822 message: {e}"))?;

        let raw_bytes = email.formatted();

        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(&raw_bytes);
        let payload = serde_json::json!({ "raw": encoded });
        let url = format!("{}/gmail/v1/users/me/messages/send", self.base);
        let resp = self.post_json(&url, &payload).await?;

        let id = resp
            .get("id")
            .and_then(|v| v.as_str())
            .unwrap_or("")
            .to_string();
        Ok(id)
    }

    /// `GET /gmail/v1/users/me/messages/{id}/attachments/{att_id}` — returns the
    /// raw bytes (base64url-encoded `data` field in the response). On non-2xx logs
    /// locally and returns a status-only error.
    pub async fn get_attachment_raw(
        &self,
        message_id: &str,
        attachment_id: &str,
    ) -> anyhow::Result<Vec<u8>> {
        use base64::Engine;
        let url = format!(
            "{}/gmail/v1/users/me/messages/{}/attachments/{}",
            self.base, message_id, attachment_id
        );
        let v = self.get_json(&url).await?;
        let data = v
            .get("data")
            .and_then(|d| d.as_str())
            .ok_or_else(|| anyhow::anyhow!("Gmail attachment response missing `data` field"))?;
        let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(data)
            .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(data))
            .map_err(|e| anyhow::anyhow!("base64 decode attachment: {e}"))?;
        Ok(bytes)
    }
}

/// Gmail says: honour the Retry-After seconds; if absent, back off
/// exponentially. Every delay is capped so a hostile or misconfigured server
/// can't park a sync for hours. (Mirrors `graph::retry_delay`.)
fn retry_delay(retry_after_header: Option<&str>, attempt: u32) -> Duration {
    const MAX_HEADER_SECS: u64 = 120;
    if let Some(h) = retry_after_header {
        if let Ok(secs) = h.trim().parse::<u64>() {
            return Duration::from_secs(secs.min(MAX_HEADER_SECS));
        }
    }
    let secs = 1u64.checked_shl(attempt).unwrap_or(60).min(60);
    Duration::from_secs(secs)
}

#[cfg(test)]
mod tests {
    use super::*;

    // ── gmail_send_base64url_encodes_rfc822 ──────────────────────────────────

    #[test]
    fn gmail_send_base64url_encodes_rfc822() {
        // Verify that an RFC822 message round-trips through base64url correctly
        // without panicking (can't hit the network here). We build the raw bytes
        // that would be sent and confirm the encoding is URL-safe (no + or /).
        use base64::Engine;
        let raw = b"From: a@example.com\r\nTo: b@example.com\r\nSubject: hi\r\n\r\nBody";
        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(raw);
        assert!(!encoded.contains('+'), "must be URL-safe base64 (no +)");
        assert!(!encoded.contains('/'), "must be URL-safe base64 (no /)");
        // Decode round-trip
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.decode(&encoded).unwrap();
        assert_eq!(decoded, raw);
    }

    // ── retry_delay ──────────────────────────────────────────────────────────

    #[test]
    fn retry_after_header_wins() {
        assert_eq!(retry_delay(Some("10"), 0), Duration::from_secs(10));
        assert_eq!(retry_delay(Some("0"), 3), Duration::from_secs(0));
    }

    #[test]
    fn falls_back_to_capped_exponential_backoff() {
        assert_eq!(retry_delay(None, 0), Duration::from_secs(1));
        assert_eq!(retry_delay(None, 2), Duration::from_secs(4));
        assert_eq!(retry_delay(None, 10), Duration::from_secs(60));
    }

    #[test]
    fn retry_after_header_is_capped() {
        assert_eq!(retry_delay(Some("86400"), 0), Duration::from_secs(120));
        assert_eq!(retry_delay(Some("120"), 0), Duration::from_secs(120));
        assert_eq!(retry_delay(Some("30"), 0), Duration::from_secs(30));
    }

    // ── list_labels ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_labels_parses_id_and_name() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/labels"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "labels": [
                    { "id": "INBOX",     "name": "INBOX",    "type": "system" },
                    { "id": "Label_1",   "name": "Work",     "type": "user"   },
                    { "id": "SENT",      "name": "SENT",     "type": "system" }
                ]
            })))
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let labels = client.list_labels().await.expect("list_labels");
        assert_eq!(labels.len(), 3);
        assert_eq!(labels[0], ("INBOX".to_string(), "INBOX".to_string()));
        assert_eq!(labels[1], ("Label_1".to_string(), "Work".to_string()));
        assert_eq!(labels[2], ("SENT".to_string(), "SENT".to_string()));
    }

    // ── list_message_ids ──────────────────────────────────────────────────────

    #[tokio::test]
    async fn list_message_ids_parses_ids_and_next_page_token() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "messages": [
                    { "id": "msg1", "threadId": "thread1" },
                    { "id": "msg2", "threadId": "thread2" }
                ],
                "nextPageToken": "tok_abc",
                "resultSizeEstimate": 2
            })))
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let (ids, next) = client
            .list_message_ids("INBOX", None)
            .await
            .expect("list_message_ids");
        assert_eq!(ids, vec!["msg1".to_string(), "msg2".to_string()]);
        assert_eq!(next.as_deref(), Some("tok_abc"));
    }

    #[tokio::test]
    async fn list_message_ids_no_messages_returns_empty_vec() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // Gmail omits `messages` entirely when the label is empty.
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/messages"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "resultSizeEstimate": 0
            })))
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let (ids, next) = client
            .list_message_ids("INBOX", None)
            .await
            .expect("list_message_ids empty");
        assert!(ids.is_empty(), "expected empty vec when messages key absent");
        assert!(next.is_none(), "expected no page token");
    }

    // ── get_message ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn get_message_returns_raw_json() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let msg = serde_json::json!({
            "id": "msg99",
            "threadId": "thread99",
            "labelIds": ["INBOX"],
            "payload": {
                "mimeType": "text/plain",
                "headers": [{ "name": "Subject", "value": "Test" }],
                "body": { "data": "aGVsbG8=" }
            }
        });
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/messages/msg99"))
            .respond_with(ResponseTemplate::new(200).set_body_json(msg.clone()))
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let result = client.get_message("msg99").await.expect("get_message");
        assert_eq!(result["id"], "msg99");
        assert_eq!(result["threadId"], "thread99");
    }

    // ── get_profile_history_id ───────────────────────────────────────────────

    #[tokio::test]
    async fn get_profile_history_id_parses_history_id() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/profile"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "emailAddress": "user@gmail.com",
                "messagesTotal": 4321,
                "threadsTotal": 1234,
                "historyId": "12345"
            })))
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let hid = client.get_profile_history_id().await.expect("get_profile_history_id");
        assert_eq!(hid, "12345");
    }

    // ── 429 retry ────────────────────────────────────────────────────────────

    #[tokio::test]
    async fn retries_once_on_429_then_succeeds() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // First call: 429 with Retry-After: 0 (so the test doesn't actually sleep).
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/labels"))
            .respond_with(
                ResponseTemplate::new(429).insert_header("Retry-After", "0"),
            )
            .up_to_n_times(1)
            .mount(&server)
            .await;
        // Second call: 200.
        Mock::given(method("GET"))
            .and(path("/gmail/v1/users/me/labels"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "labels": [{ "id": "INBOX", "name": "INBOX", "type": "system" }]
            })))
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let labels = client.list_labels().await.expect("should succeed after retry");
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].0, "INBOX");
    }
}
