//! CRM write path — approval-gated note/task creation.
//!
//! Same PII discipline as `client.rs`: response bodies and user content are
//! never logged; errors carry status codes and endpoint paths only.

use sha2::{Digest, Sha256};

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum CrmWriteKind {
    Note,
    Task,
}

impl CrmWriteKind {
    pub fn as_str(self) -> &'static str {
        match self {
            Self::Note => "note",
            Self::Task => "task",
        }
    }
}

/// One proposed write. `household_key` is the provider-side contact/household
/// id (Wealthbox: numeric string; other providers use their prefixed crm_key).
/// `source_ref` is provenance for the audit log (document path or transcript
/// timestamp) — it is never sent to the CRM.
#[derive(Debug, Clone)]
pub struct CrmWriteRequest {
    pub kind: CrmWriteKind,
    pub matter_id: String,
    pub household_key: String,
    pub title: String,
    pub body: String,
    pub due_date: Option<String>,
    pub source_ref: String,
}

/// Receipt for a completed (or deduplicated) write.
#[derive(Debug, Clone, serde::Serialize)]
#[serde(rename_all = "camelCase")]
pub struct WriteReceipt {
    /// Provider-side id of the created record.
    pub remote_id: String,
    /// True when the ledger suppressed a duplicate instead of re-posting.
    pub deduped: bool,
}

