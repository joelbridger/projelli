/**
 * Retrieval-quality eval cases (WS3b).
 *
 * Each case is a natural-language QUERY plus the SOURCE document(s) that are
 * actually relevant to it, and the confidentiality scope it is asked under. The
 * retrieval engine must rank the right document highly; the metrics in
 * `retrievalMetrics.ts` score how well it does, against the distractor corpus.
 *
 * The corpus is deliberately adversarial (see `corpus/*.md` + `corpus.ts`):
 *   - TWO confusable clients, "Marcus Johnson" (Nexus Dynamics, matter-johnson)
 *     and "Marcus Johnston" (Pinnacle Logistics, matter-johnston), with
 *     parallel-but-conflicting facts (4 vs 6 weeks severance, $425 vs $390/hr,
 *     different deadlines, different supervisors);
 *   - a confusable COMPANY, "Nexus Diagnostics Inc." vs the Johnson matter's
 *     "Nexus Dynamics Corp.";
 *   - RARE long-tail keywords that appear in exactly one document
 *     ("Telomere Assay Confidentiality Rider", "TA-204").
 * Most cases run UNSCOPED (`allMatters`) so the embedding — not a matter
 * prefilter — has to disambiguate; a couple run matter-scoped to confirm scoped
 * recall. These are the "retrieved the wrong client's document" traps.
 *
 * This list is the SOURCE OF TRUTH for the retrieval cases. The Rust real-
 * retrieval baseline (`src-tauri/tests/rag_retrieval_quality.rs`) mirrors the
 * same (id, query, expected, scope) tuples; the committed baseline + any fresh
 * run are joined back to this list by `id`.
 */

export type RetrievalScopeSel =
  | { kind: 'allMatters' }
  | { kind: 'matter'; matterId: string };

export interface RetrievalCase {
  id: string;
  query: string;
  /** Relevant source basename(s). Element 0 is the single best ("top") source. */
  expectedSources: string[];
  scope: RetrievalScopeSel;
  /** Cutoff for the "required hit in top K?" gate (also the retrieve top_k). */
  topK: number;
  /** What bug this case guards / why it is a distractor. */
  note: string;
  tags: string[];
}

const ALL: RetrievalScopeSel = { kind: 'allMatters' };

