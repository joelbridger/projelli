use base64::Engine;

use crate::commands::mail::model::{BodyContentType, MailMessage, Recipient};

/// Parse a Gmail `users.messages.get(format=full)` JSON object into a
/// [`MailMessage`].
///
/// `account` is the connected Gmail address and is used both in provenance
/// fields and in building the stable id (`gmail:<account>:<gmail-id>`).
///
/// Returns `None` only if the Gmail message `id` field is absent or not a
/// string — every other field degrades gracefully to defaults.
///
/// # Address parsing simplification
///
/// RFC 5322 address lists (From / To / Cc) are split on commas and each token
/// is parsed as either `Name <addr@x.com>` or a bare `addr@x.com`. This
/// handles the overwhelmingly common case. It does **not** handle quoted
/// display names that contain a comma (e.g. `"Doe, John" <j@x.com>`) — those
/// are treated as two separate tokens. The simplification is documented here
/// so the next implementer can replace the split with a proper RFC 5322 parser
/// if needed.
///
/// # Date field
///
/// `received_date_time` is kept as-is from the `Date` header (e.g. RFC 2822
/// format like `"Mon, 26 May 2026 14:30:00 +0000"`). It is not normalized to
/// RFC 3339 / ISO 8601. Callers that need a sortable timestamp should parse it
/// with a date library.
///
/// # Base64url decoding
///
/// Gmail encodes body `data` as base64url **without padding**. We use the
/// `URL_SAFE_NO_PAD` engine; if that fails we fall back to `URL_SAFE` (with
/// padding) so both variants decode correctly.
pub fn from_gmail(account: &str, v: &serde_json::Value) -> Option<MailMessage> {
    // ── Stable id ────────────────────────────────────────────────────────────
    let gmail_id = v.get("id")?.as_str()?;
    let id = format!("gmail:{}:{}", account, gmail_id);

    // ── thread_id ────────────────────────────────────────────────────────────
    let thread_id = v
        .get("threadId")
        .and_then(|t| t.as_str())
        .map(String::from);

    // ── folders (labelIds) ───────────────────────────────────────────────────
    let folders: Vec<String> = v
        .get("labelIds")
        .and_then(|l| l.as_array())
        .map(|arr| {
            arr.iter()
                .filter_map(|item| item.as_str().map(String::from))
                .collect()
        })
        .unwrap_or_default();

    // ── Parse headers ────────────────────────────────────────────────────────
    let headers = v
        .pointer("/payload/headers")
        .and_then(|h| h.as_array())
        .map(|arr| arr.as_slice())
        .unwrap_or(&[]);

    let get_header = |name: &str| -> Option<String> {
        headers.iter().find_map(|h| {
            let n = h.get("name")?.as_str()?;
            if n.eq_ignore_ascii_case(name) {
                h.get("value")?.as_str().map(String::from)
            } else {
                None
            }
        })
    };

    let subject = get_header("Subject").unwrap_or_default();
    let from_header = get_header("From");
    let to_header = get_header("To");
    let cc_header = get_header("Cc");
    // Accept both `Message-ID` and `Message-Id`.
    let message_id_raw = get_header("Message-ID").or_else(|| get_header("Message-Id"));
    let date_header = get_header("Date");

    // ── Parse From ───────────────────────────────────────────────────────────
    let (from_name, from_address) = from_header
        .as_deref()
        .and_then(|s| parse_address_list(s).into_iter().next())
        .map(|r| (r.name, r.address))
        .unwrap_or((None, None));

    // ── Parse To / Cc ────────────────────────────────────────────────────────
    let to = to_header
        .as_deref()
        .map(parse_address_list)
        .unwrap_or_default();
    let cc = cc_header
        .as_deref()
        .map(parse_address_list)
        .unwrap_or_default();

    // ── internet_message_id (strip surrounding <>) ───────────────────────────
    let internet_message_id = message_id_raw.map(|s| strip_angle_brackets(&s).to_string());

    // ── received_date_time ───────────────────────────────────────────────────
    // Kept as-is from the Date header (RFC 2822 format, not normalized to
    // RFC 3339). See the module-level doc comment for the rationale.
    let received_date_time = date_header;

    // ── Walk the MIME tree for body + attachments ────────────────────────────
    let payload = v.get("payload");
    let (body_text, body_content_type, has_attachments) =
        extract_body_and_attachments(payload);

    Some(MailMessage {
        id,
        conversation_id: None,
        internet_message_id,
        subject,
        received_date_time,
        from_name,
        from_address,
        to,
        cc,
        folders,
        thread_id,
        provider: "gmail".to_string(),
        account: account.to_string(),
        has_attachments,
        body_content_type,
        body_text,
    })
}

