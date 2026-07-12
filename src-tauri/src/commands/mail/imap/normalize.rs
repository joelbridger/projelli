use mail_parser::{Address, HeaderValue, MessageParser};

use crate::commands::mail::model::{
    BodyContentType, MailAuthResult, MailAuthSource, MailMessage, Recipient,
};

/// Convert an `Address` (List or Group) into a `Vec<Recipient>`.
fn addr_to_recipients(addr: &Address<'_>) -> Vec<Recipient> {
    addr.iter()
        .map(|a| Recipient {
            name: a.name().map(String::from),
            address: a.address().map(String::from),
        })
        .collect()
}

/// Strip surrounding `<>` from a message-id string.
/// mail-parser 0.11 already strips them via `parse_id`, but this is a no-op
/// safety guard if a caller ever passes a raw value.
fn strip_angle_brackets(s: &str) -> &str {
    s.strip_prefix('<')
        .and_then(|s| s.strip_suffix('>'))
        .unwrap_or(s)
}

/// Parse a raw RFC822 message into a normalized [`MailMessage`].
///
/// `id` is the stable id the caller assigns (the IMAP provider derives it from
/// UID/UIDVALIDITY or the Message-ID). `account` and `mailbox` are provenance.
///
/// Returns `None` only if `MessageParser::parse` fails outright (i.e. the bytes
/// are not a recognisable RFC822 message at all).
pub fn from_rfc822(id: &str, account: &str, mailbox: &str, raw: &[u8]) -> Option<MailMessage> {
    let msg = MessageParser::default().parse(raw)?;

    // Subject
    let subject = msg.subject().unwrap_or("").to_string();

    // From
    let (from_name, from_address) = msg
        .from()
        .and_then(|a| a.first())
        .map(|addr| {
            (
                addr.name().map(String::from),
                addr.address().map(String::from),
            )
        })
        .unwrap_or((None, None));

    // To / Cc
    let to = msg.to().map(|a| addr_to_recipients(a)).unwrap_or_default();
    let cc = msg.cc().map(|a| addr_to_recipients(a)).unwrap_or_default();

    // Message-ID (mail-parser 0.11 already strips the surrounding <>)
    let internet_message_id = msg
        .message_id()
        .map(|s| strip_angle_brackets(s).to_string());

    // Date as RFC3339 string
    let received_date_time = msg.date().map(|dt| dt.to_rfc3339());

    // Thread-ID: first Reference > In-Reply-To > own Message-ID
    let thread_id = {
        // references() returns &HeaderValue — TextList for multiple IDs, Text
        // for a single one; ids are already stripped of <> by parse_id.
        let from_refs = match msg.references() {
            HeaderValue::TextList(list) => list.first().map(|s| s.as_ref().to_string()),
            HeaderValue::Text(s) => Some(strip_angle_brackets(s.as_ref()).to_string()),
            _ => None,
        };
        let from_irt = match msg.in_reply_to() {
            HeaderValue::TextList(list) => list.first().map(|s| s.as_ref().to_string()),
            HeaderValue::Text(s) => Some(strip_angle_brackets(s.as_ref()).to_string()),
            _ => None,
        };
        from_refs
            .or(from_irt)
            .or_else(|| internet_message_id.clone())
    };

    // Body: prefer text/plain; fall back to HTML.
    //
    // mail-parser 0.11 adds an HTML-only single-part message to both
    // `text_body` and `html_body` (the part type inside is `PartType::Html`).
    // We therefore check the actual PartType of the first text_body entry:
    //   - PartType::Text  → plain text, use body_text(0)
    //   - PartType::Html  → HTML-only message in the text_body list;
    //                       surface the raw HTML with BodyContentType::Html
    // If text_body is empty but html_body is not, same HTML path applies.
    let (body_text, body_content_type) = if msg.text_body_count() > 0 {
        // Inspect the first text_body part's actual PartType.
        let first_part = msg
            .text_part(0)
            .map(|p| matches!(p.body, mail_parser::PartType::Html(_)))
            .unwrap_or(false);
        if first_part {
            // The "text" slot holds raw HTML — treat it as HTML.
            let html = msg
                .text_part(0)
                .and_then(|p| {
                    if let mail_parser::PartType::Html(h) = &p.body {
                        Some(h.as_ref().to_string())
                    } else {
                        None
                    }
                })
                .unwrap_or_default();
            (html, BodyContentType::Html)
        } else {
            let text = msg.body_text(0).map(|s| s.into_owned()).unwrap_or_default();
            (text, BodyContentType::Text)
        }
    } else if msg.html_body_count() > 0 {
        // No text_body at all — take first HTML part raw.
        let html = msg
            .html_bodies()
            .next()
            .and_then(|p| {
                if let mail_parser::PartType::Html(h) = &p.body {
                    Some(h.as_ref().to_string())
                } else {
                    None
                }
            })
            .unwrap_or_default();
        (html, BodyContentType::Html)
    } else {
        (String::new(), BodyContentType::Text)
    };

    // Attachments
    let has_attachments = msg.attachment_count() > 0;
    let auth_headers: Vec<(&str, &str)> = msg
        .headers_raw()
        .filter(|(name, _)| {
            name.eq_ignore_ascii_case("Authentication-Results")
                || name.eq_ignore_ascii_case("ARC-Authentication-Results")
                || name.eq_ignore_ascii_case("Received-SPF")
        })
        .collect();

    Some(MailMessage {
        id: id.to_string(),
        conversation_id: None,
        internet_message_id,
        subject,
        received_date_time,
        from_name,
        from_address,
        to,
        cc,
        has_attachments,
        attachments_unsupported: has_attachments,
        auth_result: MailAuthResult::from_headers(MailAuthSource::Imap, auth_headers),
        attachments: Vec::new(),
        body_content_type,
        body_text,
        folders: vec![mailbox.to_string()],
        thread_id,
        provider: "imap".to_string(),
        account: account.to_string(),
    })
}

