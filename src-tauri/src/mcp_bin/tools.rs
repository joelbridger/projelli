// MCP tool implementations.
//
// Every tool returns `Result<Vec<Value>, JsonRpcError>` where the Ok value is
// a list of MCP content blocks (`{ "type": "text", "text": "..." }`). The
// dispatcher in `main.rs` wraps that list into the `tools/call` response
// envelope (adds `isError: false`).
//
// Design notes:
//   - Tool schemas are hand-written inline rather than derived from
//     `schemars`. Five tools is tractable and the schemas are stable.
//   - Argument parsing is defensive: missing keys, wrong types, and empty
//     strings all return `ERROR_INVALID_PARAMS` with a friendly message.
//   - Path safety is centralised in `resolve_workspace_path` — every tool
//     that takes a `path` argument routes through it.
//   - The search tool opens LanceDB **read-only** (lancedb::connect + our
//     `store::nearest` helper; LanceDB supports multi-process read
//     concurrency, so the app indexing and the MCP reading never race).

use super::approval::{self, APPROVAL_MARKER};
use super::protocol::JsonRpcError;
use super::{embedder, extractor, resolve_workspace_path, store, ServerCtx};
use serde_json::{json, Value};
use std::path::Path;

/// Build the `tools/list` response array.
pub fn describe_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "list_workspace_files",
            "description": "List all files in the user's Keepance workspace. Optionally filter by a glob pattern like '**/*.md'. Returns workspace-relative paths.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "pattern": {
                        "type": "string",
                        "description": "Optional glob pattern (e.g. '**/*.md'). When omitted, lists every text file."
                    }
                }
            }
        }),
        json!({
            "name": "read_workspace_file",
            "description": "Read a file from the user's Keepance workspace. Path must be workspace-relative; absolute paths and '..' traversal are rejected.",
            "inputSchema": {
                "type": "object",
                "required": ["path"],
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path like 'notes/planning.md'."
                    }
                }
            }
        }),
        json!({
            "name": "search_workspace",
            "description": "Semantic search across the user's Keepance workspace using the same local embedding model the app uses for @workspace queries. Returns the top-k most relevant paragraphs with their source paths.",
            "inputSchema": {
                "type": "object",
                "required": ["query"],
                "properties": {
                    "query": {
                        "type": "string",
                        "description": "Natural-language search query."
                    },
                    "top_k": {
                        "type": "integer",
                        "description": "Maximum number of paragraphs to return. Defaults to 8.",
                        "minimum": 1,
                        "maximum": 50
                    }
                }
            }
        }),
        json!({
            "name": "write_workspace_file",
            "description": "Write (or overwrite) a file in the user's Keepance workspace. By default the user is prompted to approve the write — pass `require_confirmation: false` to skip the prompt (not recommended).",
            "inputSchema": {
                "type": "object",
                "required": ["path", "content"],
                "properties": {
                    "path": {
                        "type": "string",
                        "description": "Workspace-relative path. Parent directories are created automatically."
                    },
                    "content": {
                        "type": "string",
                        "description": "New file contents."
                    },
                    "require_confirmation": {
                        "type": "boolean",
                        "description": "Show the user an approval modal before writing. Defaults to true.",
                        "default": true
                    }
                }
            }
        }),
        json!({
            "name": "get_memory_facts",
            "description": "Return the user's durable memory facts stored in '.keepance/memory.json'. These are short, user-approved statements the AI is meant to always know.",
            "inputSchema": {
                "type": "object",
                "properties": {}
            }
        }),
    ]
}

// ---------------------------------------------------------------------------
// list_workspace_files
// ---------------------------------------------------------------------------

pub async fn list_workspace_files(
    ctx: &ServerCtx,
    args: Value,
) -> Result<Vec<Value>, JsonRpcError> {
    let pattern = args.get("pattern").and_then(|v| v.as_str()).map(str::to_string);

    let files = collect_workspace_files(&ctx.workspace_root);
    let filtered: Vec<String> = match pattern {
        Some(p) if !p.trim().is_empty() => {
            files
                .into_iter()
                .filter(|rel| glob_match(&p, rel))
                .collect()
        }
        _ => files,
    };

    let mut lines = String::with_capacity(filtered.len() * 32);
    if filtered.is_empty() {
        lines.push_str("(no matching files)");
    } else {
        for rel in &filtered {
            lines.push_str(rel);
            lines.push('\n');
        }
    }

    Ok(vec![super::text_content(&lines)])
}

