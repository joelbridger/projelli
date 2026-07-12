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

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MailAuthVerdict {
    Pass,
    Fail,
    None,
}

impl Default for MailAuthVerdict {
    fn default() -> Self {
        Self::None
    }
}

#[derive(Debug, Clone, Copy, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "lowercase")]
pub enum MailAuthSource {
    Graph,
    Gmail,
    Imap,
    Missing,
}

impl Default for MailAuthSource {
    fn default() -> Self {
        Self::Missing
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAuthResult {
    pub dkim: MailAuthVerdict,
    pub spf: MailAuthVerdict,
    pub dmarc: MailAuthVerdict,
    pub aligned: bool,
    pub source: MailAuthSource,
}

impl Default for MailAuthResult {
    fn default() -> Self {
        Self::missing()
    }
}

impl MailAuthResult {
    pub fn missing() -> Self {
        Self {
            dkim: MailAuthVerdict::None,
            spf: MailAuthVerdict::None,
            dmarc: MailAuthVerdict::None,
            aligned: false,
            source: MailAuthSource::Missing,
        }
    }

    pub fn from_headers<'a>(
        source: MailAuthSource,
        headers: impl IntoIterator<Item = (&'a str, &'a str)>,
    ) -> Self {
        let mut result = Self::missing();
        let mut saw_auth_header = false;

        for (name, value) in headers {
            if name.eq_ignore_ascii_case("Authentication-Results")
                || name.eq_ignore_ascii_case("ARC-Authentication-Results")
            {
                saw_auth_header = true;
                merge_auth_header(&mut result, value);
            } else if name.eq_ignore_ascii_case("Received-SPF") {
                saw_auth_header = true;
                result.spf = merge_verdict(result.spf, parse_received_spf(value));
            }
        }

        if saw_auth_header
            && (result.dkim != MailAuthVerdict::None
                || result.spf != MailAuthVerdict::None
                || result.dmarc != MailAuthVerdict::None)
        {
            result.source = source;
            result.aligned = result.dmarc == MailAuthVerdict::Pass
                && (result.dkim == MailAuthVerdict::Pass || result.spf == MailAuthVerdict::Pass);
        }

        result
    }
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "snake_case")]
pub enum MailAttachmentKind {
    File,
    Inline,
    Unsupported,
}

#[derive(Debug, Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct MailAttachmentRef {
    pub id: String,
    pub name: String,
    pub filename: String,
    pub content_type: Option<String>,
    pub byte_size: Option<u64>,
    pub kind: MailAttachmentKind,
}

impl MailAttachmentRef {
    pub fn new(
        id: impl Into<String>,
        filename: impl Into<String>,
        content_type: Option<String>,
        byte_size: Option<u64>,
        kind: MailAttachmentKind,
    ) -> Self {
        let filename = filename.into();
        Self {
            id: id.into(),
            name: filename.clone(),
            filename,
            content_type,
            byte_size,
            kind,
        }
    }
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
    pub attachments_unsupported: bool,
    pub auth_result: MailAuthResult,
    pub attachments: Vec<MailAttachmentRef>,
    pub body_content_type: BodyContentType,
    pub body_text: String,
}

fn parse_auth_verdict(token: &str) -> MailAuthVerdict {
    match token.trim().to_ascii_lowercase().as_str() {
        "pass" => MailAuthVerdict::Pass,
        "fail" | "softfail" | "permerror" | "temperror" | "neutral" | "policy" => {
            MailAuthVerdict::Fail
        }
        _ => MailAuthVerdict::None,
    }
}

fn merge_verdict(current: MailAuthVerdict, incoming: MailAuthVerdict) -> MailAuthVerdict {
    match (current, incoming) {
        (MailAuthVerdict::Fail, _) | (_, MailAuthVerdict::Fail) => MailAuthVerdict::Fail,
        (MailAuthVerdict::Pass, _) | (_, MailAuthVerdict::Pass) => MailAuthVerdict::Pass,
        _ => MailAuthVerdict::None,
    }
}

fn parse_auth_method(value: &str, method: &str) -> MailAuthVerdict {
    let needle = format!("{method}=");
    for token in value.split(|c: char| c == ';' || c.is_ascii_whitespace()) {
        let token = token.trim();
        if let Some((name, verdict)) = token.split_once('=') {
            if format!("{name}=").eq_ignore_ascii_case(&needle) {
                return parse_auth_verdict(verdict);
            }
        }
    }
    MailAuthVerdict::None
}

fn merge_auth_header(result: &mut MailAuthResult, value: &str) {
    result.dkim = merge_verdict(result.dkim, parse_auth_method(value, "dkim"));
    result.spf = merge_verdict(result.spf, parse_auth_method(value, "spf"));
    result.dmarc = merge_verdict(result.dmarc, parse_auth_method(value, "dmarc"));
}

