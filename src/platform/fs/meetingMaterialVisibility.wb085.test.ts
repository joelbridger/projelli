/**
 * CONTAINMENT (WB-085) — executable proof for the file-backed meeting gate.
 *
 * These tests drive a REAL `WorkspaceService` over a real in-memory `FSBackend`
 * — not a stub of the gate — so every assertion goes through the same
 * `readFile` / `readFileBinary` / `exists` / `list` code path production uses.
 * The arrange phase writes bytes straight into the backend map (below the
 * service), so the ACT is always the genuine guarded read.
 *
 * Every guard here has a negative control recorded in the lane report: neuter
 * the guard, the paired test goes RED, restore.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { WorkspaceService } from './WorkspaceService';
import type { FSBackend, FileStat } from './types';
import type { FileNode } from '@/platform/types/workspace';
import { setMeetingMaterialViewerResolver } from './meetingMaterialViewer';
import {
  classifyMeetingMaterialForViewer,
  meetingFolderForPath,
  applyMeetingStamp,
  parseMeetingStamp,
  OWNER_PRIVATE_VISIBILITY_POLICY,
  RECOGNIZED_BROAD_VISIBILITY_POLICIES,
} from './meetingMaterialVisibility';

const ROOT = '/ws';
const ADVISOR_A = 'advisor-a';
const ADVISOR_B = 'advisor-b';
const MATTER = `${ROOT}/Clients/Hendricks`;
const MEETING_A = `${MATTER}/Meetings/2026-07-02-annual-review`;
const MEETING_B = `${MATTER}/Meetings/2026-07-09-b-owned`;

const encoder = new TextEncoder();

function makeBackend() {
  const files = new Map<string, ArrayBuffer>();
  const dirs = new Set<string>([ROOT]);

  const ensureParents = (path: string) => {
    let parent = path.slice(0, path.lastIndexOf('/'));
    while (parent && parent.startsWith(ROOT)) {
      dirs.add(parent);
      if (parent === ROOT) break;
      parent = parent.slice(0, parent.lastIndexOf('/'));
    }
  };

  /**
   * The service hands the backend paths RELATIVE to the workspace root (see
   * `WorkspaceService.toBackendPath`), and '' for the root itself. The map is
   * keyed absolutely, so resolve here — exactly as a real backend does.
   */
  const resolve = (path: string): string =>
    path === '' || path === '.'
      ? ROOT
      : path.startsWith('/')
        ? path
        : `${ROOT}/${path}`;

  const backend: FSBackend = {
    read(rawPath) {
      const path = resolve(rawPath);
      const bytes = files.get(path);
      if (!bytes) return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(new TextDecoder().decode(bytes));
    },
    readBinary(rawPath) {
      const path = resolve(rawPath);
      const bytes = files.get(path);
      if (!bytes) return Promise.reject(new Error(`ENOENT: ${path}`));
      return Promise.resolve(bytes.slice(0));
    },
    write(rawPath, content) {
      const path = resolve(rawPath);
      files.set(path, encoder.encode(content).buffer as ArrayBuffer);
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
      files.delete(path);
      dirs.delete(path);
      return Promise.resolve();
    },
    move: () => Promise.resolve(),
    copy: () => Promise.resolve(),
    rename: () => Promise.resolve(),
    mkdir(rawPath) {
      const path = resolve(rawPath);
      dirs.add(path);
      ensureParents(path);
      return Promise.resolve();
    },
    list(rawPath) {
      const path = resolve(rawPath);
      if (!dirs.has(path)) return Promise.reject(new Error(`ENOENT: ${path}`));
      const prefix = `${path}/`;
      const seen = new Map<string, FileNode>();
      for (const filePath of files.keys()) {
        if (!filePath.startsWith(prefix)) continue;
        const rest = filePath.slice(prefix.length);
        const slash = rest.indexOf('/');
        const name = slash === -1 ? rest : rest.slice(0, slash);
        const full = `${path}/${name}`;
        seen.set(name, {
          name,
          path: full,
          type: slash === -1 ? 'file' : 'folder',
        } as FileNode);
      }
      for (const dir of dirs) {
        if (!dir.startsWith(prefix)) continue;
        const rest = dir.slice(prefix.length);
        if (rest.includes('/')) continue;
        seen.set(rest, {
          name: rest,
          path: dir,
          type: 'folder',
        } as FileNode);
      }
      return Promise.resolve([...seen.values()]);
    },
    stat(rawPath): Promise<FileStat> {
      const path = resolve(rawPath);
      return Promise.resolve({
        type: dirs.has(path) ? 'folder' : 'file',
        size: files.get(path)?.byteLength ?? 0,
      } as FileStat);
    },
    isSymlink: () => Promise.resolve(false),
    resolveSymlink: (path: string) => Promise.resolve(path),
    getRootPath() {
      return ROOT;
    },
    setRootPath: () => Promise.resolve(),
  };

  return {
    backend,
    /** ARRANGE-only: put bytes on "disk" beneath the service. */
    seed(path: string, content: string) {
      files.set(path, encoder.encode(content).buffer as ArrayBuffer);
      ensureParents(path);
    },
    seedBinary(path: string, content: ArrayBuffer) {
      files.set(path, content);
      ensureParents(path);
    },
    has: (path: string) => files.has(path),
    raw: (path: string) =>
      files.has(path)
        ? new TextDecoder().decode(files.get(path) as ArrayBuffer)
        : null,
  };
}

