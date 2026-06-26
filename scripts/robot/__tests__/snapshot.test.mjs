// scripts/robot/__tests__/snapshot.test.mjs
// Pure-logic tests for the frozen-snapshot bench primitives. These run in Node
// WITHOUT touching the Legion bench: they exercise the safety guard, the status
// parser, the ssh-invocation builder, and the manifest builder. The actual
// SSH/tar/file-swap side effects are verified live on the bench.
import { describe, it, expect } from 'vitest';
import {
  assertSnapshotRestorable,
  parseSnapshotResult,
  buildSnapshotSshArgs,
  buildManifest,
  WS_ROOT,
  SNAPSHOT_ARCHIVE,
  SNAPSHOT_MANIFEST,
} from '../bench.mjs';

describe('assertSnapshotRestorable (fail-safe: never wipe without a valid golden)', () => {
  it('throws when status is missing entirely', () => {
    expect(() => assertSnapshotRestorable(null)).toThrow(/refus/i);
    expect(() => assertSnapshotRestorable(undefined)).toThrow(/refus/i);
  });

  it('throws when the archive does not exist', () => {
    expect(() => assertSnapshotRestorable({ ok: true, exists: false })).toThrow(/refus/i);
  });

  it('throws when the status query itself failed', () => {
    expect(() => assertSnapshotRestorable({ ok: false, error: 'ssh down' })).toThrow(/refus/i);
  });

  it('throws when the archive exists but is zero bytes (corrupt/incomplete)', () => {
    expect(() => assertSnapshotRestorable({ ok: true, exists: true, archiveBytes: 0 })).toThrow(/refus/i);
  });

  it('returns true when a non-empty archive exists', () => {
    expect(assertSnapshotRestorable({ ok: true, exists: true, archiveBytes: 12345 })).toBe(true);
  });
});

describe('parseSnapshotResult', () => {
  it('extracts the trailing JSON line emitted by snapshot.ps1', () => {
    const raw = 'tar: creating archive\nwrote 42 entries\n{"ok":true,"exists":true,"archiveBytes":987}\n';
    expect(parseSnapshotResult(raw)).toEqual({ ok: true, exists: true, archiveBytes: 987 });
  });

  it('scans upward past trailing non-JSON noise', () => {
    const raw = '{"ok":true,"exists":false}\nDONE\n';
    expect(parseSnapshotResult(raw)).toEqual({ ok: true, exists: false });
  });

  it('returns a not-ok packet when there is no JSON at all', () => {
    expect(parseSnapshotResult('boom\nno json here').ok).toBe(false);
    expect(parseSnapshotResult('').ok).toBe(false);
    expect(parseSnapshotResult(null).ok).toBe(false);
  });
});

describe('buildSnapshotSshArgs', () => {
  it('targets the bench and runs the remote ps1 with the action + paths', () => {
    const args = buildSnapshotSshArgs('Restore');
    expect(args).toContain('james@100.127.67.22');
    expect(args).toContain('-File');
    expect(args.join(' ')).toMatch(/robot-snapshot\.ps1/);
    // action + the canonical paths are passed through
    const i = args.indexOf('-Action');
    expect(args[i + 1]).toBe('Restore');
    expect(args).toContain(SNAPSHOT_ARCHIVE);
    expect(args).toContain(WS_ROOT);
    // runs non-interactively so it cannot stall on a profile/policy prompt
    expect(args).toContain('-NoProfile');
    expect(args).toContain('Bypass');
  });
});

describe('buildManifest', () => {
  it('records bench/path-binding provenance and the passed metadata', () => {
    const m = buildManifest({ version: 3, createdAt: '2026-06-26T00:00:00Z', archiveBytes: 50, sha256: 'abc', mattersCount: 26 });
    expect(m.name).toBe('northcrest-golden');
    expect(m.version).toBe(3);
    expect(m.createdAt).toBe('2026-06-26T00:00:00Z');
    expect(m.workspacePath).toBe(WS_ROOT);
    expect(m.archiveBytes).toBe(50);
    expect(m.sha256).toBe('abc');
    expect(m.mattersCount).toBe(26);
    expect(m.note).toMatch(/keychain/i);
    expect(m.note).toMatch(/absolute path/i);
  });
});
