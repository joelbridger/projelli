//! Text renderers for DocuSign records.
//!
//! These functions are pure. They turn normalized envelopes, signing events,
//! and document metadata into readable text that the shared external RAG
//! bridge indexes as encrypted `source_type = "esign"` chunks.

use crate::commands::docusign::model::{
    DocusignAuditEvent, DocusignDocument, DocusignEnvelope,
};
use sha2::{Digest, Sha256};

fn append_line(buf: &mut String, label: &str, value: &str) {
    let value = value.trim();
    if value.is_empty() {
        return;
    }
    buf.push_str(label);
    buf.push_str(": ");
    buf.push_str(value);
    buf.push('\n');
}

pub fn envelope_source_id(account_id: &str, envelope_id: &str) -> String {
    format!("docusign:{account_id}:{envelope_id}")
}

pub fn event_source_id(account_id: &str, envelope_id: &str, event: &DocusignAuditEvent) -> String {
    let id = if event.event_id.trim().is_empty() {
        let seed = format!(
            "{}|{}|{}|{}",
            event.event_type, event.timestamp, event.email, event.message
        );
        hex::encode(Sha256::digest(seed.as_bytes()))
    } else {
        event.event_id.clone()
    };
    format!("docusign:{account_id}:{envelope_id}:event:{id}")
}

pub fn document_source_id(account_id: &str, envelope_id: &str, document_id: &str) -> String {
    format!("docusign:{account_id}:{envelope_id}:doc:{document_id}")
}

pub fn render_envelope(account_id: &str, envelope: &DocusignEnvelope) -> (String, String) {
    let source_id = envelope_source_id(account_id, &envelope.envelope_id);
    let mut text = String::new();
    text.push_str("DocuSign agreement\n");
    append_line(&mut text, "Subject", &envelope.email_subject);
    append_line(&mut text, "Status", &envelope.status);
    append_line(&mut text, "Created", &envelope.created_date_time);
    append_line(&mut text, "Sent", &envelope.sent_date_time);
    append_line(&mut text, "Completed", &envelope.completed_date_time);
    append_line(&mut text, "Folder", &envelope.folder_name);

    if let Some(sender) = &envelope.sender {
        let sender_line = match (sender.user_name.trim(), sender.email.trim()) {
            ("", "") => String::new(),
            ("", email) => email.to_string(),
            (name, "") => name.to_string(),
            (name, email) => format!("{name} <{email}>"),
        };
        append_line(&mut text, "Sender", &sender_line);
    }

    if let Some(recipients) = &envelope.recipients {
        for recipient in recipients.all() {
            let label = if recipient.role_name.trim().is_empty() {
                "Recipient"
            } else {
                "Recipient role"
            };
            let mut line = String::new();
            if !recipient.role_name.trim().is_empty() {
                line.push_str(recipient.role_name.trim());
                line.push_str(": ");
            }
            if !recipient.name.trim().is_empty() {
                line.push_str(recipient.name.trim());
            }
            if !recipient.email.trim().is_empty() {
                if !line.is_empty() {
                    line.push(' ');
                }
                line.push('<');
                line.push_str(recipient.email.trim());
                line.push('>');
            }
            if !recipient.status.trim().is_empty() {
                line.push_str(" - ");
                line.push_str(recipient.status.trim());
            }
            append_line(&mut text, label, &line);
        }
    }

    for document in &envelope.documents {
        let label = if document.document_id.trim().is_empty() {
            "Document".to_string()
        } else {
            format!("Document {}", document.document_id.trim())
        };
        append_line(&mut text, &label, &document.name);
    }

    if let Some(custom_fields) = &envelope.custom_fields {
        for field in custom_fields.all() {
            let value = format!("{} = {}", field.name.trim(), field.value.trim());
            append_line(&mut text, "Custom field", &value);
        }
    }

    (source_id, text)
}

pub fn render_event(
    account_id: &str,
    envelope_id: &str,
    event: &DocusignAuditEvent,
) -> (String, String) {
    let source_id = event_source_id(account_id, envelope_id, event);
    let mut text = String::new();
    text.push_str("DocuSign signing event\n");
    append_line(&mut text, "Event", &event.event_type);
    append_line(&mut text, "Timestamp", &event.timestamp);
    append_line(&mut text, "User", &event.user_name);
    append_line(&mut text, "Email", &event.email);
    append_line(&mut text, "IP address", &event.ip_address);
    append_line(&mut text, "Authentication", &event.authentication_method);
    append_line(&mut text, "Message", &event.message);
    (source_id, text)
}

pub fn render_document_metadata(
    account_id: &str,
    envelope_id: &str,
    document: &DocusignDocument,
) -> (String, String) {
    let source_id = document_source_id(account_id, envelope_id, &document.document_id);
    let mut text = String::new();
    text.push_str("DocuSign signed document metadata\n");
    append_line(&mut text, "Document id", &document.document_id);
    append_line(&mut text, "Name", &document.name);
    append_line(&mut text, "Type", &document.r#type);
    text.push_str("PDF body text: not extracted in this build; envelope, recipient, document, and audit metadata were indexed.\n");
    (source_id, text)
}