async function makeService() {
  const fs = makeBackend();
  const service = new WorkspaceService();
  await service.initialize(fs.backend, ROOT);
  return { service, fs };
}

function stampJson(ownerRef: string, visibilityPolicyId: string | null) {
  return JSON.stringify({
    matterId: 'hendricks',
    startedAt: '2026-07-02T15:00:00Z',
    consent: { mode: 'one-party', confirmedBy: 'a', confirmedAt: 'x' },
    ...(ownerRef ? { ownerRef } : {}),
    ...(visibilityPolicyId ? { visibilityPolicyId } : {}),
  });
}

/** The error a genuinely absent file produces at this boundary. */
async function absentReadError(service: WorkspaceService) {
  try {
    await service.readFile(`${MATTER}/Meetings/does-not-exist/meeting.json`);
    throw new Error('expected a refusal');
  } catch (err) {
    return err as Error & { path?: string; operation?: string };
  }
}

let viewer: string | null = null;

beforeEach(() => {
  viewer = null;
  setMeetingMaterialViewerResolver(() => viewer);
});
afterEach(() => {
  setMeetingMaterialViewerResolver(null);
});

describe('WB-085 file-backed meeting material — owner-private read gate', () => {
  it('lets the OWNER read their own owner-private meeting material', async () => {
    const { service, fs } = await makeService();
    fs.seed(
      `${MEETING_A}/meeting.json`,
      stampJson(ADVISOR_A, OWNER_PRIVATE_VISIBILITY_POLICY)
    );
    fs.seed(`${MEETING_A}/transcript.json`, '{"segments":[]}');
    viewer = ADVISOR_A;

    await expect(
      service.readFile(`${MEETING_A}/transcript.json`)
    ).resolves.toBe('{"segments":[]}');
  });

  it('REFUSES a non-owner reading owner-private meeting material', async () => {
    const { service, fs } = await makeService();
    fs.seed(
      `${MEETING_A}/meeting.json`,
      stampJson(ADVISOR_A, OWNER_PRIVATE_VISIBILITY_POLICY)
    );
    fs.seed(`${MEETING_A}/transcript.json`, 'SECRET TRANSCRIPT BODY');
    viewer = ADVISOR_B;

    await expect(
      service.readFile(`${MEETING_A}/transcript.json`)
    ).rejects.toThrow();
  });

  it('leaks nothing through the transcript, notes or audio paths', async () => {
    const { service, fs } = await makeService();
    fs.seed(
      `${MEETING_A}/meeting.json`,
      stampJson(ADVISOR_A, OWNER_PRIVATE_VISIBILITY_POLICY)
    );
    fs.seed(`${MEETING_A}/transcript.json`, 'SECRET TRANSCRIPT');
    fs.seedBinary(
      `${MEETING_A}/notes.docx`,
      encoder.encode('SECRET NOTES').buffer as ArrayBuffer
    );
    fs.seedBinary(
      `${MEETING_A}/audio.wav`,
      encoder.encode('SECRET AUDIO').buffer as ArrayBuffer
    );
    fs.seed(`${MEETING_A}/Client Notes.md`, 'SECRET MARKDOWN');
    viewer = ADVISOR_B;

    // Every artifact in the folder is gated by the FOLDER's stamp, so a
    // non-owner cannot pick a sibling file to dodge the meeting.json check.
    await expect(
      service.readFile(`${MEETING_A}/transcript.json`)
    ).rejects.toThrow();
    await expect(
      service.readFile(`${MEETING_A}/Client Notes.md`)
    ).rejects.toThrow();
    await expect(
      service.readFileBinary(`${MEETING_A}/notes.docx`)
    ).rejects.toThrow();
    await expect(
      service.readFileBinary(`${MEETING_A}/audio.wav`)
    ).rejects.toThrow();
    // ...including the stamp file itself.
    await expect(
      service.readFile(`${MEETING_A}/meeting.json`)
    ).rejects.toThrow();
  });

  it('closes the EXISTENCE ORACLE: refusal is byte-identical to "not there"', async () => {
    const { service, fs } = await makeService();
    fs.seed(
      `${MEETING_A}/meeting.json`,
      stampJson(ADVISOR_A, OWNER_PRIVATE_VISIBILITY_POLICY)
    );
    fs.seed(`${MEETING_A}/transcript.json`, 'SECRET');
    viewer = ADVISOR_B;

    const absent = await absentReadError(service);

    let refused: (Error & { path?: string; operation?: string }) | null = null;
    try {
      await service.readFile(`${MEETING_A}/transcript.json`);
    } catch (err) {
      refused = err as Error & { path?: string; operation?: string };
    }
    expect(refused).not.toBeNull();

    // Same class, same operation, and the message differs ONLY by the path the
    // caller itself supplied — nothing in the response distinguishes "owned by
    // someone else" from "does not exist".
    expect(refused?.name).toBe(absent.name);
    expect(refused?.operation).toBe(absent.operation);
    expect(refused?.message).toBe(
      `Failed to read file: ${MEETING_A}/transcript.json`
    );
    expect(absent.message).toBe(
      `Failed to read file: ${MATTER}/Meetings/does-not-exist/meeting.json`
    );
    // The refusal carries no reason and no cause a caller could probe.
    expect((refused as unknown as { cause?: unknown }).cause).toBeUndefined();
    expect(refused?.message).not.toMatch(
      /owner|private|refus|denied|permission/i
    );
  });

  it('reports exists() as FALSE for material the viewer may not read', async () => {
    const { service, fs } = await makeService();
    fs.seed(
      `${MEETING_A}/meeting.json`,
      stampJson(ADVISOR_A, OWNER_PRIVATE_VISIBILITY_POLICY)
    );
    fs.seed(`${MEETING_A}/notes.docx`, 'SECRET');
    viewer = ADVISOR_B;

    // Identical to a path that genuinely is not there.
    await expect(service.exists(`${MEETING_A}/notes.docx`)).resolves.toBe(
      false
    );
    await expect(service.exists(MEETING_A)).resolves.toBe(false);
    await expect(
      service.exists(`${MATTER}/Meetings/does-not-exist/notes.docx`)
    ).resolves.toBe(false);

    viewer = ADVISOR_A;
    await expect(service.exists(`${MEETING_A}/notes.docx`)).resolves.toBe(true);
  });

  it('omits refused meetings from a listing of the Meetings folder', async () => {
    const { service, fs } = await makeService();
    fs.seed(
      `${MEETING_A}/meeting.json`,
      stampJson(ADVISOR_A, OWNER_PRIVATE_VISIBILITY_POLICY)
    );
    fs.seed(
      `${MEETING_B}/meeting.json`,
      stampJson(ADVISOR_B, OWNER_PRIVATE_VISIBILITY_POLICY)
    );
    viewer = ADVISOR_B;

    const listed = await service.list(`${MATTER}/Meetings`);
    const names = listed.map((entry) => entry.name);
    expect(names).toContain('2026-07-09-b-owned');
    // A's owner-private meeting is not merely unreadable — it is not listed,
    // so the folder name and its date cannot be harvested either.
    expect(names).not.toContain('2026-07-02-annual-review');
  });

  it('refuses to list INSIDE a meeting folder the viewer may not read', async () => {
    const { service, fs } = await makeService();
    fs.seed(
      `${MEETING_A}/meeting.json`,
      stampJson(ADVISOR_A, OWNER_PRIVATE_VISIBILITY_POLICY)
    );
    fs.seed(`${MEETING_A}/notes.docx`, 'SECRET');
    viewer = ADVISOR_B;

    // Otherwise the artifact set (has audio / has notes / has transcript) leaks
    // even though every individual read refuses.
    await expect(service.list(MEETING_A)).rejects.toThrow(
      `Failed to list directory: ${MEETING_A}`
    );
  });
});

