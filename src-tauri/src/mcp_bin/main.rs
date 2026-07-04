// Advisor Prep Hero MCP server (M4, v1.5 Flag 2) — hand-rolled JSON-RPC 2.0 over stdio.
//
// Why hand-rolled instead of the `rmcp` crate:
//   - MCP's wire protocol is straightforward JSON-RPC 2.0 with a small handful
//     of required methods (`initialize`, `tools/list`, `tools/call`,
//     `notifications/*`). Wiring five tools takes less code than learning
//     rmcp's macro DSL, keeps our binary small (no extra transitive deps),
//     and leaves the tests plain-Rust rather than macro-heavy.
//   - rmcp pulls `schemars` + `tokio-util` + `pastey` + a dozen proc-macros
//     we don't need anywhere else in the host crate. Hand-rolling keeps the
//     `lantern-mcp` release binary small (under 10 MiB stripped) so the
//     .mcpb bundle stays a friendly download.
//   - A plain stdio JSON-RPC loop is trivial to exercise in the integration
//     test (spawn child, write JSON, read lines) — no SDK harness needed.
//
// Approval channel (see `approval.rs` for the full design):
//   - `write_workspace_file` with `require_confirmation = true` writes a JSON
//     blob to a platform temp directory (`approval-requests/<token>.json`),
//     prints a `keepance/approval_request` line to stderr, and polls for
//     `approval-responses/<token>.json` for up to 60s.
//   - The Advisor Prep Hero desktop app launches the binary as a child, reads stderr
//     line-by-line, shows the approval modal, then drops the decision file.
//
// Protocol version: we advertise `2025-03-26` in the initialize handshake,
// which is the stable spec release current Claude Desktop clients speak.

#![allow(clippy::too_many_arguments)]

use serde_json::{json, Value};
use std::io::{BufRead, BufReader, Write};
use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};

// Reuse the pure sub-modules of the main Tauri crate so the binary and the
// host app share one implementation of the vector store + embedder + file
// extractor. See `src-tauri/src/lib.rs` — `commands` is `pub` for this reason.
use lantern_lib::commands::rag::{crypto, embedder, extractor, store};

mod access;
mod approval;
mod audit;
mod protocol;
mod tools;

use protocol::{
    JsonRpcError, JsonRpcRequest, JsonRpcResponse, ERROR_INTERNAL, ERROR_INVALID_PARAMS,
    ERROR_METHOD_NOT_FOUND,
};

/// Advertised MCP protocol version. The spec lets servers pick the highest
/// version they understand; Claude Desktop (April 2026) speaks this one.
pub const MCP_PROTOCOL_VERSION: &str = "2025-03-26";

/// Server name advertised in `initialize` and the `.mcpb` manifest.
pub const SERVER_NAME: &str = lantern_lib::identity::MCP_SERVER_NAME;

/// Short human description shown in clients' tool pickers.
pub const SERVER_DESCRIPTION: &str =
    "Read your Advisor Prep Hero workspace (files + memory + semantic search) from any MCP client.";

/// Workspace root is supplied by the parent process (the Advisor Prep Hero app or a
/// directly-invoked Claude Desktop install) via this env var. Stored in the
/// .mcpb manifest so clients prompt the user for it at install time.
pub const WORKSPACE_ENV: &str = "LANTERN_WORKSPACE_ROOT";

/// Shared immutable context handed to every tool call.
#[derive(Clone)]
pub struct ServerCtx {
    pub workspace_root: PathBuf,
    pub approval_dir: PathBuf,
    /// Stderr writer wrapped in `Arc<Mutex>` so multiple async branches can
    /// emit approval notifications without interleaving partial lines.
    pub stderr: Arc<Mutex<Box<dyn Write + Send>>>,
}

