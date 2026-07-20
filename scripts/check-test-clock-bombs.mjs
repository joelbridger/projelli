#!/usr/bin/env node
/**
 * scripts/check-test-clock-bombs.mjs
 *
 * ── A TEST THAT READS THE REAL WALL CLOCK IS A SCHEDULED FAILURE ─────────────
 * Green today, red on a date nobody chose, and invisible until that date.
 *
 * On 2026-07-20T10:00:00Z one such test turned the merge tip red for every
 * branch on the board, on a cause none of them owned. A second was armed for
 * 2026-08-10. Both were found by a hand-run 30-day clock sweep — by luck and
 * effort. This check exists so the next one is found BY CONSTRUCTION.
 *
 * ── THE SHAPE IS THE REPO'S OWN, NOT A SIXTH SPELLING ────────────────────────
 * `src/platform/flags/expiry.ts` already blocks forgotten dates: every flag
 * carries an explicit expiry, the checker enumerates the registry, and the
 * failure message NAMES each offender and tells you the two legal ways out.
 * This points that same shape at date literals in test files.
 *
 * ── THE RULE ─────────────────────────────────────────────────────────────────
 * A test file FAILS this check when it contains a hard-coded absolute date
 * literal that is still IN THE FUTURE and the file installs NO fake clock.
 * Two legal ways out, exactly as with flags:
 *   1. Pin the clock —  `vi.useFakeTimers({ toFake: ['Date'] })` +
 *      `vi.setSystemTime(new Date('<fixed instant>'))` in `beforeEach`, and
 *      `vi.useRealTimers()` in `afterEach`. `toFake: ['Date']` replaces the
 *      WHOLE Date (`Date.now()` AND `new Date()`) so the clock cannot TEAR, and
 *      leaves `setTimeout`/`setInterval` real so Testing Library still polls.
 *      Do NOT "fix" a bomb by moving the fixture date forward — that re-arms
 *      the same bomb with a longer fuse.
 *   2. Register it in `scripts/test-clock-bomb-registry.mjs` with a reason and
 *      the evidence that it is inert.
 *
 * ── SCOPE IS GROUND TRUTH, AND UNRESOLVABLE FAILS CLOSED ─────────────────────
 * The file list is `vitest list --filesOnly` — vitest's OWN resolution of its
 * own `include`/`exclude`, i.e. exactly the corpus the gate runs. Not
 * `git ls-files` (blind to untracked and gitignored files — confirmed four
 * times in this program), not a hand-typed seed list, not a glob re-spelled
 * here that could drift from vitest's. If vitest cannot list, or lists nothing,
 * or a listed file cannot be read, this check THROWS. "Found nothing" and
 * "could not look" produce the same clean output and must never be confused.
 *
 * ── WHAT THIS CHECK CANNOT DO (proven bound, not a hedge) ────────────────────
 * It is a LEXICAL check over a test file's own text. It therefore cannot see:
 *   (a) a bomb whose fuse is a PAST date — e.g. `expect(ageInDays(FIXED)).toBe(3)`
 *       is already red-bound and no future literal appears;
 *   (b) a bomb reached through an imported fixture module or a JSON file rather
 *       than a literal in the test itself;
 *   (c) a bomb with no literal at all — `src/platform/flags/expiry.test.ts`
 *       reads the flag registry and detonates on 2026-09-14 with no date in the
 *       test file whatsoever. THIS CHECK DOES NOT CATCH THAT ONE, and that is
 *       stated here rather than left for someone to discover.
 * The complete decider is behavioural, not lexical: run the corpus under a
 * whole-Date OFFSET clock set to a far-future instant and require it green.
 * That is `scripts/sweep-test-clock-bombs.mjs` in this same commit. This
 * lexical check is the cheap always-on belt; that sweep is the real proof.
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { pathToFileURL } from 'node:url';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { REGISTERED_CLOCK_READERS } from './test-clock-bomb-registry.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

/** Absolute-instant literal shapes. */
const ISO_DATETIME =
  /\b\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(?::\d{2}(?:\.\d{1,6})?)?(?:Z|[+-]\d{2}:?\d{2})?/g;
const ISO_DATE = /(?<![\dT:.\-])\d{4}-\d{2}-\d{2}(?![\dT\-])/g;

/**
 * Any fake-clock installation. Deliberately BROAD: a file that pins the clock
 * by ANY of these means has taken responsibility for its own time, and this
 * check's job is to catch files that took none. Being broad here can only make
 * the check quieter, never make it miss a file that reads the real clock —
 * and the behavioural sweep is the belt that does not depend on this pattern.
 */
