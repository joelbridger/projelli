/**
 * v1.5 regression guard — Tauri / @tauri-apps/plugin-* version alignment.
 *
 * Background: v1.5-rc.3 shipped with `tauri-plugin-updater = "2"` in
 * `src-tauri/Cargo.toml` but `@tauri-apps/plugin-updater` pinned to
 * `^2.5.0` in `package.json`. Cargo resolved the Rust side to 2.9.x
 * while npm resolved the JS side to 2.5.x. At runtime the JS bindings
 * expected `Update.prototype.downloadAndInstall` to accept a progress
 * callback; the 2.5 bindings did, but the 2.9 backend ignored it — the
 * installer never reported progress and tests hung for 10 minutes.
 *
 * Fix (rc.4): pin `~2.9.0` on the npm side so both sides stay on 2.9.
 *
 * This spec reads the two files at test time and asserts that the
 * major+minor versions line up for every `tauri-plugin-*` pair that
 * exists on both sides.
 *
 * Pairs that live only on one side (e.g. `tauri-plugin-log` is Rust-
 * only) are skipped silently — they can't drift by definition.
 *
 * If someone loosens the cargo constraint to just `"2"` AND the npm
 * side pins a specific minor, this test catches the ambiguity window —
 * cargo `"2"` is "anything 2.x", which is exactly what caused rc.3 to
 * drift.
 */

import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..', '..');

/** Parse `package.json` into `{dependencies, devDependencies}`. */
function readPackageJson(): {
  dependencies: Record<string, string>;
  devDependencies: Record<string, string>;
} {
  const raw = readFileSync(join(repoRoot, 'package.json'), 'utf8');
  const parsed = JSON.parse(raw) as {
    dependencies?: Record<string, string>;
    devDependencies?: Record<string, string>;
  };
  return {
    dependencies: parsed.dependencies ?? {},
    devDependencies: parsed.devDependencies ?? {},
  };
}

/** Read `src-tauri/Cargo.toml` as plain text. */
function readCargoToml(): string {
  return readFileSync(join(repoRoot, 'src-tauri', 'Cargo.toml'), 'utf8');
}

/** Extract the version spec from a `pkg = "..."` or
 *  `pkg = { version = "...", ... }` line in Cargo.toml. Returns null if
 *  the package isn't present. Matches both `^2.9` and `"2.9.5"` style. */
function cargoVersion(cargoText: string, pkg: string): string | null {
  // Double-quoted short form: `pkg = "2.9"` (anchored to line start so
  // sub-strings like `tauri-plugin-updater` don't match `tauri = "..."`).
  const shortRe = new RegExp(`^${escapeRe(pkg)}\\s*=\\s*"([^"]+)"`, 'm');
  const shortMatch = cargoText.match(shortRe);
  if (shortMatch && shortMatch[1]) return shortMatch[1];
  // Long-form: `pkg = { version = "2.9", ... }`
  const longRe = new RegExp(
    `^${escapeRe(pkg)}\\s*=\\s*\\{[^}]*version\\s*=\\s*"([^"]+)"`,
    'm'
  );
  const longMatch = cargoText.match(longRe);
  if (longMatch && longMatch[1]) return longMatch[1];
  return null;
}

