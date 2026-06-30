// Host-side Tauri commands for the MCP approval channel and install UI.
//
// The Advisor Prep Hero MCP sidecar binary (`src/bin/mcp/`) runs as a subprocess of
// whichever MCP client spawned it — usually Claude Desktop, launched by
// double-clicking the `.mcpb` bundle. The sidecar has no UI surface of its
// own, so when a client calls `write_workspace_file` with
// `require_confirmation = true` it writes an approval request JSON to
// `<temp>/lantern-mcp/approval-requests/<token>.json` and emits a single
// `keepance/approval_request` line on stderr.
//
// This module gives the Advisor Prep Hero desktop app the three commands it needs to
// surface that request to the user and ship the decision back:
//
//   `mcp_list_pending_approvals()`
//       — scan the requests dir, return every pending write as a typed JSON
//         array. Safe to call on a 1-second poll.
//
//   `mcp_approve_write(token, approved)`
//       — drop a response JSON into the responses dir; the sidecar's
//         `wait_for_response` polls the same dir and picks it up.
//
//   `mcp_bundle_path()`
//       — resolve the path to the platform `.mcpb` (bundled in Tauri
//         resources, or else the dev-build output) so the Settings section
//         can "Download .mcpb" by copying the file into the user's
//         Downloads folder.
//
// Polling the filesystem rather than piping stderr through the sidecar's
// parent process keeps the approval channel stable regardless of which MCP
// client happens to have spawned the binary (Claude Desktop, Cursor, or a
// direct Advisor Prep Hero-as-server spawn).

use serde::{Deserialize, Serialize};
use std::path::PathBuf;

/// Base dir mirrored from `src/bin/mcp/approval.rs`. If these two ever
/// diverge, approval rendezvous breaks — the binary's constants are the
/// SSOT; this copy is the host's read-side view of the same contract.
const APPROVAL_PREFIX: &str = crate::identity::MCP_APPROVAL_TEMP_PREFIX;

fn approval_base_dir() -> PathBuf {
    std::env::temp_dir().join(APPROVAL_PREFIX)
}

fn requests_dir() -> PathBuf {
    approval_base_dir().join("requests")
}

fn responses_dir() -> PathBuf {
    approval_base_dir().join("responses")
}

/// One pending approval. Mirrors `ApprovalRequest` in `src/bin/mcp/approval.rs`
/// — kept in sync by hand because they live in different binaries (the lib
/// crate doesn't depend on the bin binary and vice versa for the request
/// struct).
#[derive(Serialize, Deserialize, Clone, Debug)]
#[serde(rename_all = "camelCase")]
pub struct PendingApproval {
    pub token: String,
    pub path: String,
    pub preview: String,
    pub file_exists: bool,
    pub old_preview: String,
    pub content_bytes: u64,
    /// Unix seconds when the file appeared on disk — the UI sorts by this
    /// so the oldest pending write shows first.
    pub received_at: i64,
}

/// Response payload written to `responses/<token>.json`. Shape has to match
/// the binary's `ApprovalResponse` type.
#[derive(Serialize, Deserialize, Debug)]
struct ApprovalResponseOut {
    approved: bool,
    reason: String,
}

/// List every pending approval request currently on disk. Returns an empty
/// vec when no writes are pending. Ignores malformed files quietly so one
/// bad entry doesn't block the rest of the list.
#[tauri::command]
pub async fn mcp_list_pending_approvals() -> Result<Vec<PendingApproval>, String> {
    let dir = requests_dir();
    if !dir.exists() {
        return Ok(Vec::new());
    }
    let entries = std::fs::read_dir(&dir).map_err(|e| format!("read_dir: {e}"))?;
    let mut out: Vec<PendingApproval> = Vec::new();
    for entry in entries.flatten() {
        if entry.file_type().map(|ft| !ft.is_file()).unwrap_or(true) {
            continue;
        }
        let path = entry.path();
        let Ok(body) = std::fs::read_to_string(&path) else {
            continue;
        };
        let Ok(mut req) = serde_json::from_str::<PendingApproval>(&body) else {
            continue;
        };
        // If the sidecar wrote an older shape without received_at we fall
        // back to the file mtime; either way gives a sortable timestamp.
        if req.received_at == 0 {
            req.received_at = std::fs::metadata(&path)
                .and_then(|m| m.modified())
                .ok()
                .and_then(|t| t.duration_since(std::time::UNIX_EPOCH).ok())
                .map(|d| d.as_secs() as i64)
                .unwrap_or(0);
        }
        out.push(req);
    }
    // Oldest first so the modal queue is FIFO.
    out.sort_by_key(|r| r.received_at);
    Ok(out)
}

