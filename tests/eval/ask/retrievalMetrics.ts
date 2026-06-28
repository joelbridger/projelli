/**
 * Retrieval-quality metrics (WS3b).
 *
 * Pure, dependency-free ranking metrics over a list of retrieved SOURCE
 * documents (basenames, best rank per document) and the set of RELEVANT source
 * documents for a query. These are the numbers a future retrieval reranker must
 * BEAT, so they are defined here once, unit-tested deterministically (no model),
 * and reused by both the TypeScript baseline check and — mirrored — the Rust
 * real-retrieval baseline (`src-tauri/tests/rag_retrieval_quality.rs`).
 *
 * Binary relevance is used throughout (a source is relevant or it is not), which
 * is the right model for "did the engine surface the correct document?".
 *
 * Conventions (standard IR):
 *   - ranks are 1-based; position 1 is the top hit.
 *   - DCG@k       = Σ_{i=1..k} rel_i / log2(i + 1)        (rel_i ∈ {0,1})
 *   - IDCG@k      = Σ_{i=1..min(k,R)} 1 / log2(i + 1)     (R = #relevant)
 *   - NDCG@k      = DCG@k / IDCG@k   (1.0 when the relevant docs fill the top)
 *   - P@k         = (#relevant in top k) / k
 *   - RR          = 1 / rank(first relevant), or 0 if none retrieved
 *   - Hit@k       = 1 if any relevant doc is in the top k, else 0
 */

/** 1-based rank of the first relevant source, or null if none are present. */
export function firstRelevantRank(ranked: readonly string[], relevant: ReadonlySet<string>): number | null {
  for (let i = 0; i < ranked.length; i++) {
    if (relevant.has(ranked[i]!)) return i + 1;
  }
  return null;
}

/** Reciprocal rank: 1 / rank of the first relevant source (0 if none). */
export function reciprocalRank(ranked: readonly string[], relevant: ReadonlySet<string>): number {
  const r = firstRelevantRank(ranked, relevant);
  return r === null ? 0 : 1 / r;
}

/** Precision@k: fraction of the top-k slots that are relevant. */
export function precisionAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  if (k <= 0) return 0;
  let hits = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) {
    if (relevant.has(ranked[i]!)) hits++;
  }
  return hits / k;
}

/** Hit@k (a.k.a. recall@k for a single relevant doc): is any relevant doc in top k? */
export function hitAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): boolean {
  const r = firstRelevantRank(ranked, relevant);
  return r !== null && r <= k;
}

/** Discounted cumulative gain over the top k, binary relevance. */
export function dcgAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  let dcg = 0;
  for (let i = 0; i < Math.min(k, ranked.length); i++) {
    if (relevant.has(ranked[i]!)) {
      // position p = i + 1 → discount log2(p + 1)
      dcg += 1 / Math.log2(i + 2);
    }
  }
  return dcg;
}

/** Ideal DCG@k: relevant docs packed into the top positions. */
export function idealDcgAtK(relevantCount: number, k: number): number {
  let idcg = 0;
  for (let i = 0; i < Math.min(k, relevantCount); i++) {
    idcg += 1 / Math.log2(i + 2);
  }
  return idcg;
}

/** Normalized DCG@k (0..1). 1.0 when IDCG is 0 (no relevant docs defined). */
export function ndcgAtK(ranked: readonly string[], relevant: ReadonlySet<string>, k: number): number {
  const idcg = idealDcgAtK(relevant.size, k);
  if (idcg === 0) return 0;
  return dcgAtK(ranked, relevant, k) / idcg;
}

/** Per-case retrieval outcome: a ranked list of source basenames + the relevant set. */
export interface RetrievalOutcome {
  id: string;
  /** Distinct source basenames in retrieved order (best rank per document). */
  rankedSources: string[];
  /** Relevant source basename(s) for this query. */
  expectedSources: string[];
}

export interface RetrievalMetricsSummary {
  n: number;
  mrr: number;
  ndcgAt5: number;
  pAt1: number;
  pAt3: number;
  pAt5: number;
  hitAt1: number;
  hitAt3: number;
  hitAt5: number;
}

function mean(xs: number[]): number {
  return xs.length === 0 ? 0 : xs.reduce((a, b) => a + b, 0) / xs.length;
}

/** Aggregate per-case outcomes into the headline retrieval metrics. */
export function summarizeRetrieval(outcomes: readonly RetrievalOutcome[]): RetrievalMetricsSummary {
  const rr: number[] = [];
  const ndcg5: number[] = [];
  const p1: number[] = [];
  const p3: number[] = [];
  const p5: number[] = [];
  const h1: number[] = [];
  const h3: number[] = [];
  const h5: number[] = [];
  for (const o of outcomes) {
    const relevant = new Set(o.expectedSources);
    rr.push(reciprocalRank(o.rankedSources, relevant));
    ndcg5.push(ndcgAtK(o.rankedSources, relevant, 5));
    p1.push(precisionAtK(o.rankedSources, relevant, 1));
    p3.push(precisionAtK(o.rankedSources, relevant, 3));
    p5.push(precisionAtK(o.rankedSources, relevant, 5));
    h1.push(hitAtK(o.rankedSources, relevant, 1) ? 1 : 0);
    h3.push(hitAtK(o.rankedSources, relevant, 3) ? 1 : 0);
    h5.push(hitAtK(o.rankedSources, relevant, 5) ? 1 : 0);
  }
  return {
    n: outcomes.length,
    mrr: mean(rr),
    ndcgAt5: mean(ndcg5),
    pAt1: mean(p1),
    pAt3: mean(p3),
    pAt5: mean(p5),
    hitAt1: mean(h1),
    hitAt3: mean(h3),
    hitAt5: mean(h5),
  };
}

/** Render a metrics summary as a compact, human-readable block for test output. */
export function formatRetrievalSummary(s: RetrievalMetricsSummary, label = 'retrieval'): string {
  const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
  const num = (x: number) => x.toFixed(4);
  return [
    `── ${label} baseline (n=${s.n}) ─────────────────────────────`,
    `   MRR        ${num(s.mrr)}`,
    `   NDCG@5     ${num(s.ndcgAt5)}`,
    `   P@1        ${num(s.pAt1)}   P@3 ${num(s.pAt3)}   P@5 ${num(s.pAt5)}`,
    `   Hit@1      ${pct(s.hitAt1)}   Hit@3 ${pct(s.hitAt3)}   Hit@5 ${pct(s.hitAt5)}`,
    `────────────────────────────────────────────────────────────`,
  ].join('\n');
}
