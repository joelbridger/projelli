use std::{future::Future, pin::Pin, sync::Arc, time::Duration};

#[derive(Debug, PartialEq)]
pub enum Continuation {
    Next(String),
    Delta(String),
    End,
}

/// Sentinel error: the delta token has expired (HTTP 410). Callers can
/// downcast with `e.downcast_ref::<DeltaGone>()` instead of string-matching.
#[derive(Debug)]
pub struct DeltaGone;
impl std::fmt::Display for DeltaGone {
    fn fmt(&self, f: &mut std::fmt::Formatter<'_>) -> std::fmt::Result {
        write!(f, "delta token expired (410 Gone): full resync required")
    }
}
impl std::error::Error for DeltaGone {}

pub type GraphTokenRefreshFuture = Pin<Box<dyn Future<Output = anyhow::Result<String>> + Send>>;
pub type GraphTokenRefresh = Arc<dyn Fn() -> GraphTokenRefreshFuture + Send + Sync>;

pub struct GraphClient {
    token: tokio::sync::Mutex<String>,
    refresh_lock: tokio::sync::Mutex<()>,
    refresh: Option<GraphTokenRefresh>,
    base: String,
    http: reqwest::Client,
}

/// The small, privacy-safe portion of a provider draft required to prove that
/// the exact approved draft is still the one about to be sent.  It deliberately
/// stays inside the native mail boundary and is never logged.
#[derive(Debug, Clone, PartialEq, Eq)]
pub struct GraphExistingDraft {
    pub id: String,
    pub is_draft: bool,
    pub to: Vec<String>,
    pub cc: Vec<String>,
    pub bcc: Vec<String>,
    pub subject: String,
    pub body: String,
}

/// A send endpoint either answered definitively, or the connection failed
/// after the request might have reached the provider.  The caller must never
/// retry the latter automatically.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum GraphExistingDraftSendError {
    ProviderRefused,
    OutcomeUnknown,
}

const GRAPH_MESSAGE_SELECT_FIELDS: &str = "id,conversationId,internetMessageId,subject,receivedDateTime,from,toRecipients,ccRecipients,hasAttachments,body,internetMessageHeaders";

impl GraphClient {
    pub fn new(token: String) -> Self {
        Self::new_with_base(token, "https://graph.microsoft.com".into())
    }
    pub fn new_with_base(token: String, base: String) -> Self {
        Self::new_with_base_and_refresh(token, base, None)
    }
    pub fn new_with_refresh(token: String, refresh: GraphTokenRefresh) -> Self {
        Self::new_with_base_and_refresh(token, "https://graph.microsoft.com".into(), Some(refresh))
    }
    pub fn new_with_base_and_refresh(
        token: String,
        base: String,
        refresh: Option<GraphTokenRefresh>,
    ) -> Self {
        // Bound every request so a hung connection can't stall a sync forever.
        let http = reqwest::Client::builder()
            .timeout(Duration::from_secs(60))
            .connect_timeout(Duration::from_secs(15))
            .build()
            .expect("build reqwest client");
        Self {
            token: tokio::sync::Mutex::new(token),
            refresh_lock: tokio::sync::Mutex::new(()),
            refresh,
            base,
            http,
        }
    }
    pub fn base(&self) -> &str {
        &self.base
    }

    async fn bearer_token(&self) -> String {
        self.token.lock().await.clone()
    }

    /// Gate attaching the Microsoft bearer token to a request: only ever send
    /// it to a real Graph origin over a safe scheme.
    ///
    /// Continuation links (nextLink/deltaLink) and persisted delta cursors are
    /// fed straight back into `get_json`/`get_bytes`, so a planted or MitM'd URL
    /// could otherwise exfiltrate the access token to an attacker-controlled
    /// host. We require the request URL's origin (scheme + host + port) to match
    /// the configured `base`, and additionally accept the canonical public Graph
    /// host (`graph.microsoft.com`) over HTTPS. Embedded userinfo, non-HTTPS
    /// public hosts, and any other host are rejected outright.
    ///
    /// Note: Graph's `/content` download endpoint 302-redirects to a
    /// pre-signed URL on a different host; reqwest's default redirect policy
    /// strips the Authorization header across hosts, so only this *initial* URL
    /// (always a Graph origin) ever carries the token. Validating it here is
    /// sufficient and does not break legitimate downloads.
    fn validate_token_target(&self, url: &str) -> anyhow::Result<()> {
        let parsed = reqwest::Url::parse(url)
            .map_err(|_| anyhow::anyhow!("graph: refusing to send token to an unparseable URL"))?;
        // Never attach credentials to a URL carrying embedded userinfo
        // (e.g. https://attacker@graph.microsoft.com/...).
        if !parsed.username().is_empty() || parsed.password().is_some() {
            anyhow::bail!("graph: refusing to send token to a URL with embedded credentials");
        }
        let scheme = parsed.scheme();
        let host = parsed.host_str().unwrap_or("");
        // The canonical public Graph endpoint, always over HTTPS on the default
        // 443 port. Pinning the port closes a planted-URL gap: a link like
        // `https://graph.microsoft.com:444/...` would otherwise match host+scheme
        // and send the token to a non-standard port. Legit next/delta/download
        // links always use 443; configured test/national-cloud origins are
        // handled by the exact-origin branch below.
        if scheme == "https"
            && host.eq_ignore_ascii_case("graph.microsoft.com")
            && parsed.port_or_known_default() == Some(443)
        {
            return Ok(());
        }
        // Otherwise require the exact origin of the configured base. This covers
        // test mock servers (http://127.0.0.1:port), national clouds, and any
        // pinned/proxy base, while still rejecting every other host.
        if let Ok(base) = reqwest::Url::parse(&self.base) {
            if scheme == base.scheme()
                && host.eq_ignore_ascii_case(base.host_str().unwrap_or(""))
                && parsed.port_or_known_default() == base.port_or_known_default()
            {
                return Ok(());
            }
        }
        anyhow::bail!("graph: refusing to send token to non-Graph host '{host}'")
    }

    async fn refresh_after_unauthorized(&self, stale_access: &str) -> anyhow::Result<bool> {
        let Some(refresh) = &self.refresh else {
            return Ok(false);
        };
        let _refresh_guard = self.refresh_lock.lock().await;
        if self.bearer_token().await != stale_access {
            return Ok(true);
        }
        let access = refresh().await.map_err(|e| {
            anyhow::anyhow!("Microsoft Graph access token expired and refresh failed: {e}")
        })?;
        if access.trim().is_empty() {
            anyhow::bail!(
                "Microsoft Graph access token expired and refresh returned an empty token"
            );
        }
        *self.token.lock().await = access;
        Ok(true)
    }

