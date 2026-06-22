// Integration test for the `keepance-mcp` sidecar binary.
//
// Spawns the binary as a child process with a stubbed workspace, writes a
// canonical MCP handshake (`initialize` → `tools/list`) to its stdin, and
// asserts the responses on stdout are well-formed JSON-RPC 2.0.
//
// We intentionally stop short of calling `tools/call` with `search_workspace`
// because that triggers the fastembed-rs model download (~100 MB) which is
// slow in CI. The `tools/list` surface is what MCP clients actually depend
// on for their tool picker; the per-tool bodies are unit-tested individually
// inside `src/bin/mcp/tools.rs`.

use std::io::{BufRead, BufReader, Write};
use std::path::PathBuf;
use std::process::{Command, Stdio};
use std::time::Duration;

const TEST_AUDIT_KEY_HEX: &str = "4242424242424242424242424242424242424242424242424242424242424242";

/// Locate the compiled `keepance-mcp` binary for the current profile. Cargo
/// sets `CARGO_BIN_EXE_<name>` when running integration tests, so no need
/// to hard-code the target dir layout.
fn binary_path() -> PathBuf {
    PathBuf::from(env!("CARGO_BIN_EXE_keepance-mcp"))
}

/// Spawn the binary with a fresh temp workspace. Returns the child so the
/// caller can speak JSON-RPC over its stdin/stdout.
fn spawn_with_workspace() -> (std::process::Child, tempfile::TempDir) {
    let tmp = tempfile::Builder::new()
        .prefix("keepance-mcp-it-")
        .tempdir()
        .expect("tmpdir");
    let child = Command::new(binary_path())
        .env("KEEPANCE_WORKSPACE_ROOT", tmp.path())
        .env("KEEPANCE_MCP_AUDIT_KEY_HEX", TEST_AUDIT_KEY_HEX)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn keepance-mcp");
    (child, tmp)
}

fn spawn_scoped_workspace(lockdown: bool) -> (std::process::Child, tempfile::TempDir) {
    let tmp = tempfile::Builder::new()
        .prefix("keepance-mcp-scoped-")
        .tempdir()
        .expect("tmpdir");
    write_scope_state(tmp.path(), "matter-a", &["matter-a"], lockdown);
    let child = Command::new(binary_path())
        .env("KEEPANCE_WORKSPACE_ROOT", tmp.path())
        .env("KEEPANCE_MCP_AUDIT_KEY_HEX", TEST_AUDIT_KEY_HEX)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn keepance-mcp");
    (child, tmp)
}

fn spawn_root_granted_workspace() -> (std::process::Child, tempfile::TempDir) {
    let tmp = tempfile::Builder::new()
        .prefix("keepance-mcp-root-granted-")
        .tempdir()
        .expect("tmpdir");
    write_root_scope_state(tmp.path(), false);
    let child = Command::new(binary_path())
        .env("KEEPANCE_WORKSPACE_ROOT", tmp.path())
        .env("KEEPANCE_MCP_AUDIT_KEY_HEX", TEST_AUDIT_KEY_HEX)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn keepance-mcp");
    (child, tmp)
}

fn write_scope_state(
    workspace: &std::path::Path,
    active_matter_id: &str,
    granted_matter_ids: &[&str],
    network_lockdown: bool,
) {
    write_scope_state_with_updated_at(
        workspace,
        active_matter_id,
        granted_matter_ids,
        network_lockdown,
        &chrono::Utc::now().to_rfc3339(),
    );
}

fn write_scope_state_with_updated_at(
    workspace: &std::path::Path,
    active_matter_id: &str,
    granted_matter_ids: &[&str],
    network_lockdown: bool,
    updated_at: &str,
) {
    let matter_a = workspace.join("Matter A");
    let matter_b = workspace.join("Matter B");
    std::fs::create_dir_all(&matter_a).unwrap();
    std::fs::create_dir_all(&matter_b).unwrap();
    let state = serde_json::json!({
        "version": 1,
        "updatedAt": updated_at,
        "activeMatterId": active_matter_id,
        "grantedMatterIds": granted_matter_ids,
        "networkLockdown": network_lockdown,
        "matters": [
            {
                "id": "matter-a",
                "name": "Matter A",
                "client": "Client A",
                "folderPaths": [matter_a.to_string_lossy()],
                "privileged": network_lockdown,
                "archived": false
            },
            {
                "id": "matter-b",
                "name": "Matter B",
                "client": "Client B",
                "folderPaths": [matter_b.to_string_lossy()],
                "privileged": false,
                "archived": false
            }
        ]
    });
    let dir = workspace.join(".keepance");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("mcp-session-scope.json"),
        serde_json::to_vec_pretty(&state).unwrap(),
    )
    .unwrap();
}