// ── MIME tree walker ──────────────────────────────────────────────────────────

/// Recursively walk a Gmail `payload` / part node, preferring `text/plain`;
/// falling back to `text/html`. Also detects attachments (any part with a
/// non-empty `filename`).
///
/// Returns `(body_text, BodyContentType, has_attachments)`.
fn extract_body_and_attachments(
    node: Option<&serde_json::Value>,
) -> (String, BodyContentType, bool) {
    let mut plain: Option<String> = None;
    let mut html: Option<String> = None;
    let mut has_attachments = false;

    walk_parts(node, &mut plain, &mut html, &mut has_attachments);

    if let Some(text) = plain {
        (text, BodyContentType::Text, has_attachments)
    } else if let Some(text) = html {
        (text, BodyContentType::Html, has_attachments)
    } else {
        (String::new(), BodyContentType::Text, has_attachments)
    }
}

fn walk_parts(
    node: Option<&serde_json::Value>,
    plain: &mut Option<String>,
    html: &mut Option<String>,
    has_attachments: &mut bool,
) {
    let node = match node {
        Some(n) => n,
        None => return,
    };

    let mime_type = node
        .get("mimeType")
        .and_then(|m| m.as_str())
        .unwrap_or("");
    let filename = node
        .get("filename")
        .and_then(|f| f.as_str())
        .unwrap_or("");

    // A part with a non-empty filename is an attachment.
    if !filename.is_empty() {
        *has_attachments = true;
    }

    match mime_type {
        "text/plain" if plain.is_none() => {
            if let Some(decoded) = decode_body_data(node) {
                *plain = Some(decoded);
            }
        }
        "text/html" if html.is_none() => {
            if let Some(decoded) = decode_body_data(node) {
                *html = Some(decoded);
            }
        }
        // Multipart containers — recurse into `parts`.
        _ if mime_type.starts_with("multipart/") => {
            if let Some(parts) = node.get("parts").and_then(|p| p.as_array()) {
                for part in parts {
                    walk_parts(Some(part), plain, html, has_attachments);
                }
            }
        }
        _ => {}
    }
}

/// Decode the `body.data` field (base64url, no padding). Returns `None` only if
/// the field is absent or base64 decoding fails.
fn decode_body_data(node: &serde_json::Value) -> Option<String> {
    let data = node
        .get("body")
        .and_then(|b| b.get("data"))
        .and_then(|d| d.as_str())?;
    if data.is_empty() {
        return Some(String::new());
    }
    // Gmail uses base64url **without padding**; try no-pad first, then with padding
    // as a fallback to be defensive.
    let bytes = base64::engine::general_purpose::URL_SAFE_NO_PAD
        .decode(data)
        .or_else(|_| base64::engine::general_purpose::URL_SAFE.decode(data))
        .ok()?;
    Some(decode_text_bytes(&bytes, body_charset(node).as_deref()))
}

fn decode_text_bytes(bytes: &[u8], charset: Option<&str>) -> String {
    if let Some(label) = charset {
        if let Some(encoding) = encoding_rs::Encoding::for_label(label.as_bytes()) {
            let (decoded, _, _) = encoding.decode(bytes);
            return decoded.into_owned();
        }
    }

    String::from_utf8_lossy(bytes).into_owned()
}

fn body_charset(node: &serde_json::Value) -> Option<String> {
    node.get("headers")
        .and_then(|h| h.as_array())
        .and_then(|headers| {
            headers.iter().find_map(|h| {
                let name = h.get("name")?.as_str()?;
                if name.eq_ignore_ascii_case("Content-Type") {
                    h.get("value")?.as_str().and_then(extract_charset)
                } else {
                    None
                }
            })
        })
        .or_else(|| {
            node.get("mimeType")
                .and_then(|m| m.as_str())
                .and_then(extract_charset)
        })
}

fn extract_charset(content_type: &str) -> Option<String> {
    content_type.split(';').find_map(|part| {
        let (name, value) = part.trim().split_once('=')?;
        if name.trim().eq_ignore_ascii_case("charset") {
            let charset = value.trim().trim_matches('"').trim_matches('\'');
            if charset.is_empty() {
                None
            } else {
                Some(charset.to_string())
            }
        } else {
            None
        }
    })
}

// ── Address parsing ───────────────────────────────────────────────────────────

/// Parse a header address-list value (e.g. `"Pat H <pat@x.com>, Bob <bob@y.com>"`)
/// into a `Vec<Recipient>`.
///
/// Splits on `,` and parses each token as `Name <addr>` or bare `addr`.
/// See the module-level doc comment for the known simplification around
/// display names that contain commas.
fn parse_address_list(value: &str) -> Vec<Recipient> {
    value
        .split(',')
        .filter_map(|token| {
            let token = token.trim();
            if token.is_empty() {
                return None;
            }
            Some(parse_single_address(token))
        })
        .collect()
}

