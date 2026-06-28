/**
 * Retrieval-quality eval (WS3b).
 *
 * The MEASUREMENT BASELINE a future retrieval reranker must BEAT: for a set of
 * (query, expected source, scope) cases over the adversarial distractor corpus,
 * how well does retrieval rank the RIGHT document? Headline metrics: MRR,
 * NDCG@5, Precision@{1,3,5}, Hit@{1,3,5}.
 *
 * WHERE THE REAL NUMBERS COME FROM. The product's retrieval path (fastembed
 * e5-small + LanceDB) is native Rust — there is no JS embedder — so the real
 * measurement runs in the Rust integration test
 * `src-tauri/tests/rag_retrieval_quality.rs`, over the SAME shared corpus. That
 * test prints the metrics, asserts a regression floor, and writes
 * `results/retrieval-latest.json`. The committed `retrieval-baseline.json` is the
 * frozen reference snapshot.
 *
 * WHAT THIS TS FILE DOES (always model-free, runs in the normal gate):
 *   1. unit-tests the metric MATH (`retrievalMetrics.ts`) deterministically, so
 *      the definitions the baseline is reported in are locked;
 *   2. checks the retrieval CASES are well-formed and keep their distractor
 *      coverage;
 *   3. validates + PRINTS the committed baseline, recomputing its metrics from
 *      the per-case ranked lists with the SAME TS metric functions (so the
 *      committed numbers can't silently rot), and holds the documented floor;
 *   4. when a fresh REAL run is present (`results/retrieval-latest.json`, written
 *      by the Rust test under `REQUIRE_RAG_MODEL=1`), recomputes its metrics in
 *      TS and cross-checks them against the Rust-computed summary — catching any
 *      TS↔Rust metric drift — then prints + holds the floor. It SKIPS GRACEFULLY
 *      when that artifact is absent (the model isn't provisioned / no run yet).
 *
 * To produce / refresh the real numbers:
 *   REQUIRE_RAG_MODEL=1 cargo test -p keepance --test rag_retrieval_quality -- --nocapture
 */

import { describe, it, expect } from 'vitest';
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { CORPUS_DOCS, DOC_MATTER } from './corpus';
import { RETRIEVAL_CASES } from './retrievalCases';
import { gradeRetrieval } from './grade';
import {
  reciprocalRank,
  precisionAtK,
  hitAtK,
  ndcgAtK,
  dcgAtK,
  summarizeRetrieval,
  formatRetrievalSummary,
  type RetrievalMetricsSummary,
  type RetrievalOutcome,
} from './retrievalMetrics';

const HERE = dirname(fileURLToPath(import.meta.url));
const BASELINE_PATH = join(HERE, 'retrieval-baseline.json');
const LATEST_PATH = join(HERE, 'results', 'retrieval-latest.json');

/** Documented regression floor — kept in lockstep with the Rust test's floor.
 *  A margin below the measured baseline so jitter never reds, real drops do. */
const FLOOR_MRR = 0.7;
const FLOOR_HIT3 = 0.8;

interface BaselineFile {
  model: string;
  summary: RetrievalMetricsSummary & Record<string, number>;
  cases: Array<{
    id: string;
    scope: string;
    expectedSources: string[];
    rankedSources: string[];
    reciprocalRank: number;
  }>;
}

function loadJson<T>(path: string): T {
  return JSON.parse(readFileSync(path, 'utf8')) as T;
}

/** Recompute the headline summary from a baseline file's per-case ranked lists,
 *  using the SAME TS metric functions — the cross-check against the recorded
 *  (Rust-computed) summary. */
function recompute(file: BaselineFile): RetrievalMetricsSummary {
  const outcomes: RetrievalOutcome[] = file.cases.map((c) => ({
    id: c.id,
    rankedSources: c.rankedSources,
    expectedSources: c.expectedSources,
  }));
  return summarizeRetrieval(outcomes);
}

/* ───────────────────────── 1. metric math (no model) ───────────────────── */