export const RETRIEVAL_CASES: RetrievalCase[] = [
  /* ── Confusable CLIENTS — the embedding must pick the right Marcus ───────── */
  {
    id: 'r-johnson-severance',
    query: 'How many weeks of severance was Marcus Johnson offered?',
    expectedSources: ['johnson-deposition.md'],
    scope: ALL,
    topK: 10,
    note: 'Confusable client: must rank the Johnson deposition over the near-identical Johnston deposition.',
    tags: ['confusable-name', 'severance'],
  },
  {
    id: 'r-johnston-severance',
    query: 'How many weeks of severance was Marcus Johnston offered by Pinnacle Logistics?',
    expectedSources: ['johnston-deposition.md'],
    scope: ALL,
    topK: 10,
    note: 'Confusable client (mirror): must rank the Johnston deposition over the Johnson deposition.',
    tags: ['confusable-name', 'severance'],
  },
  {
    id: 'r-johnson-rate',
    query: 'What hourly rate did Marcus Johnson agree to in his engagement letter?',
    expectedSources: ['johnson-engagement-letter.md'],
    scope: ALL,
    topK: 10,
    note: 'Conflicting fact: Johnson ($425) vs Johnston ($390) engagement letters; must pick Johnson’s.',
    tags: ['confusable-name', 'rate'],
  },
  {
    id: 'r-johnston-rate',
    query: 'What hourly attorney rate did Marcus Johnston agree to?',
    expectedSources: ['johnston-engagement-letter.md'],
    scope: ALL,
    topK: 10,
    note: 'Conflicting fact (mirror): must pick the Johnston engagement letter ($390), not Johnson’s.',
    tags: ['confusable-name', 'rate'],
  },
  {
    id: 'r-johnston-employer',
    query: 'Which company is Marcus Johnston suing for wrongful termination?',
    expectedSources: ['johnston-deposition.md'],
    scope: ALL,
    topK: 10,
    note: 'Must surface Johnston (Pinnacle Logistics), not the Johnson/Nexus Dynamics deposition.',
    tags: ['confusable-name'],
  },
  {
    id: 'r-johnston-deadline',
    query: 'What written-response deadline did the HR team give Marcus Johnston?',
    expectedSources: ['johnston-deposition.md'],
    scope: ALL,
    topK: 10,
    note: 'Deadline distractor: Johnston (Nov 3) vs Johnson (Oct 17/Oct 10); must pick Johnston’s deposition.',
    tags: ['confusable-name', 'deadline'],
  },
  {
    id: 'r-johnson-attorney',
    query: 'Who is the responsible attorney for Marcus Johnson?',
    expectedSources: ['johnson-engagement-letter.md'],
    scope: ALL,
    topK: 10,
    note: 'Must rank the Johnson engagement letter (Marchetti) over Johnston’s (Brunswick).',
    tags: ['confusable-name'],
  },

  /* ── Rare long-tail keywords + confusable COMPANY ────────────────────────── */
  {
    id: 'r-telomere-rider',
    query: 'What does the Telomere Assay Confidentiality Rider cover?',
    expectedSources: ['nexus-diagnostics-nda.md'],
    scope: ALL,
    topK: 10,
    note: 'Rare long-tail term present in exactly one document; must retrieve the NDA.',
    tags: ['long-tail'],
  },
  {
    id: 'r-ta204-damages',
    query: 'What are the liquidated damages for disclosing the TA-204 assay methodology?',
    expectedSources: ['nexus-diagnostics-nda.md'],
    scope: ALL,
    topK: 10,
    note: 'Rare product code TA-204 ($25k) must beat Acme’s liquidated-damages clause ($500/day).',
    tags: ['long-tail', 'confusable-amount'],
  },
  {
    id: 'r-nexus-diagnostics-parties',
    query: 'Who are the parties to the Nexus Diagnostics non-disclosure agreement?',
    expectedSources: ['nexus-diagnostics-nda.md'],
    scope: ALL,
    topK: 10,
    note: 'Confusable company: Nexus Diagnostics (NDA) vs Nexus Dynamics (the Johnson employer).',
    tags: ['confusable-company'],
  },

  /* ── Acme contract recall (non-confusable controls) ──────────────────────── */
  {
    id: 'r-acme-term',
    query: 'What is the term length of the Acme Road Runner supply agreement?',
    expectedSources: ['acme-supply-agreement.md'],
    scope: ALL,
    topK: 10,
    note: 'Control: clear single relevant document; should rank top.',
    tags: ['control'],
  },
  {
    id: 'r-acme-product',
    query: 'What product does the Acme supply agreement cover?',
    expectedSources: ['acme-supply-agreement.md'],
    scope: ALL,
    topK: 10,
    note: 'Control: Widget Model X is unique to the Acme agreement.',
    tags: ['control'],
  },
  {
    id: 'r-acme-insurance',
    query: 'What cargo insurance must Road Runner carry under the agreement?',
    expectedSources: ['acme-supply-agreement.md'],
    scope: ALL,
    topK: 10,
    note: 'Control: cargo-insurance clause unique to the Acme supply agreement.',
    tags: ['control'],
  },

  /* ── Matter-scoped recall (scope prefilter, not just the embedding) ──────── */
  {
    id: 'r-scoped-johnson-severance',
    query: 'severance package offered and declined',
    expectedSources: ['johnson-deposition.md'],
    scope: { kind: 'matter', matterId: 'matter-johnson' },
    topK: 10,
    note: 'Scoped recall: within matter-johnson, the deposition is the relevant severance source.',
    tags: ['scoped'],
  },
  {
    id: 'r-scoped-johnston-rate',
    query: 'attorney hourly billing rate in the engagement letter',
    expectedSources: ['johnston-engagement-letter.md'],
    scope: { kind: 'matter', matterId: 'matter-johnston' },
    topK: 10,
    note: 'Scoped recall: within matter-johnston, the engagement letter holds the rate (no leak to Johnson’s).',
    tags: ['scoped'],
  },
];