describe('WB-085 file-backed meeting material — fail-closed table', () => {
  it('REFUSES unstamped legacy material for EVERYONE (migration decision)', async () => {
    const { service, fs } = await makeService();
    fs.seed(
      `${MEETING_A}/meeting.json`,
      JSON.stringify({ matterId: 'hendricks', startedAt: 'x' })
    );
    fs.seed(`${MEETING_A}/transcript.json`, 'LEGACY BODY');

    for (const who of [ADVISOR_A, ADVISOR_B, null]) {
      viewer = who;
      await expect(
        service.readFile(`${MEETING_A}/transcript.json`)
      ).rejects.toThrow();
    }
  });

  it('REFUSES every stamped meeting when the viewer is unresolved', async () => {
    const { service, fs } = await makeService();
    // Deliberately a BROAD policy: an unresolved viewer must not fall through
    // to "allowed" even for material nobody marked private.
    fs.seed(`${MEETING_A}/meeting.json`, stampJson(ADVISOR_A, 'firm-visible'));
    fs.seed(`${MEETING_A}/transcript.json`, 'BODY');
    viewer = null;

    await expect(
      service.readFile(`${MEETING_A}/transcript.json`)
    ).rejects.toThrow();

    viewer = ADVISOR_B;
    await expect(
      service.readFile(`${MEETING_A}/transcript.json`)
    ).resolves.toBe('BODY');
  });

  it('REFUSES a policy outside the recognized vocabulary', async () => {
    const { service, fs } = await makeService();
    fs.seed(`${MEETING_A}/meeting.json`, stampJson(ADVISOR_A, 'legacy-open'));
    fs.seed(`${MEETING_A}/transcript.json`, 'BODY');
    viewer = ADVISOR_A;

    await expect(
      service.readFile(`${MEETING_A}/transcript.json`)
    ).rejects.toThrow();
  });

  it('REFUSES when the owner is stamped but the policy is missing', async () => {
    const { service, fs } = await makeService();
    fs.seed(`${MEETING_A}/meeting.json`, stampJson(ADVISOR_A, null));
    fs.seed(`${MEETING_A}/transcript.json`, 'BODY');
    viewer = ADVISOR_A;

    await expect(
      service.readFile(`${MEETING_A}/transcript.json`)
    ).rejects.toThrow();
  });

  it('REFUSES when meeting.json is corrupt, truncated or not an object', async () => {
    for (const corrupt of ['{ not json', '[]', 'null', '"a string"', '']) {
      const { service, fs } = await makeService();
      fs.seed(`${MEETING_A}/meeting.json`, corrupt);
      fs.seed(`${MEETING_A}/transcript.json`, 'BODY');
      viewer = ADVISOR_A;
      await expect(
        service.readFile(`${MEETING_A}/transcript.json`)
      ).rejects.toThrow();
    }
  });

  it('REFUSES when the stamp file is absent entirely', async () => {
    const { service, fs } = await makeService();
    // Artifacts present, no meeting.json at all.
    fs.seed(`${MEETING_A}/transcript.json`, 'BODY');
    viewer = ADVISOR_A;
    await expect(
      service.readFile(`${MEETING_A}/transcript.json`)
    ).rejects.toThrow();
  });

  it('cannot be dodged by separator or case variation on the Meetings segment', () => {
    // The path resolver must recognise the meeting folder regardless of how the
    // caller spells the segment, or the guard is trivially bypassable.
    expect(meetingFolderForPath(`${MEETING_A}/transcript.json`)).toBe(
      MEETING_A
    );
    expect(meetingFolderForPath(`${MATTER}/meetings/x/notes.docx`)).toBe(
      `${MATTER}/meetings/x`
    );
    expect(
      meetingFolderForPath('C:\\ws\\Clients\\H\\Meetings\\m1\\notes.docx')
    ).toBe('C:\\ws\\Clients\\H\\Meetings\\m1');
    // Deeply nested artifacts stay bound to their meeting folder.
    expect(meetingFolderForPath(`${MEETING_A}/sub/dir/leak.txt`)).toBe(
      MEETING_A
    );
    // A file sitting directly in Meetings/ is matter-level, not per-meeting.
    expect(
      meetingFolderForPath(`${MATTER}/Meetings/.consent-ledger.json`)
    ).toBeNull();
    // Nothing outside a Meetings tree is touched by this gate.
    expect(meetingFolderForPath(`${MATTER}/Documents/plan.docx`)).toBeNull();
  });
});

