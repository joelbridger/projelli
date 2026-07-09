// scripts/bench-smoke/result.mjs — check result shape, summary aggregation, exit
// code policy. Kept dependency-free (no fs/child_process) so it's cheap to
// unit test.

export const STATUS = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  // Precondition for the check wasn't met (e.g. the workspace/OAuth/data state
  // the check needs doesn't exist yet) — distinct from FAIL because it isn't
  // evidence the feature is broken, just that this run couldn't exercise it.
  SETUP_BLOCKED: 'SETUP-BLOCKED',
  // Deliberately not run this pass (e.g. --only filtered it out).
  SKIPPED: 'SKIPPED',
  // A stub for a wave whose UI doesn't exist / isn't wired to a check yet.
  TODO: 'TODO',
});

export const OVERALL = Object.freeze({
  PASS: 'PASS',
  FAIL: 'FAIL',
  SETUP_BLOCKED: 'SETUP-BLOCKED',
  INCOMPLETE: 'INCOMPLETE',
});

const VALID_STATUSES = new Set(Object.values(STATUS));

/**
 * @param {object} fields
 * @param {string} fields.id - checklist id, e.g. "wave1-calendar-brief-export"
 * @param {string} fields.section - human section label matching the RUN-LOG headings
 * @param {string} fields.status - one of STATUS
 * @param {string} fields.detail - one-line human explanation of the verdict
 * @param {string[]} [fields.screenshots] - evidence file paths (relative to evidence dir)
 * @param {object|null} [fields.forensics] - best-effort failure evidence metadata
 * @param {number} [fields.durationMs]
 */
export function makeResult(fields) {
  const { id, section, status, detail } = fields;
  if (!id) throw new Error('makeResult: id is required');
  if (!section) throw new Error('makeResult: section is required');
  if (!VALID_STATUSES.has(status)) {
    throw new Error(`makeResult: invalid status "${status}" (expected one of ${[...VALID_STATUSES].join(', ')})`);
  }
  if (!detail) throw new Error('makeResult: detail is required (be honest about failure — no silent verdicts)');

  return {
    id,
    section,
    status,
    detail,
    screenshots: fields.screenshots ?? [],
    forensics: fields.forensics ?? null,
    durationMs: fields.durationMs ?? null,
  };
}

/**
 * Build the overall summary object written to summary.json.
 */
export function summarize(results, meta = {}) {
  const counts = { PASS: 0, FAIL: 0, [STATUS.SETUP_BLOCKED]: 0, SKIPPED: 0, TODO: 0 };
  for (const r of results) {
    counts[r.status] = (counts[r.status] ?? 0) + 1;
  }

  const failed = results.filter((r) => r.status === STATUS.FAIL);
  const blocked = results.filter((r) => r.status === STATUS.SETUP_BLOCKED);
  const incomplete = results.filter((r) => r.status === STATUS.TODO || r.status === STATUS.SKIPPED);

  let overall;
  if (failed.length > 0) overall = OVERALL.FAIL;
  else if (blocked.length > 0) overall = OVERALL.SETUP_BLOCKED;
  else if (incomplete.length > 0) overall = OVERALL.INCOMPLETE;
  else overall = OVERALL.PASS;

  return {
    overall,
    counts,
    generatedAt: meta.generatedAt ?? null,
    target: meta.target ?? null,
    live: meta.live ?? false,
    results,
  };
}

/**
 * Exit code policy: 0 only when every check that actually ran passed clean.
 * 1 = at least one real FAIL (evidence a feature is broken).
 * 3 = no FAIL, but at least one SETUP-BLOCKED (bench/data wasn't ready — needs
 *     attention, but isn't proof of a break).
 * 4 = no FAIL/SETUP-BLOCKED, but at least one TODO/SKIPPED. This is not green:
 *     it means the bench did not prove the full checklist yet.
 */
export function aggregateExitCode(results) {
  if (results.some((r) => r.status === STATUS.FAIL)) return 1;
  if (results.some((r) => r.status === STATUS.SETUP_BLOCKED)) return 3;
  if (results.some((r) => r.status === STATUS.TODO || r.status === STATUS.SKIPPED)) return 4;
  return 0;
}

/**
 * Render a compact markdown table for terminal/CI-log consumption, mirroring
 * the RUN-LOG.md "Summary" table style.
 */
export function toMarkdownTable(results) {
  const lines = ['| Check | Status | Detail |', '|---|---|---|'];
  for (const r of results) {
    const detail = String(r.detail).replace(/\|/g, '\\|').replace(/\n/g, ' ');
    lines.push(`| ${r.section} — ${r.id} | ${r.status} | ${detail} |`);
  }
  return lines.join('\n');
}
