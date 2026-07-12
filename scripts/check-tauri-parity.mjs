#!/usr/bin/env node
/**
 * scripts/check-tauri-parity.mjs — fast, blocking gate check for Tauri
 * NPM/crate version drift.
 *
 * Background: the v3.3.5-rc.2 release build FAILED at "Build Tauri app
 * (unsigned)" with "Found version mismatched Tauri packages" — the
 * @tauri-apps/api npm package had drifted to a different minor than the
 * `tauri` Rust crate (2.9.x vs 2.11.x). That check only runs inside a full
 * `npm run tauri build`, which is slow and wasn't part of the local gate or
 * PR CI, so the drift shipped all the way to release day before anyone
 * noticed. tests/e2e/v1.5-regression-updater-versions.spec.ts already
 * checks tauri-plugin-* pairs, but it lives in the neglected Playwright e2e
 * suite (not run at merge time) and only checks *major* versions for the
 * core tauri/@tauri-apps/api pair — not minor, which is exactly what drifted.
 *
 * This script re-implements the same pairing logic as that spec (kept
 * unchanged) as a plain Node script with no test-runner dependency, so it
 * can run in milliseconds as a blocking step in scripts/gate.sh. It checks:
 *   1. The core pair: `tauri` (Cargo, resolved via Cargo.lock) against both
 *      @tauri-apps/api and @tauri-apps/cli (npm, from package.json) — major
 *      AND minor.
 *   2. Every tauri-plugin-* pair present on both sides — exact version.
 *   3. The three app version strings (package.json, tauri.conf.json,
 *      src-tauri/Cargo.toml [package]) are all identical.
 */

import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

const errors = [];

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function readText(path) {
  return readFileSync(path, 'utf8');
}

/** Parse Cargo.lock into a map of package name -> resolved version.
 *  If a name appears more than once (unusual, but Cargo.lock permits
 *  multiple resolved versions of the same crate), keep the first — that's
 *  the version the workspace's own crates depend on directly in practice
 *  for the tauri/tauri-plugin-* packages this script cares about. */
function parseCargoLock(text) {
  const versions = new Map();
  const blocks = text.split(/\n(?=\[\[package\]\])/);
  for (const block of blocks) {
    const nameMatch = /^\[\[package\]\]\s*\nname\s*=\s*"([^"]+)"/.exec(block);
    const versionMatch = /\nversion\s*=\s*"([^"]+)"/.exec(block);
    if (nameMatch && versionMatch && !versions.has(nameMatch[1])) {
      versions.set(nameMatch[1], versionMatch[1]);
    }
  }
  return versions;
}

/** Return the resolved version for an npm package from package-lock.json
 *  (npm v7+ "packages" map), falling back to the declared range in
 *  package.json if the lockfile has no entry (e.g. lockfile missing/stale).
 *  Reading the resolved version, not the declared range, is what actually
 *  matches what `tauri build` sees installed in node_modules — a caret
 *  range like `^2.3.1` can silently resolve to 2.4.x in the lockfile while
 *  this script would otherwise still see "2.3" and miss the drift. */
function resolvedNpmVersion(lockPackages, npmPkg, declaredSpec) {
  const entry = lockPackages?.[`node_modules/${npmPkg}`];
  return entry?.version ?? declaredSpec;
}

/** Extract the `version` field from Cargo.toml's `[package]` section only
 *  (not from a `[dependencies]` entry, which also has a `version` key). */
function cargoPackageVersion(cargoTomlText) {
  const packageSection = /\[package\]([\s\S]*?)(\n\[|$)/.exec(cargoTomlText);
  if (!packageSection) return null;
  const versionMatch = /^version\s*=\s*"([^"]+)"/m.exec(packageSection[1]);
  return versionMatch ? versionMatch[1] : null;
}

/** Return {major, minor} from a version spec. Handles plain "2.9.0", caret
 *  "^2.9.0", tilde "~2.9.0", and bare-major "2" (minor: null — "any 2.x",
 *  the ambiguity window that caused rc.3's drift). */
function majorMinor(spec) {
  const cleaned = spec.replace(/^[\^~=<>]+\s*/, '').trim();
  const bare = /^(\d+)$/.exec(cleaned);
  if (bare) return { major: Number(bare[1]), minor: null };
  const full = /^(\d+)\.(\d+)(?:\.\d+)?/.exec(cleaned);
  if (full) return { major: Number(full[1]), minor: Number(full[2]) };
  return null;
}

function formatMm(mm) {
  return mm.minor === null ? `${mm.major}.x` : `${mm.major}.${mm.minor}`;
}

/** Compare a resolved cargo version against an npm range spec; push an
 *  error if their major (and, when the npm side pins one, minor) diverge. */