    /// GET an absolute Graph URL (used for nextLink/deltaLink which come back
    /// fully-formed), honoring 429/Retry-After with capped backoff. Up to 8 tries.
    pub async fn get_json(&self, url: &str) -> anyhow::Result<serde_json::Value> {
        self.validate_token_target(url)?;
        let mut throttle_attempt = 0u32;
        let mut refreshed = false;
        loop {
            if throttle_attempt >= 8 {
                anyhow::bail!("graph: throttled past retry budget");
            }
            let access = self.bearer_token().await;
            let resp = self.http.get(url).bearer_auth(&access).send().await?;
            if resp.status().as_u16() == 429 {
                let ra = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                tokio::time::sleep(retry_delay(ra.as_deref(), throttle_attempt)).await;
                throttle_attempt += 1;
                continue;
            }
            let status = resp.status();
            if status.as_u16() == 401 && !refreshed {
                if self.refresh_after_unauthorized(&access).await? {
                    refreshed = true;
                    continue;
                }
            }
            let body = resp.text().await?;
            if status.as_u16() == 410 {
                log::warn!(
                    "graph request failed: url={} status={} {}",
                    redact_url(url),
                    status,
                    summarize_error_body(&body)
                );
                return Err(anyhow::Error::new(DeltaGone));
            }
            if !status.is_success() {
                // Never surface the raw Graph body to the caller/UI: it can carry
                // mailbox addresses or other PII. Log a redacted url + a
                // non-sensitive body summary only; return status to the caller.
                log::warn!(
                    "graph request failed: url={} status={} {}",
                    redact_url(url),
                    status,
                    summarize_error_body(&body)
                );
                anyhow::bail!("Microsoft Graph request failed (HTTP {})", status);
            }
            return Ok(serde_json::from_str(&body)?);
        }
    }

    /// GET an absolute Graph URL and return raw response bytes. Used for
    /// OneDrive/SharePoint file downloads. Mirrors `get_json`'s retry and
    /// status-only UI error policy; raw error bodies are logged locally only.
    pub async fn get_bytes(&self, url: &str) -> anyhow::Result<Vec<u8>> {
        self.validate_token_target(url)?;
        let mut throttle_attempt = 0u32;
        let mut refreshed = false;
        loop {
            if throttle_attempt >= 8 {
                anyhow::bail!("graph: throttled past retry budget");
            }
            let access = self.bearer_token().await;
            let resp = self.http.get(url).bearer_auth(&access).send().await?;
            if resp.status().as_u16() == 429 {
                let ra = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                tokio::time::sleep(retry_delay(ra.as_deref(), throttle_attempt)).await;
                throttle_attempt += 1;
                continue;
            }
            let status = resp.status();
            if status.as_u16() == 401 && !refreshed {
                if self.refresh_after_unauthorized(&access).await? {
                    refreshed = true;
                    continue;
                }
            }
            if !status.is_success() {
                let body = resp.text().await?;
                log::warn!(
                    "graph byte request failed: url={} status={} {}",
                    redact_url(url),
                    status,
                    summarize_error_body(&body)
                );
                if status.as_u16() == 410 {
                    return Err(anyhow::Error::new(DeltaGone));
                }
                anyhow::bail!("Microsoft Graph request failed (HTTP {})", status);
            }
            return Ok(resp.bytes().await?.to_vec());
        }
    }

    /// Start a delta round for a folder (no cursor) or resume from a saved
    /// next/delta link. Returns the absolute URL to GET first.
    pub fn delta_start_url(&self, folder_id: &str) -> String {
        format!(
            "{}/v1.0/me/mailFolders/{}/messages/delta?$select={}",
            self.base,
            enc_path_segment(folder_id),
            GRAPH_MESSAGE_SELECT_FIELDS
        )
    }

    /// `GET /v1.0/me/messages/{id}/attachments/{att_id}` — returns the raw
    /// decoded bytes from the Graph `contentBytes` field (base64).
    pub async fn get_attachment(
        &self,
        message_id: &str,
        attachment_id: &str,
    ) -> anyhow::Result<(Vec<u8>, String, String)> {
        use base64::Engine;
        let url = format!(
            "{}/v1.0/me/messages/{}/attachments/{}",
            self.base,
            enc_path_segment(message_id),
            enc_path_segment(attachment_id)
        );
        let v = self.get_json(&url).await?;
        let content_bytes = v
            .get("contentBytes")
            .and_then(|b| b.as_str())
            .ok_or_else(|| anyhow::anyhow!("Graph attachment response missing `contentBytes`"))?;
        let bytes = base64::engine::general_purpose::STANDARD
            .decode(content_bytes)
            .map_err(|e| anyhow::anyhow!("base64 decode Graph attachment: {e}"))?;
        let content_type = v
            .get("contentType")
            .and_then(|t| t.as_str())
            .unwrap_or("application/octet-stream")
            .to_string();
        let name = v
            .get("name")
            .and_then(|n| n.as_str())
            .unwrap_or("attachment")
            .to_string();
        Ok((bytes, content_type, name))
    }

    /// `GET /v1.0/me/messages/{id}/attachments` — returns stable attachment
    /// refs without downloading the bytes. Sync stores these refs so later
    /// proposal cards can identify a file safely without trusting body text.
    pub async fn list_attachment_refs(
        &self,
        message_id: &str,
    ) -> anyhow::Result<Vec<crate::commands::mail::model::MailAttachmentRef>> {
        let url = format!(
            "{}/v1.0/me/messages/{}/attachments?$select=id,name,contentType,size,isInline",
            self.base,
            enc_path_segment(message_id)
        );
        let v = self.get_json(&url).await?;
        Ok(crate::commands::mail::model::graph_attachment_refs_from_value(&v))
    }

