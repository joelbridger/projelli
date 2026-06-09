//! Produce an AI-authored .docx (fixture + new Keepance-AI revisions) so the
//! independent Python validator can confirm a redlined document opens and that
//! BOTH the original and the new revisions are present.
//!
//! Run with:  cargo run --bin gen_authored -- /tmp/authored.docx

use docx_roundtrip::author::{ai_delete_run_containing, ai_insert_at_paragraph_end};
use docx_roundtrip::fixture::build_fixture_model;
use docx_roundtrip::serialize_docx_bytes;

fn main() -> anyhow::Result<()> {
    let out = std::env::args()
        .nth(1)
        .unwrap_or_else(|| "/tmp/keepance-authored.docx".to_string());

    let mut doc = build_fixture_model();
    ai_insert_at_paragraph_end(&mut doc, 0, " Time is of the essence.", "2026-06-09T12:00:00Z");
    ai_delete_run_containing(&mut doc, 0, "resolve all ", "2026-06-09T12:00:00Z");

    let bytes = serialize_docx_bytes(&doc)?;
    std::fs::write(&out, &bytes)?;
    println!("wrote {} bytes -> {}", bytes.len(), out);
    Ok(())
}