/// Walk the workspace and return every indexable-or-readable relative path.
/// Unlike the RAG walker, we include ALL files the user can read (not just
/// text extensions) because an MCP client might legitimately want to see
/// `.pdf` or `.png` filenames even if we won't return their contents.
fn collect_workspace_files(workspace: &Path) -> Vec<String> {
    let mut out: Vec<String> = walkdir::WalkDir::new(workspace)
        .follow_links(false)
        .into_iter()
        .filter_entry(|e| {
            let name = e.file_name().to_string_lossy();
            !extractor::is_skipped_dir_name(&name)
        })
        .filter_map(|res| res.ok())
        .filter(|e| e.file_type().is_file())
        .filter_map(|e| {
            let rel = e.path().strip_prefix(workspace).ok()?;
            Some(rel.to_string_lossy().replace('\\', "/"))
        })
        .collect();
    out.sort();
    out
}

/// Tiny glob matcher — supports `*` and `**` only. Good enough for the
/// common patterns (`**/*.md`, `notes/*`, `*.txt`). Anything more exotic and
/// the user should read the list unfiltered and filter client-side.
pub fn glob_match(pattern: &str, path: &str) -> bool {
    // Convert the glob to a regex-ish matcher. Avoids pulling in `glob` or
    // `globset` for such a small surface.
    fn matches(pattern: &[u8], path: &[u8]) -> bool {
        let mut pi = 0;
        let mut si = 0;
        let mut star_p: Option<usize> = None;
        let mut star_s: usize = 0;
        while si < path.len() {
            if pi < pattern.len() {
                let pb = pattern[pi];
                if pb == b'*' {
                    // Double-star `**` matches any number of path components
                    // including slashes; single `*` matches within one
                    // segment only.
                    let double = pi + 1 < pattern.len() && pattern[pi + 1] == b'*';
                    if double {
                        pi += 2;
                        // Eat an optional `/` after `**` to treat `**/foo`
                        // the same as `**foo` (standard glob behavior).
                        if pi < pattern.len() && pattern[pi] == b'/' {
                            pi += 1;
                        }
                        // If `**` is at the end, the rest of the path is fine.
                        if pi == pattern.len() {
                            return true;
                        }
                        star_p = Some(pi);
                        star_s = si;
                        continue;
                    }
                    pi += 1;
                    star_p = Some(pi);
                    star_s = si;
                    continue;
                }
                if pb == b'?' || pb == path[si] {
                    pi += 1;
                    si += 1;
                    continue;
                }
            }
            if let Some(sp) = star_p {
                pi = sp;
                star_s += 1;
                si = star_s;
            } else {
                return false;
            }
        }
        while pi < pattern.len() && pattern[pi] == b'*' {
            pi += 1;
            if pi < pattern.len() && pattern[pi] == b'*' {
                pi += 1;
            }
        }
        pi == pattern.len()
    }
    matches(pattern.as_bytes(), path.as_bytes())
}

// ---------------------------------------------------------------------------
// read_workspace_file
// ---------------------------------------------------------------------------

pub async fn read_workspace_file(
    ctx: &ServerCtx,
    args: Value,
) -> Result<Vec<Value>, JsonRpcError> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError::invalid_params("missing required argument: path"))?;

    let abs = resolve_workspace_path(&ctx.workspace_root, path)
        .map_err(JsonRpcError::invalid_params)?;

    if !abs.exists() {
        return Err(JsonRpcError::internal(format!(
            "file does not exist: {path}"
        )));
    }
    if !abs.is_file() {
        return Err(JsonRpcError::internal(format!(
            "path is not a file: {path}"
        )));
    }
    // Hard cap on file size so a client can't coerce us into slurping a
    // gigabyte-long binary. Matches the RAG extractor's 5 MiB limit.
    let meta = std::fs::metadata(&abs)
        .map_err(|e| JsonRpcError::internal(format!("stat failed: {e}")))?;
    if meta.len() > extractor::MAX_FILE_BYTES {
        return Err(JsonRpcError::internal(format!(
            "file too large ({} bytes) — max is {} bytes",
            meta.len(),
            extractor::MAX_FILE_BYTES
        )));
    }
    let text = std::fs::read_to_string(&abs)
        .map_err(|e| JsonRpcError::internal(format!("read failed: {e}")))?;

    Ok(vec![super::text_content(&text)])
}

// ---------------------------------------------------------------------------
// search_workspace
// ---------------------------------------------------------------------------

