//! Safe logging for failed HTTP responses from external provider APIs
//! (Gmail, Microsoft Graph, Box, and the CRM/document connectors).
//!
//! Response bodies from these APIs can carry mailbox addresses, client
//! names, or other PII, so callers must never pass a raw body to
//! `log::warn!`/`log::error!`, and must never embed one in an error that
//! could reach the UI. Use [`log_http_failure`] instead: it logs only the
//! HTTP status, a caller-supplied context tag, and a short, non-sensitive
//! summary of the body — a machine error code/reason if one is present,
//! plus the byte length. Free-text `message` fields (the ones that
//! actually carry PII) are never included.

use std::fmt::Display;

/// Extract a short, non-sensitive summary from an API error body: a
/// machine-readable error code/reason if the body is JSON shaped like one
/// of the conventions the connectors in this app talk to, plus the raw
/// byte length. Never returns a free-text `message` field.
pub fn summarize_error_body(body: &str) -> String {
    let code = serde_json::from_str::<serde_json::Value>(body)
        .ok()
        .and_then(|v| extract_error_code(&v));
    match code {
        Some(c) => format!("code={c} bytes={}", body.len()),
        None => format!("bytes={}", body.len()),
    }
}

/// Look for a machine-readable error code/reason across the error-body
/// shapes used by the providers this app talks to:
///   - OAuth token errors (RFC 6749 §5.2): `{"error": "invalid_grant"}`
///   - Microsoft Graph:      `{"error": {"code": "itemNotFound", "message": "..."}}`
///   - Gmail:                `{"error": {"code": 400, "status": "INVALID_ARGUMENT",
///                             "errors": [{"reason": "authError", "message": "..."}]}}`
fn extract_error_code(v: &serde_json::Value) -> Option<String> {
    let err = v.get("error")?;
    if let Some(s) = err.as_str() {
        return Some(s.to_string());
    }
    if let Some(status) = err.get("status").and_then(|s| s.as_str()) {
        return Some(status.to_string());
    }
    if let Some(reason) = err
        .get("errors")
        .and_then(|e| e.as_array())
        .and_then(|a| a.first())
        .and_then(|first| first.get("reason"))
        .and_then(|r| r.as_str())
    {
        return Some(reason.to_string());
    }
    err.get("code").and_then(|c| {
        c.as_str()
            .map(String::from)
            .or_else(|| c.as_i64().map(|n| n.to_string()))
    })
}

/// Log an HTTP request failure without leaking the raw response body.
/// `context` should identify the call site (e.g. `"gmail GET"`,
/// `"Box GET https://api.box.com/2.0/files/123/content"`); `status` any
/// `Display`-able status code; `body` the raw response text — used only to
/// derive a safe summary, never logged verbatim.
pub fn log_http_failure(context: &str, status: impl Display, body: &str) {
    log::warn!(
        "{context} failed (HTTP {status}): {}",
        summarize_error_body(body)
    );
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn summarize_error_body_extracts_gmail_reason_never_message() {
        let body = r#"{"error":{"code":403,"message":"someone@example.com is not authorized to modify labels","status":"PERMISSION_DENIED","errors":[{"message":"someone@example.com is not authorized","domain":"global","reason":"forbidden"}]}}"#;
        let summary = summarize_error_body(body);
        assert!(summary.contains("code=PERMISSION_DENIED"), "{summary}");
        assert!(summary.contains(&format!("bytes={}", body.len())), "{summary}");
        assert!(!summary.contains("someone@example.com"), "{summary}");
        assert!(!summary.contains("not authorized"), "{summary}");
    }

    #[test]
    fn summarize_error_body_extracts_graph_code_never_message() {
        let body = r#"{"error":{"code":"itemNotFound","message":"mailbox jane@example.com item not found"}}"#;
        let summary = summarize_error_body(body);
        assert!(summary.contains("code=itemNotFound"), "{summary}");
        assert!(!summary.contains("jane@example.com"), "{summary}");
        assert!(!summary.contains("item not found"), "{summary}");
    }

    #[test]
    fn summarize_error_body_extracts_oauth_error_string_never_description() {
        let body = r#"{"error":"invalid_grant","error_description":"refresh token for bob@example.com expired"}"#;
        let summary = summarize_error_body(body);
        assert!(summary.contains("code=invalid_grant"), "{summary}");
        assert!(!summary.contains("bob@example.com"), "{summary}");
    }

    #[test]
    fn summarize_error_body_handles_non_json_body() {
        let body = "plain text body containing alice@example.com";
        let summary = summarize_error_body(body);
        assert_eq!(summary, format!("bytes={}", body.len()));
        assert!(!summary.contains("alice@example.com"), "{summary}");
    }

    #[test]
    fn summarize_error_body_handles_json_with_no_error_field() {
        let body = r#"{"ok": false}"#;
        assert_eq!(summarize_error_body(body), format!("bytes={}", body.len()));
    }
}
