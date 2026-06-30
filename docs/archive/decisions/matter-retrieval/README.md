# matter-retrieval — Advisor Prep Hero 3.0 de-risking spike (P0 gate 2)

Standalone Rust crate proving **matter-scoped, exact-source cited retrieval over
a mixed documents + email corpus** using the SAME stack the app ships
(LanceDB 0.21 vector store + fastembed e5-small, 384-dim), with one addition: a
`matter_id` column written at index time and a store-level SQL `only_if`
prefilter applied at query time.

This is a **learning spike**, deliberately NOT wired into the Tauri build so
tests are fast and isolated. The proven design extends the real
`src-tauri/src/commands/rag/` store schema + `Hit` + `rag_retrieve` API.

**Read [`FEASIBILITY.md`](./FEASIBILITY.md) for the verdict and recommended design.**

## The three properties proven (the gate)

1. **Exact-source cited retrieval over a MIXED corpus** — a natural-language
   query returns the right chunk with a citation that resolves to the precise
   source (document path or `mail:<id>`, plus paragraph/page), across documents
   AND emails.
2. **Matter isolation** — a query scoped to Matter A returns ONLY Matter-A
   sources; Matter-B content is never returned. Enforced by a LanceDB
   **prefilter** (`only_if`, `prefilter = true`), not by UI hiding, and proven
   against an adversarial confusable pair (both matters mention a "closing date").
3. **Citation verification** — given a citation an answer relies on, verify the
   cited chunk exists, is in the claimed matter, and its text matches the quote
   (so the app can refuse an answer whose citation does not verify).

## Run

```bash
cd spikes/matter-retrieval
cargo test            # the proof (11 tests). First run downloads e5-small (~120MB).
cargo run --bin demo  # human-readable walkthrough of all three properties
```

## Layout

| File | Role |
|---|---|
| `src/corpus.rs` | The 2-matter mixed corpus (2 docs + 2 emails each) incl. the confusable "closing date" pair |
| `src/lib.rs` | Schema (+`matter_id`/`source_id`), chunker, e5 embedder, `retrieve(scope)`, `verify_citation` |
| `src/bin/demo.rs` | Runnable demonstration of properties 1–3 |
| `tests/gate.rs` | The proof: 3 tests for P1, 4 for P2 (incl. adversarial), 4 for P3 |
| `corpus/*.md`, `corpus/*.eml` | Human-readable mirror of the corpus (inspection only) |