impl ServerCtx {
    /// Resolve the workspace path from the env var. Validation keeps the
    /// failure surface small — the parent process is responsible for passing
    /// an existing absolute path, but we still guard against typos so
    /// `tools/list` can succeed on a misconfigured install.
    pub fn from_env() -> Result<Self, String> {
        let raw = std::env::var(WORKSPACE_ENV).map_err(|_| {
            format!("{WORKSPACE_ENV} not set — parent process must provide the workspace path")
        })?;
        if raw.trim().is_empty() {
            return Err(format!("{WORKSPACE_ENV} is empty"));
        }
        let workspace_root = PathBuf::from(raw);
        if !workspace_root.exists() {
            return Err(format!(
                "{WORKSPACE_ENV} path does not exist: {}",
                workspace_root.display()
            ));
        }
        let approval_dir = approval::approval_base_dir();
        std::fs::create_dir_all(approval_dir.join("requests")).ok();
        std::fs::create_dir_all(approval_dir.join("responses")).ok();
        Ok(Self {
            workspace_root,
            approval_dir,
            stderr: Arc::new(Mutex::new(Box::new(std::io::stderr()))),
        })
    }
}

fn main() {
    // Load workspace context. If it's missing we still serve `initialize`
    // and `tools/list` (with a warning on stderr) so clients can at least
    // diagnose the misconfiguration; tool calls that need the workspace
    // return a clean error with remediation text.
    let ctx = match ServerCtx::from_env() {
        Ok(c) => Some(c),
        Err(e) => {
            eprintln!("{}: {e}", lantern_lib::identity::MCP_APPROVAL_TEMP_PREFIX);
            None
        }
    };

    let stdin = std::io::stdin();
    let mut stdout = std::io::stdout();
    let reader = BufReader::new(stdin.lock());

    // Tokio runtime for the async tool bodies (store queries are async).
    // A single-threaded rt is plenty — MCP clients drive one request at a
    // time and we'd rather keep memory overhead low inside the binary.
    let rt = tokio::runtime::Builder::new_current_thread()
        .enable_all()
        .build()
        .expect("failed to build tokio current-thread runtime");

    for line in reader.lines() {
        let line = match line {
            Ok(l) => l,
            Err(e) => {
                eprintln!("{}: stdin read error: {e}", lantern_lib::identity::MCP_APPROVAL_TEMP_PREFIX);
                break;
            }
        };
        if line.trim().is_empty() {
            continue;
        }
        // Parse as JSON-RPC request (or notification).
        let req: JsonRpcRequest = match serde_json::from_str(&line) {
            Ok(r) => r,
            Err(e) => {
                let err = JsonRpcResponse::error(
                    Value::Null,
                    protocol::ERROR_PARSE,
                    format!("parse error: {e}"),
                );
                write_response(&mut stdout, &err);
                continue;
            }
        };

        // Notifications (no id) get no response. MCP ships a few — we ack
        // them silently because none require host-side state updates today.
        let is_notification = req.id.is_none();

        let response = rt.block_on(dispatch(&req, ctx.as_ref()));

        if !is_notification {
            if let Some(resp) = response {
                write_response(&mut stdout, &resp);
            }
        }
    }
}

fn write_response(out: &mut impl Write, resp: &JsonRpcResponse) {
    match serde_json::to_string(resp) {
        Ok(s) => {
            if let Err(e) = writeln!(out, "{s}") {
                eprintln!("{}: stdout write error: {e}", lantern_lib::identity::MCP_APPROVAL_TEMP_PREFIX);
            }
            let _ = out.flush();
        }
        Err(e) => eprintln!("{}: serialize error: {e}", lantern_lib::identity::MCP_APPROVAL_TEMP_PREFIX),
    }
}

/// Dispatch a single request to the right handler. Returns `None` for
/// notifications (which never produce a response).
async fn dispatch(req: &JsonRpcRequest, ctx: Option<&ServerCtx>) -> Option<JsonRpcResponse> {
    let id = req.id.clone().unwrap_or(Value::Null);
    match req.method.as_str() {
        "initialize" => Some(handle_initialize(id)),
        "initialized" | "notifications/initialized" => None, // notification
        "ping" => Some(JsonRpcResponse::ok(id, json!({}))),
        "tools/list" => Some(handle_tools_list(id)),
        "tools/call" => match ctx {
            Some(c) => Some(handle_tools_call(id, req.params.as_ref(), c).await),
            None => Some(JsonRpcResponse::error(
                id,
                ERROR_INTERNAL,
                format!("{WORKSPACE_ENV} is not configured — restart Advisor Prep Hero and try again"),
            )),
        },
        // `notifications/cancelled`, `logging/setLevel`, etc. — swallow quietly.
        other if other.starts_with("notifications/") => None,
        _ => Some(JsonRpcResponse::error(
            id,
            ERROR_METHOD_NOT_FOUND,
            format!("method not supported: {}", req.method),
        )),
    }
}

