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

use super::access::{McpAccessState, UNASSIGNED_MATTER_ID};
use super::approval::{self, APPROVAL_MARKER};
use super::protocol::JsonRpcError;
use super::{ServerCtx, crypto, embedder, extractor, resolve_workspace_path, store};
use serde_json::{Value, json};
use std::path::{Path, PathBuf};

/// Build the `tools/list` response array.
pub fn describe_tools() -> Vec<Value> {
    vec![
        json!({
            "name": "list_workspace_files",
            "description": "List files in the external client's active/granted Keepance matter only. Optionally filter by a glob pattern like '**/*.md'. Returns workspace-relative paths.",
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
            "description": "Read a file from the external client's active/granted Keepance matter only. Path must be workspace-relative; absolute paths and '..' traversal are rejected.",
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
            "description": "Semantic search inside the external client's active/granted Keepance matter only, using the same local embedding model the app uses for @workspace queries. Returns the top-k most relevant paragraphs with their source paths.",
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
            "description": "Write (or overwrite) a file in the external client's active/granted Keepance matter only. The user must approve every write in an approval modal; there is no way to skip it.",
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
                    }
                }
            }
        }),
        json!({
            "name": "get_memory_facts",
            "description": "Return durable memory facts only when Keepance can safely expose a matter-scoped memory set. Global memory is denied by default for external clients.",
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
    let pattern = args
        .get("pattern")
        .and_then(|v| v.as_str())
        .map(str::to_string);
    let state = load_access_state(ctx, "mcp_list", None)?;
    deny_if_lockdown(ctx, &state, "mcp_list", None, UNASSIGNED_MATTER_ID)?;
    let allowed_ids = state.allowed_matter_ids_owned();
    if allowed_ids.is_empty() {
        return deny_with_audit(
            ctx,
            "mcp_list",
            None,
            UNASSIGNED_MATTER_ID,
            "denied",
            "MCP access denied: no active or granted matter is available.",
        );
    }

    let files = collect_workspace_files(&ctx.workspace_root);
    let filtered: Vec<String> = match pattern {
        Some(p) if !p.trim().is_empty() => files
            .into_iter()
            .filter(|rel| path_allowed_for_rel(ctx, &state, rel).unwrap_or(false))
            .filter(|rel| glob_match(&p, rel))
            .collect(),
        _ => files
            .into_iter()
            .filter(|rel| path_allowed_for_rel(ctx, &state, rel).unwrap_or(false))
            .collect(),
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

    append_audit_or_deny(
        ctx,
        "mcp_list",
        "External AI listed workspace files",
        json!({
            "path": null,
            "matterId": allowed_ids,
            "result": "allowed",
            "returnedCount": filtered.len()
        }),
    )?;

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

pub async fn read_workspace_file(ctx: &ServerCtx, args: Value) -> Result<Vec<Value>, JsonRpcError> {
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(path) => path,
        None => {
            append_audit_or_deny(
                ctx,
                "mcp_read",
                "External AI workspace access denied",
                json!({
                    "path": null,
                    "matterId": null,
                    "result": "denied",
                    "reason": "missing_path"
                }),
            )?;
            return Err(JsonRpcError::invalid_params(
                "missing required argument: path",
            ));
        }
    };

    let abs = match resolve_workspace_path(&ctx.workspace_root, path) {
        Ok(abs) => abs,
        Err(e) => {
            append_audit_or_deny(
                ctx,
                "mcp_read",
                "External AI workspace access denied",
                json!({
                    "path": path,
                    "matterId": null,
                    "result": "denied",
                    "reason": "invalid_path",
                    "error": e
                }),
            )?;
            return Err(JsonRpcError::invalid_params(e));
        }
    };
    let state = load_access_state(ctx, "mcp_read", Some(path))?;
    let decision = state.decide_path(&abs);
    deny_if_lockdown(ctx, &state, "mcp_read", Some(path), &decision.matter_id)?;
    if !decision.allowed {
        return deny_with_audit(
            ctx,
            "mcp_read",
            Some(path),
            &decision.matter_id,
            "denied",
            "MCP access denied: requested path is outside the granted matter.",
        );
    }

    if !abs.exists() {
        append_audit_or_deny(
            ctx,
            "mcp_read",
            "External AI read workspace file",
            json!({
                "path": path,
                "matterId": decision.matter_id,
                "result": "failed",
                "reason": "file does not exist"
            }),
        )?;
        return Err(JsonRpcError::internal(format!(
            "file does not exist: {path}"
        )));
    }
    if !abs.is_file() {
        append_audit_or_deny(
            ctx,
            "mcp_read",
            "External AI read workspace file",
            json!({
                "path": path,
                "matterId": decision.matter_id,
                "result": "failed",
                "reason": "path is not a file"
            }),
        )?;
        return Err(JsonRpcError::internal(format!(
            "path is not a file: {path}"
        )));
    }
    // Hard cap on file size so a client can't coerce us into slurping a
    // gigabyte-long binary. Matches the RAG extractor's 5 MiB limit.
    let meta = match std::fs::metadata(&abs) {
        Ok(meta) => meta,
        Err(e) => {
            append_audit_or_deny(
                ctx,
                "mcp_read",
                "External AI read workspace file",
                json!({
                    "path": path,
                    "matterId": decision.matter_id,
                    "result": "failed",
                    "reason": "stat_failed",
                    "error": e.to_string()
                }),
            )?;
            return Err(JsonRpcError::internal(format!("stat failed: {e}")));
        }
    };
    if meta.len() > extractor::MAX_FILE_BYTES {
        append_audit_or_deny(
            ctx,
            "mcp_read",
            "External AI read workspace file",
            json!({
                "path": path,
                "matterId": decision.matter_id,
                "result": "failed",
                "reason": "file too large",
                "bytes": meta.len()
            }),
        )?;
        return Err(JsonRpcError::internal(format!(
            "file too large ({} bytes) — max is {} bytes",
            meta.len(),
            extractor::MAX_FILE_BYTES
        )));
    }
    let text = match std::fs::read_to_string(&abs) {
        Ok(text) => text,
        Err(e) => {
            append_audit_or_deny(
                ctx,
                "mcp_read",
                "External AI read workspace file",
                json!({
                    "path": path,
                    "matterId": decision.matter_id,
                    "result": "failed",
                    "reason": "read_failed",
                    "error": e.to_string()
                }),
            )?;
            return Err(JsonRpcError::internal(format!("read failed: {e}")));
        }
    };
    append_audit_or_deny(
        ctx,
        "mcp_read",
        "External AI read workspace file",
        json!({
            "path": path,
            "matterId": decision.matter_id,
            "result": "allowed",
            "bytes": meta.len()
        }),
    )?;

    Ok(vec![super::text_content(&text)])
}

// ---------------------------------------------------------------------------
// search_workspace
// ---------------------------------------------------------------------------

pub async fn search_workspace(ctx: &ServerCtx, args: Value) -> Result<Vec<Value>, JsonRpcError> {
    let query = match args.get("query").and_then(|v| v.as_str()) {
        Some(query) => query,
        None => {
            append_audit_or_deny(
                ctx,
                "mcp_search",
                "External AI workspace access denied",
                json!({
                    "path": null,
                    "matterId": null,
                    "result": "denied",
                    "reason": "missing_query"
                }),
            )?;
            return Err(JsonRpcError::invalid_params(
                "missing required argument: query",
            ));
        }
    };
    if query.trim().is_empty() {
        append_audit_or_deny(
            ctx,
            "mcp_search",
            "External AI workspace access denied",
            json!({
                "path": null,
                "matterId": null,
                "result": "denied",
                "reason": "empty_query"
            }),
        )?;
        return Err(JsonRpcError::invalid_params("query is empty"));
    }
    let top_k = args
        .get("top_k")
        .and_then(|v| v.as_u64())
        .map(|v| v.clamp(1, 50) as usize)
        .unwrap_or(8);
    let state = load_access_state(ctx, "mcp_search", None)?;
    deny_if_lockdown(ctx, &state, "mcp_search", None, UNASSIGNED_MATTER_ID)?;
    let allowed_ids = state.allowed_matter_ids_owned();
    if allowed_ids.is_empty() {
        return deny_with_audit(
            ctx,
            "mcp_search",
            None,
            UNASSIGNED_MATTER_ID,
            "denied",
            "MCP access denied: no active or granted matter is available.",
        );
    }

    let conn = store::open_connection(&ctx.workspace_root)
        .await
        .map_err(|e| {
            audited_internal_error(
                ctx,
                "mcp_search",
                None,
                UNASSIGNED_MATTER_ID,
                format!("open lancedb: {e}"),
            )
        })?;
    let names = conn.table_names().execute().await.map_err(|e| {
        audited_internal_error(
            ctx,
            "mcp_search",
            None,
            UNASSIGNED_MATTER_ID,
            format!("list tables: {e}"),
        )
    })?;
    if !names.iter().any(|n| n == store::TABLE_NAME) {
        append_audit_or_deny(
            ctx,
            "mcp_search",
            "External AI searched workspace",
            json!({
                "path": null,
                "matterId": allowed_ids,
                "result": "allowed",
                "query": query,
                "returnedCount": 0
            }),
        )?;
        return Ok(vec![super::text_content(
            "Workspace hasn't been indexed yet. Open the workspace in Keepance to build the index.",
        )]);
    }
    let table = conn
        .open_table(store::TABLE_NAME)
        .execute()
        .await
        .map_err(|e| {
            audited_internal_error(
                ctx,
                "mcp_search",
                None,
                UNASSIGNED_MATTER_ID,
                format!("open table: {e}"),
            )
        })?;

    let qvec = embedder::embed_query(query).await.map_err(|e| {
        audited_internal_error(
            ctx,
            "mcp_search",
            None,
            UNASSIGNED_MATTER_ID,
            format!("embed query: {e}"),
        )
    })?;
    // WS-B/C + BUG-038: MCP is exposed to EXTERNAL AI clients, so it never gets
    // the in-app "all matters" default. Search each granted matter with the
    // LanceDB prefilter and merge the hits. If no matter is granted, we denied
    // above before embedding anything.
    //
    // WS-PRIV + BUG-039: privileged content must NEVER leak to an external MCP client.
    // `include_privileged = false` here, and there is intentionally NO way for an
    // MCP client to flip it — the "include privileged" capability is an in-app,
    // user-initiated decision only.
    let mut raw = Vec::new();
    for matter_id in &allowed_ids {
        let mut hits = store::nearest(&table, &qvec, top_k, Some(matter_id), false)
            .await
            .map_err(|e| {
                audited_internal_error(ctx, "mcp_search", None, matter_id, format!("nearest: {e}"))
            })?;
        raw.append(&mut hits);
    }
    raw.sort_by(|a, b| a.distance.total_cmp(&b.distance));

    // Defence in depth for stale or mis-tagged vector rows. The LanceDB
    // prefilter above uses the row's stored matter_id, which can be stale after
    // a file move or matter-folder remap. Before exposing a hit to an external
    // MCP client, recover its real source path and run the same live path
    // decision used by read/list. Mail and any source without a verifiable file
    // path are dropped until they have a separate matter-safe verifier.
    let enc_key = crypto::get_or_create_master_key().ok();
    let mut verified = Vec::with_capacity(top_k);
    let mut dropped_count = 0usize;
    for hit in raw {
        if verified.len() >= top_k {
            break;
        }
        match verified_file_search_hit(ctx, &state, hit, enc_key.as_ref()) {
            Some(hit) => verified.push(hit),
            None => dropped_count += 1,
        }
    }

    if verified.is_empty() {
        append_audit_or_deny(
            ctx,
            "mcp_search",
            "External AI searched workspace",
            json!({
                "path": null,
                "matterId": allowed_ids,
                "result": "allowed",
                "query": query,
                "returnedCount": 0,
                "droppedCount": dropped_count
            }),
        )?;
        return Ok(vec![super::text_content("(no results)")]);
    }

    let mut buf = String::new();
    for (i, verified_hit) in verified.iter().enumerate() {
        let score = embedder::cosine_distance_to_score(verified_hit.hit.distance);
        buf.push_str(&format!(
            "[{}] {} (score {:.2}, paragraph {})\n",
            i + 1,
            verified_hit.display_path,
            score,
            verified_hit.hit.paragraph_index
        ));
        buf.push_str(&verified_hit.hit.text);
        buf.push_str("\n\n");
    }
    append_audit_or_deny(
        ctx,
        "mcp_search",
        "External AI searched workspace",
        json!({
            "path": null,
            "matterId": allowed_ids,
            "result": "allowed",
            "query": query,
            "returnedCount": verified.len(),
            "droppedCount": dropped_count
        }),
    )?;
    Ok(vec![super::text_content(buf.trim_end())])
}

// ---------------------------------------------------------------------------
// write_workspace_file
// ---------------------------------------------------------------------------

pub async fn write_workspace_file(
    ctx: &ServerCtx,
    args: Value,
) -> Result<Vec<Value>, JsonRpcError> {
    let path = match args.get("path").and_then(|v| v.as_str()) {
        Some(path) => path,
        None => {
            append_audit_or_deny(
                ctx,
                "mcp_write_denied",
                "External AI workspace write denied",
                json!({
                    "path": null,
                    "matterId": null,
                    "result": "denied",
                    "reason": "missing_path"
                }),
            )?;
            return Err(JsonRpcError::invalid_params(
                "missing required argument: path",
            ));
        }
    };
    let content = match args.get("content").and_then(|v| v.as_str()) {
        Some(content) => content,
        None => {
            append_audit_or_deny(
                ctx,
                "mcp_write_denied",
                "External AI workspace write denied",
                json!({
                    "path": path,
                    "matterId": null,
                    "result": "denied",
                    "reason": "missing_content"
                }),
            )?;
            return Err(JsonRpcError::invalid_params(
                "missing required argument: content",
            ));
        }
    };
    let abs = match resolve_workspace_path(&ctx.workspace_root, path) {
        Ok(abs) => abs,
        Err(e) => {
            append_audit_or_deny(
                ctx,
                "mcp_write_requested",
                "External AI workspace write denied",
                json!({
                    "path": path,
                    "matterId": null,
                    "result": "denied",
                    "reason": "invalid_path",
                    "error": e
                }),
            )?;
            return Err(JsonRpcError::invalid_params(e));
        }
    };
    let state = load_access_state(ctx, "mcp_write_requested", Some(path))?;
    let decision = state.decide_path(&abs);
    append_audit_or_deny(
        ctx,
        "mcp_write_requested",
        "External AI requested workspace write",
        json!({
            "path": path,
            "matterId": decision.matter_id,
            "result": "requested",
            "bytes": content.len()
        }),
    )?;
    if state.network_lockdown {
        append_audit_or_deny(
            ctx,
            "mcp_write_denied",
            "External AI workspace write denied",
            json!({
                "path": path,
                "matterId": decision.matter_id,
                "result": "denied",
                "reason": "network_lockdown"
            }),
        )?;
        return Err(JsonRpcError::internal(
            "Network lockdown is on. MCP workspace access is disabled for this matter.".to_string(),
        ));
    }
    if !decision.allowed {
        append_audit_or_deny(
            ctx,
            "mcp_write_denied",
            "External AI workspace write denied",
            json!({
                "path": path,
                "matterId": decision.matter_id,
                "result": "denied",
                "reason": "outside_granted_matter"
            }),
        )?;
        return Err(JsonRpcError::internal(
            "MCP access denied: requested path is outside the granted matter.".to_string(),
        ));
    }

    // BUG-022 (security): every MCP write requires explicit user approval. The
    // old `require_confirmation` argument let an external MCP client skip the
    // approval modal (`require_confirmation: false`) and write straight into the
    // workspace. That bypass is removed — approval is now UNCONDITIONAL (the arg
    // is ignored and no longer advertised in the tool schema).
    {
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
            Ok(true) => {}
            Ok(false) => {
                append_audit_or_deny(
                    ctx,
                    "mcp_write_denied",
                    "External AI workspace write denied",
                    json!({
                        "path": path,
                        "matterId": decision.matter_id,
                        "result": "denied",
                        "reason": "user_denied"
                    }),
                )?;
                return Err(JsonRpcError::internal("user denied the write".to_string()));
            }
            Err(e) => {
                append_audit_or_deny(
                    ctx,
                    "mcp_write_denied",
                    "External AI workspace write denied",
                    json!({
                        "path": path,
                        "matterId": decision.matter_id,
                        "result": "denied",
                        "reason": "approval_channel_failed"
                    }),
                )?;
                return Err(JsonRpcError::internal(format!(
                    "approval channel failed: {e}"
                )));
            }
        }
    }

    // Ensure parent dir exists.
    if let Some(parent) = abs.parent() {
        if let Err(e) = std::fs::create_dir_all(parent) {
            append_audit_or_deny(
                ctx,
                "mcp_write_denied",
                "External AI workspace write failed",
                json!({
                    "path": path,
                    "matterId": decision.matter_id,
                    "result": "failed",
                    "reason": "mkdir_parent_failed",
                    "error": e.to_string()
                }),
            )?;
            return Err(JsonRpcError::internal(format!("mkdir parent: {e}")));
        }
    }
    if let Err(e) = std::fs::write(&abs, content) {
        append_audit_or_deny(
            ctx,
            "mcp_write_denied",
            "External AI workspace write failed",
            json!({
                "path": path,
                "matterId": decision.matter_id,
                "result": "failed",
                "reason": "write_failed",
                "error": e.to_string()
            }),
        )?;
        return Err(JsonRpcError::internal(format!("write failed: {e}")));
    }

    append_audit_or_deny(
        ctx,
        "mcp_write_approved",
        "External AI workspace write approved",
        json!({
            "path": path,
            "matterId": decision.matter_id,
            "result": "written",
            "bytes": content.len()
        }),
    )?;

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
    let state = load_access_state(ctx, "mcp_read", Some(".keepance/memory.json"))?;
    deny_if_lockdown(
        ctx,
        &state,
        "mcp_read",
        Some(".keepance/memory.json"),
        UNASSIGNED_MATTER_ID,
    )?;
    deny_with_audit(
        ctx,
        "mcp_read",
        Some(".keepance/memory.json"),
        UNASSIGNED_MATTER_ID,
        "denied",
        "MCP access denied: durable memory is not matter-scoped yet.",
    )
}

fn load_access_state(
    ctx: &ServerCtx,
    audit_action: &str,
    path: Option<&str>,
) -> Result<McpAccessState, JsonRpcError> {
    match McpAccessState::load(&ctx.workspace_root) {
        Ok(state) => Ok(state),
        Err(e) => {
            append_audit_or_deny(
                ctx,
                audit_action,
                "External AI workspace access denied",
                json!({
                    "path": path,
                    "matterId": null,
                    "result": "denied",
                    "reason": "scope_state_unavailable",
                    "error": e
                }),
            )?;
            Err(JsonRpcError::internal(
                "MCP access denied: Keepance has not granted this external client a matter scope."
                    .to_string(),
            ))
        }
    }
}

fn deny_if_lockdown(
    ctx: &ServerCtx,
    state: &McpAccessState,
    audit_action: &str,
    path: Option<&str>,
    matter_id: &str,
) -> Result<(), JsonRpcError> {
    if !state.network_lockdown {
        return Ok(());
    }
    append_audit_or_deny(
        ctx,
        audit_action,
        "External AI workspace access denied",
        json!({
            "path": path,
            "matterId": matter_id,
            "result": "denied",
            "reason": "network_lockdown"
        }),
    )?;
    Err(JsonRpcError::internal(
        "Network lockdown is on. MCP workspace access is disabled for this matter.".to_string(),
    ))
}

fn deny_with_audit<T>(
    ctx: &ServerCtx,
    audit_action: &str,
    path: Option<&str>,
    matter_id: &str,
    result: &str,
    message: &str,
) -> Result<T, JsonRpcError> {
    append_audit_or_deny(
        ctx,
        audit_action,
        "External AI workspace access denied",
        json!({
            "path": path,
            "matterId": matter_id,
            "result": result
        }),
    )?;
    Err(JsonRpcError::internal(message.to_string()))
}

fn audited_internal_error(
    ctx: &ServerCtx,
    audit_action: &str,
    path: Option<&str>,
    matter_id: &str,
    message: String,
) -> JsonRpcError {
    let _ = super::audit::append_mcp_audit(
        &ctx.workspace_root,
        audit_action,
        "External AI workspace access failed",
        json!({
            "path": path,
            "matterId": matter_id,
            "result": "failed",
            "reason": message
        }),
    );
    JsonRpcError::internal(message)
}

fn append_audit_or_deny(
    ctx: &ServerCtx,
    action: &str,
    description: &str,
    metadata: Value,
) -> Result<(), JsonRpcError> {
    super::audit::append_mcp_audit(&ctx.workspace_root, action, description, metadata)
        .map_err(|e| JsonRpcError::internal(format!("MCP audit failed: {e}")))
}

fn path_allowed_for_rel(
    ctx: &ServerCtx,
    state: &McpAccessState,
    rel: &str,
) -> Result<bool, String> {
    let abs = resolve_workspace_path(&ctx.workspace_root, rel)?;
    Ok(state.decide_path(&abs).allowed)
}

struct VerifiedSearchHit {
    hit: store::StoredHit,
    display_path: String,
}

fn verified_file_search_hit(
    ctx: &ServerCtx,
    state: &McpAccessState,
    hit: store::StoredHit,
    enc_key: Option<&[u8; 32]>,
) -> Option<VerifiedSearchHit> {
    let real_path = recover_hit_real_path(&hit, enc_key)?;
    if hit.source_type.as_deref() == Some("mail") || real_path.starts_with("mail:") {
        return None;
    }
    let abs = resolve_hit_file_path(&ctx.workspace_root, &real_path).ok()?;
    if !abs.is_file() {
        return None;
    }
    let decision = state.decide_path(&abs);
    if !decision.allowed {
        return None;
    }
    Some(VerifiedSearchHit {
        hit,
        display_path: display_workspace_path(&ctx.workspace_root, &abs, &real_path),
    })
}

fn recover_hit_real_path(hit: &store::StoredHit, enc_key: Option<&[u8; 32]>) -> Option<String> {
    match hit.path_enc.as_deref() {
        Some(enc) => enc_key
            .and_then(|k| {
                hex::decode(enc)
                    .ok()
                    .and_then(|bytes| {
                        keepance_lib::commands::mail::crypto::decrypt_with_key(&bytes, k).ok()
                    })
                    .and_then(|v| String::from_utf8(v).ok())
            })
            .filter(|path| !path.trim().is_empty()),
        // Legacy pre-V10 row: the raw column is the plaintext path.
        None => (!hit.path.trim().is_empty()).then(|| hit.path.clone()),
    }
}

fn resolve_hit_file_path(workspace: &Path, real_path: &str) -> Result<PathBuf, String> {
    let candidate = PathBuf::from(real_path);
    if candidate.is_absolute() {
        super::access::canonicalized_workspace_child(workspace, &candidate)
    } else {
        resolve_workspace_path(workspace, real_path)
    }
}

fn display_workspace_path(workspace: &Path, abs: &Path, fallback: &str) -> String {
    abs.strip_prefix(workspace)
        .ok()
        .map(|rel| rel.to_string_lossy().replace('\\', "/"))
        .unwrap_or_else(|| fallback.trim_start_matches(['/', '\\']).to_string())
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::sync::{Arc, Mutex};

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

    fn test_ctx(workspace_root: PathBuf) -> ServerCtx {
        ServerCtx {
            workspace_root,
            approval_dir: std::env::temp_dir(),
            stderr: Arc::new(Mutex::new(Box::new(Vec::<u8>::new()))),
        }
    }

    fn stored_hit(path: String, matter_id: &str, text: &str) -> store::StoredHit {
        store::StoredHit {
            id: format!("id-{matter_id}"),
            path,
            matter_id: Some(matter_id.to_string()),
            source_id: None,
            paragraph_index: 0,
            text: text.to_string(),
            distance: 0.1,
            source_type: Some("text".to_string()),
            page_number: None,
            encrypted: false,
            privilege: Some("none".to_string()),
            extraction: None,
            extraction_confidence: None,
            locator: None,
            path_enc: None,
        }
    }

    #[test]
    fn search_hit_with_matching_stored_matter_but_live_cross_matter_path_is_dropped() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let matter_a = tmp.path().join("Matter A");
        let matter_b = tmp.path().join("Matter B");
        std::fs::create_dir_all(&matter_a).unwrap();
        std::fs::create_dir_all(&matter_b).unwrap();
        let secret_path = matter_b.join("secret.md");
        std::fs::write(&secret_path, "other client secret").unwrap();

        let ctx = test_ctx(tmp.path().to_path_buf());
        let state = McpAccessState {
            version: 1,
            updated_at: chrono::Utc::now().to_rfc3339(),
            active_matter_id: Some("matter-a".into()),
            granted_matter_ids: vec!["matter-a".into()],
            network_lockdown: false,
            matters: vec![
                super::super::access::McpMatter {
                    id: "matter-a".into(),
                    folder_paths: vec![matter_a.to_string_lossy().to_string()],
                    archived: false,
                },
                super::super::access::McpMatter {
                    id: "matter-b".into(),
                    folder_paths: vec![matter_b.to_string_lossy().to_string()],
                    archived: false,
                },
            ],
        };

        let hit = stored_hit(
            secret_path.to_string_lossy().to_string(),
            "matter-a",
            "other client secret",
        );

        assert!(
            verified_file_search_hit(&ctx, &state, hit, None).is_none(),
            "a stale/mis-tagged search row must not be returned just because stored matter_id matches"
        );
    }

    #[test]
    fn search_hit_for_mail_source_is_dropped_until_mail_scope_verifier_exists() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let matter_a = tmp.path().join("Matter A");
        std::fs::create_dir_all(&matter_a).unwrap();

        let ctx = test_ctx(tmp.path().to_path_buf());
        let state = McpAccessState {
            version: 1,
            updated_at: chrono::Utc::now().to_rfc3339(),
            active_matter_id: Some("matter-a".into()),
            granted_matter_ids: vec!["matter-a".into()],
            network_lockdown: false,
            matters: vec![super::super::access::McpMatter {
                id: "matter-a".into(),
                folder_paths: vec![matter_a.to_string_lossy().to_string()],
                archived: false,
            }],
        };

        let mut hit = stored_hit("mail:provider-message-id".into(), "matter-a", "mail text");
        hit.source_type = Some("mail".into());

        assert!(verified_file_search_hit(&ctx, &state, hit, None).is_none());
    }

    #[test]
    fn search_hit_for_deleted_file_is_dropped_even_when_matter_matches() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let matter_a = tmp.path().join("Matter A");
        std::fs::create_dir_all(&matter_a).unwrap();
        let deleted_path = matter_a.join("deleted.md");

        let ctx = test_ctx(tmp.path().to_path_buf());
        let state = McpAccessState {
            version: 1,
            updated_at: chrono::Utc::now().to_rfc3339(),
            active_matter_id: Some("matter-a".into()),
            granted_matter_ids: vec!["matter-a".into()],
            network_lockdown: false,
            matters: vec![super::super::access::McpMatter {
                id: "matter-a".into(),
                folder_paths: vec![matter_a.to_string_lossy().to_string()],
                archived: false,
            }],
        };

        let hit = stored_hit(
            deleted_path.to_string_lossy().to_string(),
            "matter-a",
            "stale deleted file text",
        );

        assert!(verified_file_search_hit(&ctx, &state, hit, None).is_none());
    }

    #[test]
    fn search_hit_for_directory_is_dropped_even_when_matter_matches() {
        let tmp = tempfile::tempdir().expect("tmpdir");
        let matter_a = tmp.path().join("Matter A");
        let directory_path = matter_a.join("Folder");
        std::fs::create_dir_all(&directory_path).unwrap();

        let ctx = test_ctx(tmp.path().to_path_buf());
        let state = McpAccessState {
            version: 1,
            updated_at: chrono::Utc::now().to_rfc3339(),
            active_matter_id: Some("matter-a".into()),
            granted_matter_ids: vec!["matter-a".into()],
            network_lockdown: false,
            matters: vec![super::super::access::McpMatter {
                id: "matter-a".into(),
                folder_paths: vec![matter_a.to_string_lossy().to_string()],
                archived: false,
            }],
        };

        let hit = stored_hit(
            directory_path.to_string_lossy().to_string(),
            "matter-a",
            "directory stale text",
        );

        assert!(verified_file_search_hit(&ctx, &state, hit, None).is_none());
    }
}
