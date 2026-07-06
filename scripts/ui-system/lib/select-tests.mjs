/**
 * UI Iteration System — pure test-selection logic (unit-tested).
 *
 * Round-2 review P1: the Tier S gate only PRINTED "run your scoped tests". It
 * must auto-select the tests for the changed files and FAIL when none run. This
 * maps changed files to their component tests; gate-tier.mjs runs the result and
 * fails on an empty selection.
 */

/**
 * @param {string[]} changedFiles
 * @param {(path: string) => boolean} exists  fs existence probe (injectable)
 * @param {(basename: string) => string[]} [findByBasename] optional: locate
 *        non-co-located tests under tests/ by basename (gate-tier supplies a
 *        real fs walker; tests can omit it)
 * @returns {string[]} unique existing test files to run
 */
export function selectTests(changedFiles, exists, findByBasename) {
  const out = new Set();
  const isTest = (f) => /\.(test|spec)\.(tsx?|mjs)$/.test(f);
  for (const f of changedFiles) {
    if (isTest(f)) {
      if (exists(f)) out.add(f);
      continue;
    }
    if (!/\.(tsx?)$/.test(f)) continue;
    if (!(f.startsWith('src/ui/') || f.startsWith('src/app/') || f.startsWith('src/features/'))) continue;
    const base = f.replace(/\.tsx?$/, '');
    for (const cand of [`${base}.test.tsx`, `${base}.test.ts`, `${base}.spec.tsx`, `${base}.spec.ts`]) {
      if (exists(cand)) out.add(cand);
    }
    if (findByBasename) {
      const bn = base.split('/').pop();
      for (const hit of findByBasename(bn)) out.add(hit);
    }
  }
  return [...out];
}