fn handle_initialize(id: Value) -> JsonRpcResponse {
    JsonRpcResponse::ok(
        id,
        json!({
            "protocolVersion": MCP_PROTOCOL_VERSION,
            "capabilities": {
                "tools": { "listChanged": false }
            },
            "serverInfo": {
                "name": SERVER_NAME,
                "version": env!("CARGO_PKG_VERSION"),
                "description": SERVER_DESCRIPTION
            }
        }),
    )
}

fn handle_tools_list(id: Value) -> JsonRpcResponse {
    JsonRpcResponse::ok(id, json!({ "tools": tools::describe_tools() }))
}

async fn handle_tools_call(id: Value, params: Option<&Value>, ctx: &ServerCtx) -> JsonRpcResponse {
    let params = match params {
        Some(p) => p,
        None => {
            return JsonRpcResponse::error(id, ERROR_INVALID_PARAMS, "tools/call requires params");
        }
    };
    let name = match params.get("name").and_then(|v| v.as_str()) {
        Some(n) => n,
        None => {
            return JsonRpcResponse::error(
                id,
                ERROR_INVALID_PARAMS,
                "tools/call: missing tool `name`",
            );
        }
    };
    let arguments = params.get("arguments").cloned().unwrap_or(json!({}));

    let result = match name {
        "list_workspace_files" => tools::list_workspace_files(ctx, arguments).await,
        "read_workspace_file" => tools::read_workspace_file(ctx, arguments).await,
        "search_workspace" => tools::search_workspace(ctx, arguments).await,
        "write_workspace_file" => tools::write_workspace_file(ctx, arguments).await,
        "get_memory_facts" => tools::get_memory_facts(ctx, arguments).await,
        other => Err(JsonRpcError::method_not_found(format!(
            "unknown tool: {other}"
        ))),
    };

    match result {
        Ok(content) => JsonRpcResponse::ok(
            id,
            json!({
                "content": content,
                "isError": false
            }),
        ),
        Err(e) => {
            // MCP convention: tool errors return ok() with isError: true so
            // the LLM sees the error text as a tool result rather than
            // hitting the JSON-RPC error path (which aborts the whole call).
            // Protocol-level failures (invalid params, method not found)
            // do use the error path via the `code` inspection below.
            if e.code == ERROR_INVALID_PARAMS || e.code == ERROR_METHOD_NOT_FOUND {
                return JsonRpcResponse::error(id, e.code, e.message);
            }
            JsonRpcResponse::ok(
                id,
                json!({
                    "content": [text_content(&format!("Error: {}", e.message))],
                    "isError": true
                }),
            )
        }
    }
}

/// Build a `text` content block per the MCP tool-result schema.
pub fn text_content(text: &str) -> Value {
    json!({ "type": "text", "text": text })
}

// ---------------------------------------------------------------------------
// Path safety — shared between the tool fns and the unit tests.
// ---------------------------------------------------------------------------

