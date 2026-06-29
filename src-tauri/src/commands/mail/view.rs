// Read-only mail message view (Keepance 3.0 email viewer).
//
// A stored email lives on disk as an AES-256-GCM blob whose plaintext is the
// normalized Markdown produced by `normalize::to_markdown` — a YAML
// frontmatter block followed by the body. The viewer needs the message broken
// back out into structured fields (from / to / cc / subject / date / body +
// attachment names), so this module parses that Markdown into a `MailView`.
//
// Pure + dependency-free (no Tauri, no DB, no keychain) so it is unit-testable.
// `mail_get_message` (in mod.rs) does the decrypt + DB lookup and then calls
// `MailView::from_markdown` here.

use serde::Serialize;

/// One attachment, surfaced as a name only (opening attachments is a follow-up;
/// v1 mail is read-only and lists attachment names, not their bytes).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct AttachmentRef {
    /// Stable provider-specific attachment id. Used by `mail_get_attachment`
    /// to fetch the bytes on demand without re-parsing the MIME tree.
    /// Graph attachments: the `@odata.id` / attachment `id` field.
    /// Gmail attachments: the `attachmentId` from the MIME part body.
    /// IMAP attachments: the part number string (e.g. "2", "1.2").
    pub id: String,
    pub name: String,
}

/// A decrypted, structured email message ready for the read-only viewer.
/// Every field is plain text; `body` is the stripped-to-text body (HTML emails
/// were converted to text at sync time by `normalize::html_to_text`).
#[derive(Debug, Clone, Serialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct MailView {
    /// The provider message id (the part after `mail:` in a citation source).
    pub id: String,
    pub subject: String,
    /// Raw frontmatter `from` value, e.g. `Pat H <pat@hender.com>`.
    pub from: String,
    /// Recipients, split on the comma the writer joined them with.
    pub to: Vec<String>,
    pub cc: Vec<String>,
    /// ISO-8601 received timestamp when present.
    pub date: Option<String>,
    pub provider: Option<String>,
    /// Plain-text body (everything after the frontmatter + leading `# subject`).
    pub body: String,
    pub has_attachments: bool,
    /// Attachment names. Empty in v1 (the sync layer does not yet persist
    /// per-attachment metadata); kept so the viewer can render a list when it
    /// does, and so `has_attachments` has a place to grow into.
    pub attachments: Vec<AttachmentRef>,
    /// BUG-013: the matter this message is currently filed under, looked up from
    /// the RAG store by `mail_get_message`. `None` when the message isn't filed
    /// to any matter yet (or isn't indexed). Parsed views default to `None`;
    /// the command sets it after the matter lookup.
    pub matter_id: Option<String>,
}

/// Reverse `normalize::yaml_escape` for a double-quoted scalar value. Mirrors
/// `mod.rs::yaml_unescape` but is colocated with the parser that needs it.
/// `\n`/`\r` → space, `\"` → quote, `\\` → backslash. Char-based so an escaped
/// backslash followed by `n` is not mistaken for an escaped newline.
fn yaml_unescape(s: &str) -> String {
    let mut out = String::with_capacity(s.len());
    let mut chars = s.chars();
    while let Some(c) = chars.next() {
        if c == '\\' {
            match chars.next() {
                Some('n') | Some('r') => out.push(' '),
                Some('"') => out.push('"'),
                Some('\\') => out.push('\\'),
                Some(other) => {
                    out.push('\\');
                    out.push(other);
                }
                None => out.push('\\'),
            }
        } else {
            out.push(c);
        }
    }
    out
}

/// Strip the surrounding double quotes (if present) from a frontmatter scalar
/// and unescape it.
fn unquote(v: &str) -> String {
    let v = v.trim();
    let inner = v
        .strip_prefix('"')
        .and_then(|s| s.strip_suffix('"'))
        .unwrap_or(v);
    yaml_unescape(inner)
}

/// Split a comma-joined recipient list into trimmed, non-empty entries. The
/// writer joins recipients with ", " (see `normalize::to_markdown`); display
/// names never contain a literal comma after YAML escaping, so a plain split
/// is correct and lossless here.
fn split_recipients(joined: &str) -> Vec<String> {
    joined
        .split(',')
        .map(|s| s.trim())
        .filter(|s| !s.is_empty())
        .map(String::from)
        .collect()
}

