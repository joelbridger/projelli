// WS-A / A5 — BinaryVersionService (on-disk, binary-safe version history).
//
// Verifies, with a fully in-memory mock FS:
//   - a save writes a binary snapshot under `.versions/<relpath>/` plus a
//     metadata index entry (timestamp, author, size, snapshot file name);
//   - the cap prunes the OLDEST snapshots (file + index) beyond the limit;
//   - restore copies a snapshot back over the current file AND records the
//     pre-restore state + the restore itself, so nothing is lost;
//   - the docx snapshot path resolves to an absolute on-disk path for the engine.

import { describe, it, expect, beforeEach } from 'vitest';
import {
  BinaryVersionService,
  toWorkspaceRelative,
  type VersionFS,
} from '@/features/documents/versioning/BinaryVersionService';

const ROOT = '/ws';

/** A trivial in-memory FS that satisfies the VersionFS surface. */
class MemFS implements VersionFS {
  files = new Map<string, Uint8Array>();

  private key(path: string): string {
    // Normalize so absolute (`/ws/...`) and relative (`.versions/...`) addressing
    // of the same file collide, mirroring WorkspaceService.validatePath.
    return toWorkspaceRelative(path, ROOT);
  }

  async exists(path: string): Promise<boolean> {
    return this.files.has(this.key(path));
  }
  async readFile(path: string): Promise<string> {
    const b = this.files.get(this.key(path));
    if (!b) throw new Error(`ENOENT ${path}`);
    return new TextDecoder().decode(b);
  }
  async writeFile(path: string, content: string): Promise<void> {
    this.files.set(this.key(path), new TextEncoder().encode(content));
  }
  async readFileBinary(path: string): Promise<ArrayBuffer> {
    const b = this.files.get(this.key(path));
    if (!b) throw new Error(`ENOENT ${path}`);
    return b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength);
  }
  async writeFileBinary(path: string, content: ArrayBuffer): Promise<void> {
    this.files.set(this.key(path), new Uint8Array(content));
  }
  async delete(path: string): Promise<void> {
    this.files.delete(this.key(path));
  }
  async list(path: string): Promise<Array<{ name: string }>> {
    const dirKey = this.key(path).replace(/\/+$/, '');
    const prefix = dirKey === '' ? '' : `${dirKey}/`;
    const names = new Set<string>();
    for (const k of this.files.keys()) {
      if (prefix && !k.startsWith(prefix)) continue;
      const name = (prefix ? k.slice(prefix.length) : k).split('/')[0];
      if (name) names.add(name);
    }
    return [...names].map((name) => ({ name }));
  }
  getRootPath(): string | null {
    return ROOT;
  }
}

function bytes(s: string): ArrayBuffer {
  return new TextEncoder().encode(s).buffer as ArrayBuffer;
}

