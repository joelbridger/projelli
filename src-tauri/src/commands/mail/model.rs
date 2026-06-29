// Mail model — pure Rust data model for a Microsoft Graph email message.
//
// Task 1 of the M365 email-import feature. No network, no database, no Tauri
// dependencies — only serde_json parsing and unit-testable logic.

use serde::{Deserialize, Serialize};

#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
pub enum BodyContentType {
    Text,
    Html,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Recipient {
    pub name: Option<String>,
    pub address: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailMessage {
    pub id: String,
    pub conversation_id: Option<String>,
    pub internet_message_id: Option<String>,
    pub subject: String,
    pub received_date_time: Option<String>,
    pub from_name: Option<String>,
    pub from_address: Option<String>,
    pub to: Vec<Recipient>,
    pub cc: Vec<Recipient>,
    pub folders: Vec<String>,
    pub thread_id: Option<String>,
    pub provider: String,
    pub account: String,
    pub has_attachments: bool,
    pub body_content_type: BodyContentType,
    pub body_text: String,
}

fn recipients(v: &serde_json::Value, key: &str) -> Vec<Recipient> {
    v.get(key)
        .and_then(|x| x.as_array())
        .map(|arr| {
            arr.iter()
                .map(|r| {
                    let ea = r.get("emailAddress");
                    Recipient {
                        name: ea
                            .and_then(|e| e.get("name"))
                            .and_then(|s| s.as_str())
                            .map(String::from),
                        address: ea
                            .and_then(|e| e.get("address"))
                            .and_then(|s| s.as_str())
                            .map(String::from),
                    }
                })
                .collect()
        })
        .unwrap_or_default()
}

impl MailMessage {
    /// Returns true when the Graph delta response marks this item as deleted.
    pub fn is_removed(v: &serde_json::Value) -> bool {
        v.get("@removed").is_some()
    }

    /// Parse a single Graph `/messages` item JSON object into a `MailMessage`.
    /// Returns `None` only if the mandatory `id` field is absent or not a string.
    pub fn from_graph(v: &serde_json::Value) -> Option<MailMessage> {
        let id = v.get("id")?.as_str()?.to_string();
        let from = v.get("from").and_then(|f| f.get("emailAddress"));
        let ct = match v
            .get("body")
            .and_then(|b| b.get("contentType"))
            .and_then(|s| s.as_str())
        {
            Some("html") => BodyContentType::Html,
            _ => BodyContentType::Text,
        };
        let conversation_id = v
            .get("conversationId")
            .and_then(|s| s.as_str())
            .map(String::from);
        Some(MailMessage {
            id,
            thread_id: conversation_id.clone(),
            conversation_id,
            internet_message_id: v
                .get("internetMessageId")
                .and_then(|s| s.as_str())
                .map(String::from),
            subject: v
                .get("subject")
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
            received_date_time: v
                .get("receivedDateTime")
                .and_then(|s| s.as_str())
                .map(String::from),
            from_name: from
                .and_then(|e| e.get("name"))
                .and_then(|s| s.as_str())
                .map(String::from),
            from_address: from
                .and_then(|e| e.get("address"))
                .and_then(|s| s.as_str())
                .map(String::from),
            to: recipients(v, "toRecipients"),
            cc: recipients(v, "ccRecipients"),
            folders: vec![],
            provider: "m365".to_string(),
            account: String::new(),
            has_attachments: v
                .get("hasAttachments")
                .and_then(|b| b.as_bool())
                .unwrap_or(false),
            body_content_type: ct,
            body_text: v
                .get("body")
                .and_then(|b| b.get("content"))
                .and_then(|s| s.as_str())
                .unwrap_or("")
                .to_string(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn sample_graph_json() -> serde_json::Value {
        serde_json::json!({
            "id": "AAMk-123",
            "conversationId": "conv-9",
            "subject": "Closing date",
            "receivedDateTime": "2026-05-01T14:30:00Z",
            "from": { "emailAddress": { "name": "Pat H", "address": "pat@hender.com" } },
            "toRecipients": [{ "emailAddress": { "name": "Me", "address": "me@firm.com" } }],
            "ccRecipients": [],
            "internetMessageId": "<abc@hender.com>",
            "hasAttachments": false,
            "body": { "contentType": "text", "content": "Confirming May 14." }
        })
    }

    #[test]
    fn parses_core_fields() {
        let m = MailMessage::from_graph(&sample_graph_json()).expect("parse");
        assert_eq!(m.id, "AAMk-123");
        assert_eq!(m.conversation_id.as_deref(), Some("conv-9"));
        assert_eq!(m.subject, "Closing date");
        assert_eq!(m.from_address.as_deref(), Some("pat@hender.com"));
        assert_eq!(m.to.len(), 1);
        assert_eq!(m.internet_message_id.as_deref(), Some("<abc@hender.com>"));
        assert_eq!(m.body_text, "Confirming May 14.");
        assert!(!m.has_attachments);
    }

    #[test]
    fn detects_removed_tombstone() {
        let j = serde_json::json!({ "id": "X", "@removed": { "reason": "deleted" } });
        assert!(MailMessage::is_removed(&j));
        assert!(!MailMessage::is_removed(&sample_graph_json()));
    }

    #[test]
    fn html_body_is_flagged_for_later_stripping() {
        let mut j = sample_graph_json();
        j["body"]["contentType"] = serde_json::json!("html");
        j["body"]["content"] = serde_json::json!("<p>Hi <b>there</b></p>");
        let m = MailMessage::from_graph(&j).unwrap();
        assert_eq!(m.body_content_type, BodyContentType::Html);
        assert_eq!(m.body_text, "<p>Hi <b>there</b></p>"); // raw kept; stripping is a later task
    }

    #[test]
    fn from_graph_sets_provenance_fields() {
        let m = MailMessage::from_graph(&sample_graph_json()).expect("parse");
        assert_eq!(m.provider, "m365");
        assert_eq!(m.thread_id.as_deref(), Some("conv-9")); // from conversationId
        assert!(m.folders.is_empty()); // folder is assigned by the sync layer
        assert_eq!(m.account, ""); // account is assigned by the sync layer
    }
}