    /// POST JSON to an absolute Graph URL, returning the response body as JSON
    /// (or an empty object `{}` for 202 Accepted which has no body).
    /// Honors 429/Retry-After with capped backoff. Up to 8 tries.
    /// Never surfaces the raw response body to the caller.
    pub async fn post_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        self.validate_token_target(url)?;
        let mut throttle_attempt = 0u32;
        let mut refreshed = false;
        loop {
            if throttle_attempt >= 8 {
                anyhow::bail!("graph: throttled past retry budget");
            }
            let access = self.bearer_token().await;
            let resp = self
                .http
                .post(url)
                .bearer_auth(&access)
                .json(body)
                .send()
                .await?;
            if resp.status().as_u16() == 429 {
                let ra = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                tokio::time::sleep(retry_delay(ra.as_deref(), throttle_attempt)).await;
                throttle_attempt += 1;
                continue;
            }
            let status = resp.status();
            if status.as_u16() == 401 && !refreshed {
                if self.refresh_after_unauthorized(&access).await? {
                    refreshed = true;
                    continue;
                }
            }
            if status.as_u16() == 202 {
                // sendMail returns 202 Accepted with an empty body.
                return Ok(serde_json::json!({}));
            }
            let body_text = resp.text().await?;
            if !status.is_success() {
                log::warn!(
                    "graph POST failed: url={} status={} {}",
                    redact_url(url),
                    status,
                    summarize_error_body(&body_text)
                );
                anyhow::bail!("Microsoft Graph request failed (HTTP {})", status);
            }
            return Ok(serde_json::from_str(&body_text).unwrap_or(serde_json::json!({})));
        }
    }

    /// `POST /v1.0/me/sendMail` — compose and send a message immediately.
    ///
    /// `conversation_id` is set when replying (Graph uses `conversationId` for
    /// threading; there is no `In-Reply-To` header equivalent in the Graph send
    /// API). Pass `None` for new messages.
    ///
    /// BCC recipients are sent but never written to the message body, so they
    /// remain invisible to To/CC recipients — this is enforced by the Graph API.
    ///
    /// Returns the empty string on success (sendMail returns 202, no message id).
    pub async fn send_message(
        &self,
        to: &[String],
        cc: &[String],
        bcc: &[String],
        subject: &str,
        body: &str,
        conversation_id: Option<&str>,
        save_to_sent: bool,
        attachments: &[crate::commands::mail::AttachmentInput],
    ) -> anyhow::Result<String> {
        let mut message = serde_json::json!({
            "subject": subject,
            "body": {
                "contentType": "Text",
                "content": body
            },
            "toRecipients": recipient_objs(to),
            "ccRecipients": recipient_objs(cc),
            "bccRecipients": recipient_objs(bcc),
        });
        if let Some(cid) = conversation_id {
            message["conversationId"] = serde_json::Value::String(cid.to_string());
        }
        if !attachments.is_empty() {
            message["attachments"] = serde_json::Value::Array(
                attachments
                    .iter()
                    .map(|att| {
                        serde_json::json!({
                            "@odata.type": "#microsoft.graph.fileAttachment",
                            "name": att.name,
                            "contentType": att.content_type,
                            "contentBytes": att.content_base64,
                        })
                    })
                    .collect(),
            );
        }
        let payload = serde_json::json!({
            "message": message,
            "saveToSentItems": save_to_sent
        });
        let url = format!("{}/v1.0/me/sendMail", self.base);
        self.post_json(&url, &payload).await?;
        Ok(String::new())
    }

    /// Re-fetch one saved Graph draft immediately before sending.  The draft id
    /// is encoded as one path segment so provider ids can never alter the URL.
    pub async fn get_existing_draft(&self, draft_id: &str) -> anyhow::Result<GraphExistingDraft> {
        let url = format!(
            "{}/v1.0/me/messages/{}?$select=id,isDraft,toRecipients,ccRecipients,bccRecipients,subject,body",
            self.base,
            enc_path_segment(draft_id)
        );
        let value = self.get_json(&url).await?;
        let id = value
            .get("id")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("Graph draft response missing `id`"))?;
        let body = value
            .pointer("/body/content")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("Graph draft response missing body content"))?;
        Ok(GraphExistingDraft {
            id,
            is_draft: value
                .get("isDraft")
                .and_then(|v| v.as_bool())
                .unwrap_or(false),
            to: graph_draft_recipients(&value, "toRecipients"),
            cc: graph_draft_recipients(&value, "ccRecipients"),
            bcc: graph_draft_recipients(&value, "bccRecipients"),
            subject: value
                .get("subject")
                .and_then(|v| v.as_str())
                .unwrap_or_default()
                .to_string(),
            body,
        })
    }

    /// Send one already-saved draft.  This intentionally makes one request and
    /// never retries a transport failure: after a timeout or lost response the
    /// provider may have accepted it, so repeating it could duplicate mail.
    pub async fn send_existing_draft(
        &self,
        draft_id: &str,
    ) -> Result<(), GraphExistingDraftSendError> {
        let url = format!(
            "{}/v1.0/me/messages/{}/send",
            self.base,
            enc_path_segment(draft_id)
        );
        self.validate_token_target(&url)
            .map_err(|_| GraphExistingDraftSendError::ProviderRefused)?;
        let access = self.bearer_token().await;
        let response = self
            .http
            .post(&url)
            .bearer_auth(&access)
            .send()
            .await
            .map_err(|_| GraphExistingDraftSendError::OutcomeUnknown)?;
        if response.status().as_u16() == 202 {
            return Ok(());
        }
        // Deliberate status-only logging: Graph response bodies can include
        // recipients, subjects, and mailbox information.
        log::warn!(
            "Graph existing-draft send refused: status={}",
            response.status()
        );
        Err(GraphExistingDraftSendError::ProviderRefused)
    }

    /// PATCH JSON to an absolute Graph URL. Mirrors `post_json` exactly
    /// (429/Retry-After capped backoff, one 401 refresh, PII-safe logging);
    /// only the HTTP verb differs. Used to fill in a createReply draft.
    pub async fn patch_json(
        &self,
        url: &str,
        body: &serde_json::Value,
    ) -> anyhow::Result<serde_json::Value> {
        self.validate_token_target(url)?;
        let mut throttle_attempt = 0u32;
        let mut refreshed = false;
        loop {
            if throttle_attempt >= 8 {
                anyhow::bail!("graph: throttled past retry budget");
            }
            let access = self.bearer_token().await;
            let resp = self
                .http
                .patch(url)
                .bearer_auth(&access)
                .json(body)
                .send()
                .await?;
            if resp.status().as_u16() == 429 {
                let ra = resp
                    .headers()
                    .get("Retry-After")
                    .and_then(|v| v.to_str().ok())
                    .map(String::from);
                tokio::time::sleep(retry_delay(ra.as_deref(), throttle_attempt)).await;
                throttle_attempt += 1;
                continue;
            }
            let status = resp.status();
            if status.as_u16() == 401 && !refreshed {
                if self.refresh_after_unauthorized(&access).await? {
                    refreshed = true;
                    continue;
                }
            }
            let body_text = resp.text().await?;
            if !status.is_success() {
                log::warn!(
                    "graph PATCH failed: url={} status={} {}",
                    redact_url(url),
                    status,
                    summarize_error_body(&body_text)
                );
                anyhow::bail!("Microsoft Graph request failed (HTTP {})", status);
            }
            return Ok(serde_json::from_str(&body_text).unwrap_or(serde_json::json!({})));
        }
    }

    /// `POST /v1.0/me/messages` — create a DRAFT message in the mailbox's
    /// Drafts folder. Never sends. Returns the Graph draft message id.
    ///
    /// Body is HTML (the Wave 0 draft-to-mailbox contract passes `body_html`);
    /// Graph's `contentType: "HTML"` matches what Outlook shows when the user
    /// opens the draft to review and send it themselves.
    pub async fn create_draft(
        &self,
        to: &[String],
        subject: &str,
        body_html: &str,
    ) -> anyhow::Result<String> {
        let message = serde_json::json!({
            "subject": subject,
            "body": { "contentType": "HTML", "content": body_html },
            "toRecipients": recipient_objs(to),
        });
        let url = format!("{}/v1.0/me/messages", self.base);
        let resp = self.post_json(&url, &message).await?;
        resp.get("id")
            .and_then(|v| v.as_str())
            .map(String::from)
            .ok_or_else(|| anyhow::anyhow!("Graph draft response missing `id`"))
    }

    /// `POST /v1.0/me/messages/{id}/createReply` then `PATCH` — create a reply
    /// DRAFT threaded onto an existing message, then fill in our subject, HTML
    /// body, and recipients. Graph has no way to set reply threading on a plain
    /// `POST /me/messages` draft, so the two-step is the correct route.
    /// Returns the reply-draft message id.
    pub async fn create_reply_draft(
        &self,
        original_message_id: &str,
        to: &[String],
        subject: &str,
        body_html: &str,
    ) -> anyhow::Result<String> {
        let url = format!(
            "{}/v1.0/me/messages/{}/createReply",
            self.base,
            enc_path_segment(original_message_id)
        );
        let resp = self.post_json(&url, &serde_json::json!({})).await?;
        let draft_id = resp
            .get("id")
            .and_then(|v| v.as_str())
            .ok_or_else(|| anyhow::anyhow!("Graph createReply response missing `id`"))?
            .to_string();
        let patch = serde_json::json!({
            "subject": subject,
            "body": { "contentType": "HTML", "content": body_html },
            "toRecipients": recipient_objs(to),
        });
        let patch_url = format!(
            "{}/v1.0/me/messages/{}",
            self.base,
            enc_path_segment(&draft_id)
        );
        self.patch_json(&patch_url, &patch).await?;
        Ok(draft_id)
    }
}