#[derive(Debug, thiserror::Error)]
pub enum CrmWriteError {
    #[error("{0} is not connected")]
    NotConnected(&'static str),
    #[error("this client is not linked to a CRM household")]
    NoHouseholdLink,
    #[error("this client is linked to more than one CRM household — pick one in the review card")]
    AmbiguousHousehold,
    #[error("CRM write failed (HTTP {0})")]
    Http(u16),
    #[error("CRM write throttled past retry budget")]
    Throttled,
    #[error("a previous identical write may have been delivered — verification pending, retry shortly")]
    VerifyPending,
    #[error("writes are not yet supported for {0}")]
    NotSupported(&'static str),
    #[error("invalid write request: {0}")]
    InvalidInput(&'static str),
}

fn norm(s: &str) -> String {
    s.split_whitespace().collect::<Vec<_>>().join(" ")
}

/// Stable content-addressed key: identical (provider-visible) writes collide,
/// any change to target or content produces a fresh key.
pub fn dedup_key(req: &CrmWriteRequest) -> String {
    let mut h = Sha256::new();
    for part in [
        req.kind.as_str(),
        &req.household_key,
        &norm(&req.title),
        &norm(&req.body),
        req.due_date.as_deref().unwrap_or(""),
    ] {
        h.update(part.as_bytes());
        h.update([0u8]); // field separator so "a","bc" != "ab","c"
    }
    hex::encode(h.finalize())
}

/// Provider-agnostic CRM write surface. Wealthbox is the first implementation;
/// Redtail/Salesforce adopt the same trait once vendor creds land.
#[async_trait::async_trait]
pub trait CrmWriteSource: Send + Sync {
    fn provider_id(&self) -> &'static str;
    /// Creates a note, returning the provider-side remote id.
    async fn create_note(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError>;
    /// Creates a task, returning the provider-side remote id.
    async fn create_task(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError>;
    /// Look for an already-delivered identical write (recovery after an
    /// ambiguous transport failure). Returns the remote id if found.
    async fn find_recent_matching(
        &self,
        req: &CrmWriteRequest,
    ) -> Result<Option<String>, CrmWriteError>;
}

#[async_trait::async_trait]
impl CrmWriteSource for crate::commands::crm::client::WealthboxClient {
    fn provider_id(&self) -> &'static str {
        "wealthbox"
    }

    async fn create_note(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError> {
        let contact_id = wealthbox_contact_id(&req.household_key)?;
        // Wealthbox notes have no title field: title becomes the first line.
        // VERIFY-LIVE: linked_to "type" casing ("Contact").
        let body = serde_json::json!({
            "content": format!("{}\n\n{}", req.title.trim(), req.body.trim()),
            "linked_to": [{"id": contact_id, "type": "Contact"}],
        });
        let resp = self.post_json("/notes", &body).await.map_err(map_http_err)?;
        remote_id_from(&resp)
    }

    async fn create_task(&self, req: &CrmWriteRequest) -> Result<String, CrmWriteError> {
        let contact_id = wealthbox_contact_id(&req.household_key)?;
        // VERIFY-LIVE: due_date format (plain date vs "YYYY-MM-DD hh:mm AM -0400").
        let mut body = serde_json::json!({
            "name": req.title.trim(),
            "description": req.body.trim(),
            "linked_to": [{"id": contact_id, "type": "Contact"}],
        });
        if let Some(d) = &req.due_date {
            body["due_date"] = serde_json::Value::String(d.clone());
        }
        let resp = self.post_json("/tasks", &body).await.map_err(map_http_err)?;
        remote_id_from(&resp)
    }

    async fn find_recent_matching(
        &self,
        req: &CrmWriteRequest,
    ) -> Result<Option<String>, CrmWriteError> {
        // Recovery path: list recent objects and match on normalized content.
        // Full-list is acceptable at solo scale; the 1 rps gate bounds cost.
        match req.kind {
            CrmWriteKind::Note => {
                let notes = self.list_notes(None).await.map_err(map_http_err)?;
                let want = norm(&format!("{}\n\n{}", req.title.trim(), req.body.trim()));
                Ok(notes
                    .iter()
                    .find(|n| norm(&n.content) == want)
                    .map(|n| n.id.to_string()))
            }
            CrmWriteKind::Task => {
                let tasks = self.list_tasks(None).await.map_err(map_http_err)?;
                Ok(tasks
                    .iter()
                    .find(|t| {
                        norm(&t.name) == norm(req.title.trim())
                            && norm(&t.description) == norm(req.body.trim())
                    })
                    .map(|t| t.id.to_string()))
            }
        }
    }
}

fn wealthbox_contact_id(household_key: &str) -> Result<i64, CrmWriteError> {
    household_key
        .trim()
        .parse::<i64>()
        .map_err(|_| CrmWriteError::InvalidInput("household key is not a Wealthbox numeric id"))
}

fn map_http_err(e: anyhow::Error) -> CrmWriteError {
    let msg = e.to_string();
    if msg.contains("throttled past retry budget") {
        return CrmWriteError::Throttled;
    }
    if let Some(code) = msg
        .strip_prefix("Wealthbox request failed (HTTP ")
        .and_then(|s| s.strip_suffix(')'))
        .and_then(|s| s.parse::<u16>().ok())
    {
        return CrmWriteError::Http(code);
    }
    // Transport-level failure (send error / body read error): the request MAY
    // have been delivered. Callers must go through the pending_verify path.
    CrmWriteError::VerifyPending
}

fn remote_id_from(resp: &serde_json::Value) -> Result<String, CrmWriteError> {
    // VERIFY-LIVE: create responses echo the created object with top-level id.
    resp.get("id")
        .and_then(|v| v.as_i64().map(|n| n.to_string()).or_else(|| v.as_str().map(String::from)))
        .ok_or(CrmWriteError::InvalidInput("create response had no id"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn note_req() -> CrmWriteRequest {
        CrmWriteRequest {
            kind: CrmWriteKind::Note,
            matter_id: "matter-1".into(),
            household_key: "12345".into(),
            title: "Q3 review follow-up".into(),
            body: "Discussed 529 rollover.".into(),
            due_date: None,
            source_ref: "doc:Clients/Henderson/notes.docx".into(),
        }
    }

    fn task_req() -> CrmWriteRequest {
        CrmWriteRequest {
            kind: CrmWriteKind::Task,
            due_date: Some("2026-07-15".into()),
            ..note_req()
        }
    }

    #[tokio::test]
    async fn wealthbox_create_note_posts_exact_shape() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/notes"))
            .and(matchers::body_json(serde_json::json!({
                "content": "Q3 review follow-up\n\nDiscussed 529 rollover.",
                "linked_to": [{"id": 12345, "type": "Contact"}]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 555})))
            .expect(1)
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let id = client.create_note(&note_req()).await.unwrap();
        assert_eq!(id, "555");
    }

    #[tokio::test]
    async fn wealthbox_create_task_posts_exact_shape() {
        use wiremock::{matchers, Mock, MockServer, ResponseTemplate};
        let server = MockServer::start().await;
        Mock::given(matchers::method("POST"))
            .and(matchers::path("/tasks"))
            .and(matchers::body_json(serde_json::json!({
                "name": "Q3 review follow-up",
                "description": "Discussed 529 rollover.",
                "due_date": "2026-07-15",
                "linked_to": [{"id": 12345, "type": "Contact"}]
            })))
            .respond_with(ResponseTemplate::new(200).set_body_json(serde_json::json!({"id": 556})))
            .expect(1)
            .mount(&server)
            .await;
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), server.uri());
        let id = client.create_task(&task_req()).await.unwrap();
        assert_eq!(id, "556");
    }

    #[tokio::test]
    async fn non_numeric_household_key_is_rejected_for_wealthbox() {
        let client = crate::commands::crm::client::WealthboxClient::new_with_base("t".into(), "http://127.0.0.1:1".into());
        let mut req = note_req();
        req.household_key = "sfdc:001XYZ".into();
        let err = client.create_note(&req).await.unwrap_err();
        assert!(matches!(err, CrmWriteError::InvalidInput(_)));
    }

    #[test]
    fn dedup_key_is_stable_and_content_sensitive() {
        let a = dedup_key(&note_req());
        let b = dedup_key(&note_req());
        assert_eq!(a, b, "same request → same key");
        let mut changed = note_req();
        changed.body = "Discussed 529 rollover!".into();
        assert_ne!(a, dedup_key(&changed), "body change → new key");
        let mut other_house = note_req();
        other_house.household_key = "99".into();
        assert_ne!(a, dedup_key(&other_house), "target change → new key");
    }

    #[test]
    fn dedup_key_normalizes_whitespace_only() {
        let mut ws = note_req();
        ws.title = "  Q3 review follow-up \n".into();
        assert_eq!(dedup_key(&note_req()), dedup_key(&ws));
    }

    #[test]
    fn write_error_display_never_embeds_body() {
        let e = CrmWriteError::Http(500);
        assert_eq!(e.to_string(), "CRM write failed (HTTP 500)");
    }
}
