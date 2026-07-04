// Cross-process write-approval channel.
//
// Problem
// -------
// The MCP server runs as a subprocess, usually spawned by Claude Desktop or
// another client. When a client calls `write_workspace_file` with
// `require_confirmation = true` we need the USER to approve the write, not
// the client. The server can't show UI directly — it only has stdio.
//
// Design
// ------
// 1. The server writes a request JSON to
//      <temp>/lantern-mcp/approval-requests/<token>.json
//    where <token> is a random UUID and the JSON carries the intended
//    write (path + preview of content + old content when available).
//
// 2. The server emits a single-line notification on stderr:
//      {"lantern":"approval_request","token":"<token>","path":"<rel>"}
//    (JSON so the parent can parse without regex; one line per request so
//    line-buffering works cleanly.)
//
// 3. The Advisor Prep Hero desktop app tails stderr, shows the modal, and when the
//    user picks a choice it writes the decision to
//      <temp>/lantern-mcp/approval-responses/<token>.json
//    as `{ "approved": true, "reason": "user approved" }` or
//       `{ "approved": false, "reason": "user denied" }`.
//
// 4. The server polls the responses dir for up to 60 s, reads + deletes the
//    decision file, and returns.
//
// Why a file channel instead of the binary's own stdin?
//   - MCP clients own stdin/stdout for the JSON-RPC protocol — any extra
//     bytes on stdin would violate the spec and confuse the client.
//   - Files are easy to inspect from the parent side without a duplex pipe
//     (the Tauri `Command` helper's stdin-writing story is awkward).
//   - Unix domain sockets would be cleaner but Windows portability adds a
//     lot of code. A once-per-write file rendezvous is plenty for a
//     user-driven approval flow that runs a few times per minute at most.
//
// Lifetime
//   - Request files are deleted as soon as the server reads the response.
//   - The parent app is expected to clean its own stale responses; we delete
//     them on pickup either way.
//   - On timeout, the request file is removed so it doesn't linger forever.

use serde::{Deserialize, Serialize};
use std::path::{Path, PathBuf};
use std::time::{Duration, Instant};

/// Temp directory prefix used for both request and response files.
const APPROVAL_PREFIX: &str = lantern_lib::identity::MCP_APPROVAL_TEMP_PREFIX;

/// Max time to wait for a user decision before returning `false`. Long
/// enough for the user to walk away from the keyboard, short enough that
/// the MCP client doesn't hit its own timeout.
const APPROVAL_TIMEOUT: Duration = Duration::from_secs(60);

/// Poll interval while waiting for the response file to appear. 100ms keeps
/// the wait responsive without burning CPU on an idle wait.
const POLL_INTERVAL: Duration = Duration::from_millis(100);

/// Marker emitted on stderr immediately before the approval request is
/// written. Parent processes grep for this to distinguish approval lines
/// from regular log output.
pub const APPROVAL_MARKER: &str = lantern_lib::identity::MCP_APPROVAL_MARKER;

/// The payload mirrored into `<approval_dir>/requests/<token>.json`.
///
/// `camelCase` on the wire so the host-side Tauri `PendingApproval` struct
/// can deserialize the exact same JSON with its own `rename_all`. Both
/// structs live in different binaries and have to agree by convention;
/// adding a field here requires updating `commands::mcp::PendingApproval`
/// too.
#[derive(Serialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct ApprovalRequest {
    pub token: String,
    /// Workspace-relative path being written.
    pub path: String,
    /// Short preview of the new content (first 4 KiB). Long enough for the
    /// parent to show a real diff; short enough to avoid flooding the temp
    /// dir on 1 GiB writes (which we'd reject upstream anyway).
    pub preview: String,
    /// True iff a file already exists at `path`; the host can render a diff
    /// rather than a blank "new file" preview.
    pub file_exists: bool,
    /// Old content (first 4 KiB) when `file_exists == true`, else empty.
    pub old_preview: String,
    /// Total byte length of the new content.
    pub content_bytes: u64,
    /// Unix seconds when we emitted the request — the host sorts pending
    /// approvals FIFO by this field.
    pub received_at: i64,
}