/// Build Graph recipient objects. Graph requires the email address in
/// `emailAddress.address`; it does not accept an RFC5322 display string such as
/// `Client Name <client@example.com>` in that field.
fn recipient_objs(addrs: &[String]) -> Vec<serde_json::Value> {
    addrs.iter().map(|addr| recipient_obj(addr)).collect()
}

fn graph_draft_recipients(value: &serde_json::Value, key: &str) -> Vec<String> {
    value
        .get(key)
        .and_then(|v| v.as_array())
        .map(|recipients| {
            recipients
                .iter()
                .filter_map(|recipient| {
                    recipient
                        .pointer("/emailAddress/address")
                        .and_then(|v| v.as_str())
                })
                .map(String::from)
                .collect()
        })
        .unwrap_or_default()
}

fn recipient_obj(addr: &str) -> serde_json::Value {
    let (name, address) = split_display_address(addr);
    let mut email_address = serde_json::json!({ "address": address });
    if let Some(name) = name {
        email_address["name"] = serde_json::Value::String(name);
    }
    serde_json::json!({ "emailAddress": email_address })
}

fn split_display_address(raw: &str) -> (Option<String>, String) {
    let trimmed = raw.trim();
    if let (Some(start), Some(end)) = (trimmed.rfind('<'), trimmed.rfind('>')) {
        if start < end {
            let address = trimmed[start + 1..end].trim();
            if !address.is_empty() {
                let name = trimmed[..start].trim().trim_matches('"').trim().to_string();
                return (
                    if name.is_empty() { None } else { Some(name) },
                    address.to_string(),
                );
            }
        }
    }
    (None, trimmed.to_string())
}

/// Redact a Graph URL for local logging: keep only host + path, dropping the
/// query string and fragment. next/delta links carry opaque sync cursors
/// (skip/delta tokens) in the query that must never reach the log. Userinfo, if
/// any, is dropped with the rest of the authority components we don't emit.
fn redact_url(url: &str) -> String {
    match reqwest::Url::parse(url) {
        Ok(u) => format!("{}{}", u.host_str().unwrap_or("?"), u.path()),
        Err(_) => "<unparseable-url>".to_string(),
    }
}

/// Summarize a Graph error body for logging without leaking PII. Graph errors
/// are shaped `{"error":{"code":"...","message":"..."}}`; the `code` is a safe
/// machine enum (e.g. `InvalidAuthenticationToken`, `itemNotFound`) but the
/// `message` can carry mailbox/document metadata. We log only the code (when
/// present) plus the raw body length — never the body itself.
fn summarize_error_body(body: &str) -> String {
    let code = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| {
            v.get("error")
                .and_then(|e| e.get("code"))
                .and_then(|c| c.as_str())
                .map(String::from)
        });
    match code {
        Some(c) => format!("code={c} bytes={}", body.len()),
        None => format!("bytes={}", body.len()),
    }
}