describe('BinaryVersionService', () => {
  let fs: MemFS;

  beforeEach(() => {
    fs = new MemFS();
  });

  it('writes a binary snapshot + metadata under .versions/ on save', async () => {
    const svc = new BinaryVersionService(fs);
    // Seed the live file.
    await fs.writeFileBinary('/ws/docs/Contract.docx', bytes('PK-v1'));

    const entry = await svc.saveVersion('/ws/docs/Contract.docx', {
      author: 'user',
      message: 'Auto-saved version',
    });

    expect(entry).not.toBeNull();
    expect(entry!.author).toBe('user');
    expect(entry!.message).toBe('Auto-saved version');
    expect(entry!.size).toBe(bytes('PK-v1').byteLength);
    // The snapshot file keeps the .docx extension.
    expect(entry!.snapshotFile.endsWith('.docx')).toBe(true);

    // Snapshot bytes are on disk under the .versions/ area.
    const keys = [...fs.files.keys()];
    const snapshotKey = keys.find(
      (k) =>
        k.startsWith('.versions/docs/Contract.docx/') && k.endsWith('.docx'),
    );
    expect(snapshotKey).toBeTruthy();
    expect(new TextDecoder().decode(fs.files.get(snapshotKey!)!)).toBe('PK-v1');

    // Index records the entry.
    const list = await svc.listVersions('/ws/docs/Contract.docx');
    expect(list).toHaveLength(1);
    expect(list[0]!.id).toBe(entry!.id);
  });

  it('returns null when there is nothing to snapshot (missing file)', async () => {
    const svc = new BinaryVersionService(fs);
    const entry = await svc.saveVersion('/ws/docs/Missing.docx');
    expect(entry).toBeNull();
  });

  it('lists versions newest-first', async () => {
    const svc = new BinaryVersionService(fs);
    await fs.writeFileBinary('/ws/a.docx', bytes('one'));
    const v1 = await svc.saveVersionFromBytes('/ws/a.docx', bytes('one'));
    const v2 = await svc.saveVersionFromBytes('/ws/a.docx', bytes('two'));
    const list = await svc.listVersions('/ws/a.docx');
    expect(list.map((e) => e.id)).toEqual([v2.id, v1.id]);
  });

  it('rebuilds history from snapshot files when index.json is corrupt (BUG-049a)', async () => {
    const svc = new BinaryVersionService(fs);
    await fs.writeFileBinary('/ws/a.docx', bytes('base'));
    const v1 = await svc.saveVersionFromBytes('/ws/a.docx', bytes('one'));
    const v2 = await svc.saveVersionFromBytes('/ws/a.docx', bytes('two'));
    // Corrupt the index (e.g. a crash mid-write left garbage).
    await fs.writeFile('.versions/a.docx/index.json', 'not valid json {{{');

    const list = await svc.listVersions('/ws/a.docx');
    const ids = list.map((e) => e.id);
    // Both snapshots are recovered from the files on disk (not lost to the
    // corrupt index). NOTE: exact ordering of saves within the same millisecond
    // can't be recovered from filenames, so we don't assert strict order here.
    expect(ids).toContain(v1.id);
    expect(ids).toContain(v2.id);
    expect(list).toHaveLength(2);
    // Each recovered entry has a valid (parsed-from-filename) timestamp.
    for (const e of list) {
      expect(Number.isNaN(Date.parse(e.timestamp))).toBe(false);
    }
    // And a recovered entry can still be restored from its metadata.
    const restored = await svc.readSnapshotBytes('/ws/a.docx', v1.id);
    expect(new TextDecoder().decode(restored)).toBe('one');
  });

  it('does not lose entries when two snapshots of the same file race (BUG-049)', async () => {
    const svc = new BinaryVersionService(fs);
    await fs.writeFileBinary('/ws/a.docx', bytes('base'));
    // Two concurrent snapshots: without per-index-path serialization the later
    // index write would clobber the earlier entry (read-modify-write race).
    const [a, b] = await Promise.all([
      svc.saveVersionFromBytes('/ws/a.docx', bytes('one')),
      svc.saveVersionFromBytes('/ws/a.docx', bytes('two')),
    ]);
    const list = await svc.listVersions('/ws/a.docx');
    const ids = list.map((e) => e.id);
    expect(ids).toContain(a.id);
    expect(ids).toContain(b.id);
    expect(list).toHaveLength(2);
  });

  it('caps retained snapshots and prunes the oldest (file + index)', async () => {
    const svc = new BinaryVersionService(fs, 3); // cap = 3
    await fs.writeFileBinary('/ws/a.docx', bytes('seed'));

    const made: string[] = [];
    for (let i = 0; i < 5; i++) {
      const e = await svc.saveVersionFromBytes('/ws/a.docx', bytes(`v${i}`), {
        message: `v${i}`,
      });
      made.push(e.snapshotFile);
    }

    const list = await svc.listVersions('/ws/a.docx');
    expect(list).toHaveLength(3); // capped

    // The two OLDEST snapshot files were deleted from disk.
    const remaining = [...fs.files.keys()].filter(
      (k) => k.startsWith('.versions/a.docx/') && k.endsWith('.docx'),
    );
    expect(remaining).toHaveLength(3);
    expect(
      fs.files.has(`.versions/a.docx/${made[0]}`),
    ).toBe(false);
    expect(
      fs.files.has(`.versions/a.docx/${made[1]}`),
    ).toBe(false);
    // The 3 newest remain.
    expect(fs.files.has(`.versions/a.docx/${made[4]}`)).toBe(true);
  });

  it('restore copies a snapshot back over the current file and loses nothing', async () => {
    const svc = new BinaryVersionService(fs);

    // v1 content, snapshot it, then change the live file to v2.
    await fs.writeFileBinary('/ws/a.docx', bytes('VERSION-ONE'));
    const v1 = await svc.saveVersionFromBytes('/ws/a.docx', bytes('VERSION-ONE'), {
      message: 'v1',
    });
    await fs.writeFileBinary('/ws/a.docx', bytes('VERSION-TWO'));

    // Restore v1.
    const restored = await svc.restoreVersion('/ws/a.docx', v1.id);
    expect(new TextDecoder().decode(restored)).toBe('VERSION-ONE');

    // The live file now holds v1's bytes.
    const live = await fs.readFileBinary('/ws/a.docx');
    expect(new TextDecoder().decode(live)).toBe('VERSION-ONE');

    // History grew: original v1 + a "Before restore" capture (VERSION-TWO) +
    // the "Restored from version history" entry. Nothing was lost.
    const list = await svc.listVersions('/ws/a.docx');
    expect(list.length).toBeGreaterThanOrEqual(3);
    expect(list[0]!.message).toBe('Restored from version history');
    expect(list.some((e) => e.message === 'Before restore')).toBe(true);
  });

  it('resolves an absolute snapshot path for the engine', async () => {
    const svc = new BinaryVersionService(fs);
    await fs.writeFileBinary('/ws/docs/a.docx', bytes('x'));
    const e = await svc.saveVersionFromBytes('/ws/docs/a.docx', bytes('x'));
    const abs = await svc.snapshotAbsolutePath('/ws/docs/a.docx', e.id);
    expect(abs).toBe(`/ws/.versions/docs/a.docx/${e.snapshotFile}`);
  });

  it('treats a corrupt index as empty rather than throwing', async () => {
    const svc = new BinaryVersionService(fs);
    await fs.writeFile('.versions/a.docx/index.json', '{ not json');
    const list = await svc.listVersions('/ws/a.docx');
    expect(list).toEqual([]);
  });
});

describe('toWorkspaceRelative', () => {
  it('strips the workspace root', () => {
    expect(toWorkspaceRelative('/ws/docs/a.docx', '/ws')).toBe('docs/a.docx');
  });
  it('leaves an already-relative path alone', () => {
    expect(toWorkspaceRelative('docs/a.docx', '/ws')).toBe('docs/a.docx');
  });
  it('handles a trailing slash on the root', () => {
    expect(toWorkspaceRelative('/ws/a.docx', '/ws/')).toBe('a.docx');
  });
});
