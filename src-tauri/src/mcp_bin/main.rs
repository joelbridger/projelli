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
//     prints a `lantern/approval_request` line to stderr, and polls for
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

/// The result of validating a caller-supplied workspace-relative path,
/// split into the two forms different callers need:
///
/// - `io_path`: the fully canonical, symlink-free, proven-contained path.
///   Use this for every ACTUAL disk operation (metadata/read/write/
///   create_dir_all). It's captured as an already-resolved absolute path
///   (not `workspace.join(relative)` re-derived lazily), so if `workspace`
///   itself is a symlink that later gets re-pointed to a different target,
///   disk I/O still lands on the location that was actually validated
///   rather than wherever the symlink now happens to point.
/// - `lexical_path`: the same target rooted at the caller's ORIGINAL
///   `workspace` spelling. `McpAccessState`'s matter `folder_paths` (and
///   audit/display paths) are lexical strings built from that same original
///   spelling — grant comparisons must use this form, not `io_path`, or a
///   workspace opened through a symlinked root would have every legitimate
///   grant compare as "outside the granted matter".
///
/// A caller with a long wait between validating and actually touching disk
/// (e.g. `write_workspace_file`'s human approval step) should call
/// `revalidate` immediately before the real filesystem call rather than
/// reusing an old `io_path` — that shrinks the window in which a path
/// component could be swapped for a symlink to the smallest practical gap.
/// Use `revalidate`, NOT a fresh `resolve_workspace_path(&ctx.workspace_root, ...)`
/// call: the latter re-canonicalizes `workspace` from scratch, so if the
/// WORKSPACE ROOT ITSELF is a symlink that gets re-pointed during the wait,
/// it would silently re-target the whole re-check (and the write that
/// follows) at wherever the root NOW points — a different location than
/// the one the grant decision and user approval were actually made for.
/// `revalidate` instead re-runs the no-follow walk against the SAME
/// canonical root captured at the original resolution, so a root re-point
/// can't redirect it; a symlink swapped in below that frozen root is still
/// caught, and if the frozen root's target no longer exists at all, the
/// walk simply fails closed.
#[derive(Debug)]
pub struct ResolvedWorkspacePath {
    pub io_path: PathBuf,
    pub lexical_path: PathBuf,
    canon_ws: PathBuf,
    lexical_root: PathBuf,
}

impl ResolvedWorkspacePath {
    /// Re-run the no-follow safety walk for `relative` against the SAME
    /// canonical root and original lexical root this was first resolved
    /// with. See the struct doc comment for why this must be used instead
    /// of calling `resolve_workspace_path` again when re-validating shortly
    /// before a real disk write.
    pub fn revalidate(&self, relative: &str) -> Result<ResolvedWorkspacePath, String> {
        resolve_against_root(&self.canon_ws, &self.lexical_root, relative)
    }
}

fn resolve_against_root(
    canon_ws: &Path,
    lexical_root: &Path,
    relative: &str,
) -> Result<ResolvedWorkspacePath, String> {
    let io_path = lantern_lib::commands::pathguard::resolve_creatable(canon_ws, relative, canon_ws)
        .map_err(|e| format!("path escapes workspace root: {relative} ({e})"))?;
    // Build `lexical_path` from the same NORMALIZED components `io_path`'s
    // walk used (skipping `.` segments), not a raw `lexical_root.join(relative)`
    // — a relative string like `./Clients/A/notes.md` or
    // `Clients/./A/notes.md` is valid and resolves fine, but joining it
    // verbatim would leave a literal `.` component in `lexical_path` that
    // `McpAccessState`'s grant comparison (a lexical string match against
    // matter `folder_paths`, which never contain `.` segments) would then
    // fail to match — denying access to an otherwise legitimately granted
    // file. `relative` is already proven `..`-free and absolute-free by
    // `resolve_workspace_path`'s scan before this is ever called, so only
    // `Component::Normal` segments can remain here.
    let mut lexical_path = lexical_root.to_path_buf();
    for component in Path::new(relative).components() {
        if let std::path::Component::Normal(seg) = component {
            lexical_path.push(seg);
        }
    }
    Ok(ResolvedWorkspacePath {
        io_path,
        lexical_path,
        canon_ws: canon_ws.to_path_buf(),
        lexical_root: lexical_root.to_path_buf(),
    })
}