/// Parse a single address token. Recognises:
/// - `Display Name <addr@example.com>` — extracts both name and address.
/// - `<addr@example.com>` — address only, no name.
/// - `addr@example.com` — bare address.
fn parse_single_address(token: &str) -> Recipient {
    // Find the last `<` / `>` pair.
    if let (Some(lt), Some(gt)) = (token.rfind('<'), token.rfind('>')) {
        if lt < gt {
            let name_part = token[..lt].trim();
            let addr_part = token[lt + 1..gt].trim();
            return Recipient {
                name: if name_part.is_empty() {
                    None
                } else {
                    Some(name_part.to_string())
                },
                address: if addr_part.is_empty() {
                    None
                } else {
                    Some(addr_part.to_string())
                },
            };
        }
    }
    // Bare address (no angle brackets).
    Recipient {
        name: None,
        address: if token.is_empty() {
            None
        } else {
            Some(token.to_string())
        },
    }
}

/// Strip surrounding `<>` from a Message-ID string.
fn strip_angle_brackets(s: &str) -> &str {
    s.strip_prefix('<')
        .and_then(|s| s.strip_suffix('>'))
        .unwrap_or(s)
}

// ── Tests ─────────────────────────────────────────────────────────────────────

#[cfg(test)]
mod tests {
    use super::*;

    /// A realistic `format=full` Gmail JSON object: multipart/mixed containing
    /// a multipart/alternative (text/plain + text/html) and one attachment.
    fn sample_full_message() -> serde_json::Value {
        // The `text/plain` body "Hello from Gmail!" base64url-encoded (no padding):
        // base64url("Hello from Gmail!") = "SGVsbG8gZnJvbSBHbWFpbCE"
        serde_json::json!({
            "id": "abc123",
            "threadId": "thread456",
            "labelIds": ["INBOX", "IMPORTANT"],
            "payload": {
                "mimeType": "multipart/mixed",
                "headers": [
                    { "name": "Subject",    "value": "Closing date" },
                    { "name": "From",       "value": "Pat H <pat@hender.com>" },
                    { "name": "To",         "value": "Me <me@firm.com>, Alice <alice@firm.com>" },
                    { "name": "Cc",         "value": "Bob <bob@x.com>" },
                    { "name": "Message-ID", "value": "<closing-date@hender.com>" },
                    { "name": "Date",       "value": "Fri, 01 May 2026 14:30:00 +0000" }
                ],
                "body": { "size": 0 },
                "parts": [
                    {
                        "mimeType": "multipart/alternative",
                        "body": { "size": 0 },
                        "parts": [
                            {
                                "mimeType": "text/plain",
                                "filename": "",
                                "body": {
                                    "size": 18,
                                    // base64url("Hello from Gmail!") — no padding
                                    "data": "SGVsbG8gZnJvbSBHbWFpbCE"
                                }
                            },
                            {
                                "mimeType": "text/html",
                                "filename": "",
                                "body": {
                                    "size": 32,
                                    // base64url("<p>Hello from Gmail!</p>") — no padding
                                    "data": "PHA-SGVsbG8gZnJvbSBHbWFpbCE8L3A-"
                                }
                            }
                        ]
                    },
                    {
                        "mimeType": "application/pdf",
                        "filename": "contract.pdf",
                        "body": { "size": 1024, "attachmentId": "att_001" }
                    }
                ]
            }
        })
    }

    #[test]
    fn parses_stable_id_and_provenance() {
        let m = from_gmail("user@gmail.com", &sample_full_message()).expect("parse");
        assert_eq!(m.id, "gmail:user@gmail.com:abc123");
        assert_eq!(m.provider, "gmail");
        assert_eq!(m.account, "user@gmail.com");
        assert!(m.conversation_id.is_none(), "conversation_id is always None for Gmail");
    }

    #[test]
    fn parses_thread_id_and_folders() {
        let m = from_gmail("user@gmail.com", &sample_full_message()).expect("parse");
        assert_eq!(m.thread_id.as_deref(), Some("thread456"));
        assert_eq!(m.folders, vec!["INBOX".to_string(), "IMPORTANT".to_string()]);
    }

    #[test]
    fn parses_headers() {
        let m = from_gmail("user@gmail.com", &sample_full_message()).expect("parse");
        assert_eq!(m.subject, "Closing date");
        assert_eq!(m.from_address.as_deref(), Some("pat@hender.com"));
        assert_eq!(m.from_name.as_deref(), Some("Pat H"));
        assert_eq!(m.to.len(), 2);
        assert_eq!(m.to[0].address.as_deref(), Some("me@firm.com"));
        assert_eq!(m.to[1].address.as_deref(), Some("alice@firm.com"));
        assert_eq!(m.cc.len(), 1);
        assert_eq!(m.cc[0].address.as_deref(), Some("bob@x.com"));
    }

