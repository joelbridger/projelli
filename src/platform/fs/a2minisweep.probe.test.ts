/**
 * A2 MINI-SWEEP — PHASE 1 PROBE SUITE (scratch, NOT a production guard).
 *
 * PR-5: a static "looks safe" verdict on a method is a HYPOTHESIS. This suite
 * SETTLES every WorkspaceService method that can read a meeting path's content
 * OR metadata, by EXECUTING a read-as-non-owner probe through the real service
 * over a realistic in-memory backend.
 *
 * The backend below is deliberately MORE realistic than the WB-085 suite's:
 *   - `stat` returns a full FileStat (size, modifiedAt, createdAt, isSymlink)
 *   - `move` / `copy` / `rename` / `delete` are REAL (the WB-085 harness stubs
 *     them as no-ops, which is exactly why the write-side bypasses were never
 *     observed)
 *   - every miss rejects with a distinguishable ENOENT Error, so the `cause`
 *     field of a refusal can be compared against a genuine miss
 *
 * Each test prints its OBSERVED value so the report can quote real output.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceService } from './WorkspaceService';
import type { FSBackend, FileStat } from './types';
import { FileOperationError } from './types';
import type { FileNode } from '@/platform/types/workspace';
import { setMeetingMaterialViewerResolver } from './meetingMaterialViewer';

const ROOT = '/ws';
const ADVISOR_A = 'advisor-a';
const ADVISOR_B = 'advisor-b';
const MATTER = `${ROOT}/Clients/Hendricks`;
const MEETINGS = `${MATTER}/Meetings`;
/** The folder name itself is sensitive: it carries the client + the subject. */
const SECRET = `${MEETINGS}/2026-07-02-SECRET-annual-review`;
const AUDIO = `${SECRET}/audio.wav`;
const NOTES = `${SECRET}/notes.docx`;
const TRANSCRIPT = `${SECRET}/transcript.json`;
const STAMP = `${SECRET}/meeting.json`;
/** A path that genuinely does not exist — the control for every error shape. */
const ABSENT = `${MEETINGS}/2026-01-01-does-not-exist/audio.wav`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();

const observed: string[] = [];
function record(label: string, value: unknown) {
  const rendered =
    typeof value === 'string' ? value : JSON.stringify(value, null, 0);
  observed.push(`${label} => ${rendered}`);
}

interface Harness {
  backend: FSBackend;
  seed(path: string, content: string): void;
  raw(path: string): string | null;
  paths(): string[];
}

