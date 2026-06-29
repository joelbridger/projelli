/**
 * brand-sync locked-identifier drift guard.
 *
 * The "locked layer" (Tauri bundle id, updater endpoint, Cargo binary name,
 * keychain service names) is the whole safety guarantee of the branding system:
 * a rebrand must NEVER change these, because a drift there breaks auto-update,
 * the OS keychain, encrypted data, or payments for existing users. So
 * `npm run brand:check` (wired into the gate) must FAIL on locked-identifier
 * drift — not merely warn. This tests the detection that drives that failure.
 *
 * Crucially, the keychain check must be PRECISE: the same service strings also
 * live in a central allowlist array, in comments, and in #[cfg(test)] blocks, so
 * a genuine change at the real definition site must fail the check even when a
 * stale copy lingers in one of those places (otherwise the guard is defeated for
 * exactly the drift it should catch).
 *
 * Uses tiny throwaway fixture repos, so it never mutates the real tree and can't flake.
 */
import { describe, it, expect, afterEach } from 'vitest';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { detectLockedDrift } from '../../scripts/brand-sync.mjs';

const LOCKED = {
  tauriBundleId: 'com.keepance.app',
  updaterEndpoint: 'https://github.com/keepance/keepance/releases/latest/download/latest.json',
  cargoBinaryName: 'keepance',
  keychainServices: ['com.keepance.app', 'keepance-audit-enc'],
};

const made: string[] = [];
afterEach(() => {
  for (const d of made.splice(0)) fs.rmSync(d, { recursive: true, force: true });
});

/**
 * Build a throwaway repo with all locked identifiers intact, unless overridden.
 * It deliberately mirrors the real shape: the keychain service appears at a real
 * `const … = "…"` definition site AND (always, with the OLD value) in a central
 * allowlist array, a comment, and a #[cfg(test)] module.
 */
function fixtureRepo(over: { identifier?: string; cargoName?: string; auditConst?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-lock-'));
  made.push(dir);
  const src = path.join(dir, 'src-tauri', 'src');
  fs.mkdirSync(src, { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ identifier: over.identifier ?? 'com.keepance.app', updater: LOCKED.updaterEndpoint }),
  );
  fs.writeFileSync(path.join(dir, 'src-tauri', 'Cargo.toml'), `name = "${over.cargoName ?? 'keepance'}"\n`);
  // Real definition site for the audit-enc service (value overridable to simulate drift).
  fs.writeFileSync(
    path.join(src, 'audit.rs'),
    `// audit master key under service = "keepance-audit-enc", key = "master-key-v1"\n` +
      `const KEYCHAIN_SERVICE: &str = "${over.auditConst ?? 'keepance-audit-enc'}";\n`,
  );
  // keychain.rs: real const for the app id + the central allowlist (bare array
  // elements) + a #[cfg(test)] module — both carrying the OLD audit value. The
  // precise check must NOT count these as "intact".
  fs.writeFileSync(
    path.join(src, 'keychain.rs'),
    `const DEFAULT_SERVICE: &str = "com.keepance.app";\n` +
      `const ALLOWED: &[&str] = &[\n  "com.keepance.app",\n  "keepance-audit-enc",\n];\n` +
      `#[cfg(test)]\nmod tests {\n  #[test]\n  fn t() { let _ = format!("{}", "keepance-audit-enc"); }\n}\n`,
  );
  return dir;
}

describe('detectLockedDrift (brand:check safety guard)', () => {
  it('reports NO drift when every locked identifier is intact', () => {
    const { drift } = detectLockedDrift(fixtureRepo(), LOCKED);
    expect(drift).toEqual([]);
  });

  it('FAILS when the Tauri bundle id changed', () => {
    const { drift } = detectLockedDrift(fixtureRepo({ identifier: 'com.northstar.app' }), LOCKED);
    expect(drift.join(' ')).toContain('bundle identifier');
  });

  it('FAILS when the Cargo binary name changed', () => {
    const { drift } = detectLockedDrift(fixtureRepo({ cargoName: 'northstar' }), LOCKED);
    expect(drift.join(' ')).toContain('Cargo binary name');
  });

  it('FAILS when the updater endpoint changed', () => {
    const dir = fixtureRepo();
    fs.writeFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ identifier: 'com.keepance.app' }));
    const { drift } = detectLockedDrift(dir, LOCKED);
    expect(drift.join(' ')).toContain('updater endpoint');
  });

  // The precise case the review asked for: the real keychain CONST changed, but the
  // old value still lingers in a comment, the central allowlist, and a #[cfg(test)]
  // module. A raw substring scan would call this "intact" — the precise check must FAIL.
  it('FAILS when the real keychain const changed even though the old value lingers in a comment/allowlist/test', () => {
    const { drift } = detectLockedDrift(fixtureRepo({ auditConst: 'keepance-renamed' }), LOCKED);
    expect(drift.join(' ')).toMatch(/keychain service/);
    expect(drift.join(' ')).toContain('keepance-audit-enc');
  });

  // The substring-trap variant: renaming `x` → `x-v2` keeps the old value as a
  // PREFIX of the new const. Exact-literal matching for full services must still FAIL.
  it('FAILS when the keychain const gains a suffix (x → x-v2)', () => {
    const { drift } = detectLockedDrift(fixtureRepo({ auditConst: 'keepance-audit-enc-v2' }), LOCKED);
    expect(drift.join(' ')).toContain('keepance-audit-enc');
  });
});
