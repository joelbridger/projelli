#!/usr/bin/env node
/**
 * scripts/check-case-collisions.mjs — fast, blocking gate check for
 * case-only filename collisions (QA-60).
 *
 * Background: `meetingNoteOutboundGate.ts` (the pure gate logic) and
 * `MeetingNoteOutboundGate.tsx` (the component wrapping it) differed only by
 * the first letter's case. Linux/CI's case-sensitive filesystem resolves
 * both fine, but Windows and macOS default to case-INsensitive filesystems,
 * where an extensionless import (`./meetingNoteOutboundGate`) can resolve to
 * either file depending on directory-listing order. Live-verified on two
 * separate Windows machines: it served the `.tsx` component's exports where
 * the `.ts` logic was expected, leaving the imported name `undefined` and
 * crashing the whole React mount — a permanent blank white screen on boot,
 * with zero signal from Linux/CI. This script makes the whole CLASS of bug
 * fail the gate instead of only surfacing on a real Windows/Mac machine.
 *
 * Flags two collision shapes across every git-tracked file. The FULL path
 * (directory included) is case-folded for grouping, not just the basename —
 * a parent directory that differs only by case (e.g. `src/Foo/x.ts` vs
 * `src/foo/X.tsx`) collapses to one directory on Windows/macOS too, so it's
 * the same resolution risk as a same-directory collision (Codex review,
 * QA-60 follow-up).
 *   1. EXACT — two files whose full paths (including extension) are
 *      identical except for case, e.g. `Foo.ts` / `foo.ts`. This breaks even
 *      on `git checkout` for a case-insensitive filesystem.
 *   2. STEM — two files whose paths, with the extension stripped, are
 *      identical except for case, e.g. `meetingNoteOutboundGate.ts` /
 *      `MeetingNoteOutboundGate.tsx`. This is the QA-60 shape: an
 *      extensionless import of either name can't tell them apart on a
 *      case-insensitive filesystem.
 */

import { execFileSync } from 'node:child_process';
import { dirname, basename, extname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

function listTrackedFiles(root = repoRoot) {
  const out = execFileSync('git', ['ls-files'], { cwd: root, encoding: 'utf8' });
  return out.split('\n').filter(Boolean);
}

function stripExt(base) {
  const ext = extname(base);
  return ext ? base.slice(0, -ext.length) : base;
}

// Extensions the bundler/Node module resolver will match via an
// EXTENSIONLESS import (`./foo`) — i.e. the ones QA-60's `./meetingNoteOutboundGate`
// resolution risk actually applies to. CSS/Markdown/HTML/etc. always require
// their extension to be written explicitly in this codebase's imports, so a
// same-stem pair like `OnboardingV2.tsx` / `onboardingV2.css` can't suffer the
// same silent-wrong-file resolution and is deliberately not flagged here.
const RESOLVABLE_EXTS = new Set(['.ts', '.tsx', '.mts', '.cts', '.js', '.jsx', '.mjs', '.cjs', '.json']);

/**
 * Exported so the contract test (tests/unit/case-collisions.test.ts) enforces
 * the same invariant inside `vitest run`, not only in scripts/gate.sh — one
 * source of truth for the rule.
 */
export function findCaseCollisions(files = listTrackedFiles()) {
  const exactGroups = new Map(); // full path, case-folded -> Set<actual file>
  const stemGroups = new Map(); // dir+stem, case-folded -> Map<dir/stem (case-preserved), file>

  for (const file of files) {
    const dir = dirname(file);
    const base = basename(file);
    const stem = stripExt(base);

    // EXACT applies to every tracked file: two paths identical except for
    // case break `git checkout` itself on a case-insensitive filesystem,
    // regardless of file type. Case-fold the WHOLE path (not just the
    // basename) so a parent directory that differs only by case is caught
    // too — Windows/macOS collapse those directories into one.
    const exactKey = file.toLowerCase();
    if (!exactGroups.has(exactKey)) exactGroups.set(exactKey, new Set());
    exactGroups.get(exactKey).add(file);

    // STEM only applies to extensionless-resolvable file types (see above).
    if (!RESOLVABLE_EXTS.has(extname(base))) continue;
    const stemPath = `${dir}/${stem}`;
    const stemKey = stemPath.toLowerCase();
    if (!stemGroups.has(stemKey)) stemGroups.set(stemKey, new Map());
    const stemMap = stemGroups.get(stemKey);
    if (!stemMap.has(stemPath)) stemMap.set(stemPath, file);
  }

  const exact = [];
  for (const [, fileSet] of exactGroups) {
    if (fileSet.size > 1) exact.push({ files: [...fileSet] });
  }

  const stems = [];
  for (const [, stemMap] of stemGroups) {
    if (stemMap.size > 1) {
      stems.push({ files: [...stemMap.values()] });
    }
  }

  return { exact, stems };
}

// Run the CLI/gate check only when executed directly (not when imported by
// the contract test).
const invokedDirectly =
  process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1];

if (invokedDirectly) {
  const { exact, stems } = findCaseCollisions();
  if (exact.length > 0 || stems.length > 0) {
    console.error(
      '❌ Case-only filename collision(s) found (QA-60 class — Windows/Mac\n' +
        '   case-insensitive filesystem risk). These resolve fine on\n' +
        '   case-sensitive Linux/CI but can silently import the WRONG file on\n' +
        '   Windows/macOS, crashing the app with no signal here.\n',
    );
    for (const { files: collidingPaths } of exact) {
      console.error(`   EXACT: ${collidingPaths.join(' <-> ')} — identical except for case.`);
    }
    for (const { files: collidingFiles } of stems) {
      console.error(
        `   STEM:  ${collidingFiles.join(' <-> ')} — same name once the extension is ` +
          'stripped, except for case; an extensionless import can\'t tell them apart on Windows.',
      );
    }
    console.error(
      `\n   ${exact.length + stems.length} collision(s). Rename one file in each pair so ` +
        'directory listings can never collide on a case-insensitive filesystem.',
    );
    process.exit(1);
  }

  console.log('✅ No case-only filename collisions.');
}