function makeBackend(root = ROOT): Harness {
  const files = new Map<string, ArrayBuffer>();
  const dirs = new Set<string>([root]);
  const times = new Map<string, { m: Date; c: Date }>();

  const ensureParents = (path: string) => {
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (parent && parent.startsWith(root)) {
      dirs.add(parent);
      if (parent === root) break;
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  };

  const resolve = (path: string): string =>
    path === '' || path === '.'
      ? root
      : path.startsWith('/')
        ? path
        : `${root}/${path}`;

  const enoent = (path: string) => new Error(`ENOENT: no such file: ${path}`);

  const backend: FSBackend = {
    read(rawPath) {
      const path = resolve(rawPath);
      const bytes = files.get(path);
      if (!bytes) return Promise.reject(enoent(path));
      return Promise.resolve(decoder.decode(bytes));
    },
    readBinary(rawPath) {
      const path = resolve(rawPath);
      const bytes = files.get(path);
      if (!bytes) return Promise.reject(enoent(path));
      return Promise.resolve(bytes.slice(0));
    },
    write(rawPath, content) {
      const path = resolve(rawPath);
      files.set(path, encoder.encode(content).buffer as ArrayBuffer);
      times.set(path, { m: new Date('2026-07-19T00:00:00Z'), c: new Date('2026-07-19T00:00:00Z') });
      ensureParents(path);
      return Promise.resolve();
    },
    writeBinary(rawPath, content) {
      const path = resolve(rawPath);
      files.set(path, content.slice(0));
      ensureParents(path);
      return Promise.resolve();
    },
    exists(rawPath) {
      const path = resolve(rawPath);
      return Promise.resolve(files.has(path) || dirs.has(path));
    },
    delete(rawPath) {
      const path = resolve(rawPath);
      if (!files.has(path) && !dirs.has(path))
        return Promise.reject(enoent(path));
      files.delete(path);
      dirs.delete(path);
      for (const key of [...files.keys()])
        if (key.startsWith(`${path}/`)) files.delete(key);
      for (const key of [...dirs])
        if (key.startsWith(`${path}/`)) dirs.delete(key);
      return Promise.resolve();
    },
    move(from, to) {
      const src = resolve(from);
      const dst = resolve(to);
      if (!files.has(src) && !dirs.has(src)) return Promise.reject(enoent(src));
      const relocate = (key: string) =>
        key === src ? dst : `${dst}${key.slice(src.length)}`;
      for (const key of [...files.keys()]) {
        if (key === src || key.startsWith(`${src}/`)) {
          files.set(relocate(key), files.get(key) as ArrayBuffer);
          files.delete(key);
        }
      }
      for (const key of [...dirs]) {
        if (key === src || key.startsWith(`${src}/`)) {
          dirs.add(relocate(key));
          dirs.delete(key);
        }
      }
      ensureParents(dst);
      return Promise.resolve();
    },
    copy(from, to) {
      const src = resolve(from);
      const dst = resolve(to);
      if (!files.has(src) && !dirs.has(src)) return Promise.reject(enoent(src));
      const relocate = (key: string) =>
        key === src ? dst : `${dst}${key.slice(src.length)}`;
      for (const key of [...files.keys()])
        if (key === src || key.startsWith(`${src}/`))
          files.set(relocate(key), (files.get(key) as ArrayBuffer).slice(0));
      for (const key of [...dirs])
        if (key === src || key.startsWith(`${src}/`)) dirs.add(relocate(key));
      ensureParents(dst);
      return Promise.resolve();
    },
    rename(rawPath, newName) {
      const src = resolve(rawPath);
      const dst = `${src.slice(0, src.lastIndexOf('/'))}/${newName}`;
      return backend.move(src, dst);
    },
    mkdir(rawPath) {
      const path = resolve(rawPath);
      dirs.add(path);
      ensureParents(path);
      return Promise.resolve();
    },
    list(rawPath) {
      const path = resolve(rawPath);
      if (!dirs.has(path)) return Promise.reject(enoent(path));
      const prefix = `${path}/`;
      const seen = new Map<string, FileNode>();
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        seen.set(name, {
          name,
          path: `${path}/${name}`,
          type: slash === -1 ? 'file' : 'folder',
        } as FileNode);
      }
      for (const dir of dirs) {
        if (!dir.startsWith(prefix)) continue;
        const rest = dir.slice(prefix.length);
        if (rest.includes('/')) continue;
        seen.set(rest, { name: rest, path: dir, type: 'folder' } as FileNode);
      }
      return Promise.resolve([...seen.values()]);
    },
    stat(rawPath): Promise<FileStat> {
      const path = resolve(rawPath);
      const isDir = dirs.has(path);
      if (!isDir && !files.has(path)) return Promise.reject(enoent(path));
      const t = times.get(path) ?? {
        m: new Date('2026-07-02T15:00:00Z'),
        c: new Date('2026-07-02T15:00:00Z'),
      };
      return Promise.resolve({
        path,
        name: path.slice(path.lastIndexOf('/') + 1),
        type: isDir ? 'folder' : 'file',
        size: files.get(path)?.byteLength ?? 0,
        modifiedAt: t.m,
        createdAt: t.c,
        isSymlink: false,
      });
    },
    isSymlink: () => Promise.resolve(false),
    resolveSymlink: (path: string) => Promise.resolve(path),
    getRootPath: () => root,
    setRootPath: () => Promise.resolve(),
  };

  return {
    backend,
    seed(path, content) {
      files.set(path, encoder.encode(content).buffer as ArrayBuffer);
      times.set(path, {
        m: new Date('2026-07-02T15:00:00Z'),
        c: new Date('2026-07-02T15:00:00Z'),
      });
      ensureParents(path);
    },
    raw: (path) =>
      files.has(path) ? decoder.decode(files.get(path) as ArrayBuffer) : null,
    paths: () => [...files.keys()].sort(),
  };
}