impl MailView {
    /// Parse stored mail Markdown into a structured view. `id` is the provider
    /// message id supplied by the caller (the DB key), used as the canonical id
    /// even if the frontmatter `message_id` is absent.
    pub fn from_markdown(id: &str, markdown: &str) -> MailView {
        let mut subject = String::new();
        let mut from = String::new();
        let mut to: Vec<String> = Vec::new();
        let mut cc: Vec<String> = Vec::new();
        let mut date: Option<String> = None;
        let mut provider: Option<String> = None;
        let mut has_attachments = false;

        // Walk the fenced frontmatter block only. The first `---` opens it, the
        // next closes it; everything after is the body.
        let mut in_frontmatter = false;
        let mut frontmatter_ended = false;
        let mut body_lines: Vec<&str> = Vec::new();
        let mut saw_heading = false;

        for line in markdown.lines() {
            if !frontmatter_ended {
                if line.trim() == "---" {
                    if in_frontmatter {
                        frontmatter_ended = true;
                    } else {
                        in_frontmatter = true;
                    }
                    continue;
                }
                if in_frontmatter {
                    if let Some((key, val)) = line.split_once(':') {
                        let key = key.trim();
                        let val = val.trim();
                        match key {
                            "subject" => subject = unquote(val),
                            "from" => from = unquote(val),
                            "to" => to = split_recipients(&unquote(val)),
                            "cc" => cc = split_recipients(&unquote(val)),
                            "date" => {
                                let d = unquote(val);
                                if !d.is_empty() {
                                    date = Some(d);
                                }
                            }
                            "provider" => {
                                let p = unquote(val);
                                if !p.is_empty() {
                                    provider = Some(p);
                                }
                            }
                            "has_attachments" => {
                                has_attachments = val.trim() == "true";
                            }
                            _ => {}
                        }
                    }
                    continue;
                }
                // Lines before the opening fence (there shouldn't be any) are
                // ignored.
                continue;
            }

            // Body region. Drop a single leading blank line and the `# subject`
            // heading the writer prepends, so the viewer renders the body the
            // user actually wrote, not a duplicated subject line.
            if !saw_heading {
                if line.trim().is_empty() {
                    continue;
                }
                if line.starts_with("# ") {
                    saw_heading = true;
                    continue;
                }
                // No heading present — fall through and keep this line.
                saw_heading = true;
            }
            body_lines.push(line);
        }

        // Trim leading blank lines left between the heading and the body.
        while body_lines
            .first()
            .map(|l| l.trim().is_empty())
            .unwrap_or(false)
        {
            body_lines.remove(0);
        }
        let body = body_lines.join("\n").trim_end().to_string();

        MailView {
            id: id.to_string(),
            subject,
            from,
            to,
            cc,
            date,
            provider,
            body,
            has_attachments,
            attachments: Vec::new(),
            // Set by `mail_get_message` after the RAG-store matter lookup; the
            // pure markdown parse has no matter information.
            matter_id: None,
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::commands::mail::model::{BodyContentType, MailMessage, Recipient};
    use crate::commands::mail::normalize::to_markdown;

    fn sample_message() -> MailMessage {
        MailMessage {
            id: "AAMk-123".into(),
            conversation_id: Some("conv-9".into()),
            internet_message_id: Some("<abc@hender.com>".into()),
            subject: "Closing date".into(),
            received_date_time: Some("2026-05-01T14:30:00Z".into()),
            from_name: Some("Pat H".into()),
            from_address: Some("pat@hender.com".into()),
            to: vec![
                Recipient {
                    name: Some("Me".into()),
                    address: Some("me@firm.com".into()),
                },
                Recipient {
                    name: None,
                    address: Some("legal@firm.com".into()),
                },
            ],
            cc: vec![Recipient {
                name: Some("Boss".into()),
                address: Some("boss@firm.com".into()),
            }],
            folders: vec![],
            thread_id: Some("conv-9".into()),
            provider: "m365".into(),
            account: String::new(),
            has_attachments: true,
            body_content_type: BodyContentType::Text,
            body_text: "Confirming May 14. The closing is at 10am.".into(),
        }
    }

    #[test]
    fn round_trips_normalized_markdown_into_fields() {
        let md = to_markdown(&sample_message());
        let v = MailView::from_markdown("AAMk-123", &md);
        assert_eq!(v.id, "AAMk-123");
        assert_eq!(v.subject, "Closing date");
        assert_eq!(v.from, "Pat H <pat@hender.com>");
        assert_eq!(v.to, vec!["Me <me@firm.com>", "legal@firm.com"]);
        assert_eq!(v.cc, vec!["Boss <boss@firm.com>"]);
        assert_eq!(v.date.as_deref(), Some("2026-05-01T14:30:00Z"));
        assert_eq!(v.provider.as_deref(), Some("m365"));
        assert!(v.has_attachments);
        // The body must NOT include the frontmatter or the `# Closing date` heading.
        assert_eq!(v.body, "Confirming May 14. The closing is at 10am.");
        assert!(!v.body.contains("---"));
        assert!(!v.body.contains("# Closing date"));
    }

    #[test]
    fn html_body_is_already_text_in_storage() {
        let mut m = sample_message();
        m.body_content_type = BodyContentType::Html;
        m.body_text = "<p>Hi <b>there</b></p><script>alert('x')</script>".into();
        let md = to_markdown(&m);
        let v = MailView::from_markdown(&m.id, &md);
        // Storage already stripped tags + script content; the view inherits text.
        assert!(v.body.contains("Hi there"));
        assert!(!v.body.contains("<b>"));
        assert!(!v.body.contains("alert"));
    }

    #[test]
    fn escaped_subject_is_unescaped() {
        let mut m = sample_message();
        m.subject = "Re: \"urgent\" matter".into();
        let md = to_markdown(&m);
        let v = MailView::from_markdown(&m.id, &md);
        assert_eq!(v.subject, "Re: \"urgent\" matter");
    }

    #[test]
    fn no_attachments_flag_when_absent() {
        let mut m = sample_message();
        m.has_attachments = false;
        let md = to_markdown(&m);
        let v = MailView::from_markdown(&m.id, &md);
        assert!(!v.has_attachments);
        assert!(v.attachments.is_empty());
    }

    #[test]
    fn empty_cc_yields_empty_vec_not_a_blank_entry() {
        let mut m = sample_message();
        m.cc = vec![];
        let md = to_markdown(&m);
        let v = MailView::from_markdown(&m.id, &md);
        assert!(v.cc.is_empty());
    }

    #[test]
    fn multiline_body_is_preserved() {
        let mut m = sample_message();
        m.body_text = "Line one.\nLine two.\n\nLine four.".into();
        let md = to_markdown(&m);
        let v = MailView::from_markdown(&m.id, &md);
        assert_eq!(v.body, "Line one.\nLine two.\n\nLine four.");
    }
}