/// The response dropped into `<approval_dir>/responses/<token>.json` by the
/// parent app.
#[derive(Deserialize, Debug, Clone)]
pub struct ApprovalResponse {
    pub approved: bool,
    #[serde(default)]
    #[allow(dead_code)]
    pub reason: String,
}

/// Base dir we use for both `requests/` and `responses/`. Falls back to
/// `std::env::temp_dir()` which is portable across Win/Mac/Linux.
pub fn approval_base_dir() -> PathBuf {
    std::env::temp_dir().join(APPROVAL_PREFIX)
}

/// Full path to the request file for a token.
pub fn request_path(approval_dir: &Path, token: &str) -> PathBuf {
    approval_dir.join("requests").join(format!("{token}.json"))
}

/// Full path to the response file for a token.
pub fn response_path(approval_dir: &Path, token: &str) -> PathBuf {
    approval_dir.join("responses").join(format!("{token}.json"))
}

/// Generate a random token. UUID-v4 would be nice but we don't want another
/// crate dep for this; a 128-bit random hex from the OS RNG is plenty.
pub fn generate_token() -> String {
    use std::time::{SystemTime, UNIX_EPOCH};
    // Best-effort randomness: read 16 bytes from /dev/urandom on Unix,
    // BCryptGenRandom via `std::time` hash on Windows fallback. We only
    // need uniqueness inside this process's temp dir, not crypto-grade.
    let mut bytes = [0u8; 16];
    if let Ok(mut f) = std::fs::File::open("/dev/urandom") {
        use std::io::Read;
        let _ = f.read(&mut bytes);
    }
    // Mix in the clock + process id so Windows (no /dev/urandom) still
    // produces a unique token even if the read above returned zero bytes.
    let nanos = SystemTime::now()
        .duration_since(UNIX_EPOCH)
        .map(|d| d.subsec_nanos())
        .unwrap_or(0);
    let pid = std::process::id();
    let mix = [
        (nanos & 0xff) as u8,
        ((nanos >> 8) & 0xff) as u8,
        ((nanos >> 16) & 0xff) as u8,
        ((nanos >> 24) & 0xff) as u8,
        (pid & 0xff) as u8,
        ((pid >> 8) & 0xff) as u8,
        ((pid >> 16) & 0xff) as u8,
        ((pid >> 24) & 0xff) as u8,
    ];
    for (b, m) in bytes.iter_mut().zip(mix.iter()) {
        *b ^= m;
    }
    const HEX: &[u8] = b"0123456789abcdef";
    let mut s = String::with_capacity(32);
    for &b in &bytes {
        s.push(HEX[(b >> 4) as usize] as char);
        s.push(HEX[(b & 0x0f) as usize] as char);
    }
    s
}

/// Build an `ApprovalRequest`, truncating the preview fields to 4 KiB so
/// giant writes don't blow out the temp dir.
pub fn build_request(
    token: String,
    path: String,
    new_content: &str,
    old_content: Option<&str>,
) -> ApprovalRequest {
    const MAX_PREVIEW: usize = 4096;
    let truncate = |s: &str| -> String {
        if s.len() <= MAX_PREVIEW {
            s.to_string()
        } else {
            let mut out = String::with_capacity(MAX_PREVIEW + 16);
            out.push_str(&s[..MAX_PREVIEW]);
            out.push_str("\n[truncated]");
            out
        }
    };
    let preview = truncate(new_content);
    let (file_exists, old_preview) = match old_content {
        Some(c) => (true, truncate(c)),
        None => (false, String::new()),
    };
    let received_at = std::time::SystemTime::now()
        .duration_since(std::time::UNIX_EPOCH)
        .map(|d| d.as_secs() as i64)
        .unwrap_or(0);
    ApprovalRequest {
        token,
        path,
        preview,
        file_exists,
        old_preview,
        content_bytes: new_content.len() as u64,
        received_at,
    }
}

