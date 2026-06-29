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
 * It exercises the exported `detectLockedDrift()` against tiny throwaway fixture
 * repos, so it never mutates the real tree and can't flake.
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

/** Build a throwaway repo whose locked identifiers are all intact, unless overridden. */
function fixtureRepo(over: { identifier?: string; cargoName?: string; keychain?: string } = {}): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'brand-lock-'));
  made.push(dir);
  fs.mkdirSync(path.join(dir, 'src-tauri', 'src'), { recursive: true });
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'tauri.conf.json'),
    JSON.stringify({ identifier: over.identifier ?? 'com.keepance.app', updater: LOCKED.updaterEndpoint }),
  );
  fs.writeFileSync(path.join(dir, 'src-tauri', 'Cargo.toml'), `name = "${over.cargoName ?? 'keepance'}"\n`);
  fs.writeFileSync(
    path.join(dir, 'src-tauri', 'src', 'keychain.rs'),
    over.keychain ?? 'const A = "com.keepance.app"; const B = "keepance-audit-enc";',
  );
  return dir;
}

describe('detectLockedDrift (brand:check safety guard)', () => {
  it('reports NO drift when every locked identifier is intact', () => {
    const { drift } = detectLockedDrift(fixtureRepo(), LOCKED);
    expect(drift).toEqual([]);
  });

  it('FAILS (non-empty drift) when the Tauri bundle id changed', () => {
    const { drift } = detectLockedDrift(fixtureRepo({ identifier: 'com.northstar.app' }), LOCKED);
    expect(drift.length).toBeGreaterThan(0);
    expect(drift.join(' ')).toContain('bundle identifier');
  });

  it('FAILS when the Cargo binary name changed', () => {
    const { drift } = detectLockedDrift(fixtureRepo({ cargoName: 'northstar' }), LOCKED);
    expect(drift.join(' ')).toContain('Cargo binary name');
  });

  it('FAILS when the updater endpoint changed', () => {
    const dir = fixtureRepo();
    // overwrite tauri.conf.json without the updater endpoint
    fs.writeFileSync(path.join(dir, 'src-tauri', 'tauri.conf.json'), JSON.stringify({ identifier: 'com.keepance.app' }));
    const { drift } = detectLockedDrift(dir, LOCKED);
    expect(drift.join(' ')).toContain('updater endpoint');
  });

  it('FAILS when a keychain service name is missing', () => {
    const { drift } = detectLockedDrift(fixtureRepo({ keychain: 'const A = "com.keepance.app";' }), LOCKED);
    expect(drift.join(' ')).toMatch(/keychain service/);
  });
});
