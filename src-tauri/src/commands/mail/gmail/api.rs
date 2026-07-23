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

/// The exact draft data needed for the native approval re-check. It is never
/// logged or returned to the renderer.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GmailExistingDraft {
    pub id: String,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body: String,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GmailExistingDraftSendError {
    ProviderRefused,
    OutcomeUnknown,
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
            let resp = self.http.get(url).bearer_auth(&self.token).send().await?;
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
                // Never surface the raw Gmail response body to the caller/UI
                // (or the log): it can carry mailbox addresses or other PII.
                crate::util::http_log::log_http_failure("gmail GET", status, &body);
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

    /// List message ids across ALL mail: `messages.list` with NO `labelIds`
    /// filter. Gmail returns every message EXCEPT those in Spam and Trash
    /// (`includeSpamTrash=false` is the default). Used for the single-pass
    /// All-Mail backfill, so archived mail (which lives only in All Mail) is
    /// included and a message is not re-fetched once per overlapping label.
    pub async fn list_all_message_ids(
        &self,
        page_token: Option<&str>,
    ) -> anyhow::Result<(Vec<String>, Option<String>)> {
        let mut url = format!("{}/gmail/v1/users/me/messages?maxResults=500", self.base);
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
                // Never surface the raw Gmail response body to the caller/UI
                // (or the log): it can carry mailbox addresses or other PII.
                crate::util::http_log::log_http_failure("gmail POST", status, &body_text);
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
        attachments: &[crate::commands::mail::AttachmentInput],
    ) -> anyhow::Result<String> {
        use base64::Engine;
        use lettre::message::header::ContentType as LettreContentType;
        use lettre::message::{Attachment, Mailboxes, MultiPart, SinglePart};
        use lettre::Message;
        use std::str::FromStr;

        // Build the message using lettre's typed builder.
        let mut builder = Message::builder()
            .from(
                from.parse()
                    .map_err(|e| anyhow::anyhow!("invalid From address {from:?}: {e}"))?,
            )
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

        let email = if attachments.is_empty() {
            builder
                .body(body.to_string())
                .map_err(|e| anyhow::anyhow!("build RFC822 message: {e}"))?
        } else {
            let mut mixed = MultiPart::mixed().singlepart(SinglePart::plain(body.to_string()));
            for att in attachments {
                let bytes = base64::engine::general_purpose::STANDARD
                    .decode(&att.content_base64)
                    .map_err(|e| anyhow::anyhow!("decode attachment {:?}: {e}", att.name))?;
                let ct = LettreContentType::parse(&att.content_type).unwrap_or_else(|_| {
                    LettreContentType::parse("application/octet-stream").unwrap()
                });
                mixed = mixed.singlepart(Attachment::new(att.name.clone()).body(bytes, ct));
            }
            builder
                .multipart(mixed)
                .map_err(|e| anyhow::anyhow!("build RFC822 multipart message: {e}"))?
        };

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

    /// `POST /gmail/v1/users/me/drafts` — create a DRAFT (never sends).
    ///
    /// Builds an RFC822 message with an HTML body using lettre (mirroring
    /// `send_message`), base64url-encodes it, and posts
    /// `{ "message": { "raw": "<base64url>" } }` to the drafts.create endpoint.
    ///
    /// `in_reply_to`/`references` are the RFC822 threading headers of the
    /// message being replied to (same semantics as `send_message`); pass None
    /// for a fresh draft. Returns the Gmail DRAFT id (the outer `id` of the
    /// draft resource, not the inner message id) — deleting/sending the draft
    /// later addresses it by this id.
    pub async fn create_draft(
        &self,
        from: &str,
        to: &[String],
        subject: &str,
        body_html: &str,
        in_reply_to: Option<&str>,
        references: Option<&str>,
    ) -> anyhow::Result<String> {
        use base64::Engine;
        use lettre::message::{Mailboxes, SinglePart};
        use lettre::Message;
        use std::str::FromStr;

        let mut builder = Message::builder()
            .from(
                from.parse()
                    .map_err(|e| anyhow::anyhow!("invalid From address {from:?}: {e}"))?,
            )
            .subject(subject);
        for addr in to {
            let mbs = Mailboxes::from_str(addr)
                .map_err(|e| anyhow::anyhow!("invalid To address {addr:?}: {e}"))?;
            for mb in mbs {
                builder = builder.to(mb);
            }
        }
        if let Some(irt) = in_reply_to {
            builder = builder.in_reply_to(irt.to_string());
        }
        if let Some(refs) = references {
            builder = builder.references(refs.to_string());
        }
        let email = builder
            .singlepart(SinglePart::html(body_html.to_string()))
            .map_err(|e| anyhow::anyhow!("build RFC822 draft: {e}"))?;

        let encoded = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(email.formatted());
        let payload = serde_json::json!({ "message": { "raw": encoded } });
        let url = format!("{}/gmail/v1/users/me/drafts", self.base);
        let resp = self.post_json(&url, &payload).await?;
        resp.get("id")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("Gmail drafts.create response missing `id`"))
    }

    /// `GET /gmail/v1/users/me/drafts/{id}?format=full` — fetch the exact saved
    /// draft immediately before an explicit send.  Gmail draft ids are encoded
    /// as a single path segment even though normal ids are URL-safe.
    pub async fn get_existing_draft(&self, draft_id: &str) -> anyhow::Result<GmailExistingDraft> {
        let url = format!(
            "{}/gmail/v1/users/me/drafts/{}?format=full",
            self.base,
            enc_path_segment(draft_id)
        );
        let draft = self.get_json(&url).await?;
        let id = draft
            .get("id")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("Gmail draft response missing `id`"))?;
        let message = draft
            .get("message")
            .ok_or_else(|| anyhow::anyhow!("Gmail draft response missing message"))?;
        let normalized = crate::commands::mail::gmail::normalize::from_gmail("default", message)
            .ok_or_else(|| anyhow::anyhow!("Gmail draft message missing `id`"))?;
        Ok(GmailExistingDraft {
            id,
            to: gmail_header_recipients(message, "To"),
            cc: gmail_header_recipients(message, "Cc"),
            bcc: gmail_header_recipients(message, "Bcc"),
            subject: normalized.subject,
            body: normalized.body_text,
        })
    }

    /// `POST /gmail/v1/users/me/drafts/{id}/send` — send exactly one saved
    /// draft. Do not use the generic retrying POST helper here: once a network
    /// response is lost, a second request could send a duplicate email.
    pub async fn send_existing_draft(
        &self,
        draft_id: &str,
    ) -> Result<String, GmailExistingDraftSendError> {
        let url = format!(
            "{}/gmail/v1/users/me/drafts/{}/send",
            self.base,
            enc_path_segment(draft_id)
        );
        let response = self
            .http
            .post(&url)
            .bearer_auth(&self.token)
            .json(&serde_json::json!({}))
            .send()
            .await
            .map_err(|_| GmailExistingDraftSendError::OutcomeUnknown)?;
        let status = response.status();
        let body = response
            .text()
            .await
            .map_err(|_| GmailExistingDraftSendError::OutcomeUnknown)?;
        if !status.is_success() {
            crate::util::http_log::log_http_failure("gmail existing-draft send", status, &body);
            return Err(GmailExistingDraftSendError::ProviderRefused);
        }
        serde_json::from_str::<serde_json::Value>(&body)
            .ok()
            .and_then(|value| value.get("id").and_then(|v| v.as_str()).map(String::from))
            // A successful status with an unreadable receipt is not a known
            // refusal. Treat it as uncertain so nobody resends blind.
            .ok_or(GmailExistingDraftSendError::OutcomeUnknown)
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

fn enc_path_segment(value: &str) -> String {
    let mut encoded = String::with_capacity(value.len());
    for byte in value.bytes() {
        match byte {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'~' => {
                encoded.push(byte as char)
            }
            _ => encoded.push_str(&format!("%{byte:02X}")),
        }
    }
    encoded
}

fn gmail_header_recipients(message: &serde_json::Value, name: &str) -> Vec<String> {
    message
        .pointer("/payload/headers")
        .and_then(|v| v.as_array())
        .and_then(|headers| {
            headers.iter().find_map(|header| {
                (header
                    .get("name")
                    .and_then(|v| v.as_str())
                    .is_some_and(|header_name| header_name.eq_ignore_ascii_case(name)))
                .then(|| header.get("value").and_then(|v| v.as_str()))
                .flatten()
            })
        })
        .map(|value| {
            value
                .split(',')
                .map(str::trim)
                .filter(|value| !value.is_empty())
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
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
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(&encoded)
            .unwrap();
        assert_eq!(decoded, raw);
    }

    #[tokio::test]
    async fn gmail_send_still_accepts_display_name_recipients() {
        use base64::Engine;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/gmail/v1/users/me/messages/send"))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "id": "gmail-msg-1" })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let id = client
            .send_message(
                "advisor@example.com",
                &["Client Name <client@example.com>".to_string()],
                &[],
                &[],
                "Test subject",
                "Hello",
                None,
                None,
                &[],
            )
            .await
            .expect("Gmail should keep accepting RFC5322 recipient strings");
        assert_eq!(id, "gmail-msg-1");

        let requests = server.received_requests().await.expect("received requests");
        let body: serde_json::Value = serde_json::from_slice(&requests[0].body).expect("json body");
        let raw = body["raw"].as_str().expect("raw message");
        let decoded = base64::engine::general_purpose::URL_SAFE_NO_PAD
            .decode(raw)
            .expect("base64url raw message");
        let message = String::from_utf8(decoded).expect("utf8 message");
        assert!(
            message.contains("To: \"Client Name\" <client@example.com>"),
            "{message}"
        );
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
        assert!(
            ids.is_empty(),
            "expected empty vec when messages key absent"
        );
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
        let hid = client
            .get_profile_history_id()
            .await
            .expect("get_profile_history_id");
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
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "0"))
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
        let labels = client
            .list_labels()
            .await
            .expect("should succeed after retry");
        assert_eq!(labels.len(), 1);
        assert_eq!(labels[0].0, "INBOX");
    }

    // ── create_draft ──────────────────────────────────────────────────────────

    #[tokio::test]
    async fn create_draft_posts_to_drafts_endpoint_and_returns_draft_id() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // drafts.create returns the draft resource: { id, message: {...} }.
        // The DRAFT id (outer) is the provider draft id we must return —
        // not the inner message id.
        Mock::given(method("POST"))
            .and(path("/gmail/v1/users/me/drafts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": "r-draft-9001",
                "message": { "id": "m-777", "threadId": "t-1" }
            })))
            .expect(1)
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let id = client
            .create_draft(
                "me@example.com",
                &["alice@example.com".to_string()],
                "Follow-up: Q2 review",
                "<p>Hello Alice,</p>",
                Some("<orig-msg-id@mail.example.com>"),
                None,
            )
            .await
            .expect("create_draft should succeed");
        assert_eq!(id, "r-draft-9001");
    }

    #[tokio::test]
    async fn create_draft_missing_id_is_an_error() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/gmail/v1/users/me/drafts"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "message": { "id": "m-777" }
            })))
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let err = client
            .create_draft(
                "me@example.com",
                &["a@b.com".to_string()],
                "s",
                "<p>b</p>",
                None,
                None,
            )
            .await
            .expect_err("missing draft id must be an error");
        assert!(err.to_string().contains("missing `id`"), "got: {err}");
    }

    #[tokio::test]
    async fn existing_draft_fetches_and_sends_the_exact_escaped_draft_id() {
        use base64::Engine;
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let draft_id = "draft/with+reserved=";
        let encoded_id = "draft%2Fwith%2Breserved%3D";
        let encoded_body = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode("approved body");
        Mock::given(method("GET"))
            .and(path(format!("/gmail/v1/users/me/drafts/{encoded_id}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": draft_id,
                "message": {
                    "id": "inner-message",
                    "payload": {
                        "mimeType": "text/plain",
                        "headers": [
                            { "name": "To", "value": "client@example.com" },
                            { "name": "Cc", "value": "cc@example.com" },
                            { "name": "Bcc", "value": "bcc@example.com" },
                            { "name": "Subject", "value": "approved subject" }
                        ],
                        "body": { "data": encoded_body }
                    }
                }
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(format!("/gmail/v1/users/me/drafts/{encoded_id}/send")))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "id": "sent-message-1" })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let client = GmailClient::new_with_base("AT".into(), server.uri());
        let draft = client
            .get_existing_draft(draft_id)
            .await
            .expect("draft fetch");
        assert_eq!(draft.id, draft_id);
        assert_eq!(draft.to, vec!["client@example.com"]);
        assert_eq!(draft.cc, vec!["cc@example.com"]);
        assert_eq!(draft.bcc, vec!["bcc@example.com"]);
        assert_eq!(draft.body, "approved body");
        assert_eq!(
            client.send_existing_draft(draft_id).await,
            Ok("sent-message-1".into())
        );
    }

    #[tokio::test]
    async fn existing_draft_transport_loss_is_unknown_and_never_retried() {
        let client = GmailClient::new_with_base("AT".into(), "http://127.0.0.1:9".into());
        assert_eq!(
            client.send_existing_draft("draft-1").await,
            Err(GmailExistingDraftSendError::OutcomeUnknown)
        );
    }
}