function stampJson(ownerRef: string, policy: string | null) {
  return JSON.stringify({
    matterId: 'hendricks',
    startedAt: '2026-07-02T15:00:00Z',
    ...(ownerRef ? { ownerRef } : {}),
    ...(policy ? { visibilityPolicyId: policy } : {}),
  });
}

/** A owns SECRET, owner-private. B is the non-owner viewer. */
async function scenario(root = ROOT) {
  const fs = makeBackend(root);
  fs.seed(STAMP, stampJson(ADVISOR_A, 'owner-private'));
  fs.seed(AUDIO, 'RIFF....0123456789abcdefghijklmno'); // 32 bytes
  fs.seed(NOTES, 'A-notes-body');
  fs.seed(TRANSCRIPT, '{"segments":["client said X"]}');
  const service = new WorkspaceService();
  await service.initialize(fs.backend, root);
  return { service, fs };
}

/** Capture the FULL observable shape of a thrown error. */
function shapeOf(err: unknown) {
  const e = err as FileOperationError & { cause?: unknown };
  return {
    ctor: (e as object)?.constructor?.name ?? null,
    name: e?.name ?? null,
    message: e?.message ?? null,
    path: e?.path ?? null,
    operation: e?.operation ?? null,
    causePresent: e?.cause !== undefined && e?.cause !== null,
    causeMessage:
      e?.cause instanceof Error ? e.cause.message : (e?.cause ?? null),
  };
}

async function capture(fn: () => Promise<unknown>) {
  try {
    const value = await fn();
    return { threw: false as const, value };
  } catch (err) {
    return { threw: true as const, err, shape: shapeOf(err) };
  }
}

let viewer: string | null = null;
beforeEach(() => {
  viewer = ADVISOR_B; // every probe runs AS THE NON-OWNER
  setMeetingMaterialViewerResolver(() => viewer);
});
afterEach(() => setMeetingMaterialViewerResolver(null));

import { afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';

afterAll(() => {
  writeFileSync('/tmp/a2-probe-observations.txt', observed.join('\n') + '\n');
});

// ===========================================================================
// GROUP 1 — the four ALREADY-GATED methods (re-confirm, plus error shape)
// ===========================================================================

describe('G1 gated methods', () => {
  it('P01 readFile — refuses, but compare error shape to a genuine miss', async () => {
    const { service } = await scenario();
    const refusal = await capture(() => service.readFile(AUDIO));
    const miss = await capture(() => service.readFile(ABSENT));
    record('P01 refusal', refusal.threw && refusal.shape);
    record('P01 genuine-miss', miss.threw && miss.shape);
    expect(refusal.threw).toBe(true);
    expect(miss.threw).toBe(true);
    // THE CHECK: are they indistinguishable?
    record(
      'P01 distinguishable-fields',
      refusal.threw && miss.threw
        ? Object.keys(refusal.shape).filter(
            (k) =>
              JSON.stringify(
                (refusal.shape as Record<string, unknown>)[k]
              ) !==
              JSON.stringify(
                (miss.shape as Record<string, unknown>)[k]
              )
          )
        : 'n/a'
    );
  });

  it('P02 readFileBinary — same comparison', async () => {
    const { service } = await scenario();
    const refusal = await capture(() => service.readFileBinary(AUDIO));
    const miss = await capture(() => service.readFileBinary(ABSENT));
    record('P02 refusal', refusal.threw && refusal.shape);
    record('P02 genuine-miss', miss.threw && miss.shape);
  });

  it('P03 exists — reports absent for refused material', async () => {
    const { service } = await scenario();
    record('P03 exists(audio)', await service.exists(AUDIO));
    record('P03 exists(meeting folder)', await service.exists(SECRET));
    record('P03 exists(absent)', await service.exists(ABSENT));
  });

  it('P04 list — inside refused folder, and Meetings/ filtering', async () => {
    const { service } = await scenario();
    const inside = await capture(() => service.list(SECRET));
    const missDir = await capture(() => service.list(`${MEETINGS}/nope`));
    record('P04 list-inside-refused', inside.threw && inside.shape);
    record('P04 list-genuine-miss', missDir.threw && missDir.shape);
    const meetings = await capture(() => service.list(MEETINGS));
    record(
      'P04 list(Meetings/)',
      !meetings.threw && (meetings.value as FileNode[]).map((n) => n.name)
    );
  });
});

// ===========================================================================
// GROUP 2 — the UNGATED metadata readers (F1, F2 + candidates)
// ===========================================================================

describe('G2 ungated metadata readers', () => {
  it('P05 stat (F2) — non-owner asks for A audio.wav', async () => {
    const { service } = await scenario();
    const r = await capture(() => service.stat(AUDIO));
    record(
      'P05 stat(audio)',
      r.threw ? r.shape : (r.value as FileStat)
    );
    const folder = await capture(() => service.stat(SECRET));
    record('P05 stat(meeting folder)', folder.threw ? folder.shape : folder.value);
  });

  it('P06 getFileTree (F1) — does the tree contain A meeting?', async () => {
    const { service } = await scenario();
    const tree = await service.getFileTree();
    const flat: string[] = [];
    const walk = (nodes: FileNode[]) => {
      for (const n of nodes) {
        flat.push(n.path);
        if (n.children) walk(n.children);
      }
    };
    walk(tree);
    record(
      'P06 getFileTree leaked paths',
      flat.filter((p) => p.includes('SECRET'))
    );
  });

  it('P07 isSymlink — ungated metadata read', async () => {
    const { service } = await scenario();
    const r = await capture(() => service.isSymlink(AUDIO));
    const m = await capture(() => service.isSymlink(ABSENT));
    record('P07 isSymlink(A audio)', r.threw ? r.shape : r.value);
    record('P07 isSymlink(absent)', m.threw ? m.shape : m.value);
  });

  it('P08 resolveSymlink — ungated metadata read', async () => {
    const { service } = await scenario();
    const r = await capture(() => service.resolveSymlink(AUDIO));
    record('P08 resolveSymlink(A audio)', r.threw ? r.shape : r.value);
  });

  it('P09 getBackend — hands out the raw ungated backend', async () => {
    const { service } = await scenario();
    const raw = service.getBackend();
    const bytes = await raw!.read('Clients/Hendricks/Meetings/2026-07-02-SECRET-annual-review/audio.wav');
    record('P09 getBackend().read(A audio)', bytes);
  });

  it('P10 initialize/getWorkspace — root pointed AT a meeting folder', async () => {
    const fs = makeBackend(ROOT);
    fs.seed(STAMP, stampJson(ADVISOR_A, 'owner-private'));
    fs.seed(AUDIO, 'RIFF....0123456789abcdefghijklmno');
    const svc = new WorkspaceService();
    const r = await capture(() => svc.initialize(fs.backend, SECRET));
    record('P10 initialize(root=A meeting folder)', r.threw ? r.shape : r.value);
    record('P10 getWorkspace()', svc.getWorkspace());
    record('P10 toRecentWorkspace()', svc.toRecentWorkspace());
    // existence oracle on an arbitrary path via initialize
    const svc2 = new WorkspaceService();
    const missing = await capture(() =>
      svc2.initialize(makeBackend(ROOT).backend, `${MEETINGS}/never-existed`)
    );
    record('P10 initialize(absent folder)', missing.threw ? missing.shape : 'no-throw');
  });
});

// ===========================================================================
// GROUP 3 — WRITE-SIDE bypasses (HD-2: a read gate with open writes)
// ===========================================================================

describe('G3 write-side bypasses', () => {
  it('P11 copy — exfiltrate A material to an ungated path, then read it', async () => {
    const { service } = await scenario();
    const c = await capture(() => service.copy(AUDIO, `${ROOT}/loot.wav`));
    record('P11 copy threw?', c.threw ? c.shape : 'no-throw');
    const readBack = await capture(() => service.readFile(`${ROOT}/loot.wav`));
    record('P11 readFile(loot.wav)', readBack.threw ? readBack.shape : readBack.value);
  });

  it('P12 move — relocate A meeting folder out of Meetings/, then read', async () => {
    const { service } = await scenario();
    const m = await capture(() => service.move(SECRET, `${ROOT}/stolen`));
    record('P12 move threw?', m.threw ? m.shape : 'no-throw');
    const readBack = await capture(() => service.readFile(`${ROOT}/stolen/audio.wav`));
    record('P12 readFile(stolen/audio.wav)', readBack.threw ? readBack.shape : readBack.value);
  });

  it('P13 rename — rename the Meetings segment itself', async () => {
    const { service } = await scenario();
    const r = await capture(() => service.rename(MEETINGS, 'Meetingz'));
    record('P13 rename threw?', r.threw ? r.shape : 'no-throw');
    const readBack = await capture(() =>
      service.readFile(`${MATTER}/Meetingz/2026-07-02-SECRET-annual-review/audio.wav`)
    );
    record('P13 readFile(after rename)', readBack.threw ? readBack.shape : readBack.value);
  });

  it('P14 writeFile — overwrite A stamp to re-own the folder, then read', async () => {
    const { service, fs } = await scenario();
    const w = await capture(() =>
      service.writeFile(STAMP, stampJson(ADVISOR_B, 'owner-private'))
    );
    record('P14 writeFile(A meeting.json) threw?', w.threw ? w.shape : 'no-throw');
    record('P14 stamp on disk now', fs.raw(STAMP));
    const readBack = await capture(() => service.readFile(AUDIO));
    record('P14 readFile(A audio) after re-stamp', readBack.threw ? readBack.shape : readBack.value);
  });

  it('P15 delete — destroy A material as a non-owner', async () => {
    const { service, fs } = await scenario();
    const d = await capture(() => service.delete(AUDIO));
    record('P15 delete threw?', d.threw ? d.shape : 'no-throw');
    record('P15 audio still on disk?', fs.raw(AUDIO) !== null);
    const miss = await capture(() => service.delete(ABSENT));
    record('P15 delete(absent) shape', miss.threw ? miss.shape : 'no-throw');
  });

  it('P16 mkdir / writeFileBinary into a refused meeting folder', async () => {
    const { service, fs } = await scenario();
    const mk = await capture(() => service.mkdir(`${SECRET}/planted`));
    record('P16 mkdir into refused folder threw?', mk.threw ? mk.shape : 'no-throw');
    const wb = await capture(() =>
      service.writeFileBinary(NOTES, encoder.encode('OVERWRITTEN').buffer as ArrayBuffer)
    );
    record('P16 writeFileBinary(A notes) threw?', wb.threw ? wb.shape : 'no-throw');
    record('P16 notes on disk now', fs.raw(NOTES));
  });

  it('P17 adoptUnstampedMeetingFolder — stamped vs unstamped', async () => {
    const { service } = await scenario();
    const stamped = await capture(() =>
      service.adoptUnstampedMeetingFolder(SECRET, { ownerRef: ADVISOR_B })
    );
    record('P17 adopt(A stamped folder)', stamped.threw ? stamped.shape : stamped.value);
    const absent = await capture(() =>
      service.adoptUnstampedMeetingFolder(`${MEETINGS}/never-existed`, {
        ownerRef: ADVISOR_B,
      })
    );
    record('P17 adopt(absent folder)', absent.threw ? absent.shape : absent.value);
  });
});

// ===========================================================================
// GROUP 4 — A2.1 NESTED MEETINGS FOLDER (protected outer / permissive inner)
// ===========================================================================

describe('G4 A2.1 nested meeting folders', () => {
  it('P18 protected OUTER + permissive INNER — does the inner stamp win?', async () => {
    const fs = makeBackend(ROOT);
    // OUTER: A owned, owner-private
    fs.seed(STAMP, stampJson(ADVISOR_A, 'owner-private'));
    fs.seed(AUDIO, 'OUTER-SECRET-AUDIO');
    // INNER: .../SECRET/Meetings/inner/ stamped firm-visible (permissive)
    const INNER = `${SECRET}/Meetings/inner`;
    fs.seed(`${INNER}/meeting.json`, stampJson(ADVISOR_B, 'firm-visible'));
    fs.seed(`${INNER}/loot.txt`, 'INNER-PAYLOAD');
    const service = new WorkspaceService();
    await service.initialize(fs.backend, ROOT);

    const inner = await capture(() => service.readFile(`${INNER}/loot.txt`));
    record('P18 read inner (permissive under protected outer)', inner.threw ? inner.shape : inner.value);

    // The real question: can the ATTACKER-CONTROLLED inner stamp unlock the
    // OUTER material? Two shapes to try.
    // (a) put a permissive stamp in a nested Meetings dir, read outer artifact
    const outer = await capture(() => service.readFile(AUDIO));
    record('P18a read OUTER audio while inner is permissive', outer.threw ? outer.shape : outer.value);

    // (b) attacker plants .../SECRET/Meetings/<x>/ and asks for a path whose
    //     LAST Meetings segment is the planted one but which resolves to outer
    //     bytes via a sibling reference
    const planted = `${SECRET}/Meetings/${'2026-07-02-SECRET-annual-review'}/audio.wav`;
    const p = await capture(() => service.readFile(planted));
    record('P18b read planted-nested path', p.threw ? p.shape : p.value);
  });

  it('P19 nested — attacker plants a permissive inner stamp INSIDE the protected folder', async () => {
    const fs = makeBackend(ROOT);
    fs.seed(STAMP, stampJson(ADVISOR_A, 'owner-private'));
    fs.seed(AUDIO, 'OUTER-SECRET-AUDIO');
    const service = new WorkspaceService();
    await service.initialize(fs.backend, ROOT);
    // B (non-owner) writes a nested Meetings tree inside A's folder — writes
    // are ungated (see G3), so this is reachable.
    const planted = `${SECRET}/Meetings/x/meeting.json`;
    const w = await capture(() =>
      service.writeFile(planted, stampJson(ADVISOR_B, 'firm-visible'))
    );
    record('P19 plant nested stamp threw?', w.threw ? w.shape : 'no-throw');
    // now copy A's audio into the permissive nested folder using the ungated copy
    const c = await capture(() => service.copy(AUDIO, `${SECRET}/Meetings/x/audio.wav`));
    record('P19 copy into permissive nested folder threw?', c.threw ? c.shape : 'no-throw');
    const r = await capture(() => service.readFile(`${SECRET}/Meetings/x/audio.wav`));
    record('P19 read A audio via permissive nested folder', r.threw ? r.shape : r.value);
  });

  it('P20 meetingFolderForPath resolution on a nested path (unit-level truth)', async () => {
    const { meetingFolderForPath } = await import('./meetingMaterialVisibility');
    record(
      'P20 resolve nested',
      meetingFolderForPath(`${SECRET}/Meetings/inner/loot.txt`)
    );
    record('P20 resolve flat', meetingFolderForPath(AUDIO));
    record(
      'P20 resolve deep-non-meeting',
      meetingFolderForPath(`${SECRET}/sub/deep/file.txt`)
    );
  });
});

// ===========================================================================
// GROUP 5 — symlink-safety ordering (gate claims "before the backend")
// ===========================================================================

describe('G5 pre-gate backend touches', () => {
  it('P21 checkSymlinkSafety runs BEFORE the gate in readFile', async () => {
    const fs = makeBackend(ROOT);
    fs.seed(STAMP, stampJson(ADVISOR_A, 'owner-private'));
    fs.seed(AUDIO, 'RIFF');
    const calls: string[] = [];
    const wrapped: FSBackend = new Proxy(fs.backend, {
      get(target, prop, recv) {
        const value = Reflect.get(target, prop, recv);
        if (typeof value === 'function' && typeof prop === 'string') {
          return (...args: unknown[]) => {
            calls.push(`${prop}(${String(args[0])})`);
            return (value as (...a: unknown[]) => unknown).apply(target, args);
          };
        }
        return value;
      },
    });
    const service = new WorkspaceService();
    await service.initialize(wrapped, ROOT);
    calls.length = 0;
    await capture(() => service.readFile(AUDIO));
    record('P21 backend calls during a REFUSED readFile', calls);
  });

  it('P22 symlink escaping the workspace produces a DIFFERENT error than a refusal', async () => {
    const fs = makeBackend(ROOT);
    fs.seed(STAMP, stampJson(ADVISOR_A, 'owner-private'));
    fs.seed(AUDIO, 'RIFF');
    const linky: FSBackend = {
      ...fs.backend,
      isSymlink: (p: string) => Promise.resolve(p.endsWith('audio.wav')),
      resolveSymlink: () => Promise.resolve('/etc/passwd'),
    };
    const service = new WorkspaceService();
    await service.initialize(linky, ROOT);
    const r = await capture(() => service.readFile(AUDIO));
    record('P22 refused-AND-symlinked readFile', r.threw ? r.shape : r.value);
  });
});
