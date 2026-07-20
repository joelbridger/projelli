/**
 * A2 MINI-SWEEP — PHASE 1 PROBE SUITE, ROUND 2 (scratch, NOT a production guard).
 *
 * Round 1 (`a2minisweep.probe.test.ts`) settled the big shapes but had three
 * harness artifacts that would have produced DISHONEST verdicts. Round 2 fixes
 * them and closes the remaining gaps:
 *
 *   (1) `setRootPath` was a no-op, so `initialize(root = <meeting folder>)`
 *       actually stat'd the OLD root. Fixed: the backend genuinely re-roots.
 *   (2) The "genuine miss" control was itself a REFUSAL (a nonexistent meeting
 *       folder is unstamped -> refused), so the error-shape comparison compared
 *       a refusal against a refusal. Fixed: the control is now a missing file
 *       inside a folder the viewer IS allowed to read.
 *   (3) `isSymlink` / `resolveSymlink` were constants, so an ungated metadata
 *       reader looked benign. Fixed: a realistic lstat-shaped backend that
 *       rejects for a path that does not exist.
 */
import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { writeFileSync } from 'node:fs';
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
const SECRET = `${MEETINGS}/2026-07-02-SECRET-annual-review`;
const AUDIO = `${SECRET}/audio.wav`;
/** A meeting B IS allowed to read — the control folder for genuine misses. */
const MINE = `${MEETINGS}/2026-07-09-b-owned`;

const encoder = new TextEncoder();
const decoder = new TextDecoder();
const observed: string[] = [];
function record(label: string, value: unknown) {
  observed.push(
    `${label} => ${typeof value === 'string' ? value : JSON.stringify(value)}`
  );
}
afterAll(() => {
  writeFileSync('/tmp/a2-probe2-observations.txt', observed.join('\n') + '\n');
});

interface Opts {
  /** Realistic lstat: reject for a path that does not exist. */
  strictLinkStat?: boolean;
}