/// Resolve a workspace-relative path, rejecting traversal attempts, absolute
/// paths, and symlinks escaping the workspace root.
///
/// Returns the canonicalised absolute path inside the workspace (when the
/// file exists) or the lexical join (when it doesn't — for new-file writes).
pub fn resolve_workspace_path(workspace: &Path, relative: &str) -> Result<PathBuf, String> {
    if relative.is_empty() {
        return Err("path is empty".into());
    }
    // Absolute paths are always rejected — MCP clients receive workspace-
    // relative paths from `list_workspace_files` and should echo them back.
    // Windows absolute detection (drive letter + colon) as well as POSIX.
    let looks_absolute = relative.starts_with('/')
        || relative.starts_with('\\')
        || (relative.len() >= 2
            && relative.as_bytes()[1] == b':'
            && relative.as_bytes()[0].is_ascii_alphabetic());
    if looks_absolute {
        return Err(format!("absolute paths are not allowed: {relative}"));
    }
    // Block traversal components pre-join for clarity. Canonicalize at the
    // end too so symlinks can't escape.
    let mut saw_path_segment = false;
    for part in relative.split(['/', '\\']) {
        if part.is_empty() || part == "." {
            continue;
        }
        if !saw_path_segment && lantern_lib::commands::data_dir::is_workspace_data_dir_name(part) {
            return Err("App internal files are not exposed over MCP".into());
        }
        saw_path_segment = true;
        if part == ".." {
            return Err(format!("path escapes workspace root: {relative}"));
        }
    }
    // Walk `relative` component-by-component from the canonical workspace
    // root, refusing outright the moment any component — intermediate
    // directory or final target — is a symlink (checked via
    // `symlink_metadata`, which never follows). The prior implementation
    // canonicalized the full joined path and, when that failed (a new-file
    // write), fell back to canonicalizing the nearest EXISTING ancestor —
    // both FOLLOW symlinks, so an in-workspace alias directory
    // (`Clients/Alias` -> `Clients/RealClient`) would pass the
    // `starts_with` check and let `read_workspace_file`/`write_workspace_file`
    // touch a different client's files. See `crate::commands::pathguard`
    // (shared with the vault and diarize command sites) for the no-follow
    // walk, and `resolve_creatable` specifically for its "missing tail is
    // fine, symlinked component is not" semantics that new-file writes need.
    let canon_ws = workspace
        .canonicalize()
        .map_err(|_| "workspace root cannot be canonicalised".to_string())?;
    lantern_lib::commands::pathguard::resolve_creatable(&canon_ws, relative, &canon_ws)
        .map_err(|e| format!("path escapes workspace root: {relative} ({e})"))
}