/// Percent-encode a single URL path segment. Graph folder ids are normally
/// base64url (already safe), but we encode anything outside the unreserved set
/// so an odd/hostile id can never break out of the segment (via `/`, `?`, `#`,
/// or a `..` segment). `.` is encoded too, specifically to neutralize `..`.
fn enc_path_segment(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    for b in s.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'~' => out.push(b as char),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

/// Microsoft says: wait the Retry-After seconds and retry; if absent, back off
/// exponentially. Every delay is capped (header included) so a hostile or
/// misconfigured server can't park a sync for hours.
pub fn retry_delay(retry_after_header: Option<&str>, attempt: u32) -> Duration {
    const MAX_HEADER_SECS: u64 = 120;
    if let Some(h) = retry_after_header {
        if let Ok(secs) = h.trim().parse::<u64>() {
            return Duration::from_secs(secs.min(MAX_HEADER_SECS));
        }
    }
    let secs = 1u64.checked_shl(attempt).unwrap_or(60).min(60);
    Duration::from_secs(secs)
}

/// A delta page carries EITHER a nextLink (more pages this round) OR a
/// deltaLink (round complete) OR neither. Never both (per Graph docs).
pub fn page_continuation(page: &serde_json::Value) -> Continuation {
    if let Some(n) = page.get("@odata.nextLink").and_then(|v| v.as_str()) {
        return Continuation::Next(n.to_string());
    }
    if let Some(d) = page.get("@odata.deltaLink").and_then(|v| v.as_str()) {
        return Continuation::Delta(d.to_string());
    }
    Continuation::End
}

use crate::commands::mail::model::MailMessage;
use crate::commands::mail::provider::{ChangePage, Cursor, MailProvider, RemoteFolder};
use async_trait::async_trait;

/// Max consecutive 410 (delta-token-expired) resets within one fetch before giving up.
const PROVIDER_MAX_DELTA_RESETS: u32 = 3;

/// Microsoft 365 implementation of `MailProvider`, wrapping `GraphClient`.
pub struct GraphProvider {
    client: GraphClient,
}
impl GraphProvider {
    pub fn new(token: String) -> Self {
        Self {
            client: GraphClient::new(token),
        }
    }
    pub fn new_with_base(token: String, base: String) -> Self {
        Self {
            client: GraphClient::new_with_base(token, base),
        }
    }
    pub fn new_with_refresh(token: String, refresh: GraphTokenRefresh) -> Self {
        Self {
            client: GraphClient::new_with_refresh(token, refresh),
        }
    }
    pub fn new_with_base_and_refresh(
        token: String,
        base: String,
        refresh: GraphTokenRefresh,
    ) -> Self {
        Self {
            client: GraphClient::new_with_base_and_refresh(token, base, Some(refresh)),
        }
    }
}

#[async_trait]
impl MailProvider for GraphProvider {
    fn kind(&self) -> &'static str {
        "m365"
    }

    async fn list_folders(&self) -> anyhow::Result<Vec<RemoteFolder>> {
        // Resolve the junk folders (Deleted Items + Junk Email) by their stable
        // well-known names, so they can be excluded regardless of mailbox
        // language. A confidential mail search must not surface deleted or junk
        // mail (the equivalent of Gmail's SPAM/TRASH exclusion). Best-effort: if a
        // lookup fails we simply don't add it to the skip set.
        let mut skip_ids = std::collections::HashSet::new();
        for well_known in ["deleteditems", "junkemail"] {
            let url = format!(
                "{}/v1.0/me/mailFolders/{}?$select=id",
                self.client.base(),
                well_known
            );
            if let Ok(j) = self.client.get_json(&url).await {
                if let Some(id) = j.get("id").and_then(|s| s.as_str()) {
                    skip_ids.insert(id.to_string());
                }
            }
        }

        let mut folders = Vec::new();
        let mut next = Some(format!(
            "{}/v1.0/me/mailFolders?$top=200",
            self.client.base()
        ));
        while let Some(url) = next {
            let page = self.client.get_json(&url).await?;
            if let Some(arr) = page.get("value").and_then(|v| v.as_array()) {
                for f in arr {
                    if let Some(id) = f.get("id").and_then(|s| s.as_str()) {
                        if skip_ids.contains(id) {
                            continue;
                        } // skip Deleted Items / Junk Email
                        let name = f
                            .get("displayName")
                            .and_then(|s| s.as_str())
                            .unwrap_or(id)
                            .to_string();
                        folders.push(RemoteFolder {
                            id: id.to_string(),
                            display_name: name,
                        });
                    }
                }
            }
            next = page
                .get("@odata.nextLink")
                .and_then(|v| v.as_str())
                .map(String::from);
        }
        Ok(folders)
    }

    async fn fetch_changes(
        &self,
        folder: &RemoteFolder,
        cursor: &Cursor,
    ) -> anyhow::Result<ChangePage> {
        let mut url = match cursor {
            Cursor::Backfill => self.client.delta_start_url(&folder.id),
            Cursor::Resume(t) => t.clone(),
        };
        let mut resets = 0u32;
        let page = loop {
            match self.client.get_json(&url).await {
                Ok(p) => break p,
                Err(e) if e.downcast_ref::<DeltaGone>().is_some() => {
                    resets += 1;
                    if resets > PROVIDER_MAX_DELTA_RESETS {
                        anyhow::bail!(
                            "folder {}: delta token expired {} times in a row; giving up",
                            folder.id,
                            resets
                        );
                    }
                    url = self.client.delta_start_url(&folder.id);
                }
                Err(e) => return Err(e),
            }
        };
        let mut messages = Vec::new();
        let mut removed_ids = Vec::new();
        if let Some(arr) = page.get("value").and_then(|v| v.as_array()) {
            for item in arr {
                let id = item.get("id").and_then(|s| s.as_str()).unwrap_or("");
                if id.is_empty() {
                    continue;
                }
                if MailMessage::is_removed(item) {
                    removed_ids.push(id.to_string());
                } else if let Some(mut m) = MailMessage::from_graph(item) {
                    if m.has_attachments && m.attachments.is_empty() {
                        match self.client.list_attachment_refs(&m.id).await {
                            Ok(refs) => {
                                m.attachments = refs;
                            }
                            Err(e) => {
                                log::warn!(
                                    "graph attachment metadata fetch failed for message {}: {e}",
                                    m.id
                                );
                                m.attachments_unsupported = true;
                            }
                        }
                    }
                    messages.push(m);
                }
            }
        }
        Ok(match page_continuation(&page) {
            Continuation::Next(n) => ChangePage {
                messages,
                removed_ids,
                next: Some(n),
                done: false,
            },
            Continuation::Delta(d) => ChangePage {
                messages,
                removed_ids,
                next: Some(d),
                done: true,
            },
            Continuation::End => ChangePage {
                messages,
                removed_ids,
                next: None,
                done: true,
            },
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::time::Duration;

    #[tokio::test]
    async fn fetches_delta_page_and_retries_on_429() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        // First call 429 with Retry-After: 0, second returns a page.
        Mock::given(method("GET"))
            .and(path("/v1.0/me/mailFolders/inbox/messages/delta"))
            .respond_with(ResponseTemplate::new(429).insert_header("Retry-After", "0"))
            .up_to_n_times(1)
            .mount(&server)
            .await;
        Mock::given(method("GET")).and(path("/v1.0/me/mailFolders/inbox/messages/delta"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "id": "m1", "subject": "Hi", "body": {"contentType":"text","content":"yo"} }],
                "@odata.deltaLink": "https://x/d?$deltatoken=tok"
            }))).mount(&server).await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let url = format!("{}/v1.0/me/mailFolders/inbox/messages/delta", server.uri());
        let page = client.get_json(&url).await.expect("page");
        assert_eq!(
            page_continuation(&page),
            Continuation::Delta("https://x/d?$deltatoken=tok".into())
        );
        assert_eq!(page["value"][0]["id"], "m1");
    }

    #[tokio::test]
    async fn get_json_refreshes_access_token_once_on_401() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1.0/me/drive/root/delta"))
            .and(header("authorization", "Bearer OLD"))
            .respond_with(ResponseTemplate::new(401).set_body_string("expired token"))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/v1.0/me/drive/root/delta"))
            .and(header("authorization", "Bearer NEW"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "id": "file-1", "name": "Plan.docx" }]
            })))
            .mount(&server)
            .await;

        let refresh_count = Arc::new(AtomicUsize::new(0));
        let refresh_seen = refresh_count.clone();
        let refresh: GraphTokenRefresh = Arc::new(move || -> GraphTokenRefreshFuture {
            let refresh_seen = refresh_seen.clone();
            Box::pin(async move {
                refresh_seen.fetch_add(1, Ordering::SeqCst);
                Ok("NEW".to_string())
            })
        });
        let client =
            GraphClient::new_with_base_and_refresh("OLD".into(), server.uri(), Some(refresh));
        let url = format!("{}/v1.0/me/drive/root/delta", server.uri());

        let page = client
            .get_json(&url)
            .await
            .expect("401 should refresh and retry");

        assert_eq!(refresh_count.load(Ordering::SeqCst), 1);
        assert_eq!(page["value"][0]["id"], "file-1");
    }

    #[tokio::test]
    async fn concurrent_401s_share_one_access_token_refresh() {
        use std::sync::{
            atomic::{AtomicUsize, Ordering},
            Arc,
        };
        use wiremock::matchers::{header, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1.0/me/drive/root/delta"))
            .and(header("authorization", "Bearer OLD"))
            .respond_with(ResponseTemplate::new(401).set_body_string("expired token"))
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/v1.0/me/drive/root/delta"))
            .and(header("authorization", "Bearer NEW"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "id": "file-1", "name": "Plan.docx" }]
            })))
            .mount(&server)
            .await;

        let refresh_count = Arc::new(AtomicUsize::new(0));
        let refresh_seen = refresh_count.clone();
        let refresh: GraphTokenRefresh = Arc::new(move || -> GraphTokenRefreshFuture {
            let refresh_seen = refresh_seen.clone();
            Box::pin(async move {
                refresh_seen.fetch_add(1, Ordering::SeqCst);
                tokio::time::sleep(Duration::from_millis(25)).await;
                Ok("NEW".to_string())
            })
        });
        let client = Arc::new(GraphClient::new_with_base_and_refresh(
            "OLD".into(),
            server.uri(),
            Some(refresh),
        ));
        let url = format!("{}/v1.0/me/drive/root/delta", server.uri());

        let mut tasks = Vec::new();
        for _ in 0..5 {
            let client = client.clone();
            let url = url.clone();
            tasks.push(tokio::spawn(async move { client.get_json(&url).await }));
        }

        for task in tasks {
            let page = task
                .await
                .expect("task should join")
                .expect("request should retry");
            assert_eq!(page["value"][0]["id"], "file-1");
        }
        assert_eq!(refresh_count.load(Ordering::SeqCst), 1);
    }

    #[tokio::test]
    async fn list_folders_excludes_deleted_and_junk() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        // The two well-known junk-folder lookups resolve their (locale-independent) ids.
        Mock::given(method("GET"))
            .and(path("/v1.0/me/mailFolders/deleteditems"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "id": "DEL_ID" })),
            )
            .mount(&server)
            .await;
        Mock::given(method("GET"))
            .and(path("/v1.0/me/mailFolders/junkemail"))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "id": "JUNK_ID" })),
            )
            .mount(&server)
            .await;
        // The folder list contains Inbox, Deleted Items, Junk Email, and Sent Items.
        Mock::given(method("GET"))
            .and(path("/v1.0/me/mailFolders"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [
                    { "id": "INBOX_ID", "displayName": "Inbox" },
                    { "id": "DEL_ID",   "displayName": "Deleted Items" },
                    { "id": "JUNK_ID",  "displayName": "Junk Email" },
                    { "id": "SENT_ID",  "displayName": "Sent Items" }
                ]
            })))
            .mount(&server)
            .await;

        let provider = GraphProvider::new_with_base("AT".into(), server.uri());
        let folders = provider.list_folders().await.expect("list_folders");
        let ids: Vec<&str> = folders.iter().map(|f| f.id.as_str()).collect();
        // Deleted Items + Junk Email are excluded; Inbox + Sent Items are kept.
        assert_eq!(ids, vec!["INBOX_ID", "SENT_ID"]);
    }

    #[tokio::test]
    async fn fetch_changes_preserves_graph_auth_headers_from_delta_items() {
        use crate::commands::mail::model::{MailAuthSource, MailAuthVerdict};
        use wiremock::matchers::{method, path, query_param};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1.0/me/mailFolders/inbox/messages/delta"))
            .and(query_param("$select", GRAPH_MESSAGE_SELECT_FIELDS))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [
                    {
                        "id": "pass-msg",
                        "subject": "Signed reply",
                        "internetMessageHeaders": [
                            {
                                "name": "Authentication-Results",
                                "value": "mx.outlook.com; dkim=pass header.d=example.com; spf=pass smtp.mailfrom=example.com; dmarc=pass header.from=example.com"
                            }
                        ],
                        "body": { "contentType": "text", "content": "ok" }
                    },
                    {
                        "id": "fail-msg",
                        "subject": "Failed reply",
                        "internetMessageHeaders": [
                            {
                                "name": "Authentication-Results",
                                "value": "mx.outlook.com; dkim=pass header.d=example.com; spf=pass smtp.mailfrom=example.com; dmarc=fail header.from=example.com"
                            }
                        ],
                        "body": { "contentType": "text", "content": "bad" }
                    },
                    {
                        "id": "missing-msg",
                        "subject": "No auth reply",
                        "body": { "contentType": "text", "content": "missing" }
                    }
                ],
                "@odata.deltaLink": "https://graph.microsoft.com/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=done"
            })))
            .mount(&server)
            .await;

        let provider = GraphProvider::new_with_base("AT".into(), server.uri());
        let page = provider
            .fetch_changes(
                &RemoteFolder {
                    id: "inbox".to_string(),
                    display_name: "Inbox".to_string(),
                },
                &Cursor::Backfill,
            )
            .await
            .expect("fetch changes");

        assert_eq!(page.messages.len(), 3);
        assert_eq!(page.messages[0].id, "pass-msg");
        assert_eq!(page.messages[0].auth_result.dkim, MailAuthVerdict::Pass);
        assert_eq!(page.messages[0].auth_result.spf, MailAuthVerdict::Pass);
        assert_eq!(page.messages[0].auth_result.dmarc, MailAuthVerdict::Pass);
        assert_eq!(page.messages[0].auth_result.source, MailAuthSource::Graph);
        assert!(page.messages[0].auth_result.aligned);

        assert_eq!(page.messages[1].id, "fail-msg");
        assert_eq!(page.messages[1].auth_result.dmarc, MailAuthVerdict::Fail);
        assert!(!page.messages[1].auth_result.aligned);

        assert_eq!(page.messages[2].id, "missing-msg");
        assert_eq!(page.messages[2].auth_result.dkim, MailAuthVerdict::None);
        assert_eq!(page.messages[2].auth_result.spf, MailAuthVerdict::None);
        assert_eq!(page.messages[2].auth_result.dmarc, MailAuthVerdict::None);
        assert_eq!(page.messages[2].auth_result.source, MailAuthSource::Missing);
        assert!(!page.messages[2].auth_result.aligned);
    }

    #[test]
    fn retry_after_header_wins() {
        assert_eq!(retry_delay(Some("10"), 0), Duration::from_secs(10));
        assert_eq!(retry_delay(Some("0"), 3), Duration::from_secs(0));
    }

    #[test]
    fn falls_back_to_capped_exponential_backoff() {
        // attempt 0 -> 1s, 1 -> 2s, 2 -> 4s, capped at 60s
        assert_eq!(retry_delay(None, 0), Duration::from_secs(1));
        assert_eq!(retry_delay(None, 2), Duration::from_secs(4));
        assert_eq!(retry_delay(None, 10), Duration::from_secs(60));
    }

    #[test]
    fn retry_after_header_is_capped() {
        // A hostile/misconfigured server cannot park the sync for hours.
        assert_eq!(retry_delay(Some("86400"), 0), Duration::from_secs(120));
        assert_eq!(retry_delay(Some("120"), 0), Duration::from_secs(120));
        assert_eq!(retry_delay(Some("30"), 0), Duration::from_secs(30));
    }

    #[test]
    fn delta_start_url_encodes_unsafe_folder_id() {
        let client = GraphClient::new_with_base("AT".into(), "https://g".into());
        // Normal base64url ids pass through unchanged.
        let safe = client.delta_start_url("AQMkAD-0_abc");
        let parsed_safe = reqwest::Url::parse(&safe).expect("safe url");
        assert_eq!(
            parsed_safe.path(),
            "/v1.0/me/mailFolders/AQMkAD-0_abc/messages/delta"
        );
        assert_eq!(
            parsed_safe
                .query_pairs()
                .find(|(key, _)| key == "$select")
                .map(|(_, value)| value.into_owned()),
            Some(GRAPH_MESSAGE_SELECT_FIELDS.to_string())
        );
        // A traversal/escape attempt is neutralized (no raw `/` or `..` survives).
        let evil = client.delta_start_url("../../etc");
        assert!(
            !evil.contains("/../../etc/"),
            "folder id must be encoded: {evil}"
        );
        assert!(
            evil.contains("%2E%2E%2F%2E%2E%2Fetc"),
            "expected percent-encoding, got {evil}"
        );
    }

    #[test]
    fn extracts_delta_and_next_links() {
        let next =
            serde_json::json!({ "value": [], "@odata.nextLink": "https://g/n?$skiptoken=s" });
        let delta =
            serde_json::json!({ "value": [], "@odata.deltaLink": "https://g/d?$deltatoken=d" });
        assert_eq!(
            page_continuation(&next),
            Continuation::Next("https://g/n?$skiptoken=s".into())
        );
        assert_eq!(
            page_continuation(&delta),
            Continuation::Delta("https://g/d?$deltatoken=d".into())
        );
        assert_eq!(
            page_continuation(&serde_json::json!({"value":[]})),
            Continuation::End
        );
    }

    #[tokio::test]
    async fn http_410_returns_delta_gone_sentinel() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(method("GET"))
            .and(path("/v1.0/me/mailFolders/inbox/messages/delta"))
            .respond_with(ResponseTemplate::new(410).set_body_string("Sync state not found"))
            .mount(&server)
            .await;
        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let url = format!("{}/v1.0/me/mailFolders/inbox/messages/delta", server.uri());
        let err = client.get_json(&url).await.expect_err("should fail on 410");
        assert!(
            err.downcast_ref::<DeltaGone>().is_some(),
            "expected DeltaGone sentinel, got: {err}"
        );
    }

    #[tokio::test]
    async fn send_message_posts_to_send_mail_endpoint() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1.0/me/sendMail"))
            .respond_with(ResponseTemplate::new(202).set_body_string(""))
            .mount(&server)
            .await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let result = client
            .send_message(
                &["alice@example.com".to_string()],
                &[],
                &[],
                "Test subject",
                "Hello",
                None,
                true,
                &[],
            )
            .await
            .expect("send_message should succeed on 202");
        assert_eq!(result, ""); // 202 returns no id
    }

    #[tokio::test]
    async fn send_message_splits_display_name_recipients_for_graph() {
        use wiremock::matchers::{body_partial_json, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1.0/me/sendMail"))
            .and(body_partial_json(serde_json::json!({
                "message": {
                    "toRecipients": [{
                        "emailAddress": {
                            "name": "Client Name",
                            "address": "client@example.com"
                        }
                    }],
                    "ccRecipients": [{
                        "emailAddress": {
                            "address": "cc@example.com"
                        }
                    }]
                }
            })))
            .respond_with(ResponseTemplate::new(202).set_body_string(""))
            .expect(1)
            .mount(&server)
            .await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        client
            .send_message(
                &["Client Name <client@example.com>".to_string()],
                &["cc@example.com".to_string()],
                &[],
                "Test subject",
                "Hello",
                None,
                true,
                &[],
            )
            .await
            .expect("Graph should accept split recipient objects");
    }

    #[tokio::test]
    async fn create_draft_posts_to_messages_and_returns_id() {
        use wiremock::matchers::{body_partial_json, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // POST /me/messages creates a DRAFT (201 + the created message JSON).
        // It must NOT hit /me/sendMail — a draft never sends.
        Mock::given(method("POST"))
            .and(path("/v1.0/me/messages"))
            .and(body_partial_json(serde_json::json!({
                "subject": "Follow-up: Q2 review",
                "body": { "contentType": "HTML" }
            })))
            .respond_with(
                ResponseTemplate::new(201)
                    .set_body_json(serde_json::json!({ "id": "draft-abc-123" })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let id = client
            .create_draft(
                &["alice@example.com".to_string()],
                "Follow-up: Q2 review",
                "<p>Hello Alice,</p>",
            )
            .await
            .expect("create_draft should succeed");
        assert_eq!(id, "draft-abc-123");
    }

    #[tokio::test]
    async fn create_draft_missing_id_is_an_error() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        Mock::given(method("POST"))
            .and(path("/v1.0/me/messages"))
            .respond_with(ResponseTemplate::new(201).set_body_json(serde_json::json!({})))
            .mount(&server)
            .await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let err = client
            .create_draft(&["a@b.com".to_string()], "s", "<p>b</p>")
            .await
            .expect_err("missing id must be an error, never a silent empty string");
        assert!(err.to_string().contains("missing `id`"), "got: {err}");
    }

    #[tokio::test]
    async fn create_reply_draft_uses_create_reply_then_patches() {
        use wiremock::matchers::{body_partial_json, method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        // 1. createReply returns the new reply-draft message.
        Mock::given(method("POST"))
            .and(path("/v1.0/me/messages/orig-42/createReply"))
            .respond_with(
                ResponseTemplate::new(201)
                    .set_body_json(serde_json::json!({ "id": "reply-draft-7" })),
            )
            .expect(1)
            .mount(&server)
            .await;
        // 2. PATCH fills in our subject/body/recipients on that draft.
        Mock::given(method("PATCH"))
            .and(path("/v1.0/me/messages/reply-draft-7"))
            .and(body_partial_json(serde_json::json!({
                "body": { "contentType": "HTML", "content": "<p>Following up.</p>" }
            })))
            .respond_with(
                ResponseTemplate::new(200)
                    .set_body_json(serde_json::json!({ "id": "reply-draft-7" })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let id = client
            .create_reply_draft(
                "orig-42",
                &["alice@example.com".to_string()],
                "RE: Q2 review",
                "<p>Following up.</p>",
            )
            .await
            .expect("create_reply_draft should succeed");
        assert_eq!(id, "reply-draft-7");
    }

    #[tokio::test]
    async fn create_reply_draft_encodes_message_ids_with_path_sensitive_characters() {
        // Real Graph AAMkAD... ids and their base64-derived variants can contain
        // '/', '+', '=' — codex-review catch: interpolating them unencoded into
        // the URL path breaks the request (or worse, splits the path). Mirror the
        // existing enc_path_segment convention used by get_attachment_raw.
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let raw_id = "AAMk/ADAwATY3+ZjBl=";
        let encoded_id = "AAMk%2FADAwATY3%2BZjBl%3D";
        let raw_draft_id = "reply/draft+7=";
        let encoded_draft_id = "reply%2Fdraft%2B7%3D";

        Mock::given(method("POST"))
            .and(path(format!("/v1.0/me/messages/{encoded_id}/createReply")))
            .respond_with(
                ResponseTemplate::new(201).set_body_json(serde_json::json!({ "id": raw_draft_id })),
            )
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("PATCH"))
            .and(path(format!("/v1.0/me/messages/{encoded_draft_id}")))
            .respond_with(
                ResponseTemplate::new(200).set_body_json(serde_json::json!({ "id": raw_draft_id })),
            )
            .expect(1)
            .mount(&server)
            .await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let id = client
            .create_reply_draft(
                raw_id,
                &["alice@example.com".to_string()],
                "RE: Q2 review",
                "<p>Following up.</p>",
            )
            .await
            .expect("create_reply_draft should succeed with a path-sensitive id");
        assert_eq!(id, raw_draft_id);
    }

    #[tokio::test]
    async fn existing_draft_fetches_and_sends_the_exact_escaped_draft_id() {
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let draft_id = "draft/with+reserved=";
        let encoded_id = "draft%2Fwith%2Breserved%3D";
        Mock::given(method("GET"))
            .and(path(format!("/v1.0/me/messages/{encoded_id}")))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "id": draft_id,
                "isDraft": true,
                "toRecipients": [{ "emailAddress": { "address": "client@example.com" } }],
                "ccRecipients": [],
                "bccRecipients": [],
                "subject": "approved subject",
                "body": { "content": "approved body" }
            })))
            .expect(1)
            .mount(&server)
            .await;
        Mock::given(method("POST"))
            .and(path(format!("/v1.0/me/messages/{encoded_id}/send")))
            .respond_with(ResponseTemplate::new(202))
            .expect(1)
            .mount(&server)
            .await;

        let client = GraphClient::new_with_base("AT".into(), server.uri());
        let draft = client
            .get_existing_draft(draft_id)
            .await
            .expect("draft fetch");
        assert_eq!(draft.id, draft_id);
        assert!(draft.is_draft);
        assert_eq!(draft.to, vec!["client@example.com"]);
        client
            .send_existing_draft(draft_id)
            .await
            .expect("accepted send");
    }

    #[tokio::test]
    async fn existing_draft_transport_loss_is_unknown_and_never_retried() {
        let client = GraphClient::new_with_base("AT".into(), "http://127.0.0.1:9".into());
        assert_eq!(
            client.send_existing_draft("draft-1").await,
            Err(GraphExistingDraftSendError::OutcomeUnknown)
        );
    }

    #[tokio::test]
    async fn graph_provider_fetch_changes_backfill_returns_message_and_delta_done() {
        use crate::commands::mail::provider::{Cursor, RemoteFolder};
        use wiremock::matchers::{method, path};
        use wiremock::{Mock, MockServer, ResponseTemplate};

        let server = MockServer::start().await;
        let delta_link = format!(
            "{}/v1.0/me/mailFolders/inbox/messages/delta?$deltatoken=tok123",
            server.uri()
        );
        Mock::given(method("GET")).and(path("/v1.0/me/mailFolders/inbox/messages/delta"))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({
                "value": [{ "id": "msg1", "subject": "Hello from Graph", "body": { "contentType": "text", "content": "Body text here." } }],
                "@odata.deltaLink": delta_link
            }))).mount(&server).await;

        let provider = GraphProvider::new_with_base("AT".into(), server.uri());
        let folder = RemoteFolder {
            id: "inbox".into(),
            display_name: "Inbox".into(),
        };
        let page = provider
            .fetch_changes(&folder, &Cursor::Backfill)
            .await
            .expect("fetch_changes");

        assert_eq!(page.messages.len(), 1, "expected exactly one message");
        assert_eq!(page.messages[0].id, "msg1");
        assert!(
            page.done,
            "Cursor::Backfill with deltaLink must be done=true"
        );
        assert_eq!(page.next, Some(delta_link), "next must equal the deltaLink");
        assert!(page.removed_ids.is_empty(), "no tombstones expected");
    }

    #[test]
    fn token_target_accepts_canonical_graph_host_over_https() {
        // Production base; canonical Graph host + continuation links are allowed.
        let client = GraphClient::new("AT".into());
        assert!(client
            .validate_token_target("https://graph.microsoft.com/v1.0/me/drive/root/delta")
            .is_ok());
        assert!(client
            .validate_token_target(
                "https://graph.microsoft.com/v1.0/me/messages?$deltatoken=opaque"
            )
            .is_ok());
    }

    #[test]
    fn token_target_rejects_non_graph_and_unsafe_urls() {
        let client = GraphClient::new("AT".into());
        // Wrong host entirely (planted continuation URL).
        assert!(client
            .validate_token_target("https://evil.example.com/v1.0/me/messages")
            .is_err());
        // Right host but plaintext http (downgrade / MitM).
        assert!(client
            .validate_token_target("http://graph.microsoft.com/v1.0/me/messages")
            .is_err());
        // Embedded userinfo trying to look like Graph.
        assert!(client
            .validate_token_target("https://attacker@graph.microsoft.com/v1.0/me/messages")
            .is_err());
        // Lookalike host that merely contains the Graph host as a substring.
        assert!(client
            .validate_token_target("https://graph.microsoft.com.evil.example/v1.0/me")
            .is_err());
        // Canonical Graph host on a non-default port (planted continuation URL).
        assert!(client
            .validate_token_target("https://graph.microsoft.com:444/v1.0/me/messages")
            .is_err());
        // Explicit default port 443 is fine.
        assert!(client
            .validate_token_target("https://graph.microsoft.com:443/v1.0/me/messages")
            .is_ok());
        // Unparseable.
        assert!(client.validate_token_target("not a url").is_err());
    }

    #[test]
    fn token_target_accepts_configured_test_base_origin() {
        // A mock/test base (plain http on localhost) is honored so the connector
        // still works against a configured non-default origin, but only that
        // exact origin — not arbitrary http hosts.
        let client = GraphClient::new_with_base("AT".into(), "http://127.0.0.1:8451".into());
        assert!(client
            .validate_token_target("http://127.0.0.1:8451/v1.0/me/drive/root/delta")
            .is_ok());
        // Same host, different port → rejected.
        assert!(client
            .validate_token_target("http://127.0.0.1:9999/v1.0/me")
            .is_err());
        // Different http host → rejected.
        assert!(client
            .validate_token_target("http://192.168.0.1:8451/v1.0/me")
            .is_err());
    }

    #[test]
    fn redact_url_drops_query_and_keeps_host_path() {
        assert_eq!(
            redact_url("https://graph.microsoft.com/v1.0/me/messages/delta?$deltatoken=SECRET"),
            "graph.microsoft.com/v1.0/me/messages/delta"
        );
        // No query → unchanged host+path.
        assert_eq!(
            redact_url("https://graph.microsoft.com/v1.0/me/drive"),
            "graph.microsoft.com/v1.0/me/drive"
        );
        assert_eq!(redact_url("::::nonsense"), "<unparseable-url>");
    }

    #[test]
    fn summarize_error_body_emits_code_and_length_never_message() {
        let body = r#"{"error":{"code":"InvalidAuthenticationToken","message":"user@example.com token expired at mailbox X"}}"#;
        let summary = summarize_error_body(body);
        assert!(
            summary.contains("code=InvalidAuthenticationToken"),
            "{summary}"
        );
        assert!(
            summary.contains(&format!("bytes={}", body.len())),
            "{summary}"
        );
        // The PII-bearing message must never appear in the summary.
        assert!(!summary.contains("user@example.com"), "{summary}");
        assert!(!summary.contains("mailbox"), "{summary}");
        // Non-JSON / unexpected shape → length only, no panic.
        assert_eq!(summarize_error_body("plain text"), "bytes=10");
    }
}
