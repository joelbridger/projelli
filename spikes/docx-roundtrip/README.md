# docx-roundtrip — Keepance 3.0 de-risking spike

Standalone Rust crate proving **in-house Microsoft Word track-changes round-trip**
(import a redline, AI adds its own tracked edits, export valid `.docx`) using only
generic `zip` + `quick-xml` crates — no document SDK, no cloud service.

This is a **learning spike**, deliberately NOT wired into the Tauri build so tests
are fast and isolated. The proven code is intended to move into
`src-tauri/src/commands/docx/`.

**Read [`FEASIBILITY.md`](./FEASIBILITY.md) for the verdict and recommended design.**

## Run

```bash
cd spikes/docx-roundtrip
cargo test                 # the proof (6 tests)
cargo run --bin gen_fixture   # regenerate fixtures/with-tracked-changes.docx
cargo run --bin gen_authored -- /tmp/authored.docx   # AI-redlined sample
python3 scripts/independent_validate.py fixtures/with-tracked-changes.docx
```

## Layout

| File | Role |
|---|---|
| `src/model.rs` | In-memory DOM model; revisions + comments are first-class typed nodes |
| `src/package.rs` | OOXML ZIP read/write + static plumbing parts (content-types, rels) |
| `src/parse.rs` | `document.xml` + `comments.xml` → model, preserving revision markup |
| `src/serialize.rs` | model → valid `.docx` (deterministic, well-formed) |
| `src/fixture.rs` | Programmatic minimal `.docx` with existing tracked changes + a comment |
| `src/author.rs` | "AI authoring": add new `w:author="Keepance AI"` revisions |
| `src/validate.rs` | Vendor-free structural validation (well-formedness, parts, schema-plausibility) |
| `tests/roundtrip.rs` | TEST A (preservation) + TEST B (authoring) + fixture validity |
| `tests/python_validate.rs` | Independent `python-docx` cross-check (auto-skips if absent) |
| `fixtures/with-tracked-changes.docx` | Committed, reproducible test fixture |
