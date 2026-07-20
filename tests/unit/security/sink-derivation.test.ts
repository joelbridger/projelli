// THE GUARD-OF-GUARDS.
//
// The checker in scripts/check-untrusted-sink-derivation.mjs replaced three
// hand-maintained lists. A replacement inherits the illusion unless it is
// shown to see something the list could not. So: plant a NEW writer, a NEW
// markup sink and a NEW archive reader — each in a file that is UNTRACKED BY
// GIT and imported by nothing — and require the checker to find all three and
// exit non-zero.
//
// The untracked part is deliberate. A checker whose scope comes from the git
// index reports GREEN over exactly the file an attacker or a hurried developer
// just created; that failure has already happened once in this codebase. The
// test asserts `git status` reports the probes as untracked (`??`) BEFORE
// trusting the fact that the checker found them anyway.
//
// The negative control matters as much: with the probes removed the checker
// must go back to exit 0. A checker that always fails is not detecting
// anything either.

import { describe, it, expect, afterAll } from 'vitest';
import { execFileSync, execSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const repoRoot = join(__dirname, '..', '..', '..');
// NOT under src/. Several guard suites (brandVisibleCopy, taskRemovalSeam,
// crm-egress-boundary, network-lockdown, workflowCompletionSeam) walk `src/`
// from disk, and vitest runs suites in parallel — planting files there made a
// brand-copy guard red in one full run and pass in isolation. A test that
// mutates a tree other tests read is a race, and "it passed on my machine" is
// exactly the evidence that race destroys.
//
// `scripts/` is walked by the checker (it already derives members there) and by
// no test suite, so the probe proves the same thing without the collision. The
// walk's reach into src/ and src-tauri/ is asserted separately below.
const probeDir = join(repoRoot, 'scripts', '__sink_derivation_probe__');

const PROBES: Record<string, string> = {
  // A seventh CSV writer. It never says "csvSafe", never imports the
  // chokepoint, and is named nothing like the six that came before.
  'quarterlyLedger.ts': `
export function buildLedgerReport(rows: string[][]): string {
  const body = rows.map((row) => row.join(',')).join('\\r\\n');
  const blob = new Blob([body], { type: 'text/csv' });
  void blob;
  return body;
}
`,
  // A fifth markup sink.
  'ProposalBanner.tsx': `
export function mountBanner(host: HTMLElement, message: string): void {
  host.innerHTML = '<span>' + message + '</span>';
}
`,
  // An eighth archive reader — through a library that unzips internally, with
  // the word "zip" nowhere in the file.
  'legacyBookImport.ts': `
import * as XLSX from 'xlsx';
export function importLegacyBook(bytes: ArrayBuffer) {
  return XLSX.read(bytes, { type: 'array' });
}
`,
};

function runChecker(): { status: number; stdout: string } {
  try {
    const stdout = execFileSync(
      process.execPath,
      ['scripts/check-untrusted-sink-derivation.mjs', '--list'],
      { cwd: repoRoot, encoding: 'utf8' },
    );
    return { status: 0, stdout };
  } catch (error) {
    const e = error as { status?: number; stdout?: string; stderr?: string };
    // Read the STATUS and the STDOUT, never one through the other. An empty
    // stdout with a non-zero status is "the checker could not run", which is
    // not the same answer as "it found nothing".
    return { status: e.status ?? -1, stdout: `${e.stdout ?? ''}${e.stderr ?? ''}` };
  }
}

function plant(): void {
  mkdirSync(probeDir, { recursive: true });
  for (const [name, body] of Object.entries(PROBES)) {
    writeFileSync(join(probeDir, name), body, 'utf8');
  }
}

function unplant(): void {
  rmSync(probeDir, { recursive: true, force: true });
}

afterAll(unplant);

describe('the derivation discriminates — it finds a NEW sink nobody listed', () => {
  it('is GREEN before the probes are planted (negative control)', () => {
    unplant();
    const before = runChecker();
    expect(before.status).toBe(0);
    expect(before.stdout).toContain('every derived sink routes through its chokepoint');
  });

  it('finds all three planted sinks, in files git does not track', () => {
    plant();

    // Prove the premise first: these files really are untracked, so the
    // checker cannot be finding them via the git index.
    const status = execSync('git status --porcelain -- scripts/__sink_derivation_probe__', {
      cwd: repoRoot,
      encoding: 'utf8',
    });
    expect(status).toContain('??');

    const after = runChecker();
    expect(after.status).toBe(1);

    for (const name of Object.keys(PROBES)) {
      expect(after.stdout).toContain(`UNGUARDED scripts/__sink_derivation_probe__/${name}`);
    }
    // …and each landed in the RIGHT set.
    expect(after.stdout).toMatch(
      /\[csv][\s\S]*?UNGUARDED scripts\/__sink_derivation_probe__\/quarterlyLedger\.ts/,
    );
    expect(after.stdout).toMatch(
      /\[html][\s\S]*?UNGUARDED scripts\/__sink_derivation_probe__\/ProposalBanner\.tsx/,
    );
    expect(after.stdout).toMatch(
      /\[archive][\s\S]*?UNGUARDED scripts\/__sink_derivation_probe__\/legacyBookImport\.ts/,
    );
  });

  // The probes live outside src/, so prove separately that the walk actually
  // reaches the trees that matter — otherwise this whole test could pass over a
  // scope that stops at scripts/.
  it('derives members from src/, src-tauri/ and the crates tree', () => {
    unplant();
    const { stdout } = runChecker();
    expect(stdout).toContain('src/platform/export/csvSafe.ts');
    expect(stdout).toContain('src-tauri/src/safe_csv.rs');
    expect(stdout).toContain('src-tauri/crates/lantern-docx/src/package.rs');
  });

  it('goes GREEN again once the probes are removed', () => {
    unplant();
    expect(runChecker().status).toBe(0);
  });
});
