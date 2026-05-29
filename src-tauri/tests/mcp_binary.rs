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
        .stdin(Stdio::piped())
        .stdout(Stdio::piped())
        .stderr(Stdio::piped())
        .spawn()
        .expect("spawn keepance-mcp");
    (child, tmp)
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
    let tools = parsed["result"]["tools"]
        .as_array()
        .expect("tools array");
    assert_eq!(tools.len(), 5);
    let names: Vec<&str> = tools
        .iter()
        .filter_map(|t| t["name"].as_str())
        .collect();
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
    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn list_workspace_files_returns_workspace_contents() {
    let (mut child, tmp) = spawn_with_workspace();
    // Drop a couple of fixture files so the tool has something to enumerate.
    std::fs::write(tmp.path().join("notes.md"), "# hello").unwrap();
    std::fs::create_dir_all(tmp.path().join("sub")).unwrap();
    std::fs::write(tmp.path().join("sub/plan.md"), "plan").unwrap();

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
    assert!(text.contains("notes.md"), "got: {text}");
    assert!(text.contains("sub/plan.md"), "got: {text}");

    let _ = child.kill();
    std::thread::sleep(Duration::from_millis(50));
}

#[test]
fn read_workspace_file_rejects_traversal() {
    let (mut child, _tmp) = spawn_with_workspace();
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