describe('WB-085 file-backed meeting material — stamping', () => {
  it('never lets a later writer re-own an earlier advisor material', () => {
    const existing = {
      matterId: 'm',
      ownerRef: ADVISOR_A,
      visibilityPolicyId: OWNER_PRIVATE_VISIBILITY_POLICY,
    };
    // A merge-write by a DIFFERENT seat must not change the owner: this is the
    // exact move that would silently transfer ownership of another advisor's
    // meeting in a shared folder.
    const after = applyMeetingStamp(existing, { ownerRef: ADVISOR_B });
    expect(after.ownerRef).toBe(ADVISOR_A);
    expect(after.visibilityPolicyId).toBe(OWNER_PRIVATE_VISIBILITY_POLICY);
  });

  it('stamps unstamped metadata owner-private by default', () => {
    const after = applyMeetingStamp({ matterId: 'm' }, { ownerRef: ADVISOR_A });
    expect(after.ownerRef).toBe(ADVISOR_A);
    expect(after.visibilityPolicyId).toBe(OWNER_PRIVATE_VISIBILITY_POLICY);
  });

  it('adopts an UNSTAMPED folder for this seat, but never a stamped one', async () => {
    const { service, fs } = await makeService();
    // Rust's finalize_session shape: no stamp.
    fs.seed(
      `${MEETING_A}/meeting.json`,
      JSON.stringify({ matterId: 'hendricks', startedAt: 'T', consent: {} })
    );
    viewer = ADVISOR_A;

    const adopted = await service.adoptUnstampedMeetingFolder(MEETING_A, {
      ownerRef: ADVISOR_A,
    });
    expect(adopted?.['ownerRef']).toBe(ADVISOR_A);
    expect(adopted?.['visibilityPolicyId']).toBe(
      OWNER_PRIVATE_VISIBILITY_POLICY
    );
    // Rust's authoritative fields survive the stamp.
    expect(adopted?.['matterId']).toBe('hendricks');
    expect(adopted?.['startedAt']).toBe('T');

    // Now B tries the same trick on a folder already owned by A.
    viewer = ADVISOR_B;
    const stolen = await service.adoptUnstampedMeetingFolder(MEETING_A, {
      ownerRef: ADVISOR_B,
    });
    expect(stolen).toBeNull();
    // ...and the stamp on disk is untouched.
    expect(
      parseMeetingStamp(fs.raw(`${MEETING_A}/meeting.json`) as string)?.ownerRef
    ).toBe(ADVISOR_A);
  });
});