pub async fn search_workspace(ctx: &ServerCtx, args: Value) -> Result<Vec<Value>, JsonRpcError> {
    let query = args
        .get("query")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError::invalid_params("missing required argument: query"))?;
    if query.trim().is_empty() {
        return Err(JsonRpcError::invalid_params("query is empty"));
    }
    let top_k = args
        .get("top_k")
        .and_then(|v| v.as_u64())
        .map(|v| v.clamp(1, 50) as usize)
        .unwrap_or(8);

    let conn = store::open_connection(&ctx.workspace_root)
        .await
        .map_err(|e| JsonRpcError::internal(format!("open lancedb: {e}")))?;
    let names = conn
        .table_names()
        .execute()
        .await
        .map_err(|e| JsonRpcError::internal(format!("list tables: {e}")))?;
    if !names.iter().any(|n| n == store::TABLE_NAME) {
        return Ok(vec![super::text_content(
            "Workspace hasn't been indexed yet. Open the workspace in Keepance to build the index.",
        )]);
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| JsonRpcError::internal(format!("open table: {e}")))?;

    let qvec = embedder::embed_query(query)
        .await
        .map_err(|e| JsonRpcError::internal(format!("embed query: {e}")))?;
    // WS-B/C: the MCP server is the read-only workspace-search surface exposed to
    // external MCP clients; matter scoping is an in-app (Tauri) concept and the
    // client/matter UI is a separate task. Pass `None` (no matter prefilter) to
    // preserve the existing whole-workspace search behaviour here. When matter
    // scoping is surfaced to MCP clients, thread a `RetrievalScope` through.
    //
    // WS-PRIV: privileged content must NEVER leak to an external MCP client.
    // `include_privileged = false` here, and there is intentionally NO way for an
    // MCP client to flip it — the "include privileged" capability is an in-app,
    // user-initiated decision only.
    let raw = store::nearest(&table, &qvec, top_k, None, false)
        .await
        .map_err(|e| JsonRpcError::internal(format!("nearest: {e}")))?;

    if raw.is_empty() {
        return Ok(vec![super::text_content("(no results)")]);
    }

    let mut buf = String::new();
    for (i, hit) in raw.iter().enumerate() {
        let score = embedder::cosine_distance_to_score(hit.distance);
        let rel_path = hit
            .path
            .strip_prefix(ctx.workspace_root.to_string_lossy().as_ref())
            .unwrap_or(&hit.path)
            .trim_start_matches(['/', '\\']);
        buf.push_str(&format!(
            "[{}] {} (score {:.2}, paragraph {})\n",
            i + 1,
            rel_path,
            score,
            hit.paragraph_index
        ));
        buf.push_str(&hit.text);
        buf.push_str("\n\n");
    }
    Ok(vec![super::text_content(buf.trim_end())])
}

// ---------------------------------------------------------------------------
// write_workspace_file
// ---------------------------------------------------------------------------

pub async fn write_workspace_file(
    ctx: &ServerCtx,
    args: Value,
) -> Result<Vec<Value>, JsonRpcError> {
    let path = args
        .get("path")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError::invalid_params("missing required argument: path"))?;
    let content = args
        .get("content")
        .and_then(|v| v.as_str())
        .ok_or_else(|| JsonRpcError::invalid_params("missing required argument: content"))?;
    let require_confirmation = args
        .get("require_confirmation")
        .and_then(|v| v.as_bool())
        .unwrap_or(true);

    let abs = resolve_workspace_path(&ctx.workspace_root, path)
        .map_err(JsonRpcError::invalid_params)?;

    if require_confirmation {
        let token = approval::generate_token();
        let old_content: Option<String> = if abs.exists() {
            std::fs::read_to_string(&abs).ok()
        } else {
            None
        };
        let request = approval::build_request(
            token.clone(),
            path.to_string(),
            content,
            old_content.as_deref(),
        );
        let request_json = serde_json::to_string(&request)
            .map_err(|e| JsonRpcError::internal(format!("serialize approval: {e}")))?;

        std::fs::create_dir_all(ctx.approval_dir.join("requests"))
            .map_err(|e| JsonRpcError::internal(format!("mkdir approval: {e}")))?;
        std::fs::write(
            approval::request_path(&ctx.approval_dir, &token),
            &request_json,
        )
        .map_err(|e| JsonRpcError::internal(format!("write approval request: {e}")))?;

        // Emit the stderr marker. One JSON object per line keeps the parent
        // parser simple. We don't panic if the writer is closed — the user
        // just won't see a modal and the tool will time out.
        let marker_line = serde_json::json!({
            APPROVAL_MARKER: {
                "token": token,
                "path": path,
            }
        })
        .to_string();
        if let Ok(mut w) = ctx.stderr.lock() {
            let _ = writeln!(w, "{marker_line}");
            let _ = w.flush();
        }

        match approval::wait_for_response(&ctx.approval_dir, &token) {
            Ok(true) => {
                // approved — fall through to write
            }
            Ok(false) => {
                return Err(JsonRpcError::internal("user denied the write".to_string()));
            }
            Err(e) => {
                return Err(JsonRpcError::internal(format!(
                    "approval channel failed: {e}"
                )));
            }
        }
    }

    // Ensure parent dir exists.
    if let Some(parent) = abs.parent() {
        std::fs::create_dir_all(parent)
            .map_err(|e| JsonRpcError::internal(format!("mkdir parent: {e}")))?;
    }
    std::fs::write(&abs, content)
        .map_err(|e| JsonRpcError::internal(format!("write failed: {e}")))?;

    Ok(vec![super::text_content(&format!(
        "Wrote {} bytes to {}",
        content.len(),
        path
    ))])
}