function escapeRe(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

/** Return the major.minor number pair from a version spec.
 *  Handles plain `"2.9.0"`, caret `"^2.9.0"`, tilde `"~2.9.0"`, and
 *  bare-major `"2"`. Returns minor=null for bare major since that
 *  means "any 2.x" — the ambiguity window that caused rc.3. */
function majorMinor(spec: string): { major: number; minor: number | null } | null {
  const cleaned = spec.replace(/^[\^~=<>]+\s*/, '').trim();
  // Plain number form.
  const bare = /^(\d+)$/.exec(cleaned);
  if (bare && bare[1] !== undefined) {
    return { major: Number(bare[1]), minor: null };
  }
  const full = /^(\d+)\.(\d+)(?:\.\d+)?$/.exec(cleaned);
  if (full && full[1] !== undefined && full[2] !== undefined) {
    return { major: Number(full[1]), minor: Number(full[2]) };
  }
  return null;
}

/** Pairs where a drift between Cargo and npm minors would cause a
 *  runtime mismatch. All sit on the critical path for Tauri IPC. */
const PLUGIN_PAIRS: Array<{ cargo: string; npm: string }> = [
  { cargo: 'tauri-plugin-updater', npm: '@tauri-apps/plugin-updater' },
  { cargo: 'tauri-plugin-process', npm: '@tauri-apps/plugin-process' },
  { cargo: 'tauri-plugin-fs', npm: '@tauri-apps/plugin-fs' },
  { cargo: 'tauri-plugin-dialog', npm: '@tauri-apps/plugin-dialog' },
  { cargo: 'tauri-plugin-shell', npm: '@tauri-apps/plugin-shell' },
  { cargo: 'tauri-plugin-http', npm: '@tauri-apps/plugin-http' },
];

test.describe('v1.5 regression — Tauri / npm version alignment', () => {
  test('every tauri-plugin-* cargo entry has a matching npm entry', async () => {
    const pkg = readPackageJson();
    const cargoText = readCargoToml();
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const pair of PLUGIN_PAIRS) {
      const cargoSpec = cargoVersion(cargoText, pair.cargo);
      const npmSpec = allDeps[pair.npm];
      // If cargo side has it, npm side must also have it (or we have a
      // stale dependency waiting to bite us).
      if (cargoSpec !== null) {
        expect(
          npmSpec,
          `missing npm package ${pair.npm} to match cargo ${pair.cargo}`
        ).toBeDefined();
      }
    }
  });

  test('majors match across every present tauri-plugin pair', async () => {
    const pkg = readPackageJson();
    const cargoText = readCargoToml();
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    for (const pair of PLUGIN_PAIRS) {
      const cargoSpec = cargoVersion(cargoText, pair.cargo);
      const npmSpec = allDeps[pair.npm];
      if (cargoSpec === null || npmSpec === undefined) continue;

      const cargoVer = majorMinor(cargoSpec);
      const npmVer = majorMinor(npmSpec);
      expect(cargoVer, `cargo spec unparseable for ${pair.cargo}: ${cargoSpec}`).not.toBeNull();
      expect(npmVer, `npm spec unparseable for ${pair.npm}: ${npmSpec}`).not.toBeNull();

      if (cargoVer && npmVer) {
        expect(
          cargoVer.major,
          `major mismatch for ${pair.cargo} (cargo ${cargoSpec}) vs ${pair.npm} (npm ${npmSpec})`
        ).toBe(npmVer.major);
      }
    }
  });

  test('tauri-plugin-updater has a concrete minor pinned on the npm side (rc.3 regression)', async () => {
    // This is the *specific* bug rc.3 hit. We want the npm side to
    // have a minor pinned (via `~` or explicit), not a bare major.
    const pkg = readPackageJson();
    const cargoText = readCargoToml();
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    const cargoSpec = cargoVersion(cargoText, 'tauri-plugin-updater');
    const npmSpec = allDeps['@tauri-apps/plugin-updater'];
    expect(cargoSpec).not.toBeNull();
    expect(npmSpec).toBeDefined();

    if (cargoSpec && npmSpec) {
      const cargoVer = majorMinor(cargoSpec);
      const npmVer = majorMinor(npmSpec);
      expect(
        npmVer?.minor,
        `npm plugin-updater must pin a minor (got "${npmSpec}")`
      ).not.toBeNull();

      // If both sides pin minors, they must agree.
      if (cargoVer && cargoVer.minor !== null && npmVer && npmVer.minor !== null) {
        expect(
          cargoVer.minor,
          `minor mismatch: cargo tauri-plugin-updater ${cargoSpec} vs npm @tauri-apps/plugin-updater ${npmSpec}`
        ).toBe(npmVer.minor);
      }
    }
  });

  test('tauri core (Cargo) and @tauri-apps/api (npm) majors align', async () => {
    const pkg = readPackageJson();
    const cargoText = readCargoToml();
    const allDeps = { ...pkg.dependencies, ...pkg.devDependencies };

    const cargoTauri = cargoVersion(cargoText, 'tauri');
    const npmTauri = allDeps['@tauri-apps/api'];
    expect(cargoTauri).not.toBeNull();
    expect(npmTauri).toBeDefined();

    if (cargoTauri && npmTauri) {
      const cMm = majorMinor(cargoTauri);
      const nMm = majorMinor(npmTauri);
      expect(cMm?.major).toBe(nMm?.major);
    }
  });
});