describe('retrieval metrics — pure math (deterministic)', () => {
  it('perfect ranking scores 1 everywhere', () => {
    const ranked = ['a.md'];
    const rel = new Set(['a.md']);
    expect(reciprocalRank(ranked, rel)).toBe(1);
    expect(precisionAtK(ranked, rel, 1)).toBe(1);
    expect(hitAtK(ranked, rel, 1)).toBe(true);
    expect(ndcgAtK(ranked, rel, 5)).toBeCloseTo(1, 10);
  });

  it('relevant at rank 2: RR = 0.5, miss@1, hit@3, NDCG = 1/log2(3)', () => {
    const ranked = ['x.md', 'a.md', 'y.md'];
    const rel = new Set(['a.md']);
    expect(reciprocalRank(ranked, rel)).toBeCloseTo(0.5, 10);
    expect(hitAtK(ranked, rel, 1)).toBe(false);
    expect(hitAtK(ranked, rel, 3)).toBe(true);
    expect(precisionAtK(ranked, rel, 1)).toBe(0);
    expect(precisionAtK(ranked, rel, 3)).toBeCloseTo(1 / 3, 10);
    expect(ndcgAtK(ranked, rel, 5)).toBeCloseTo(1 / Math.log2(3), 10);
  });

  it('no relevant document retrieved scores 0', () => {
    const ranked = ['x.md', 'y.md'];
    const rel = new Set(['a.md']);
    expect(reciprocalRank(ranked, rel)).toBe(0);
    expect(hitAtK(ranked, rel, 5)).toBe(false);
    expect(precisionAtK(ranked, rel, 5)).toBe(0);
    expect(ndcgAtK(ranked, rel, 5)).toBe(0);
  });

  it('multiple relevant docs: DCG and precision accumulate', () => {
    const ranked = ['a.md', 'x.md', 'b.md'];
    const rel = new Set(['a.md', 'b.md']);
    expect(precisionAtK(ranked, rel, 3)).toBeCloseTo(2 / 3, 10);
    // dcg = 1/log2(2) + 1/log2(4) = 1 + 0.5
    expect(dcgAtK(ranked, rel, 5)).toBeCloseTo(1.5, 10);
    // idcg(R=2) = 1/log2(2) + 1/log2(3)
    const idcg = 1 / Math.log2(2) + 1 / Math.log2(3);
    expect(ndcgAtK(ranked, rel, 5)).toBeCloseTo(1.5 / idcg, 10);
  });

  it('summarizeRetrieval aggregates per-case metrics correctly', () => {
    const s = summarizeRetrieval([
      { id: 'perfect', rankedSources: ['a.md'], expectedSources: ['a.md'] },
      { id: 'rank2', rankedSources: ['x.md', 'a.md'], expectedSources: ['a.md'] },
    ]);
    expect(s.n).toBe(2);
    expect(s.mrr).toBeCloseTo(0.75, 10); // (1 + 0.5)/2
    expect(s.pAt1).toBeCloseTo(0.5, 10); // (1 + 0)/2
    expect(s.hitAt1).toBeCloseTo(0.5, 10);
    expect(s.hitAt3).toBeCloseTo(1, 10);
    expect(s.ndcgAt5).toBeCloseTo((1 + 1 / Math.log2(3)) / 2, 10);
  });
});

describe('gradeRetrieval — "required hit in top_k?" gate', () => {
  const hits = (...paths: string[]) => paths.map((path) => ({ path }));

  it('passes when a relevant source is within top_k', () => {
    const g = gradeRetrieval({ expectedSources: ['a.md'], topK: 3 }, hits('x.md', 'a.md', 'y.md'));
    expect(g.pass).toBe(true);
    expect(g.rankOfFirstRelevant).toBe(2);
  });

  it('fails when the relevant source is beyond top_k', () => {
    const g = gradeRetrieval({ expectedSources: ['a.md'], topK: 1 }, hits('x.md', 'a.md'));
    expect(g.pass).toBe(false);
    expect(g.rankOfFirstRelevant).toBe(2);
  });

  it('fails when no relevant source was retrieved', () => {
    const g = gradeRetrieval({ expectedSources: ['a.md'], topK: 5 }, hits('x.md', 'y.md'));
    expect(g.pass).toBe(false);
    expect(g.rankOfFirstRelevant).toBeNull();
  });

  it('dedupes to the BEST rank per document (and matches by basename)', () => {
    // The same doc appears twice (two chunks); rank should be its first slot,
    // and a full path resolves to the same basename as a relevant bare name.
    const g = gradeRetrieval(
      { expectedSources: ['a.md'], topK: 3 },
      hits('x.md', '/deep/a.md', 'a.md'),
    );
    expect(g.rankedSources).toEqual(['x.md', 'a.md']);
    expect(g.rankOfFirstRelevant).toBe(2);
    expect(g.pass).toBe(true);
  });
});

/* ───────────────────────── 2. cases integrity ──────────────────────────── */

describe('retrieval cases — integrity + distractor coverage', () => {
  it('has a healthy, uniquely-identified case set', () => {
    expect(RETRIEVAL_CASES.length).toBeGreaterThanOrEqual(10);
    expect(new Set(RETRIEVAL_CASES.map((c) => c.id)).size).toBe(RETRIEVAL_CASES.length);
  });

  it('every expected source is a real corpus document', () => {
    const docs = new Set<string>(CORPUS_DOCS);
    for (const c of RETRIEVAL_CASES) {
      expect(c.expectedSources.length, `${c.id} has no expected source`).toBeGreaterThan(0);
      for (const s of c.expectedSources) {
        expect(docs.has(s), `${c.id} expects unknown doc ${s}`).toBe(true);
      }
    }
  });

  it('keeps the distractor coverage that makes the eval meaningful', () => {
    const tags = new Set(RETRIEVAL_CASES.flatMap((c) => c.tags));
    // The three trap families the distractor corpus exists to exercise.
    expect(tags.has('confusable-name')).toBe(true);
    expect(tags.has('confusable-company')).toBe(true);
    expect(tags.has('long-tail')).toBe(true);
  });

  it('matter-scoped cases reference real matters', () => {
    const matters = new Set(Object.values(DOC_MATTER));
    for (const c of RETRIEVAL_CASES) {
      if (c.scope.kind === 'matter') {
        expect(matters.has(c.scope.matterId), `${c.id} bad matter ${c.scope.matterId}`).toBe(true);
      }
    }
  });
});