// Keep the embedder / store / extractor references alive so the compiler
// doesn't drop them when the tool bodies use `use super::*;` to reach them.
// Cheap const fn so it also double-checks they compile.
#[allow(dead_code)]
fn _assert_rag_imports_wire_up() {
    let _: fn(&Path) -> bool = extractor::is_indexable;
    let _: usize = embedder::EMBEDDING_DIM;
    let _: &str = store::TABLE_NAME;
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn rejects_absolute_posix_path() {
        let ws = std::env::temp_dir();
        let err = resolve_workspace_path(&ws, "/etc/passwd").unwrap_err();
        assert!(err.contains("absolute"), "got: {err}");
    }

    #[test]
    fn rejects_absolute_windows_path() {
        let ws = std::env::temp_dir();
        let err = resolve_workspace_path(&ws, "C:\\Users\\x").unwrap_err();
        assert!(err.contains("absolute"), "got: {err}");
    }

    #[test]
    fn rejects_traversal_dotdot() {
        let ws = std::env::temp_dir();
        let err = resolve_workspace_path(&ws, "../../etc/passwd").unwrap_err();
        assert!(err.contains("escapes"), "got: {err}");
    }

    #[test]
    fn rejects_nested_traversal() {
        let ws = std::env::temp_dir();
        let err = resolve_workspace_path(&ws, "a/b/../../../../etc/passwd").unwrap_err();
        assert!(
            err.contains("escapes") || err.contains("absolute"),
            "got: {err}"
        );
    }

    #[test]
    fn accepts_simple_relative_path() {
        let ws = std::env::temp_dir();
        let p = resolve_workspace_path(&ws, "notes.md").expect("should resolve");
        assert!(p.ends_with("notes.md"));
    }

    #[test]
    fn rejects_empty_path() {
        let ws = std::env::temp_dir();
        assert!(resolve_workspace_path(&ws, "").is_err());
    }

    #[test]
    fn rejects_keepance_internal_root_path() {
        let ws = std::env::temp_dir();
        let scope_path = format!("{}/mcp-session-scope.json", lantern_lib::identity::WORKSPACE_DATA_DIR);
        let err = resolve_workspace_path(&ws, &scope_path).unwrap_err();
        assert!(
            err.contains("App internal files are not exposed over MCP"),
            "got: {err}"
        );
    }

    #[test]
    fn rejects_keepance_internal_root_path_with_backslashes() {
        let ws = std::env::temp_dir();
        let scope_path = format!("{}\\mcp-session-scope.json", lantern_lib::identity::WORKSPACE_DATA_DIR);
        let err = resolve_workspace_path(&ws, &scope_path).unwrap_err();
        assert!(
            err.contains("App internal files are not exposed over MCP"),
            "got: {err}"
        );
    }

    #[test]
    fn rejects_keepance_internal_root_path_after_current_dir_segment() {
        let ws = std::env::temp_dir();
        let scope_path = format!("./{}/mcp-session-scope.json", lantern_lib::identity::WORKSPACE_DATA_DIR);
        let err = resolve_workspace_path(&ws, &scope_path).unwrap_err();
        assert!(
            err.contains("App internal files are not exposed over MCP"),
            "got: {err}"
        );
    }

    #[test]
    fn accepts_nested_subdir_path() {
        let ws = std::env::temp_dir();
        let p = resolve_workspace_path(&ws, "sub/dir/file.md").expect("nested should resolve");
        assert!(p.ends_with("file.md"));
    }

    #[test]
    fn server_name_matches_manifest() {
        assert_eq!(SERVER_NAME, lantern_lib::identity::MCP_SERVER_NAME);
    }

    #[test]
    fn backslash_traversal_blocked() {
        let ws = std::env::temp_dir();
        let err = resolve_workspace_path(&ws, "a\\..\\..\\secrets.txt").unwrap_err();
        assert!(
            err.contains("escapes") || err.contains("absolute"),
            "got: {err}"
        );
    }

    /// An IN-WORKSPACE alias (`Clients/Alias` -> `Clients/RealClient`, both
    /// inside the workspace) must be rejected for a READ through it — the
    /// old canonicalize+starts_with fallback would FOLLOW the alias and
    /// accept it since RealClient is also inside the workspace.
    #[cfg(unix)]
    #[test]
    fn rejects_read_through_in_workspace_alias_symlink() {
        let ws = tempfile::tempdir().unwrap();
        let real = ws.path().join("Clients/RealClient");
        std::fs::create_dir_all(&real).unwrap();
        std::fs::write(real.join("secret.docx"), b"real client secret").unwrap();
        let alias = ws.path().join("Clients/Alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();

        let err = resolve_workspace_path(ws.path(), "Clients/Alias/secret.docx").unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

    /// Same alias attack for a WRITE of a NEW file (doesn't exist yet) —
    /// exercises the "missing tail is fine, symlinked component is not"
    /// path specifically, since new-file writes are exactly the case that
    /// falls through to the "doesn't exist" branch.
    #[cfg(unix)]
    #[test]
    fn rejects_write_through_in_workspace_alias_symlink() {
        let ws = tempfile::tempdir().unwrap();
        let real = ws.path().join("Clients/RealClient");
        std::fs::create_dir_all(&real).unwrap();
        let alias = ws.path().join("Clients/Alias");
        std::os::unix::fs::symlink(&real, &alias).unwrap();

        let err = resolve_workspace_path(ws.path(), "Clients/Alias/new-file.docx").unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

    /// An out-of-workspace symlink must still be rejected (regression guard
    /// for the previous behavior, now caught earlier — at the symlink
    /// component itself rather than only after following it).
    #[cfg(unix)]
    #[test]
    fn rejects_out_of_workspace_symlink() {
        let ws = tempfile::tempdir().unwrap();
        let outside = tempfile::tempdir().unwrap();
        std::fs::write(outside.path().join("secret.txt"), b"secret").unwrap();
        std::os::unix::fs::symlink(outside.path(), ws.path().join("escape")).unwrap();

        let err = resolve_workspace_path(ws.path(), "escape/secret.txt").unwrap_err();
        assert!(err.contains("symlink"), "got: {err}");
    }

    /// A normal nested path with no symlinks anywhere must still resolve —
    /// regression guard alongside `accepts_nested_subdir_path` (which
    /// covers the fully-missing case) for the fully-EXISTING case.
    #[test]
    fn accepts_existing_nested_path_with_no_symlinks() {
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("Clients/RealClient")).unwrap();
        std::fs::write(ws.path().join("Clients/RealClient/notes.md"), b"hi").unwrap();
        let p = resolve_workspace_path(ws.path(), "Clients/RealClient/notes.md")
            .expect("legitimate nested path must resolve");
        assert!(p.ends_with("Clients/RealClient/notes.md"));
    }
}