fn parse_received_spf(value: &str) -> MailAuthVerdict {
    value
        .split_whitespace()
        .next()
        .map(parse_auth_verdict)
        .unwrap_or(MailAuthVerdict::None)
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

fn graph_header_pairs(v: &serde_json::Value) -> Vec<(String, String)> {
    v.get("internetMessageHeaders")
        .or_else(|| v.get("headers"))
        .and_then(|h| h.as_array())
        .map(|headers| {
            headers
                .iter()
                .filter_map(|h| {
                    let name = h.get("name")?.as_str()?.to_string();
                    let value = h.get("value")?.as_str()?.to_string();
                    Some((name, value))
                })
                .collect()
        })
        .unwrap_or_default()
}

pub(crate) fn graph_attachment_refs_from_value(v: &serde_json::Value) -> Vec<MailAttachmentRef> {
    let attachments = v
        .get("attachments")
        .or_else(|| v.get("value"))
        .and_then(|a| a.as_array())
        .map(|arr| arr.as_slice())
        .unwrap_or(&[]);

    attachments
        .iter()
        .filter_map(|att| {
            let id = att.get("id")?.as_str()?.to_string();
            let filename = att
                .get("name")
                .and_then(|n| n.as_str())
                .filter(|s| !s.trim().is_empty())
                .unwrap_or("attachment")
                .to_string();
            let content_type = att
                .get("contentType")
                .and_then(|c| c.as_str())
                .filter(|s| !s.trim().is_empty())
                .map(String::from);
            let byte_size = att.get("size").and_then(|s| s.as_u64());
            let kind = if att
                .get("isInline")
                .and_then(|b| b.as_bool())
                .unwrap_or(false)
            {
                MailAttachmentKind::Inline
            } else {
                MailAttachmentKind::File
            };
            Some(MailAttachmentRef::new(
                id,
                filename,
                content_type,
                byte_size,
                kind,
            ))
        })
        .collect()
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
        let headers = graph_header_pairs(v);
        let attachments = graph_attachment_refs_from_value(v);
        let has_attachments = v
            .get("hasAttachments")
            .and_then(|b| b.as_bool())
            .unwrap_or(false)
            || !attachments.is_empty();
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
            has_attachments,
            attachments_unsupported: false,
            auth_result: MailAuthResult::from_headers(
                MailAuthSource::Graph,
                headers
                    .iter()
                    .map(|(name, value)| (name.as_str(), value.as_str())),
            ),
            attachments,
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
            "internetMessageHeaders": [
                { "name": "Authentication-Results", "value": "mx.example; dkim=pass header.d=hender.com; spf=pass smtp.mailfrom=hender.com; dmarc=pass header.from=hender.com" }
            ],
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
        assert_eq!(m.auth_result.dmarc, MailAuthVerdict::Pass);
        assert!(m.auth_result.aligned);
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

    #[test]
    fn graph_auth_missing_never_defaults_to_pass() {
        let mut j = sample_graph_json();
        j.as_object_mut().unwrap().remove("internetMessageHeaders");
        let m = MailMessage::from_graph(&j).expect("parse");
        assert_eq!(m.auth_result.dkim, MailAuthVerdict::None);
        assert_eq!(m.auth_result.spf, MailAuthVerdict::None);
        assert_eq!(m.auth_result.dmarc, MailAuthVerdict::None);
        assert_eq!(m.auth_result.source, MailAuthSource::Missing);
        assert!(!m.auth_result.aligned);
    }

    #[test]
    fn graph_auth_fail_dominates_pass() {
        let mut j = sample_graph_json();
        j["internetMessageHeaders"] = serde_json::json!([
            { "name": "Authentication-Results", "value": "mx.example; dkim=pass; spf=pass; dmarc=fail header.from=hender.com" }
        ]);
        let m = MailMessage::from_graph(&j).expect("parse");
        assert_eq!(m.auth_result.dkim, MailAuthVerdict::Pass);
        assert_eq!(m.auth_result.spf, MailAuthVerdict::Pass);
        assert_eq!(m.auth_result.dmarc, MailAuthVerdict::Fail);
        assert!(!m.auth_result.aligned);
    }

    #[test]
    fn graph_attachment_manifest_is_stable() {
        let mut j = sample_graph_json();
        j["hasAttachments"] = serde_json::json!(true);
        j["attachments"] = serde_json::json!([
            { "id": "a1", "name": "license.pdf", "contentType": "application/pdf", "size": 1200, "isInline": false },
            { "id": "a2", "name": "inline.png", "contentType": "image/png", "size": 512, "isInline": true }
        ]);
        let m = MailMessage::from_graph(&j).expect("parse");
        assert_eq!(m.attachments.len(), 2);
        assert_eq!(m.attachments[0].id, "a1");
        assert_eq!(m.attachments[0].filename, "license.pdf");
        assert_eq!(m.attachments[0].byte_size, Some(1200));
        assert_eq!(m.attachments[1].kind, MailAttachmentKind::Inline);
    }
}