/* ───────────────────── 3. committed baseline validation ─────────────────── */

// The committed baseline is a TRACKED reference file (not the gitignored transient
// run artifact), so its ABSENCE is a real failure — an accidental delete or a
// packaging/path mistake — not a reason to skip. This block always runs and reds
// the gate if the file is gone, instead of silently passing. (Only the fresh real
// run below is legitimately skippable when the model isn't provisioned.)
describe('retrieval baseline — committed reference (a reranker must beat this)', () => {
  it('the committed baseline file exists (tracked reference, not optional)', () => {
    expect(
      existsSync(BASELINE_PATH),
      `${BASELINE_PATH} is missing — it is a committed reference; restore it (or regenerate via the Rust baseline + commit).`,
    ).toBe(true);
  });

  it('covers every retrieval case', () => {
    const file = loadJson<BaselineFile>(BASELINE_PATH);
    const ids = new Set(file.cases.map((c) => c.id));
    for (const c of RETRIEVAL_CASES) {
      expect(ids.has(c.id), `baseline missing case ${c.id}`).toBe(true);
    }
  });

  it('its recorded summary matches a TS recomputation from the ranked lists', () => {
    const file = loadJson<BaselineFile>(BASELINE_PATH);
    const recomputed = recompute(file);
    for (const k of ['mrr', 'ndcgAt5', 'pAt1', 'pAt3', 'pAt5', 'hitAt1', 'hitAt3', 'hitAt5'] as const) {
      expect(recomputed[k], `baseline summary.${k} != TS recomputation`).toBeCloseTo(file.summary[k], 6);
    }
  });

  it('PRINTS the baseline and holds the documented floor', () => {
    const file = loadJson<BaselineFile>(BASELINE_PATH);
    const s = recompute(file);
     
    console.log(`\n[retrieval-quality] COMMITTED baseline (${file.model}):\n${formatRetrievalSummary(s, 'committed')}`);
    expect(s.mrr, `committed MRR below floor ${FLOOR_MRR}`).toBeGreaterThanOrEqual(FLOOR_MRR);
    expect(s.hitAt3, `committed Hit@3 below floor ${FLOOR_HIT3}`).toBeGreaterThanOrEqual(FLOOR_HIT3);
  });

  it('per case: the required source is within top_k (gradeRetrieval gate)', () => {
    const file = loadJson<BaselineFile>(BASELINE_PATH);
    const byId = new Map(file.cases.map((c) => [c.id, c]));
    for (const rc of RETRIEVAL_CASES) {
      const baselineCase = byId.get(rc.id);
      expect(baselineCase, `baseline missing ${rc.id}`).toBeDefined();
      // Reconstruct a ranked RagHit-like list from the recorded order and run the
      // product-shaped "required hit in top_k?" grader over it.
      const hits = baselineCase!.rankedSources.map((path) => ({ path }));
      const grade = gradeRetrieval({ expectedSources: rc.expectedSources, topK: rc.topK }, hits);
      expect(
        grade.pass,
        `${rc.id}: ${grade.checks.map((c) => c.detail).filter(Boolean).join('; ')}`,
      ).toBe(true);
    }
  });
});

/* ─────────────── 4. fresh REAL-run cross-check (REQUIRE_RAG_MODEL) ───────── */

const hasLatest = existsSync(LATEST_PATH);

describe.skipIf(!hasLatest)('retrieval baseline — fresh real run cross-check', () => {
  it('TS recomputation matches the Rust-computed summary (no metric drift)', () => {
    const file = loadJson<BaselineFile>(LATEST_PATH);
    const recomputed = recompute(file);
    for (const k of ['mrr', 'ndcgAt5', 'pAt1', 'pAt3', 'pAt5', 'hitAt1', 'hitAt3', 'hitAt5'] as const) {
      expect(recomputed[k], `Rust summary.${k} != TS recomputation`).toBeCloseTo(file.summary[k], 6);
    }
  });

  it('PRINTS the fresh metrics and holds the documented floor', () => {
    const file = loadJson<BaselineFile>(LATEST_PATH);
    const s = recompute(file);
     
    console.log(`\n[retrieval-quality] FRESH real run (${file.model}):\n${formatRetrievalSummary(s, 'fresh-run')}`);
    expect(s.mrr).toBeGreaterThanOrEqual(FLOOR_MRR);
    expect(s.hitAt3).toBeGreaterThanOrEqual(FLOOR_HIT3);
  });
});

// Visibility: when no FRESH real run is present, say how to produce one (the
// committed baseline is validated unconditionally above; only the live run is
// optional and gated on the e5-small model being provisioned).
if (!hasLatest) {
  console.log(
    '\n[retrieval-quality] No fresh real-run artifact (results/retrieval-latest.json) — ' +
      'the committed baseline + metric math are still validated. To refresh the REAL baseline, run:\n' +
      '  REQUIRE_RAG_MODEL=1 cargo test -p keepance --test rag_retrieval_quality -- --nocapture\n',
  );
}
