//! Independent cross-validation via Python `python-docx` (a non-Keepance
//! OOXML reader). This shells out to `scripts/independent_validate.py`.
//!
//! It auto-skips (passes) when python3 or python-docx is unavailable, so the
//! core `cargo test` proof never depends on the Python toolchain. When the
//! toolchain IS present (as in this spike environment), it gives a strong
//! second opinion that our output opens in an independent reader.

use std::path::PathBuf;
use std::process::Command;

use docx_roundtrip::author::{ai_delete_run_containing, ai_insert_at_paragraph_end};
use docx_roundtrip::fixture::build_fixture_model;
use docx_roundtrip::serialize_docx_bytes;

fn manifest_dir() -> PathBuf {
    PathBuf::from(env!("CARGO_MANIFEST_DIR"))
}

/// Returns true if `python3 -c "import docx"` succeeds.
fn python_docx_available() -> bool {
    Command::new("python3")
        .args(["-c", "import docx, lxml"])
        .status()
        .map(|s| s.success())
        .unwrap_or(false)
}

#[test]
fn independent_python_reader_opens_fixture_and_authored() {
    if !python_docx_available() {
        eprintln!("SKIP: python3 + python-docx not available; skipping independent cross-validation");
        return;
    }

    // Materialize a fresh fixture and an AI-authored doc to temp files.
    let tmp = std::env::temp_dir();
    let fixture_path = tmp.join("keepance-spike-fixture.docx");
    let authored_path = tmp.join("keepance-spike-authored.docx");

    std::fs::write(&fixture_path, serialize_docx_bytes(&build_fixture_model()).unwrap()).unwrap();

    let mut authored = build_fixture_model();
    ai_insert_at_paragraph_end(&mut authored, 0, " Time is of the essence.", "2026-06-09T12:00:00Z");
    ai_delete_run_containing(&mut authored, 0, "resolve all ", "2026-06-09T12:00:00Z");
    std::fs::write(&authored_path, serialize_docx_bytes(&authored).unwrap()).unwrap();

    let script = manifest_dir().join("scripts/independent_validate.py");
    let output = Command::new("python3")
        .arg(&script)
        .arg(&fixture_path)
        .arg(&authored_path)
        .output()
        .expect("run independent_validate.py");

    let stdout = String::from_utf8_lossy(&output.stdout);
    let stderr = String::from_utf8_lossy(&output.stderr);
    eprintln!("--- independent_validate.py stdout ---\n{stdout}");
    if !stderr.trim().is_empty() {
        eprintln!("--- stderr ---\n{stderr}");
    }

    assert!(
        output.status.success(),
        "independent python-docx validation failed:\n{stdout}\n{stderr}"
    );
    // Sanity: it should have reported the AI author on the authored doc.
    assert!(
        stdout.contains("Keepance AI"),
        "expected Keepance AI revision author in python reader output"
    );
}