fn write_root_scope_state(workspace: &std::path::Path, network_lockdown: bool) {
    let state = serde_json::json!({
        "version": 1,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
        "activeMatterId": "matter-root",
        "grantedMatterIds": ["matter-root"],
        "networkLockdown": network_lockdown,
        "matters": [
            {
                "id": "matter-root",
                "name": "Root Matter",
                "client": "Root Client",
                "folderPaths": [workspace.to_string_lossy()],
                "privileged": network_lockdown,
                "archived": false
            }
        ]
    });
    let dir = workspace.join(".keepance");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("mcp-session-scope.json"),
        serde_json::to_vec_pretty(&state).unwrap(),
    )
    .unwrap();
}

fn write_deny_all_scope_state(workspace: &std::path::Path) {
    let state = serde_json::json!({
        "version": 1,
        "updatedAt": chrono::Utc::now().to_rfc3339(),
        "activeMatterId": null,
        "grantedMatterIds": [],
        "networkLockdown": true,
        "matters": []
    });
    let dir = workspace.join(".keepance");
    std::fs::create_dir_all(&dir).unwrap();
    std::fs::write(
        dir.join("mcp-session-scope.json"),
        serde_json::to_vec_pretty(&state).unwrap(),
    )
    .unwrap();
}

fn audit_actions(workspace: &std::path::Path) -> Vec<(String, serde_json::Value)> {
    let key_bytes = hex::decode(TEST_AUDIT_KEY_HEX).unwrap();
    let mut key = [0u8; 32];
    key.copy_from_slice(&key_bytes);
    let store =
        keepance_lib::commands::audit::store::EncryptedAuditStore::open_with_key(workspace, &key)
            .expect("open audit store");
    store
        .list(None, None)
        .expect("list audit")
        .into_iter()
        .map(|rec| {
            let payload =
                serde_json::from_str(&rec.payload_json).unwrap_or(serde_json::Value::Null);
            (rec.action, payload)
        })
        .collect()
}

/// Write a single JSON-RPC line to the server and read a single line back.
fn exchange(child: &mut std::process::Child, line: &str) -> String {
    let stdin = child.stdin.as_mut().expect("stdin");
    writeln!(stdin, "{line}").expect("write");
    stdin.flush().expect("flush");
    let stdout = child.stdout.as_mut().expect("stdout");
    let mut reader = BufReader::new(stdout);
    let mut resp = String::new();
    reader.read_line(&mut resp).expect("read");
    resp
}

