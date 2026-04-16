// Projelli MCP server — Phase 2 stub.
//
// Real implementation lands in Phase 4 M4. For now this binary exists so
// the release pipeline can cross-compile `projelli-mcp` on every platform
// and stage the output in `src-tauri/binaries/` without needing the full
// MCP SDK wired up yet.
//
// The binary simply logs and exits 0 — invoking it in Phase 2 is a
// no-op success.

fn main() {
    eprintln!("projelli-mcp stub — real implementation in Phase 4 M4.");
    std::process::exit(0);
}
