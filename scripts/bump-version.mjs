#!/usr/bin/env node
/**
 * scripts/bump-version.mjs — one command to bump the app version everywhere
 * it must match.
 *
 * Background: v2.5.0 shipped with NO Windows installer because
 * src-tauri/Cargo.toml still had the old version string — the release build
 * silently produced a mismatched artifact. package.json,
 * src-tauri/tauri.conf.json, and src-tauri/Cargo.toml's [package].version
 * must always be identical (scripts/check-tauri-parity.mjs enforces this at
 * gate time); this script is the one place that writes all three, so they
 * can never drift again from a manual edit.
 *
 * Usage:
 *   node scripts/bump-version.mjs <major|minor|patch|X.Y.Z> [--dry-run]
 *
 * What it does:
 *   1. Reads the current version from all three files; refuses to proceed
 *      if they already disagree (tells the operator to reconcile first).
 *   2. Resolves the new version (semver bump keyword, or an explicit
 *      version — validated as semver).
 *   3. Writes the new version into all three files (--dry-run prints the
 *      plan and exits without touching anything).
 *   4. Runs `npm install --package-lock-only` so package-lock.json's own
 *      version fields stay in sync.
 *   5. Runs scripts/check-tauri-parity.mjs to prove all three files agree.
 *   6. Prints the one follow-up command it does NOT run for you: a real
 *      `cargo build`, needed to update src-tauri/Cargo.lock (this script
 *      never invokes cargo).
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join, resolve } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');

// ── Pure logic (unit-tested directly, no file I/O) ─────────────────────────

// Full semver core + optional prerelease/build metadata (semver.org grammar).
const SEMVER_RE =
  /^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-((?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*)(?:\.(?:0|[1-9]\d*|\d*[a-zA-Z-][0-9a-zA-Z-]*))*))?(?:\+([0-9a-zA-Z-]+(?:\.[0-9a-zA-Z-]+)*))?$/;

export function isValidSemver(version) {
  return typeof version === 'string' && SEMVER_RE.test(version);
}

const BUMP_KEYWORDS = new Set(['major', 'minor', 'patch']);

/** Resolve the requested new version against the current one.
 *  `arg` is either a bump keyword (major/minor/patch) or an explicit
 *  semver string. Throws a descriptive Error for anything invalid. */
export function resolveNewVersion(currentVersion, arg) {
  if (!isValidSemver(currentVersion)) {
    throw new Error(
      `current version "${currentVersion}" is not valid semver — cannot bump it`
    );
  }
  if (BUMP_KEYWORDS.has(arg)) {
    const [, majorStr, minorStr, patchStr, prerelease] =
      SEMVER_RE.exec(currentVersion);
    const major = Number(majorStr);
    const minor = Number(minorStr);
    const patch = Number(patchStr);
    if (arg === 'major') return `${major + 1}.0.0`;
    if (arg === 'minor') return `${major}.${minor + 1}.0`;
    // A patch bump on a prerelease (e.g. 3.3.5-rc.2) promotes it to the
    // final release it's a candidate for (3.3.5), matching `npm version
    // patch` — incrementing the patch number too would skip that release.
    if (prerelease) return `${major}.${minor}.${patch}`;
    return `${major}.${minor}.${patch + 1}`;
  }
  if (!isValidSemver(arg)) {
    throw new Error(
      `"${arg}" is not a valid version — pass a semver string like "3.4.0", or one of: major, minor, patch`
    );
  }
  return arg;
}

/** Extract the three files' current version strings without asserting
 *  anything about them (the caller decides what "disagree" means). */
export function extractCurrentVersions({
  pkgJsonText,
  tauriConfText,
  cargoTomlText,
}) {
  return {
    'package.json': JSON.parse(pkgJsonText).version,
    'src-tauri/tauri.conf.json': JSON.parse(tauriConfText).version,
    'src-tauri/Cargo.toml': cargoPackageVersion(cargoTomlText),
  };
}

/** Throws with a reconcile-first message if the three versions aren't
 *  all identical (and all present). */
export function assertVersionsAgree(versions) {
  const entries = Object.entries(versions);
  const unique = new Set(entries.map(([, v]) => v));
  if (unique.size > 1 || entries.some(([, v]) => !v)) {
    const detail = entries
      .map(([file, v]) => `${file}=${v ?? '(missing)'}`)
      .join(', ');
    throw new Error(
      `version strings already disagree (${detail}) — reconcile them by hand first, ` +
        `then re-run this script. Refusing to bump from an inconsistent state.`
    );
  }
}

/** Parse the `version` key out of Cargo.toml's [package] section only
 *  (dependency tables also have `version = "..."` keys we must not touch). */
function cargoPackageVersion(cargoTomlText) {
  const packageSection = /\[package\]([\s\S]*?)(\n\[|$)/.exec(cargoTomlText);
  if (!packageSection) return null;
  const versionMatch = /^version\s*=\s*"([^"]+)"/m.exec(packageSection[1]);
  return versionMatch ? versionMatch[1] : null;
}

/** Replace the top-level `"version": "..."` field in package.json or
 *  tauri.conf.json text, preserving everything else byte-for-byte. */
export function setJsonVersionField(text, newVersion) {
  const re = /^(\s*"version":\s*")([^"]+)(")/m;
  if (!re.test(text)) {
    throw new Error('could not find a top-level "version" field to replace');
  }
  return text.replace(
    re,
    (_match, pre, _old, post) => `${pre}${newVersion}${post}`
  );
}