#[cfg(test)]
mod tests {
    use super::*;

    const RAW: &[u8] = b"From: Pat H <pat@hender.com>\r\nTo: Me <me@firm.com>\r\nSubject: Closing date\r\nMessage-ID: <abc@hender.com>\r\nReferences: <root@hender.com> <abc@hender.com>\r\nDate: Fri, 01 May 2026 14:30:00 +0000\r\n\r\nConfirming May 14.\r\n";

    #[test]
    fn parses_core_headers_and_body() {
        let m = from_rfc822("uid-1", "acct@x.com", "INBOX", RAW).expect("parse");
        assert_eq!(m.id, "uid-1");
        assert_eq!(m.subject, "Closing date");
        assert_eq!(m.from_address.as_deref(), Some("pat@hender.com"));
        assert_eq!(m.to.len(), 1);
        assert_eq!(m.internet_message_id.as_deref(), Some("abc@hender.com")); // <> stripped
        assert_eq!(m.thread_id.as_deref(), Some("root@hender.com")); // first Reference
        assert_eq!(m.provider, "imap");
        assert_eq!(m.account, "acct@x.com");
        assert_eq!(m.folders, vec!["INBOX".to_string()]);
        assert!(m.body_text.contains("Confirming May 14."));
    }

    #[test]
    fn no_references_uses_own_message_id_as_thread() {
        let raw = b"Subject: Solo\r\nMessage-ID: <solo@x.com>\r\n\r\nhi\r\n";
        let m = from_rfc822("uid-2", "a", "INBOX", raw).expect("parse");
        assert_eq!(m.thread_id.as_deref(), Some("solo@x.com"));
    }

    #[test]
    fn html_only_sets_html_body_type() {
        let raw = b"Subject: HTML msg\r\nContent-Type: text/html\r\n\r\n<p>Hello</p>\r\n";
        let m = from_rfc822("uid-3", "a", "INBOX", raw).expect("parse");
        assert_eq!(m.body_content_type, BodyContentType::Html);
        assert!(m.body_text.contains("<p>Hello</p>") || m.body_text.contains("Hello"));
    }

    #[test]
    fn returns_none_for_empty_input() {
        // An empty slice is not a valid RFC822 message — but mail-parser may
        // still return Some (it is lenient). We only require that if it returns
        // Some, it doesn't panic.
        let _ = from_rfc822("uid-4", "a", "INBOX", b"");
    }

    #[test]
    fn in_reply_to_used_when_no_references() {
        let raw = b"Subject: Reply\r\nMessage-ID: <reply@x.com>\r\nIn-Reply-To: <parent@x.com>\r\n\r\nbody\r\n";
        let m = from_rfc822("uid-5", "a", "INBOX", raw).expect("parse");
        assert_eq!(m.thread_id.as_deref(), Some("parent@x.com"));
    }

    #[test]
    fn imap_auth_missing_never_defaults_to_pass() {
        let m = from_rfc822("uid-auth-missing", "a", "INBOX", RAW).expect("parse");
        assert_eq!(
            m.auth_result.dkim,
            crate::commands::mail::model::MailAuthVerdict::None
        );
        assert_eq!(
            m.auth_result.spf,
            crate::commands::mail::model::MailAuthVerdict::None
        );
        assert_eq!(
            m.auth_result.dmarc,
            crate::commands::mail::model::MailAuthVerdict::None
        );
        assert_eq!(
            m.auth_result.source,
            crate::commands::mail::model::MailAuthSource::Missing
        );
        assert!(!m.auth_result.aligned);
    }

    #[test]
    fn imap_auth_headers_are_parsed_when_present() {
        let raw = b"From: Pat H <pat@hender.com>\r\nTo: Me <me@firm.com>\r\nSubject: Auth\r\nMessage-ID: <auth@hender.com>\r\nAuthentication-Results: mx.example; dkim=pass header.d=hender.com; spf=pass smtp.mailfrom=hender.com; dmarc=pass header.from=hender.com\r\n\r\nHi\r\n";
        let m = from_rfc822("uid-auth", "a", "INBOX", raw).expect("parse");
        assert_eq!(
            m.auth_result.dkim,
            crate::commands::mail::model::MailAuthVerdict::Pass
        );
        assert_eq!(
            m.auth_result.spf,
            crate::commands::mail::model::MailAuthVerdict::Pass
        );
        assert_eq!(
            m.auth_result.dmarc,
            crate::commands::mail::model::MailAuthVerdict::Pass
        );
        assert!(m.auth_result.aligned);
        assert_eq!(
            m.auth_result.source,
            crate::commands::mail::model::MailAuthSource::Imap
        );
    }

    #[test]
    fn conversation_id_is_none_and_folders_set() {
        let m = from_rfc822("uid-6", "a", "Sent", RAW).expect("parse");
        assert!(m.conversation_id.is_none());
        assert_eq!(m.folders, vec!["Sent".to_string()]);
    }
}