function checkPair(label, cargoResolvedVersion, npmSpec) {
  const cargoMm = majorMinor(cargoResolvedVersion);
  const npmMm = majorMinor(npmSpec);
  if (!cargoMm) {
    errors.push(`${label}: could not parse cargo version "${cargoResolvedVersion}"`);
    return;
  }
  if (!npmMm) {
    errors.push(`${label}: could not parse npm spec "${npmSpec}"`);
    return;
  }
  if (cargoMm.major !== npmMm.major) {
    errors.push(
      `${label}: major mismatch — cargo resolved ${cargoResolvedVersion} vs npm ${npmSpec}`
    );
    return;
  }
  if (npmMm.minor !== null && cargoMm.minor !== npmMm.minor) {
    errors.push(
      `${label}: minor mismatch — cargo resolved ${formatMm(cargoMm)} vs npm ${formatMm(npmMm)} ` +
        `(cargo resolved ${cargoResolvedVersion}, npm spec ${npmSpec})`
    );
  }
}

/** Plugins can change their IPC contract in a patch release, so Tauri
 * requires the JavaScript and Rust packages to use the exact same version. */
function checkExactPair(label, cargoResolvedVersion, npmSpec) {
  if (cargoResolvedVersion !== npmSpec) {
    errors.push(
      `${label}: exact version mismatch — cargo resolved ${cargoResolvedVersion} vs npm ${npmSpec}`
    );
  }
}

const pkg = readJson(join(repoRoot, 'package.json'));
const allNpmDeps = { ...(pkg.dependencies ?? {}), ...(pkg.devDependencies ?? {}) };
const npmLock = readJson(join(repoRoot, 'package-lock.json'));
const cargoLock = parseCargoLock(readText(join(repoRoot, 'src-tauri', 'Cargo.lock')));
const cargoToml = readText(join(repoRoot, 'src-tauri', 'Cargo.toml'));

// 1. Core pair — tauri crate vs @tauri-apps/api and @tauri-apps/cli.
const tauriResolved = cargoLock.get('tauri');
if (!tauriResolved) {
  errors.push('core: could not find resolved "tauri" version in src-tauri/Cargo.lock');
} else {
  for (const npmPkg of ['@tauri-apps/api', '@tauri-apps/cli']) {
    const npmSpec = allNpmDeps[npmPkg];
    if (!npmSpec) {
      errors.push(`core: ${npmPkg} is missing from package.json but Cargo depends on tauri`);
      continue;
    }
    const npmResolved = resolvedNpmVersion(npmLock.packages, npmPkg, npmSpec);
    checkPair(`core (tauri vs ${npmPkg})`, tauriResolved, npmResolved);
  }
}

// 2. Every tauri-plugin-* pair present on both sides. Tauri requires exact
// plugin parity because patch releases can change their IPC contract.
for (const [cargoName, cargoResolved] of cargoLock) {
  if (!cargoName.startsWith('tauri-plugin-')) continue;
  const suffix = cargoName.slice('tauri-plugin-'.length);
  const npmPkg = `@tauri-apps/plugin-${suffix}`;
  const npmSpec = allNpmDeps[npmPkg];
  if (!npmSpec) continue; // Rust-only plugin (e.g. tauri-plugin-log) — can't drift.
  const npmResolved = resolvedNpmVersion(npmLock.packages, npmPkg, npmSpec);
  checkExactPair(`plugin (${cargoName} vs ${npmPkg})`, cargoResolved, npmResolved);
}

// 3. The three app version strings must be identical.
const packageJsonVersion = pkg.version;
const tauriConfVersion = readJson(join(repoRoot, 'src-tauri', 'tauri.conf.json')).version;
const cargoTomlVersion = cargoPackageVersion(cargoToml);

const versionStrings = {
  'package.json': packageJsonVersion,
  'src-tauri/tauri.conf.json': tauriConfVersion,
  'src-tauri/Cargo.toml [package]': cargoTomlVersion,
};
const uniqueVersions = new Set(Object.values(versionStrings));
if (uniqueVersions.size > 1) {
  errors.push(
    `app version strings disagree: ${Object.entries(versionStrings)
      .map(([file, v]) => `${file}=${v ?? '(missing)'}`)
      .join(', ')}`
  );
}

if (errors.length > 0) {
  console.error('❌ Tauri version parity check FAILED:\n');
  for (const err of errors) console.error(`  - ${err}`);
  console.error(
    '\nFix: align the npm package(s) to the same major.minor as the Rust crate ' +
      '(prefer bumping npm to match Rust — the Rust side is what actually compiled). ' +
      'See CHANGELOG / fix/tauri-version-align for the last time this drifted.'
  );
  process.exit(1);
}

console.log('✅ Tauri version parity check passed (core pair, all plugin pairs, app version strings).');