/** Replace `version = "..."` inside Cargo.toml's [package] section only,
 *  leaving every dependency table's own `version = "..."` untouched. */
export function setCargoPackageVersion(text, newVersion) {
  // The lookahead (not a consuming match) is deliberate: an earlier version
  // consumed the "\n[" that opens the next section (e.g. "[lib]") as part
  // of its own match, then dropped the "[" when splicing the text back
  // together — silently corrupting the following section header.
  const sectionMatch = /\[package\]([\s\S]*?)(?=\n\[|$)/.exec(text);
  if (!sectionMatch) {
    throw new Error('could not find a [package] section in Cargo.toml');
  }
  const versionLineRe = /^version\s*=\s*"([^"]+)"/m;
  if (!versionLineRe.test(sectionMatch[1])) {
    throw new Error(
      'could not find a version field inside Cargo.toml [package]'
    );
  }
  const newSection = sectionMatch[1].replace(
    versionLineRe,
    `version = "${newVersion}"`
  );
  return (
    text.slice(0, sectionMatch.index) +
    '[package]' +
    newSection +
    text.slice(sectionMatch.index + sectionMatch[0].length)
  );
}

// ── CLI ─────────────────────────────────────────────────────────────────────

function printUsage() {
  console.error(
    'Usage: node scripts/bump-version.mjs <major|minor|patch|X.Y.Z> [--dry-run]'
  );
}

function main() {
  const rawArgs = process.argv.slice(2);
  const dryRun = rawArgs.includes('--dry-run');
  const bumpArg = rawArgs.find((a) => a !== '--dry-run');

  if (!bumpArg) {
    printUsage();
    process.exit(1);
  }

  const pkgJsonPath = join(repoRoot, 'package.json');
  const tauriConfPath = join(repoRoot, 'src-tauri', 'tauri.conf.json');
  const cargoTomlPath = join(repoRoot, 'src-tauri', 'Cargo.toml');

  const pkgJsonText = readFileSync(pkgJsonPath, 'utf8');
  const tauriConfText = readFileSync(tauriConfPath, 'utf8');
  const cargoTomlText = readFileSync(cargoTomlPath, 'utf8');

  const currentVersions = extractCurrentVersions({
    pkgJsonText,
    tauriConfText,
    cargoTomlText,
  });

  try {
    assertVersionsAgree(currentVersions);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    process.exit(1);
  }

  const currentVersion = currentVersions['package.json'];
  let newVersion;
  try {
    newVersion = resolveNewVersion(currentVersion, bumpArg);
  } catch (err) {
    console.error(`❌ ${err.message}`);
    printUsage();
    process.exit(1);
  }

  console.log(`Bumping version: ${currentVersion} → ${newVersion}`);
  console.log('  - package.json');
  console.log('  - src-tauri/tauri.conf.json');
  console.log('  - src-tauri/Cargo.toml [package]');

  if (dryRun) {
    console.log('\n(dry run — no files written, npm/cargo not touched)');
    return;
  }

  // Roll back the three version files on any post-write failure below, so a
  // failed run never leaves the repo half-bumped — a naive retry of the same
  // command would otherwise start from the already-bumped version and
  // silently advance past the intended target.
  const rollback = () => {
    writeFileSync(pkgJsonPath, pkgJsonText);
    writeFileSync(tauriConfPath, tauriConfText);
    writeFileSync(cargoTomlPath, cargoTomlText);
    console.error(
      `(rolled back package.json, tauri.conf.json, and Cargo.toml to ${currentVersion})`
    );
  };

  writeFileSync(pkgJsonPath, setJsonVersionField(pkgJsonText, newVersion));
  writeFileSync(tauriConfPath, setJsonVersionField(tauriConfText, newVersion));
  writeFileSync(
    cargoTomlPath,
    setCargoPackageVersion(cargoTomlText, newVersion)
  );

  console.log('\n===== npm install --package-lock-only =====');
  const npmInstall = spawnSync('npm', ['install', '--package-lock-only'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (npmInstall.status !== 0) {
    console.error('❌ npm install --package-lock-only failed');
    rollback();
    process.exit(npmInstall.status ?? 1);
  }

  console.log('\n===== scripts/check-tauri-parity.mjs =====');
  const parityCheck = spawnSync('node', ['scripts/check-tauri-parity.mjs'], {
    cwd: repoRoot,
    stdio: 'inherit',
  });
  if (parityCheck.status !== 0) {
    console.error(
      '❌ Tauri version parity check failed after bump — see output above'
    );
    rollback();
    console.error(
      'Note: package-lock.json may still reflect the new version — ' +
        'run `npm install --package-lock-only` again once you re-bump.'
    );
    process.exit(parityCheck.status ?? 1);
  }

  console.log(
    `\n✅ Version bumped to ${newVersion} in package.json, tauri.conf.json, Cargo.toml, ` +
      'and package-lock.json.\n\n' +
      '👉 Follow-up (not run by this script): run `cargo build` inside src-tauri/ to update\n' +
      '   src-tauri/Cargo.lock, then commit all four changed files plus Cargo.lock together.'
  );
}

const isMain =
  !!process.argv[1] &&
  resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  main();
}
