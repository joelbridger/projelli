//! Regenerate the committed fixture .docx from the model.
//!
//! Run with:  cargo run --bin gen_fixture
//!
//! Keeps the binary fixture reproducible from source: the bytes on disk are a
//! deterministic function of `fixture::build_fixture_model()` +
//! `serialize::serialize_to_bytes`.

use std::path::PathBuf;

use docx_roundtrip::fixture::build_fixture_model;
use docx_roundtrip::serialize_docx_bytes;

fn main() -> anyhow::Result<()> {
    let model = build_fixture_model();
    let bytes = serialize_docx_bytes(&model)?;

    let out = PathBuf::from(env!("CARGO_MANIFEST_DIR")).join("fixtures/with-tracked-changes.docx");
    std::fs::write(&out, &bytes)?;
    println!("wrote {} bytes -> {}", bytes.len(), out.display());
    Ok(())
}