#[test]
fn initialize_returns_server_info_and_protocol_version() {
    let (mut child, _tmp) = spawn_with_workspace();
    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["jsonrpc"], "2.0");
    assert_eq!(parsed["id"], 1);
    // Server-info + protocol version + capabilities are mandatory.
    let info = &parsed["result"]["serverInfo"];
    assert_eq!(info["name"], "keepance");
    assert!(info["version"].is_string(), "got {info:?}");
    assert_eq!(parsed["result"]["protocolVersion"], "2025-03-26");
    assert!(parsed["result"]["capabilities"]["tools"].is_object());

    let _ = child.kill();
    // Give the OS a moment to reap before the tempdir is dropped.
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn tools_list_returns_five_keepance_tools() {
    let (mut child, _tmp) = spawn_with_workspace();
    // We can skip initialize and jump straight to tools/list — the spec
    // recommends the handshake but doesn't require it for stateless servers.
    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":7,"method":"tools/list"}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 7);
    let tools = parsed["result"]["tools"].as_array().expect("tools array");
    assert_eq!(tools.len(), 5);
    let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
    for expected in [
        "list_workspace_files",
        "read_workspace_file",
        "search_workspace",
        "write_workspace_file",
        "get_memory_facts",
    ] {
        assert!(
            names.contains(&expected),
            "missing tool {expected} in {names:?}"
        );
    }
    // BUG-022 (security): the write tool must NOT advertise a require_confirmation
    // bypass — every MCP write requires explicit user approval.
    let write_tool = tools
        .iter()
        .find(|t| t["name"] == "write_workspace_file")
        .expect("write_workspace_file tool present");
    assert!(
        write_tool["inputSchema"]["properties"]["require_confirmation"].is_null(),
        "write_workspace_file must not expose a require_confirmation bypass"
    );
    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn list_workspace_files_returns_workspace_contents() {
    let (mut child, tmp) = spawn_scoped_workspace(false);
    // Drop a couple of fixture files so the tool has something to enumerate.
    std::fs::write(tmp.path().join("Matter A").join("notes.md"), "# hello").unwrap();
    std::fs::write(tmp.path().join("Matter A").join("plan.md"), "plan").unwrap();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/call","params":{"name":"list_workspace_files","arguments":{}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 2);
    assert_eq!(parsed["result"]["isError"], false);
    let text = parsed["result"]["content"][0]["text"]
        .as_str()
        .expect("text content");
    assert!(text.contains("Matter A/notes.md"), "got: {text}");
    assert!(text.contains("Matter A/plan.md"), "got: {text}");

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn read_workspace_file_denies_cross_matter_path() {
    let (mut child, tmp) = spawn_scoped_workspace(false);
    std::fs::write(tmp.path().join("Matter A").join("allowed.md"), "allowed").unwrap();
    std::fs::write(
        tmp.path().join("Matter B").join("secret.md"),
        "other client secret",
    )
    .unwrap();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":31,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":"Matter B/secret.md"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 31);
    assert_eq!(parsed["result"]["isError"], true, "got: {parsed:?}");
    let text = parsed["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("outside the granted matter"), "got: {text}");
    assert!(!text.contains("other client secret"), "got: {text}");

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["matterId"] == "matter-b"
        }),
        "missing denied read audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn read_workspace_file_denies_active_matter_without_explicit_grant() {
    let tmp = tempfile::Builder::new()
        .prefix("keepance-mcp-active-not-granted-")
        .tempdir()
        .expect("tmpdir");
    write_scope_state(tmp.path(), "matter-a", &[], false);
    std::fs::write(
        tmp.path().join("Matter A").join("active.md"),
        "active client secret",
    )
    .unwrap();
    let mut child = Command::new(binary_path())
        .env("KEEPANCE_WORKSPACE_ROOT", tmp.path())
        .env("KEEPANCE_MCP_AUDIT_KEY_HEX", TEST_AUDIT_KEY_HEX)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn keepance-mcp");

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":311,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":"Matter A/active.md"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 311);
    assert_eq!(parsed["result"]["isError"], true, "got: {parsed:?}");
    let text = parsed["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("outside the granted matter"), "got: {text}");
    assert!(!text.contains("active client secret"), "got: {text}");

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["matterId"] == "matter-a"
        }),
        "missing denied active-matter read audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn read_workspace_file_allows_in_scope_path() {
    let (mut child, tmp) = spawn_scoped_workspace(false);
    std::fs::write(
        tmp.path().join("Matter A").join("allowed.md"),
        "client A memo",
    )
    .unwrap();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":32,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":"Matter A/allowed.md"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 32);
    assert_eq!(parsed["result"]["isError"], false, "got: {parsed:?}");
    let text = parsed["result"]["content"][0]["text"].as_str().unwrap();
    assert_eq!(text, "client A memo");

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["result"] == "allowed"
                && payload["metadata"]["matterId"] == "matter-a"
        }),
        "missing allowed read audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn stale_scope_state_denies_read_and_audits() {
    let tmp = tempfile::Builder::new()
        .prefix("keepance-mcp-stale-scope-")
        .tempdir()
        .expect("tmpdir");
    let stale = (chrono::Utc::now() - chrono::Duration::minutes(5)).to_rfc3339();
    write_scope_state_with_updated_at(tmp.path(), "matter-a", &["matter-a"], false, &stale);
    std::fs::write(
        tmp.path().join("Matter A").join("allowed.md"),
        "client A memo",
    )
    .unwrap();
    let mut child = Command::new(binary_path())
        .env("KEEPANCE_WORKSPACE_ROOT", tmp.path())
        .env("KEEPANCE_MCP_AUDIT_KEY_HEX", TEST_AUDIT_KEY_HEX)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn keepance-mcp");

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":37,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":"Matter A/allowed.md"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["result"]["isError"], true, "got: {parsed:?}");
    let text = parsed["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("not granted"), "got: {text}");
    assert!(!text.contains("client A memo"), "got: {text}");

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["path"] == "Matter A/allowed.md"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "scope_state_unavailable"
        }),
        "missing stale-scope audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn missing_scope_state_denies_read_and_audits() {
    let (mut child, tmp) = spawn_with_workspace();
    std::fs::create_dir_all(tmp.path().join("Matter A")).unwrap();
    std::fs::write(
        tmp.path().join("Matter A").join("allowed.md"),
        "client A memo",
    )
    .unwrap();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":38,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":"Matter A/allowed.md"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["result"]["isError"], true, "got: {parsed:?}");
    let text = parsed["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("not granted"), "got: {text}");
    assert!(!text.contains("client A memo"), "got: {text}");

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["path"] == "Matter A/allowed.md"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "scope_state_unavailable"
        }),
        "missing no-scope audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn future_scope_state_denies_read_and_audits() {
    let tmp = tempfile::Builder::new()
        .prefix("keepance-mcp-future-scope-")
        .tempdir()
        .expect("tmpdir");
    let future = (chrono::Utc::now() + chrono::Duration::minutes(2)).to_rfc3339();
    write_scope_state_with_updated_at(tmp.path(), "matter-a", &["matter-a"], false, &future);
    std::fs::write(
        tmp.path().join("Matter A").join("allowed.md"),
        "client A memo",
    )
    .unwrap();
    let mut child = Command::new(binary_path())
        .env("KEEPANCE_WORKSPACE_ROOT", tmp.path())
        .env("KEEPANCE_MCP_AUDIT_KEY_HEX", TEST_AUDIT_KEY_HEX)
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn keepance-mcp");

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":39,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":"Matter A/allowed.md"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["result"]["isError"], true, "got: {parsed:?}");
    let text = parsed["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("not granted"), "got: {text}");
    assert!(!text.contains("client A memo"), "got: {text}");

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["path"] == "Matter A/allowed.md"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "scope_state_unavailable"
        }),
        "missing future-scope audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn deny_all_scope_cleanup_denies_read_and_audits() {
    let (mut child, tmp) = spawn_scoped_workspace(false);
    std::fs::write(
        tmp.path().join("Matter A").join("allowed.md"),
        "client A memo",
    )
    .unwrap();
    write_deny_all_scope_state(tmp.path());

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":40,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":"Matter A/allowed.md"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["result"]["isError"], true, "got: {parsed:?}");
    let text = parsed["result"]["content"][0]["text"].as_str().unwrap();
    assert!(
        text.contains("Network lockdown is on") || text.contains("outside the granted matter"),
        "got: {text}"
    );
    assert!(!text.contains("client A memo"), "got: {text}");

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["path"] == "Matter A/allowed.md"
                && payload["metadata"]["result"] == "denied"
        }),
        "missing deny-all read audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn list_workspace_files_filters_to_granted_matter_and_audits() {
    let (mut child, tmp) = spawn_scoped_workspace(false);
    std::fs::write(tmp.path().join("Matter A").join("allowed.md"), "allowed").unwrap();
    std::fs::write(
        tmp.path().join("Matter B").join("secret.md"),
        "other client secret",
    )
    .unwrap();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":33,"method":"tools/call","params":{"name":"list_workspace_files","arguments":{}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["result"]["isError"], false, "got: {parsed:?}");
    let text = parsed["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("Matter A/allowed.md"), "got: {text}");
    assert!(!text.contains("Matter B/secret.md"), "got: {text}");

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_list"
                && payload["metadata"]["result"] == "allowed"
                && payload["metadata"]["returnedCount"] == 1
        }),
        "missing list audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn root_granted_matter_still_denies_keepance_internal_files() {
    let (mut child, tmp) = spawn_root_granted_workspace();
    std::fs::write(tmp.path().join("visible.md"), "visible matter content").unwrap();

    let read_resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":331,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":".keepance/mcp-session-scope.json"}}}"#,
    );
    let read_parsed: serde_json::Value = serde_json::from_str(&read_resp).expect("valid JSON");
    assert_eq!(read_parsed["id"], 331);
    assert!(read_parsed["error"].is_object(), "got {read_parsed:?}");
    assert_eq!(read_parsed["error"]["code"], -32602);
    let read_message = read_parsed["error"]["message"].as_str().unwrap();
    assert!(
        read_message.contains("Keepance internal files are not exposed over MCP"),
        "got: {read_message}"
    );
    assert!(!read_message.contains("Root Client"), "got: {read_message}");

    let list_resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":332,"method":"tools/call","params":{"name":"list_workspace_files","arguments":{}}}"#,
    );
    let list_parsed: serde_json::Value = serde_json::from_str(&list_resp).expect("valid JSON");
    assert_eq!(list_parsed["id"], 332);
    assert_eq!(
        list_parsed["result"]["isError"], false,
        "got: {list_parsed:?}"
    );
    let list_text = list_parsed["result"]["content"][0]["text"]
        .as_str()
        .unwrap();
    assert!(list_text.contains("visible.md"), "got: {list_text}");
    assert!(!list_text.contains(".keepance"), "got: {list_text}");
    assert!(
        !list_text.contains("mcp-session-scope.json"),
        "got: {list_text}"
    );

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["path"] == ".keepance/mcp-session-scope.json"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "invalid_path"
        }),
        "missing internal-file read denial audit entry: {actions:?}"
    );
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_list"
                && payload["metadata"]["result"] == "allowed"
                && payload["metadata"]["returnedCount"] == 1
        }),
        "missing internal-file-safe list audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn lockdown_denies_read_and_search_before_any_content_access() {
    let (mut child, tmp) = spawn_scoped_workspace(true);
    std::fs::write(
        tmp.path().join("Matter A").join("privileged.md"),
        "privileged content",
    )
    .unwrap();

    let read_resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":34,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":"Matter A/privileged.md"}}}"#,
    );
    let read_parsed: serde_json::Value = serde_json::from_str(&read_resp).expect("valid JSON");
    assert_eq!(
        read_parsed["result"]["isError"], true,
        "got: {read_parsed:?}"
    );
    let read_text = read_parsed["result"]["content"][0]["text"]
        .as_str()
        .unwrap();
    assert!(
        read_text.contains("Network lockdown is on"),
        "got: {read_text}"
    );
    assert!(
        !read_text.contains("privileged content"),
        "got: {read_text}"
    );

    let search_resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":35,"method":"tools/call","params":{"name":"search_workspace","arguments":{"query":"privileged"}}}"#,
    );
    let search_parsed: serde_json::Value = serde_json::from_str(&search_resp).expect("valid JSON");
    assert_eq!(
        search_parsed["result"]["isError"], true,
        "got: {search_parsed:?}"
    );
    let search_text = search_parsed["result"]["content"][0]["text"]
        .as_str()
        .unwrap();
    assert!(
        search_text.contains("Network lockdown is on"),
        "got: {search_text}"
    );

    let actions = audit_actions(tmp.path());
    assert!(
        actions
            .iter()
            .any(|(a, payload)| a == "mcp_read" && payload["metadata"]["result"] == "denied"),
        "missing denied read audit entry: {actions:?}"
    );
    assert!(
        actions
            .iter()
            .any(|(a, payload)| a == "mcp_search" && payload["metadata"]["result"] == "denied"),
        "missing denied search audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn lockdown_denies_write_without_waiting_for_user_approval_and_audits() {
    let (mut child, tmp) = spawn_scoped_workspace(true);

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":36,"method":"tools/call","params":{"name":"write_workspace_file","arguments":{"path":"Matter A/new.md","content":"new secret"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["result"]["isError"], true, "got: {parsed:?}");
    let text = parsed["result"]["content"][0]["text"].as_str().unwrap();
    assert!(text.contains("Network lockdown is on"), "got: {text}");
    assert!(
        !tmp.path().join("Matter A").join("new.md").exists(),
        "lockdown write must not create the file"
    );

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_write_requested"
                && payload["metadata"]["path"] == "Matter A/new.md"
                && payload["metadata"]["matterId"] == "matter-a"
        }),
        "missing write-request audit entry: {actions:?}"
    );
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_write_denied"
                && payload["metadata"]["path"] == "Matter A/new.md"
                && payload["metadata"]["result"] == "denied"
        }),
        "missing write-denied audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn read_workspace_file_rejects_traversal() {
    let (mut child, tmp) = spawn_with_workspace();
    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{"path":"../../../etc/passwd"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 3);
    // Invalid-params is a protocol-level error and travels via error{} not
    // via isError.
    assert!(parsed["error"].is_object(), "got {parsed:?}");
    assert_eq!(parsed["error"]["code"], -32602);

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["path"] == "../../../etc/passwd"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "invalid_path"
        }),
        "missing invalid-path audit entry: {actions:?}"
    );
    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn malformed_read_missing_path_is_audited() {
    let (mut child, tmp) = spawn_with_workspace();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":41,"method":"tools/call","params":{"name":"read_workspace_file","arguments":{}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 41);
    assert!(parsed["error"].is_object(), "got {parsed:?}");
    assert_eq!(parsed["error"]["code"], -32602);

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_read"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "missing_path"
        }),
        "missing malformed read audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn malformed_search_empty_query_is_audited() {
    let (mut child, tmp) = spawn_with_workspace();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":42,"method":"tools/call","params":{"name":"search_workspace","arguments":{"query":"   "}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 42);
    assert!(parsed["error"].is_object(), "got {parsed:?}");
    assert_eq!(parsed["error"]["code"], -32602);

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_search"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "empty_query"
        }),
        "missing malformed search audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn malformed_search_missing_query_is_audited() {
    let (mut child, tmp) = spawn_with_workspace();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":44,"method":"tools/call","params":{"name":"search_workspace","arguments":{}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 44);
    assert!(parsed["error"].is_object(), "got {parsed:?}");
    assert_eq!(parsed["error"]["code"], -32602);

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_search"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "missing_query"
        }),
        "missing missing-query search audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn malformed_write_missing_path_is_audited() {
    let (mut child, tmp) = spawn_with_workspace();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":45,"method":"tools/call","params":{"name":"write_workspace_file","arguments":{}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 45);
    assert!(parsed["error"].is_object(), "got {parsed:?}");
    assert_eq!(parsed["error"]["code"], -32602);

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_write_denied"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "missing_path"
        }),
        "missing missing-path write audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn malformed_write_missing_content_is_audited() {
    let (mut child, tmp) = spawn_with_workspace();

    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":43,"method":"tools/call","params":{"name":"write_workspace_file","arguments":{"path":"Matter A/new.md"}}}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["id"], 43);
    assert!(parsed["error"].is_object(), "got {parsed:?}");
    assert_eq!(parsed["error"]["code"], -32602);

    let actions = audit_actions(tmp.path());
    assert!(
        actions.iter().any(|(a, payload)| {
            a == "mcp_write_denied"
                && payload["metadata"]["path"] == "Matter A/new.md"
                && payload["metadata"]["result"] == "denied"
                && payload["metadata"]["reason"] == "missing_content"
        }),
        "missing malformed write audit entry: {actions:?}"
    );

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn unknown_method_returns_method_not_found() {
    let (mut child, _tmp) = spawn_with_workspace();
    let resp = exchange(
        &mut child,
        r#"{"jsonrpc":"2.0","id":9,"method":"resources/list"}"#,
    );
    let parsed: serde_json::Value = serde_json::from_str(&resp).expect("valid JSON");
    assert_eq!(parsed["error"]["code"], -32601);
    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}