/// Wait for the parent to drop a response file. Returns `Ok(true)` on
/// approval, `Ok(false)` on denial, and `Err` on timeout / IO failure.
///
/// Times out after `APPROVAL_TIMEOUT` so a disconnected parent can't hang
/// the MCP client forever. Deletes the response file and the paired request
/// file before returning.
pub fn wait_for_response(approval_dir: &Path, token: &str) -> Result<bool, String> {
    let resp_path = response_path(approval_dir, token);
    let req_path = request_path(approval_dir, token);
    let deadline = Instant::now() + APPROVAL_TIMEOUT;
    loop {
        if resp_path.exists() {
            let body = std::fs::read_to_string(&resp_path)
                .map_err(|e| format!("read approval response: {e}"))?;
            let parsed: ApprovalResponse = serde_json::from_str(&body)
                .map_err(|e| format!("parse approval response: {e}"))?;
            // Best-effort cleanup — not fatal if either unlink fails.
            let _ = std::fs::remove_file(&resp_path);
            let _ = std::fs::remove_file(&req_path);
            return Ok(parsed.approved);
        }
        if Instant::now() >= deadline {
            let _ = std::fs::remove_file(&req_path);
            return Err("approval request timed out (60 s)".into());
        }
        std::thread::sleep(POLL_INTERVAL);
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn tokens_are_32_hex_chars() {
        let t = generate_token();
        assert_eq!(t.len(), 32);
        assert!(t.chars().all(|c| c.is_ascii_hexdigit()));
    }

    #[test]
    fn tokens_are_unique() {
        // 1000 tokens with no collisions is a loose proof of life; the real
        // uniqueness guarantee comes from /dev/urandom + clock + pid mixing.
        let mut seen = std::collections::HashSet::new();
        for _ in 0..1000 {
            assert!(seen.insert(generate_token()));
        }
    }

    #[test]
    fn base_dir_is_under_temp() {
        let base = approval_base_dir();
        let temp = std::env::temp_dir();
        assert!(base.starts_with(&temp), "got {base:?}, temp {temp:?}");
    }

    #[test]
    fn request_and_response_paths_are_siblings() {
        let base = PathBuf::from("/tmp/x");
        let req = request_path(&base, "abc");
        let resp = response_path(&base, "abc");
        assert_eq!(req, PathBuf::from("/tmp/x/requests/abc.json"));
        assert_eq!(resp, PathBuf::from("/tmp/x/responses/abc.json"));
    }

    #[test]
    fn build_request_truncates_large_preview() {
        let huge = "A".repeat(10_000);
        let req = build_request("t".into(), "big.md".into(), &huge, None);
        assert!(req.preview.len() <= 4096 + 16);
        assert!(req.preview.ends_with("[truncated]"));
        assert_eq!(req.content_bytes, 10_000);
        assert!(!req.file_exists);
    }

    #[test]
    fn build_request_captures_old_content_when_supplied() {
        let old = "previous";
        let req = build_request("t".into(), "x.md".into(), "new", Some(old));
        assert!(req.file_exists);
        assert_eq!(req.old_preview, "previous");
    }

    #[test]
    fn wait_returns_true_when_response_file_says_approved() {
        let base = std::env::temp_dir().join(format!(
            "{}-test-{}",
            lantern_lib::identity::MCP_APPROVAL_TEMP_PREFIX,
            std::process::id()
        ));
        std::fs::create_dir_all(base.join("responses")).unwrap();
        std::fs::create_dir_all(base.join("requests")).unwrap();
        let token = "deadbeef";
        std::fs::write(
            response_path(&base, token),
            r#"{"approved": true, "reason": "ok"}"#,
        )
        .unwrap();
        let result = wait_for_response(&base, token);
        assert!(matches!(result, Ok(true)));
        // Response file was consumed.
        assert!(!response_path(&base, token).exists());
    }

    #[test]
    fn wait_returns_false_when_response_file_says_denied() {
        let base = std::env::temp_dir().join(format!(
            "{}-test-deny-{}",
            lantern_lib::identity::MCP_APPROVAL_TEMP_PREFIX,
            std::process::id()
        ));
        std::fs::create_dir_all(base.join("responses")).unwrap();
        std::fs::create_dir_all(base.join("requests")).unwrap();
        let token = "feedface";
        std::fs::write(
            response_path(&base, token),
            r#"{"approved": false, "reason": "no"}"#,
        )
        .unwrap();
        let result = wait_for_response(&base, token);
        assert!(matches!(result, Ok(false)));
    }
}