/// Resolve a workspace-relative path, rejecting traversal attempts, absolute
/// paths, and symlinks escaping the workspace root.
pub fn resolve_workspace_path(workspace: &Path, relative: &str) -> Result<ResolvedWorkspacePath, String> {
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
    resolve_against_root(&canon_ws, workspace, relative)
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
        assert!(p.lexical_path.ends_with("notes.md"));
        assert!(p.io_path.ends_with("notes.md"));
    }

    /// A `.` segment inside an otherwise-legitimate relative path (e.g.
    /// `Clients/./A/notes.md`, which a client could produce via naive path
    /// joining) is harmless and must resolve — and `lexical_path` must come
    /// out with the `.` stripped, matching `io_path`'s own normalization,
    /// so a grant comparison against matter `folder_paths` (which never
    /// contain a literal `.` segment) still matches.
    #[test]
    fn lexical_path_strips_current_dir_segments_to_match_io_path_normalization() {
        let ws = tempfile::tempdir().unwrap();
        std::fs::create_dir_all(ws.path().join("Clients/A")).unwrap();
        std::fs::write(ws.path().join("Clients/A/notes.md"), b"hi").unwrap();

        let p = resolve_workspace_path(ws.path(), "Clients/./A/notes.md")
            .expect("a '.' segment must not block resolution");
        assert_eq!(p.lexical_path, ws.path().join("Clients/A/notes.md"));

        let p2 = resolve_workspace_path(ws.path(), "./Clients/A/notes.md")
            .expect("a leading './' must not block resolution");
        assert_eq!(p2.lexical_path, ws.path().join("Clients/A/notes.md"));
    }

    #[test]
    fn rejects_empty_path() {
        let ws = std::env::temp_dir();
        assert!(resolve_workspace_path(&ws, "").is_err());
    }

    #[test]
    fn rejects_lantern_internal_root_path() {
        let ws = std::env::temp_dir();
        let scope_path = format!("{}/mcp-session-scope.json", lantern_lib::identity::WORKSPACE_DATA_DIR);
        let err = resolve_workspace_path(&ws, &scope_path).unwrap_err();
        assert!(
            err.contains("App internal files are not exposed over MCP"),
            "got: {err}"
        );
    }

    #[test]
    fn rejects_lantern_internal_root_path_with_backslashes() {
        let ws = std::env::temp_dir();
        let scope_path = format!("{}\\mcp-session-scope.json", lantern_lib::identity::WORKSPACE_DATA_DIR);
        let err = resolve_workspace_path(&ws, &scope_path).unwrap_err();
        assert!(
            err.contains("App internal files are not exposed over MCP"),
            "got: {err}"
        );
    }

    #[test]
    fn rejects_lantern_internal_root_path_after_current_dir_segment() {
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
        assert!(p.lexical_path.ends_with("file.md"));
        assert!(p.io_path.ends_with("file.md"));
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

    /// When the WORKSPACE ROOT itself is opened through a symlink (a
    /// legitimate, unrelated-to-the-alias-attack setup — e.g. the app's
    /// workspace path lives on a symlinked mount), the resolved path must
    /// stay rooted at the caller's ORIGINAL workspace spelling, not silently
    /// switch to the canonical target. `McpAccessState::decide_path` compares
    /// the resolved path against matter `folder_paths` built from that same
    /// original spelling; returning a canonical-rooted path here would make
    /// every legitimate grant compare as "outside the granted matter" and
    /// break access for such a workspace — for both an existing file and a
    /// brand-new one.
    #[cfg(unix)]
    #[test]
    fn returns_path_rooted_at_original_workspace_spelling_when_root_itself_is_a_symlink() {
        let real = tempfile::tempdir().unwrap();
        std::fs::write(real.path().join("existing.md"), b"hi").unwrap();
        let parent = tempfile::tempdir().unwrap();
        let symlinked_root = parent.path().join("workspace-link");
        std::os::unix::fs::symlink(real.path(), &symlinked_root).unwrap();

        let p = resolve_workspace_path(&symlinked_root, "existing.md")
            .expect("existing file through a symlinked workspace root must resolve");
        assert!(
            p.lexical_path.starts_with(&symlinked_root),
            "lexical_path must stay rooted at the caller's original workspace spelling, got: {:?}", p.lexical_path
        );
        assert!(
            p.io_path.starts_with(real.path()),
            "io_path must be rooted at the resolved canonical target so a later re-pointed root symlink can't redirect a disk operation, got: {:?}", p.io_path
        );

        let p2 = resolve_workspace_path(&symlinked_root, "new-file.md")
            .expect("new file through a symlinked workspace root must resolve");
        assert!(
            p2.lexical_path.starts_with(&symlinked_root),
            "new-file lexical_path must also stay rooted at the original workspace spelling, got: {:?}", p2.lexical_path
        );
        assert!(
            p2.io_path.starts_with(real.path()),
            "new-file io_path must also be rooted at the canonical target, got: {:?}", p2.io_path
        );
    }

    /// If the WORKSPACE ROOT itself is a symlink and gets RE-POINTED to a
    /// different target after the first resolution (e.g. during
    /// `write_workspace_file`'s human approval wait), `revalidate` must
    /// keep re-checking against the ORIGINALLY-resolved canonical root, not
    /// silently follow the root to its new target. Calling
    /// `resolve_workspace_path(&workspace, ...)` again instead of
    /// `revalidate` would get this wrong — that's exactly the bug this
    /// method exists to prevent.
    #[cfg(unix)]
    #[test]
    fn revalidate_stays_pinned_to_the_original_root_even_if_the_root_symlink_is_repointed() {
        let real_a = tempfile::tempdir().unwrap();
        std::fs::write(real_a.path().join("file.md"), b"a").unwrap();
        let real_b = tempfile::tempdir().unwrap();
        std::fs::write(real_b.path().join("file.md"), b"b").unwrap();

        let parent = tempfile::tempdir().unwrap();
        let symlinked_root = parent.path().join("workspace-link");
        std::os::unix::fs::symlink(real_a.path(), &symlinked_root).unwrap();

        let first = resolve_workspace_path(&symlinked_root, "file.md")
            .expect("initial resolution through the symlinked root must succeed");
        assert!(first.io_path.starts_with(real_a.path()));

        // Re-point the root symlink to a DIFFERENT real target, simulating
        // an attacker (or unrelated process) acting during a long approval
        // wait between the initial resolution and the actual write.
        std::fs::remove_file(&symlinked_root).unwrap();
        std::os::unix::fs::symlink(real_b.path(), &symlinked_root).unwrap();

        let revalidated = first
            .revalidate("file.md")
            .expect("revalidate must still succeed against the frozen original root");
        assert!(
            revalidated.io_path.starts_with(real_a.path()),
            "revalidate must stay pinned to the ORIGINALLY resolved root (real_a), not follow the repointed symlink to real_b, got: {:?}",
            revalidated.io_path
        );
        assert!(
            !revalidated.io_path.starts_with(real_b.path()),
            "revalidate must NOT follow the root symlink to its new target"
        );

        // Sanity check: a FRESH resolve_workspace_path call (the wrong thing
        // to do here) WOULD follow the repointed symlink — demonstrating
        // why `revalidate` (not a fresh call) is required.
        let fresh = resolve_workspace_path(&symlinked_root, "file.md").unwrap();
        assert!(fresh.io_path.starts_with(real_b.path()));
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
        assert!(p.lexical_path.ends_with("Clients/RealClient/notes.md"));
        assert!(p.io_path.ends_with("Clients/RealClient/notes.md"));
    }
}