describe('WB-085 vocabulary is pinned (drift from the pool classifier fails here)', () => {
  it('names exactly the policies the pool-side classifier names', () => {
    expect(OWNER_PRIVATE_VISIBILITY_POLICY).toBe('owner-private');
    expect([...RECOGNIZED_BROAD_VISIBILITY_POLICIES].sort()).toEqual([
      'firm-visible',
      'household-team',
    ]);
  });

  it('is TOTAL: every input maps to allowed or a NAMED refusal', () => {
    const cases: Array<[unknown, string | null, string]> = [
      [null, ADVISOR_A, 'unstamped'],
      [undefined, ADVISOR_A, 'unstamped'],
      [{}, ADVISOR_A, 'unstamped'],
      [{ ownerRef: '   ', visibilityPolicyId: '  ' }, ADVISOR_A, 'unstamped'],
      [
        { ownerRef: ADVISOR_A, visibilityPolicyId: 'owner-private' },
        null,
        'viewer-unresolved',
      ],
      [
        { ownerRef: ADVISOR_A, visibilityPolicyId: 'firm-visible' },
        '  ',
        'viewer-unresolved',
      ],
      [{ ownerRef: ADVISOR_A }, ADVISOR_A, 'missing-policy'],
      [
        { ownerRef: ADVISOR_A, visibilityPolicyId: 42 },
        ADVISOR_A,
        'missing-policy',
      ],
      [
        { ownerRef: ADVISOR_A, visibilityPolicyId: 'nope' },
        ADVISOR_A,
        'unknown-policy',
      ],
      [
        { ownerRef: ADVISOR_A, visibilityPolicyId: 'owner-private' },
        ADVISOR_B,
        'owner-private-not-owner',
      ],
      [
        { visibilityPolicyId: 'owner-private' },
        ADVISOR_B,
        'owner-private-not-owner',
      ],
    ];
    for (const [stamp, who, reason] of cases) {
      const result = classifyMeetingMaterialForViewer(stamp as never, who);
      expect(result.kind).toBe('refused');
      expect(result.kind === 'refused' && result.reason).toBe(reason);
    }

    for (const policy of ['owner-private', 'firm-visible', 'household-team']) {
      expect(
        classifyMeetingMaterialForViewer(
          { ownerRef: ADVISOR_A, visibilityPolicyId: policy },
          ADVISOR_A
        ).kind
      ).toBe('allowed');
    }
  });
});