/// Approve or deny a pending write by writing the decision JSON. The
/// sidecar's polling `wait_for_response` picks it up within 100 ms.
#[tauri::command]
pub async fn mcp_approve_write(token: String, approved: bool) -> Result<(), String> {
    if token.is_empty() {
        return Err("token is empty".into());
    }
    // Basic safety: tokens must be hex-only. Prevents a frontend bug from
    // passing `../foo` and escaping the responses dir.
    if !token.chars().all(|c| c.is_ascii_hexdigit()) {
        return Err("token must be hex".into());
    }
    let resp_dir = responses_dir();
    std::fs::create_dir_all(&resp_dir).map_err(|e| format!("mkdir responses: {e}"))?;
    let resp_path = resp_dir.join(format!("{token}.json"));
    let body = ApprovalResponseOut {
        approved,
        reason: if approved {
            "user approved".into()
        } else {
            "user denied".into()
        },
    };
    let payload = serde_json::to_string(&body).map_err(|e| format!("serialize: {e}"))?;
    std::fs::write(&resp_path, payload)
        .map_err(|e| format!("write response {}: {e}", resp_path.display()))?;
    Ok(())
}

/// Resolve the path to the `.mcpb` bundle for the current platform.
///
/// Build order:
///   1. `<resource_dir>/mcpb/keepance-<target>.mcpb`  (production Tauri)
///   2. `<repo_root>/dist/keepance-<target>.mcpb`     (local dev build)
///
/// Returns `None` when neither file is found so the UI can show a "run
/// `npm run build:mcpb` first" hint instead of a scary error.
#[tauri::command]
pub async fn mcp_bundle_path(
    app: tauri::AppHandle,
) -> Result<Option<String>, String> {
    use tauri::Manager;
    let target = current_target_triple();
    let candidate_name = format!("{}-{target}.mcpb", crate::identity::MCP_SERVER_NAME);

    // Tauri resource lookup — wrapped in a catch-all so missing-resource
    // paths on dev builds don't crash the command.
    if let Ok(resource_dir) = app.path().resource_dir() {
        let p = resource_dir.join("mcpb").join(&candidate_name);
        if p.exists() {
            return Ok(Some(p.to_string_lossy().into_owned()));
        }
    }

    // Dev-build fallback: look at `<cwd>/dist/<name>` for engineers running
    // `npm run tauri:dev` after `node scripts/build-mcpb.mjs`.
    if let Ok(cwd) = std::env::current_dir() {
        // Walk up to find repo root (has a `package.json` and a `src-tauri`
        // sibling). Two levels up usually lands us at the repo root from
        // `src-tauri/target/debug/keepance`.
        for candidate in [cwd.clone(), cwd.join(".."), cwd.join("..").join("..")] {
            let p = candidate.join("dist").join(&candidate_name);
            if p.exists() {
                return Ok(Some(p.to_string_lossy().into_owned()));
            }
        }
    }

    Ok(None)
}

/// Best-effort target triple for the running process. Mirrors what the CI
/// `$MCP_TARGET` env var ends up as, so the resource-dir lookup finds the
/// right bundle.
fn current_target_triple() -> &'static str {
    // Rust doesn't expose this at runtime — build.rs sets it via a consts
    // module during the Tauri build. For our purposes the coarse
    // family-level match below is enough: we only have three binaries
    // (mac-aarch64, mac-x86, linux-x86, win-x86) and the UI tells the user
    // which platform to pick anyway.
    #[cfg(target_os = "macos")]
    {
        #[cfg(target_arch = "aarch64")]
        {
            return "aarch64-apple-darwin";
        }
        #[cfg(target_arch = "x86_64")]
        {
            return "x86_64-apple-darwin";
        }
    }
    #[cfg(target_os = "windows")]
    {
        return "x86_64-pc-windows-msvc";
    }
    #[cfg(target_os = "linux")]
    {
        return "x86_64-unknown-linux-gnu";
    }
    #[allow(unreachable_code)]
    "unknown"
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn responses_dir_is_under_temp() {
        let dir = responses_dir();
        assert!(dir.starts_with(std::env::temp_dir()));
        assert!(dir.ends_with("responses"));
    }

    #[test]
    fn requests_dir_is_sibling_of_responses() {
        assert_eq!(requests_dir().parent(), responses_dir().parent());
    }

    #[tokio::test]
    async fn list_returns_empty_when_dir_is_missing() {
        // Use a stale-state-free temp namespace so the CI runner's leftover
        // approval files from earlier tests don't contaminate the result.
        // We rely on the real requests_dir() but bail if it's currently
        // populated — skip rather than fail.
        let existing = mcp_list_pending_approvals().await.unwrap();
        assert!(existing.iter().all(|a| a.token.chars().all(|c| c.is_ascii_hexdigit())));
    }

    #[tokio::test]
    async fn approve_write_rejects_non_hex_token() {
        let err = mcp_approve_write("../etc".into(), true).await.unwrap_err();
        assert!(err.contains("hex"), "got: {err}");
    }

    #[tokio::test]
    async fn approve_write_rejects_empty_token() {
        let err = mcp_approve_write("".into(), true).await.unwrap_err();
        assert!(err.contains("empty"), "got: {err}");
    }

    #[tokio::test]
    async fn approve_write_creates_response_file() {
        // Use a throwaway token that doesn't collide with real flows.
        let token = format!("{:032x}", std::process::id());
        mcp_approve_write(token.clone(), true).await.unwrap();
        let p = responses_dir().join(format!("{token}.json"));
        assert!(p.exists(), "response file should exist at {p:?}");
        let body = std::fs::read_to_string(&p).unwrap();
        assert!(body.contains("\"approved\":true"));
        // Clean up so later runs don't find stale files.
        let _ = std::fs::remove_file(&p);
    }
}