function makeBackend(opts: Opts = {}) {
  let root = ROOT;
  const files = new Map<string, ArrayBuffer>();
  const dirs = new Set<string>([ROOT]);
  const times = new Map<string, Date>();

  const ensureParents = (path: string) => {
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (parent && parent.startsWith(ROOT)) {
      dirs.add(parent);
      if (parent === ROOT) break;
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  };
  const resolve = (p: string): string =>
    p === '' || p === '.' ? root : p.startsWith('/') ? p : `${root}/${p}`;
  const enoent = (p: string) => new Error(`ENOENT: no such file: ${p}`);
  const present = (p: string) => files.has(p) || dirs.has(p);

  const backend: FSBackend = {
    read(rp) {
      const p = resolve(rp);
      const b = files.get(p);
      return b
        ? Promise.resolve(decoder.decode(b))
        : Promise.reject(enoent(p));
    },
    readBinary(rp) {
      const p = resolve(rp);
      const b = files.get(p);
      return b ? Promise.resolve(b.slice(0)) : Promise.reject(enoent(p));
    },
    write(rp, c) {
      const p = resolve(rp);
      files.set(p, encoder.encode(c).buffer as ArrayBuffer);
      ensureParents(p);
      return Promise.resolve();
    },
    writeBinary(rp, c) {
      const p = resolve(rp);
      files.set(p, c.slice(0));
      ensureParents(p);
      return Promise.resolve();
    },
    exists: (rp) => Promise.resolve(present(resolve(rp))),
    delete(rp) {
      const p = resolve(rp);
      if (!present(p)) return Promise.reject(enoent(p));
      files.delete(p);
      dirs.delete(p);
      return Promise.resolve();
    },
    move: () => Promise.resolve(),
    copy: () => Promise.resolve(),
    rename: () => Promise.resolve(),
    mkdir(rp) {
      const p = resolve(rp);
      dirs.add(p);
      ensureParents(p);
      return Promise.resolve();
    },
    list(rp) {
      const p = resolve(rp);
      if (!dirs.has(p)) return Promise.reject(enoent(p));
      const prefix = `${p}/`;
      const seen = new Map<string, FileNode>();
      for (const f of files.keys()) {
        if (!f.startsWith(prefix)) continue;
        const rest = f.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        seen.set(name, {
          name,
          path: `${p}/${name}`,
          type: slash === -1 ? 'file' : 'folder',
        } as FileNode);
      }
      for (const d of dirs) {
        if (!d.startsWith(prefix)) continue;
        const rest = d.slice(prefix.length);
        if (rest.includes('/')) continue;
        seen.set(rest, { name: rest, path: d, type: 'folder' } as FileNode);
      }
      return Promise.resolve([...seen.values()]);
    },
    stat(rp): Promise<FileStat> {
      const p = resolve(rp);
      if (!present(p)) return Promise.reject(enoent(p));
      const t = times.get(p) ?? new Date('2026-07-02T15:00:00Z');
      return Promise.resolve({
        path: p,
        name: p.slice(p.lastIndexOf('/') + 1),
        type: dirs.has(p) ? 'folder' : 'file',
        size: files.get(p)?.byteLength ?? 0,
        modifiedAt: t,
        createdAt: t,
        isSymlink: false,
      });
    },
    isSymlink(rp) {
      const p = resolve(rp);
      if (opts.strictLinkStat && !present(p)) return Promise.reject(enoent(p));
      return Promise.resolve(false);
    },
    resolveSymlink(rp) {
      const p = resolve(rp);
      if (opts.strictLinkStat && !present(p)) return Promise.reject(enoent(p));
      return Promise.resolve(p);
    },
    getRootPath: () => root,
    setRootPath(p) {
      root = p; // ROUND-2 FIX: genuinely re-root, as a real backend does.
      return Promise.resolve();
    },
  };

  return {
    backend,
    seed(path: string, content: string, mtime?: string) {
      files.set(path, encoder.encode(content).buffer as ArrayBuffer);
      if (mtime) times.set(path, new Date(mtime));
      ensureParents(path);
      if (mtime) {
        // stamp the enclosing folders too, so a folder stat carries a real time
        let parent = path.slice(0, path.lastIndexOf('/'));
        while (parent.startsWith(ROOT)) {
          times.set(parent, new Date(mtime));
          if (parent === ROOT) break;
          parent = parent.slice(0, parent.lastIndexOf('/'));
        }
      }
    },
    raw: (p: string) =>
      files.has(p) ? decoder.decode(files.get(p) as ArrayBuffer) : null,
  };
}

function stampJson(ownerRef: string, policy: string | null) {
  return JSON.stringify({
    matterId: 'hendricks',
    ...(ownerRef ? { ownerRef } : {}),
    ...(policy ? { visibilityPolicyId: policy } : {}),
  });
}

async function scenario(opts: Opts = {}) {
  const fs = makeBackend(opts);
  // A's owner-private meeting (the target)
  fs.seed(`${SECRET}/meeting.json`, stampJson(ADVISOR_A, 'owner-private'), '2026-07-02T15:00:00Z');
  fs.seed(AUDIO, 'RIFF....0123456789abcdefghijklmn', '2026-07-02T15:00:00Z'); // 32 bytes
  // B's OWN meeting (the control: reads here are ALLOWED)
  fs.seed(`${MINE}/meeting.json`, stampJson(ADVISOR_B, 'owner-private'));
  fs.seed(`${MINE}/audio.wav`, 'my-own-audio');
  const service = new WorkspaceService();
  await service.initialize(fs.backend, ROOT);
  return { service, fs };
}

function shapeOf(err: unknown) {
  const e = err as FileOperationError & { cause?: unknown };
  return {
    ctor: (e as object)?.constructor?.name ?? null,
    name: e?.name ?? null,
    /** path-independent message template, so paths don't mask the comparison */
    messageTemplate: (e?.message ?? '').replace(/:[^:]*$/, ': <PATH>'),
    operation: e?.operation ?? null,
    causePresent: e?.cause !== undefined && e?.cause !== null,
    causeMessage: e?.cause instanceof Error ? '<Error>' : null,
  };
}
async function capture(fn: () => Promise<unknown>) {
  try {
    return { threw: false as const, value: await fn() };
  } catch (err) {
    return { threw: true as const, err, shape: shapeOf(err) };
  }
}
function diff(a: object, b: object) {
  return Object.keys(a).filter(
    (k) =>
      JSON.stringify((a as Record<string, unknown>)[k]) !==
      JSON.stringify((b as Record<string, unknown>)[k])
  );
}

let viewer: string | null = null;
beforeEach(() => {
  viewer = ADVISOR_B;
  setMeetingMaterialViewerResolver(() => viewer);
});
afterEach(() => setMeetingMaterialViewerResolver(null));

// ===========================================================================
describe('R2-A error shape: REFUSAL vs a GENUINE MISS the viewer is allowed', () => {
  it('P30 readFile', async () => {
    const { service } = await scenario();
    const refusal = await capture(() => service.readFile(AUDIO));
    const miss = await capture(() => service.readFile(`${MINE}/absent.wav`));
    record('P30 refusal', refusal.threw && refusal.shape);
    record('P30 allowed-genuine-miss', miss.threw && miss.shape);
    record(
      'P30 DISTINGUISHABLE FIELDS',
      refusal.threw && miss.threw ? diff(refusal.shape, miss.shape) : 'n/a'
    );
    expect(refusal.threw && miss.threw).toBe(true);
  });

  it('P31 readFileBinary', async () => {
    const { service } = await scenario();
    const refusal = await capture(() => service.readFileBinary(AUDIO));
    const miss = await capture(() => service.readFileBinary(`${MINE}/absent.wav`));
    record(
      'P31 DISTINGUISHABLE FIELDS',
      refusal.threw && miss.threw ? diff(refusal.shape, miss.shape) : 'n/a'
    );
    record('P31 refusal', refusal.threw && refusal.shape);
    record('P31 allowed-genuine-miss', miss.threw && miss.shape);
  });

  it('P32 list', async () => {
    const { service } = await scenario();
    const refusal = await capture(() => service.list(SECRET));
    const miss = await capture(() => service.list(`${MINE}/absent-dir`));
    record('P32 refusal', refusal.threw && refusal.shape);
    record('P32 allowed-genuine-miss', miss.threw && miss.shape);
    record(
      'P32 DISTINGUISHABLE FIELDS',
      refusal.threw && miss.threw ? diff(refusal.shape, miss.shape) : 'n/a'
    );
  });

  it('P33 non-meeting genuine miss (baseline for what "allowed" looks like)', async () => {
    const { service } = await scenario();
    const miss = await capture(() => service.readFile(`${ROOT}/nothing-here.txt`));
    record('P33 non-meeting genuine miss', miss.threw && miss.shape);
  });
});

// ===========================================================================
describe('R2-B ungated metadata readers, realistic backend', () => {
  it('P34 isSymlink is an EXISTENCE ORACLE on refused material', async () => {
    const { service } = await scenario({ strictLinkStat: true });
    const onExisting = await capture(() => service.isSymlink(AUDIO));
    const onAbsent = await capture(() =>
      service.isSymlink(`${SECRET}/never-recorded.wav`)
    );
    record('P34 isSymlink(A audio, EXISTS)', onExisting.threw ? onExisting.shape : onExisting.value);
    record('P34 isSymlink(A folder, ABSENT file)', onAbsent.threw ? onAbsent.shape : onAbsent.value);
  });

  it('P35 resolveSymlink is an EXISTENCE ORACLE on refused material', async () => {
    const { service } = await scenario({ strictLinkStat: true });
    const onExisting = await capture(() => service.resolveSymlink(AUDIO));
    const onAbsent = await capture(() =>
      service.resolveSymlink(`${SECRET}/never-recorded.wav`)
    );
    record('P35 resolveSymlink(EXISTS)', onExisting.threw ? onExisting.shape : onExisting.value);
    record('P35 resolveSymlink(ABSENT)', onAbsent.threw ? onAbsent.shape : onAbsent.value);
  });

  it('P36 stat is an EXISTENCE + SIZE + MTIME oracle (F2 re-confirm, realistic)', async () => {
    const { service } = await scenario();
    const hit = await capture(() => service.stat(AUDIO));
    const missing = await capture(() =>
      service.stat(`${SECRET}/never-recorded.wav`)
    );
    record('P36 stat(EXISTS)', hit.threw ? hit.shape : hit.value);
    record('P36 stat(ABSENT)', missing.threw ? missing.shape : missing.value);
  });

  it('P37 initialize() re-rooted at a meeting folder (harness now really re-roots)', async () => {
    const fs = makeBackend();
    fs.seed(`${SECRET}/meeting.json`, stampJson(ADVISOR_A, 'owner-private'), '2026-07-02T15:00:00Z');
    fs.seed(AUDIO, 'RIFF', '2026-07-02T15:00:00Z');
    const svc = new WorkspaceService();
    const r = await capture(() => svc.initialize(fs.backend, SECRET));
    record('P37 initialize(root = A meeting folder)', r.threw ? r.shape : r.value);
    record('P37 getWorkspace()', svc.getWorkspace());

    const fs2 = makeBackend();
    fs2.seed(`${SECRET}/meeting.json`, stampJson(ADVISOR_A, 'owner-private'));
    const svc2 = new WorkspaceService();
    const absent = await capture(() =>
      svc2.initialize(fs2.backend, `${MEETINGS}/never-recorded`)
    );
    record('P37 initialize(NONEXISTENT folder)', absent.threw ? absent.shape : 'no-throw');
    record(
      'P37 initialize existence-oracle message',
      absent.threw ? (absent.err as Error).message : 'n/a'
    );

    // and can the re-rooted service still read A's bytes?
    const read = await capture(() => svc.readFile('audio.wav'));
    record('P37 re-rooted readFile(audio.wav)', read.threw ? read.shape : read.value);
  });
});

// ===========================================================================
describe('R2-C A2.1 nested Meetings — PURE READ, no attacker write needed', () => {
  it('P38 sensitive bytes under a nested permissive inner folder are readable', async () => {
    const fs = makeBackend();
    // OUTER: A owned, owner-private
    fs.seed(`${SECRET}/meeting.json`, stampJson(ADVISOR_A, 'owner-private'));
    fs.seed(AUDIO, 'OUTER-AUDIO');
    // A NESTED meeting folder that carries a BROAD policy. No attacker write:
    // this is just what the tree looks like on disk.
    const INNER = `${SECRET}/Meetings/2026-07-03-followup`;
    fs.seed(`${INNER}/meeting.json`, stampJson(ADVISOR_A, 'firm-visible'));
    fs.seed(`${INNER}/transcript.json`, '{"client":"said the sensitive thing"}');

    const service = new WorkspaceService();
    await service.initialize(fs.backend, ROOT);

    const r = await capture(() => service.readFile(`${INNER}/transcript.json`));
    record('P38 non-owner reads nested-inner transcript', r.threw ? r.shape : r.value);

    const l = await capture(() => service.list(INNER));
    record(
      'P38 non-owner lists nested-inner folder',
      l.threw ? l.shape : (l.value as FileNode[]).map((n) => n.name)
    );

    const lOuter = await capture(() => service.list(`${SECRET}/Meetings`));
    record('P38 list(outer/Meetings) — gated by OUTER?', lOuter.threw ? lOuter.shape : lOuter.value);

    const e = await capture(() => service.exists(`${INNER}/transcript.json`));
    record('P38 exists(nested-inner transcript)', e.threw ? e.shape : e.value);
  });

  it('P39 an OWNER-PRIVATE inner owned by the ATTACKER shields nothing but unlocks the inner subtree', async () => {
    const fs = makeBackend();
    fs.seed(`${SECRET}/meeting.json`, stampJson(ADVISOR_A, 'owner-private'));
    fs.seed(AUDIO, 'OUTER-AUDIO');
    const INNER = `${SECRET}/Meetings/planted`;
    fs.seed(`${INNER}/meeting.json`, stampJson(ADVISOR_B, 'owner-private'));
    fs.seed(`${INNER}/x.txt`, 'reachable');
    const service = new WorkspaceService();
    await service.initialize(fs.backend, ROOT);
    const r = await capture(() => service.readFile(`${INNER}/x.txt`));
    record('P39 read under attacker-owned inner inside A protected outer', r.threw ? r.shape : r.value);
  });
});

// ===========================================================================
describe('R2-D litmus: what the gate reads, and who controls it', () => {
  it('P40 the viewer id is renderer-settable (THE LAW litmus, executable)', async () => {
    const { service } = await scenario();
    const before = await capture(() => service.readFile(AUDIO));
    record('P40 as advisor-b', before.threw ? 'REFUSED' : before.value);
    viewer = ADVISOR_A; // the renderer simply asserts it is A
    const after = await capture(() => service.readFile(AUDIO));
    record('P40 after renderer claims to be advisor-a', after.threw ? 'REFUSED' : after.value);
  });

  it('P41 the stamp is renderer-writable (second litmus input)', async () => {
    const { service, fs } = await scenario();
    await service.writeFile(`${SECRET}/meeting.json`, stampJson(ADVISOR_B, 'firm-visible'));
    record('P41 stamp after non-owner write', fs.raw(`${SECRET}/meeting.json`));
    const r = await capture(() => service.readFile(AUDIO));
    record('P41 readFile after non-owner re-stamp', r.threw ? 'REFUSED' : r.value);
  });
});