    #[test]
    fn strips_angle_brackets_from_message_id() {
        let m = from_gmail("user@gmail.com", &sample_full_message()).expect("parse");
        // `<closing-date@hender.com>` → `closing-date@hender.com`
        assert_eq!(
            m.internet_message_id.as_deref(),
            Some("closing-date@hender.com")
        );
    }

    #[test]
    fn keeps_date_header_as_is() {
        let m = from_gmail("user@gmail.com", &sample_full_message()).expect("parse");
        assert_eq!(
            m.received_date_time.as_deref(),
            Some("Fri, 01 May 2026 14:30:00 +0000")
        );
    }

    #[test]
    fn prefers_text_plain_body_and_decodes_base64url() {
        let m = from_gmail("user@gmail.com", &sample_full_message()).expect("parse");
        assert_eq!(m.body_content_type, BodyContentType::Text);
        assert_eq!(m.body_text, "Hello from Gmail!");
    }

    #[test]
    fn decodes_latin1_body_using_part_charset() {
        let latin1_cafe = base64::engine::general_purpose::URL_SAFE_NO_PAD.encode(b"Caf\xe9");
        let v = serde_json::json!({
            "id": "latin1",
            "payload": {
                "mimeType": "text/plain",
                "headers": [
                    { "name": "Content-Type", "value": "text/plain; charset=ISO-8859-1" }
                ],
                "body": {
                    "data": latin1_cafe
                }
            }
        });

        let m = from_gmail("user@gmail.com", &v).expect("parse");
        assert_eq!(m.body_text, "Café");
    }

    #[test]
    fn detects_attachment() {
        let m = from_gmail("user@gmail.com", &sample_full_message()).expect("parse");
        assert!(m.has_attachments, "contract.pdf part must set has_attachments");
    }

    #[test]
    fn returns_none_when_id_missing() {
        let mut v = sample_full_message();
        v.as_object_mut().unwrap().remove("id");
        assert!(from_gmail("user@gmail.com", &v).is_none());
    }

    // ── HTML-only case ────────────────────────────────────────────────────────

    #[test]
    fn html_only_sets_html_body_type() {
        let v = serde_json::json!({
            "id": "html1",
            "threadId": "t1",
            "labelIds": ["INBOX"],
            "payload": {
                "mimeType": "text/html",
                "headers": [
                    { "name": "Subject", "value": "HTML only" },
                    { "name": "From",    "value": "sender@x.com" },
                    { "name": "Message-Id", "value": "<html1@x.com>" }
                ],
                "body": {
                    "size": 15,
                    // base64url("<p>Hi there</p>") — no padding
                    // base64url encode: "<p>Hi there</p>" → PHA+SGkgdGhlcmU8L3A+
                    "data": "PHA-SGkgdGhlcmU8L3A-"
                }
            }
        });
        let m = from_gmail("user@gmail.com", &v).expect("parse html-only");
        assert_eq!(m.body_content_type, BodyContentType::Html);
        assert!(!m.body_text.is_empty(), "HTML body should be decoded");
        assert!(m.body_text.contains("Hi there") || m.body_text.starts_with("<p>"),
            "decoded HTML body: {:?}", m.body_text);
        assert!(!m.has_attachments);
        // Message-Id (case variant) must still be stripped.
        assert_eq!(m.internet_message_id.as_deref(), Some("html1@x.com"));
    }

    // ── Address parser edge cases ─────────────────────────────────────────────

    #[test]
    fn parse_address_list_bare_address() {
        let addrs = parse_address_list("noreply@example.com");
        assert_eq!(addrs.len(), 1);
        assert!(addrs[0].name.is_none());
        assert_eq!(addrs[0].address.as_deref(), Some("noreply@example.com"));
    }

    #[test]
    fn parse_address_list_angle_bracket_only() {
        let addrs = parse_address_list("<only@example.com>");
        assert_eq!(addrs.len(), 1);
        assert!(addrs[0].name.is_none());
        assert_eq!(addrs[0].address.as_deref(), Some("only@example.com"));
    }

    #[test]
    fn parse_address_list_multiple() {
        let addrs = parse_address_list("A <a@x.com>, B <b@x.com>");
        assert_eq!(addrs.len(), 2);
        assert_eq!(addrs[0].name.as_deref(), Some("A"));
        assert_eq!(addrs[1].address.as_deref(), Some("b@x.com"));
    }
}
