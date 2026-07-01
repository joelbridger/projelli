/**
 * Unit tests for `scripts/bump-version.mjs` — the pure edit logic that
 * bumps package.json, src-tauri/tauri.conf.json, and src-tauri/Cargo.toml
 * to the same new version string. File I/O and process orchestration live
 * in the script's main(); these tests only exercise the pure functions it
 * calls, on in-memory file contents.
 */
import { describe, expect, it } from 'vitest';
// @ts-expect-error — ESM module with no TS types, intentionally imported raw.
import * as bumpVersion from '../../scripts/bump-version.mjs';

const {
  isValidSemver,
  resolveNewVersion,
  extractCurrentVersions,
  assertVersionsAgree,
  setJsonVersionField,
  setCargoPackageVersion,
} = bumpVersion;

describe('isValidSemver', () => {
  it('accepts plain X.Y.Z versions', () => {
    expect(isValidSemver('3.3.5')).toBe(true);
    expect(isValidSemver('0.0.1')).toBe(true);
  });

  it('accepts prerelease and build metadata', () => {
    expect(isValidSemver('3.4.0-beta.1')).toBe(true);
    expect(isValidSemver('3.4.0+build.5')).toBe(true);
  });

  it('rejects non-semver strings', () => {
    expect(isValidSemver('3.3')).toBe(false);
    expect(isValidSemver('v3.3.5')).toBe(false);
    expect(isValidSemver('3.3.5.1')).toBe(false);
    expect(isValidSemver('latest')).toBe(false);
    expect(isValidSemver('')).toBe(false);
  });
});

describe('resolveNewVersion', () => {
  it('bumps patch/minor/major off the current version', () => {
    expect(resolveNewVersion('3.3.5', 'patch')).toBe('3.3.6');
    expect(resolveNewVersion('3.3.5', 'minor')).toBe('3.4.0');
    expect(resolveNewVersion('3.3.5', 'major')).toBe('4.0.0');
  });

  it('resets lower parts to zero on a bump', () => {
    expect(resolveNewVersion('3.3.5', 'minor')).toBe('3.4.0');
    expect(resolveNewVersion('3.3.5', 'major')).toBe('4.0.0');
  });

  it('accepts an explicit valid semver string', () => {
    expect(resolveNewVersion('3.3.5', '3.9.0')).toBe('3.9.0');
  });

  it('refuses an explicit non-semver string', () => {
    expect(() => resolveNewVersion('3.3.5', 'not-a-version')).toThrow(
      /not a valid version/
    );
  });

  it('refuses to bump from a current version that is not valid semver', () => {
    expect(() => resolveNewVersion('bogus', 'patch')).toThrow(
      /not valid semver/
    );
  });

  it('promotes a prerelease to its final release on a patch bump, instead of skipping ahead', () => {
    // Keepance ships RC versions (e.g. 3.3.5-rc.2) before the final release.
    // A "patch" bump on a prerelease should land on the release it's a
    // candidate for, not increment past it to 3.3.6.
    expect(resolveNewVersion('3.3.5-rc.2', 'patch')).toBe('3.3.5');
  });

  it('bumps minor/major off a prerelease the same as off a release', () => {
    expect(resolveNewVersion('3.3.5-rc.2', 'minor')).toBe('3.4.0');
    expect(resolveNewVersion('3.3.5-rc.2', 'major')).toBe('4.0.0');
  });
});

describe('extractCurrentVersions', () => {
  it('reads the version field out of each file', () => {
    const versions = extractCurrentVersions({
      pkgJsonText: '{\n  "name": "x",\n  "version": "3.3.5"\n}\n',
      tauriConfText: '{\n  "productName": "X",\n  "version": "3.3.5"\n}\n',
      cargoTomlText:
        '[package]\nname = "lantern"\nversion = "3.3.5"\nedition = "2021"\n',
    });
    expect(versions).toEqual({
      'package.json': '3.3.5',
      'src-tauri/tauri.conf.json': '3.3.5',
      'src-tauri/Cargo.toml': '3.3.5',
    });
  });

  it('ignores a dependency table version when reading Cargo.toml', () => {
    const versions = extractCurrentVersions({
      pkgJsonText: '{\n  "version": "3.3.5"\n}\n',
      tauriConfText: '{\n  "version": "3.3.5"\n}\n',
      cargoTomlText:
        '[package]\nversion = "3.3.5"\n\n[dependencies]\ntauri = { version = "2.9.5" }\n',
    });
    expect(versions['src-tauri/Cargo.toml']).toBe('3.3.5');
  });
});

describe('assertVersionsAgree', () => {
  it('does not throw when all three versions match', () => {
    expect(() =>
      assertVersionsAgree({
        'package.json': '3.3.5',
        'src-tauri/tauri.conf.json': '3.3.5',
        'src-tauri/Cargo.toml': '3.3.5',
      })
    ).not.toThrow();
  });

  it('throws when the versions disagree, naming the mismatched files', () => {
    expect(() =>
      assertVersionsAgree({
        'package.json': '3.3.5',
        'src-tauri/tauri.conf.json': '3.3.4',
        'src-tauri/Cargo.toml': '3.3.5',
      })
    ).toThrow(/already disagree/);
  });

  it('throws when a version is missing entirely', () => {
    expect(() =>
      assertVersionsAgree({
        'package.json': '3.3.5',
        'src-tauri/tauri.conf.json': '3.3.5',
        'src-tauri/Cargo.toml': null,
      })
    ).toThrow(/already disagree/);
  });
});

describe('setJsonVersionField', () => {
  it('replaces the version value in place, preserving everything else', () => {
    const before =
      '{\n  "name": "advisor-prep-hero",\n  "version": "3.3.5",\n  "private": true\n}\n';
    const after = setJsonVersionField(before, '3.4.0');
    expect(after).toBe(
      '{\n  "name": "advisor-prep-hero",\n  "version": "3.4.0",\n  "private": true\n}\n'
    );
  });

  it('throws if there is no version field to replace', () => {
    expect(() => setJsonVersionField('{\n  "name": "x"\n}\n', '3.4.0')).toThrow(
      /could not find/
    );
  });
});

describe('setCargoPackageVersion', () => {
  it('replaces only the [package] version, not a dependency version', () => {
    const before =
      '[package]\nname = "lantern"\nversion = "3.3.5"\nedition = "2021"\n\n' +
      '[dependencies]\ntauri = { version = "2.9.5", features = ["devtools"] }\n';
    const after = setCargoPackageVersion(before, '3.4.0');
    expect(after).toContain(
      '[package]\nname = "lantern"\nversion = "3.4.0"\nedition = "2021"'
    );
    expect(after).toContain(
      'tauri = { version = "2.9.5", features = ["devtools"] }'
    );
  });

  it('throws if there is no [package] section', () => {
    expect(() =>
      setCargoPackageVersion('[dependencies]\ntauri = "2.9.5"\n', '3.4.0')
    ).toThrow(/\[package\]/);
  });

  it('preserves the next section header when [package] is immediately followed by another section', () => {
    // Regression: an earlier version's boundary regex consumed the "\n["
    // that opens the next section as part of the [package] match, then
    // dropped the "[" when splicing — corrupting "[lib]" into "lib]".
    const before =
      '[package]\nname = "lantern"\nversion = "3.3.5"\ndefault-run = "lantern"\n[lib]\nname = "lantern_lib"\n';
    const after = setCargoPackageVersion(before, '3.4.0');
    expect(after).toContain('\n[lib]\n');
    expect(after).not.toContain('\nlib]\n');
  });
});