// Needed inside `write_workspace_file` when we reach for `writeln!`.
use std::io::Write;

// ---------------------------------------------------------------------------
// get_memory_facts
// ---------------------------------------------------------------------------

pub async fn get_memory_facts(ctx: &ServerCtx, _args: Value) -> Result<Vec<Value>, JsonRpcError> {
    let facts_path = ctx.workspace_root.join(".keepance").join("memory.json");
    if !facts_path.exists() {
        return Ok(vec![super::text_content(
            "(no memory facts — the user hasn't approved any yet)",
        )]);
    }
    let raw = std::fs::read_to_string(&facts_path)
        .map_err(|e| JsonRpcError::internal(format!("read memory.json: {e}")))?;
    let parsed: serde_json::Value = serde_json::from_str(&raw)
        .map_err(|e| JsonRpcError::internal(format!("parse memory.json: {e}")))?;
    let facts = parsed
        .get("facts")
        .and_then(|v| v.as_array())
        .cloned()
        .unwrap_or_default();
    if facts.is_empty() {
        return Ok(vec![super::text_content("(no memory facts saved yet)")]);
    }
    let mut buf = String::from("Memory facts:\n");
    for (i, f) in facts.iter().enumerate() {
        let text = f.get("text").and_then(|v| v.as_str()).unwrap_or("");
        if !text.is_empty() {
            buf.push_str(&format!("{}. {}\n", i + 1, text));
        }
    }
    Ok(vec![super::text_content(buf.trim_end())])
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn describe_tools_returns_five_entries() {
        let tools = describe_tools();
        assert_eq!(tools.len(), 5);
        let names: Vec<&str> = tools
            .iter()
            .filter_map(|t| t.get("name").and_then(|v| v.as_str()))
            .collect();
        assert!(names.contains(&"list_workspace_files"));
        assert!(names.contains(&"read_workspace_file"));
        assert!(names.contains(&"search_workspace"));
        assert!(names.contains(&"write_workspace_file"));
        assert!(names.contains(&"get_memory_facts"));
    }

    #[test]
    fn every_tool_has_input_schema() {
        for t in describe_tools() {
            assert!(
                t.get("inputSchema").is_some(),
                "tool {:?} missing inputSchema",
                t.get("name")
            );
            assert!(t.get("description").is_some());
        }
    }

    #[test]
    fn glob_matches_basic_star() {
        assert!(glob_match("*.md", "notes.md"));
        assert!(!glob_match("*.md", "notes.txt"));
    }

    #[test]
    fn glob_matches_double_star() {
        assert!(glob_match("**/*.md", "a/b/c.md"));
        assert!(glob_match("**/*.md", "c.md"));
        assert!(!glob_match("**/*.md", "a/b/c.txt"));
    }

    #[test]
    fn glob_matches_prefix() {
        assert!(glob_match("notes/*", "notes/hello.md"));
        assert!(!glob_match("notes/*", "other/hello.md"));
    }

    #[test]
    fn glob_matches_exact() {
        assert!(glob_match("notes.md", "notes.md"));
        assert!(!glob_match("notes.md", "notes.markdown"));
    }
}