const FAKE_CLOCK =
  /vi\.useFakeTimers|vi\.setSystemTime|jest\.useFakeTimers|jest\.setSystemTime|MockDate|mockdate|spyOn\(\s*Date\s*,|Date\.now\s*=|globalThis\.Date\s*=/;

/** Absolute instants a literal may express. Returns ms, or null if unparseable. */
function instantOf(literal) {
  const value = Date.parse(literal.length === 10 ? `${literal}T00:00:00Z` : literal);
  return Number.isFinite(value) ? value : null;
}

/** vitest's OWN resolution of its own corpus. Anything unresolvable throws. */
export function listVitestFiles(root = ROOT) {
  let output;
  try {
    output = execFileSync(
      resolve(root, 'node_modules/.bin/vitest'),
      ['list', '--filesOnly'],
      { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024, stdio: ['ignore', 'pipe', 'pipe'] }
    );
  } catch (error) {
    const detail = [error?.stdout, error?.stderr, error?.message].filter(Boolean).join('\n').trim();
    throw new Error(
      `check-test-clock-bombs: vitest could not list its own test corpus, so this check cannot ` +
        `know what it has not seen. An unlistable corpus is UNKNOWN, never empty.\n${detail}`
    );
  }
  const files = output
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => /\.(test|spec)\.(ts|tsx|js|jsx|mts|cts)$/.test(line));
  if (files.length === 0) {
    throw new Error(
      'check-test-clock-bombs: vitest listed ZERO test files. A corpus that resolves nothing is a ' +
        'broken oracle, not an empty project.'
    );
  }
  return files;
}

/**
 * @param {string[]} files      repo-relative test files (ground-truth scope)
 * @param {number}   nowMs      the instant "future" is measured against
 * @param {(f: string) => string} readFile
 * @param {Record<string, {literals: string[]}>} registry
 */
export function findScheduledFailures(files, nowMs, readFile, registry = REGISTERED_CLOCK_READERS) {
  const violations = [];
  let scanned = 0;
  let pinned = 0;
  let registeredHits = 0;
  for (const file of files) {
    let text;
    try {
      text = readFile(file);
    } catch (error) {
      // FAIL CLOSED. An unreadable in-scope file is UNKNOWN, never clean.
      throw new Error(
        `check-test-clock-bombs: a file in the derived scope could not be read: ${file} ` +
          `(${error?.message ?? error}). An unreadable file is not a clean file.`
      );
    }
    scanned += 1;
    const literals = [
      ...new Set([...(text.match(ISO_DATETIME) ?? []), ...(text.match(ISO_DATE) ?? [])]),
    ];
    const future = literals.filter((literal) => {
      const instant = instantOf(literal);
      return instant !== null && instant > nowMs;
    });
    if (future.length === 0) continue;
    if (FAKE_CLOCK.test(text)) {
      pinned += 1;
      continue;
    }
    // Registered file+LITERAL, not file. A new future date in an already
    // registered file still fails, so the registry cannot grandfather a file
    // into permanent silence.
    const registered = new Set(registry[file]?.literals ?? []);
    const unregistered = future.filter((literal) => !registered.has(literal));
    if (unregistered.length === 0) {
      registeredHits += 1;
      continue;
    }
    violations.push({ file, literals: unregistered.sort() });
  }
  return { violations, scanned, pinned, registeredHits };
}

export function scheduledFailureMessage(violations) {
  if (violations.length === 0) return '';
  const lines = violations.map(
    (violation) => `  ${violation.file}\n      ${violation.literals.join(', ')}`
  );
  return (
    `Test files hold a hard-coded FUTURE date and install no fake clock.\n` +
    `A test that reads the real wall clock is a scheduled failure: green today, red on a\n` +
    `date nobody chose, and invisible until that date.\n\n` +
    `${lines.join('\n')}\n\n` +
    `Fix by PINNING the clock, not by moving the date forward (that re-arms the same bomb\n` +
    `with a longer fuse):\n` +
    `    beforeEach(() => {\n` +
    `      vi.useFakeTimers({ toFake: ['Date'] });   // whole Date; timers stay real\n` +
    `      vi.setSystemTime(new Date('2026-07-20T08:00:00.000Z'));\n` +
    `    });\n` +
    `    afterEach(() => { vi.useRealTimers(); });\n\n` +
    `Or, if the date is genuinely inert (pure arithmetic, no comparison to the real clock),\n` +
    `register it in scripts/test-clock-bomb-registry.mjs with a reason and evidence.`
  );
}

export function main() {
  const files = listVitestFiles();
  const result = findScheduledFailures(files, Date.now(), (file) =>
    readFileSync(resolve(ROOT, file), 'utf8')
  );
  if (result.violations.length === 0) {
    console.log(
      `✅ Test clock discipline: ${result.scanned} test files scanned (vitest's own corpus), ` +
        `${result.pinned} pin a fake clock, ${result.registeredHits} registered inert, 0 unregistered ` +
        `scheduled failures.`
    );
    return 0;
  }
  console.error(`❌ ${scheduledFailureMessage(result.violations)}`);
  console.error(
    `\n(${result.scanned} test files scanned, ${result.pinned} pin a fake clock, ` +
      `${result.registeredHits} registered inert, ${result.violations.length} FAILING.)`
  );
  return 1;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  process.exitCode = main();
