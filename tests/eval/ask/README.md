# Ask answer-quality eval

A small, extensible scorecard for the single most important thing an AI product
does: **give good, grounded answers.** Other tests prove the AI *can't fake
citations*; this one proves it *gives the right answer, cites the right source,
and declines when it doesn't know.*

## The two layers

| Layer | Model | When | What it proves |
|---|---|---|---|
| **Gate** (`ask-eval.gate.test.ts`) | MockProvider (scripted) | every `npm run gate` | The grader + rubric are correct and discriminate good answers from bad ones. Fast, free, deterministic. |
| **Nightly** (`realModel.eval.test.ts`) | a real model (OpenAI/Claude) | scheduled, opt-in | The *live* model still answers well over the corpus; drift is reported to Jameson. |

The gate never calls a real model. The nightly is skipped unless `ASK_EVAL_REAL=1`
and an API key are set.

## How it works

Each **case** (`cases.ts`) is a question over a fixed slice of the eval **corpus**
(`corpus/*.md` — the Johnson employment matter and the Acme contract matter,
mirroring `tests/fixtures/matter-corpus/`). A case declares its expectation:

- `expect: 'answer'` → must answer, with the required **grounded** citation
  (`mustCite`), the right facts (`mustInclude`), and no fabrication
  (`mustNotInclude`).
- `expect: 'decline'` → the answer is not in the context, so the model must say
  it can't find it instead of guessing.

The **harness** (`harness.ts`) builds the *exact* prompt the app ships
(`buildAskSystemPrompt` + `buildWorkspaceContextBlock`, the same functions
`useAsk.ts` uses), asks the provider, and the **grader** (`grade.ts`) scores the
answer. "Grounded" means what it means in the product: the citation resolves to
the cited file *and the exact retrieved paragraph* (`resolveCitationTarget`,
BUG-065) — so an answer can't pass by citing a file it never grounded.

Every case also ships a `gold` answer (should pass) and `traps` (should fail).
The gate asserts golds pass and traps fail — the traps are the negative control
that keeps the grader honest.

## Add a case

1. If you need a new fact, add it to a `corpus/*.md` file (one fact per
   paragraph; blank lines separate paragraphs; paragraph index is 0-based).
2. Add an `EvalCase` to `cases.ts` with `sources` (which paragraphs are
   "retrieved"), `expect`, the `mustCite`/`mustInclude`/`mustNotInclude` checks,
   a `rubric` (for the nightly judge), a `gold` answer, and at least one `trap`.
3. Run `npx vitest run tests/eval/ask/ask-eval.gate.test.ts`. The gate will tell
   you if your gold doesn't pass or a trap doesn't fail.

## Run it

```bash
# Gate (deterministic, part of the normal gate)
npx vitest run tests/eval/ask/ask-eval.gate.test.ts

# Nightly (real model) — needs a key
OPENAI_API_KEY=sk-... node scripts/eval/ask-nightly.mjs
ASK_EVAL_PROVIDER=anthropic ANTHROPIC_API_KEY=... node scripts/eval/ask-nightly.mjs

# First trusted run sets the baseline:
OPENAI_API_KEY=sk-... node scripts/eval/ask-nightly.mjs --update-baseline
```

The nightly writes `results/latest.json` (gitignored), compares the pass rate to
`baseline.json` (committed), and notifies Jameson — `MILESTONE` when steady,
`NEED YOU` on a regression. Tune the floor with `ASK_EVAL_FLOOR` /
`ASK_EVAL_TOLERANCE`; pick the model with `ASK_EVAL_MODEL`.

To schedule it, add the cron line in the header of `scripts/eval/ask-nightly.mjs`.

## Retrieval quality + citation faithfulness (WS3b)

The answer eval above tests the ANSWER given retrieval. Two further tests measure
the layers underneath it — and establish the **measurement baseline** a future
retrieval reranker must beat.

### 1. Retrieval quality — `retrieval-quality.test.ts` + `rag_retrieval_quality.rs`

"Did the engine rank the RIGHT document highly?" measured as **MRR, NDCG@5,
Precision@{1,3,5}, Hit@{1,3,5}** over an adversarial distractor corpus (two
confusable clients "Marcus Johnson" / "Marcus Johnston" with conflicting facts, a
confusable company "Nexus Diagnostics" / "Nexus Dynamics", and rare long-tail
keywords). Cases live in `retrievalCases.ts`; metrics in `retrievalMetrics.ts`.

The product's retrieval path (fastembed **e5-small** + LanceDB) is native Rust —
there is no JS embedder — so the REAL numbers are produced by the Rust
integration test `src-tauri/tests/rag_retrieval_quality.rs`, over the SAME shared
corpus (`corpus/*.md` + `corpus/manifest.json`). It prints the metrics, holds a
regression floor, and writes `results/retrieval-latest.json`. The committed
`retrieval-baseline.json` is the frozen reference.

The TS test is always model-free in the gate: it unit-tests the metric math,
checks case integrity, and validates + prints the committed baseline (recomputing
its metrics from the per-case ranked lists). When a fresh real run is present it
cross-checks the Rust-computed summary against a TS recomputation (catches metric
drift). It **skips gracefully** when the run artifact is absent.

```bash
# TS layer (gate — metric math + committed-baseline validation, no model)
npx vitest run tests/eval/ask/retrieval-quality.test.ts

# REAL baseline — needs the e5-small model cache provisioned. REQUIRE_RAG_MODEL=1
# turns a missing model into a hard failure instead of a silent skip (matches the
# other RAG integration tests). Provision the model by running the app once, or
# populate <data_dir>/keepance/models/e5-small.
REQUIRE_RAG_MODEL=1 cargo test -p keepance --test rag_retrieval_quality -- --nocapture
```

**Baseline (measured 2026-06-28, multilingual-e5-small, n=15):** MRR 0.933 ·
NDCG@5 0.951 · P@1 0.867 · Hit@1 0.867 · Hit@3 1.000 · Hit@5 1.000. (P@3/P@5 are
intentionally low — most queries have a single relevant document, so P@3 maxes at
0.333 and P@5 at 0.200; MRR / NDCG@5 / Hit@K are the meaningful signals.)

### 2. Citation faithfulness — `citation-faithfulness.test.ts`

"Does every citation resolve to a real chunk whose text actually supports the
claim?" For each gold answer it verifies, via the product's own
`parseCitations` / `resolveCitationTarget`, that (a) every citation resolves to a
retrieved chunk, (b) every required fact appears in the TEXT of a chunk the answer
cited, and (c) a decline never cites. A curated negative control (dangling,
cross-client, same-locator drift, confusable-company, decline-that-cites) must be
caught — each for its named reason. Deterministic, no model, runs in the gate.

```bash
npx vitest run tests/eval/ask/citation-faithfulness.test.ts
```

## Why MockProvider for the gate?

We can't run real RAG (LanceDB/embeddings are native Rust) or a real model inside
the unit-test gate, and we don't want to. The gate's job is to lock the *eval
itself* — the rubric, the grounding check, the harness wiring — deterministically
and for free. Measuring the actual live model is the nightly's job.
