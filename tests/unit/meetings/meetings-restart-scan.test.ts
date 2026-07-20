/**
 * P1 repro — recorded meetings vanish from the Meetings tab after an app
 * restart, even though the files are intact on disk (docs/evidence/
 * meetings-verify-20260704/RUN-LOG.md, finding #6).
 *
 * This drives the REAL desktop stack `listClientMeetings` runs through in
 * production — `TauriFSBackend` + `WorkspaceService` + `PathValidator` — against
 * an in-memory Windows-shaped filesystem (case-insensitive, `/` and `\`
 * interchangeable, exactly like real NTFS), so it can catch a path-shape bug
 * a plain `ListableWorkspace` mock (which just keys a JS object by whatever
 * string it's given) would paper over.
 *
 * "Restart" = a BRAND NEW `TauriFSBackend` + `WorkspaceService` + fresh
 * in-memory `PathValidator`, matching what `handleOpenRecentProject`
 * (useWorkspaceLifecycle.ts) actually constructs on every launch — the
 * previous session's instances are gone; only the on-disk files and the
 * persisted `rootPath` string survive.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';

// ── In-memory Windows-shaped filesystem ─────────────────────────────────────
// Keys are case-folded with `\` normalized to `/`, mirroring real NTFS
// (case-insensitive, `/` and `\` are equivalent separators).
function winKey(p: string): string {
  return p.replace(/\\/g, '/').toLowerCase().replace(/\/+$/, '') || '/';
}

class FakeWinFs {
  dirs = new Set<string>();
  files = new Map<string, string>();

  private ensureAncestors(key: string): void {
    const segments = key.split('/');
    for (let i = 1; i <= segments.length; i++) {
      this.dirs.add(segments.slice(0, i).join('/'));
    }
  }

  mkdir(path: string): void {
    this.ensureAncestors(winKey(path));
  }

  writeTextFile(path: string, content: string): void {
    const key = winKey(path);
    const parent = key.split('/').slice(0, -1).join('/');
    this.ensureAncestors(parent);
    this.files.set(key, content);
  }

  readTextFile(path: string): string {
    const key = winKey(path);
    const content = this.files.get(key);
    if (content === undefined) throw new Error(`ENOENT: ${path}`);
    return content;
  }

  exists(path: string): boolean {
    const key = winKey(path);
    return this.dirs.has(key) || this.files.has(key);
  }

  readDir(path: string): { name: string; isDirectory: boolean; isFile: boolean; isSymlink: boolean }[] {
    const key = winKey(path);
    const seen = new Map<string, boolean>(); // name -> isDirectory
    const prefix = `${key}/`;
    for (const d of this.dirs) {
      if (d === key || !d.startsWith(prefix)) continue;
      const rest = d.slice(prefix.length);
      if (rest.includes('/')) continue; // not an immediate child
      seen.set(rest, true);
    }
    for (const f of this.files.keys()) {
      if (!f.startsWith(prefix)) continue;
      const rest = f.slice(prefix.length);
      if (rest.includes('/')) continue;
      if (!seen.has(rest)) seen.set(rest, false);
    }
    // Recover ORIGINAL casing for display purposes isn't needed by the code
    // under test (it only reads `.name`), so lowercase names are fine here —
    // the fixtures below use lowercase-safe names throughout.
    return Array.from(seen.entries()).map(([name, isDirectory]) => ({
      name,
      isDirectory,
      isFile: !isDirectory,
      isSymlink: false,
    }));
  }
}

const fakeFs = new FakeWinFs();

vi.mock('@tauri-apps/plugin-fs', () => ({
  exists: (path: string) => Promise.resolve(fakeFs.exists(path)),
  mkdir: (path: string) => {
    fakeFs.mkdir(path);
    return Promise.resolve();
  },
  readDir: (path: string) => Promise.resolve(fakeFs.readDir(path)),
  readTextFile: (path: string) => Promise.resolve(fakeFs.readTextFile(path)),
  writeTextFile: (path: string, content: string) => {
    fakeFs.writeTextFile(path, content);
    return Promise.resolve();
  },
  stat: (path: string) => {
    const key = winKey(path);
    if (!fakeFs.exists(path)) return Promise.reject(new Error(`ENOENT: ${path}`));
    return Promise.resolve({
      isFile: fakeFs.files.has(key),
      isDirectory: fakeFs.dirs.has(key),
      isSymlink: false,
      size: 0,
      readonly: false,
      fileType: fakeFs.dirs.has(key) ? 'dir' : 'file',
      mtime: null,
      atime: null,
      ctime: null,
    });
  },
  lstat: (path: string) => Promise.reject(new Error(`lstat not modeled: ${path}`)),
}));

import { TauriFSBackend } from '@/platform/fs/TauriFSBackend';
import { createWorkspaceService, type WorkspaceService } from '@/platform/fs/WorkspaceService';
import { listClientMeetings } from '@/features/meetings/ClientMeetingsTab';
import { setMeetingMaterialViewerResolver } from '@/platform/fs/meetingMaterialViewer';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';
import {
  readActiveMeetingClientBoundary,
  type SealedMeetingClientBoundary,
} from '@/features/meetings';

const meetingBoundaryMint = vi.hoisted(() => ({
  selection: null as null | { householdRef: string; matterId: string },
}));

vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/client-context')>();
  return {
    ...actual,
    readSelectionOperationDecision: (
      request: Parameters<typeof actual.readSelectionOperationDecision>[0]
    ) => {
      const selection = meetingBoundaryMint.selection;
      return selection
        ? {
            kind: 'matter' as const,
            sourceKind: 'matter' as const,
            matter: { id: selection.matterId } as Matter,
            client: {
              provider: 'wealthbox' as const,
              householdId: selection.householdRef,
              displayName: selection.householdRef,
            },
          }
        : actual.readSelectionOperationDecision(request);
    },
  };
});

function mintedBoundary(
  householdRef: string,
  matterId: string
): SealedMeetingClientBoundary {
  meetingBoundaryMint.selection = { householdRef, matterId };
  try {
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected live-authority meeting boundary');
    return boundary;
  } finally {
    meetingBoundaryMint.selection = null;
  }
}

async function scanAuthorizedClientMeetings(
  matterFolder: string,
  workspaceService: WorkspaceService,
  opts?: { retryDelayMs?: number }
) {
  const clientBoundary = mintedBoundary('household-test', 'matter-test');
  useMatterStore.setState({
    matters: [
      {
        id: clientBoundary.matterId,
        name: 'Test household',
        client: 'Test household',
        folderPaths: matterFolder ? [matterFolder] : [],
        crmHouseholdKeys: [clientBoundary.householdRef],
        createdAt: '2026-07-01T00:00:00.000Z',
      } as Matter,
    ],
  });
  const result = await listClientMeetings({
    clientBoundary,
    getActiveClientBoundary: () => clientBoundary,
    matterFolder,
    workspaceService,
    ...(opts?.retryDelayMs !== undefined
      ? { retryDelayMs: opts.retryDelayMs }
      : {}),
  });
  return result.kind === 'ready'
    ? {
        meetings: result.meetings.map((entry) => entry.meeting),
        scanFailed: false,
      }
    : { meetings: [], scanFailed: result.kind === 'error' };
}

async function openWorkspace(rootPath: string): Promise<WorkspaceService> {
  const backend = new TauriFSBackend();
  const svc = createWorkspaceService();
  await svc.initialize(backend, rootPath);
  return svc;
}

/**
 * CONTAINMENT (WB-085): file-backed meeting material now carries an owner +
 * visibility policy, and the read gate resolves the viewer before returning
 * anything. These prior-session fixtures are stamped to the advisor doing
 * the scan — ARRANGE-phase truth matching production. The fail-closed
 * refusal path is proved in src/platform/fs/meetingMaterialVisibility.wb085.test.ts.
 */
const FIXTURE_OWNER = 'advisor-restart-scan';

beforeEach(() => {
  setMeetingMaterialViewerResolver(() => FIXTURE_OWNER);
  fakeFs.dirs.clear();
  fakeFs.files.clear();
  (window as unknown as { __TAURI__?: unknown }).__TAURI__ = {};
});

describe('meetings survive a restart (fresh WorkspaceService/backend/PathValidator instances)', () => {
  it('lists a meeting recorded in a PRIOR session after a simulated restart, same rootPath shape', async () => {
    const rootRaw = 'C:\\Northcrest Wealth Partners';
    fakeFs.mkdir(rootRaw);
    // matterFolder as matterStore actually stores it: forward-slash absolute
    // (see canonicalizeFolderPath / deriveNewClientFolderPath).
    const matterFolder = 'C:/Northcrest Wealth Partners/Clients/Caldwell, Jennifer';

    // ── Session 1: record a meeting ──
    const svc1 = await openWorkspace(rootRaw);
    await svc1.writeFile(
      `${matterFolder}/Meetings/2026-07-04-matter_nc_caldwell_jennifer/meeting.json`,
      JSON.stringify({
        matterId: 'matter_nc_caldwell_jennifer',
        startedAt: '2026-07-04T10:47:38.422Z',
        consent: { mode: 'two-party', confirmedBy: 'user', confirmedAt: '2026-07-04T10:47:38.422Z' },
        ownerRef: FIXTURE_OWNER,
        visibilityPolicyId: 'owner-private',
      }),
    );
    const inSession = await scanAuthorizedClientMeetings(matterFolder, svc1);
    expect(inSession.scanFailed).toBe(false);
    expect(inSession.meetings).toHaveLength(1);

    // ── Restart: brand new backend + WorkspaceService + PathValidator, same
    // persisted rootPath string (as `recentWorkspaces[0].path` would supply). ──
    const svc2 = await openWorkspace(rootRaw);
    const afterRestart = await scanAuthorizedClientMeetings(matterFolder, svc2);
    expect(afterRestart.scanFailed).toBe(false);
    expect(afterRestart.meetings).toHaveLength(1);
    expect(afterRestart.meetings[0]?.meta?.matterId).toBe('matter_nc_caldwell_jennifer');
  });

  it('lists TWO meetings from two prior sessions plus one from the current session, after restart', async () => {
    const rootRaw = 'C:\\Northcrest Wealth Partners';
    fakeFs.mkdir(rootRaw);
    const matterFolder = 'C:/Northcrest Wealth Partners/Clients/Caldwell, Jennifer';

    const svcA = await openWorkspace(rootRaw);
    await svcA.writeFile(
      `${matterFolder}/Meetings/2026-06-01-old-one/meeting.json`,
      JSON.stringify({ matterId: 'm1', startedAt: '2026-06-01T00:00:00Z', consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-06-01T00:00:00Z' }, ownerRef: FIXTURE_OWNER, visibilityPolicyId: 'owner-private' }),
    );
    await svcA.writeFile(
      `${matterFolder}/Meetings/2026-06-15-old-two/meeting.json`,
      JSON.stringify({ matterId: 'm1', startedAt: '2026-06-15T00:00:00Z', consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-06-15T00:00:00Z' }, ownerRef: FIXTURE_OWNER, visibilityPolicyId: 'owner-private' }),
    );

    // Restart, record a THIRD meeting this session, then restart again.
    const svcB = await openWorkspace(rootRaw);
    await svcB.writeFile(
      `${matterFolder}/Meetings/2026-07-04-new-one/meeting.json`,
      JSON.stringify({ matterId: 'm1', startedAt: '2026-07-04T00:00:00Z', consent: { mode: 'two-party', confirmedBy: 'user', confirmedAt: '2026-07-04T00:00:00Z' }, ownerRef: FIXTURE_OWNER, visibilityPolicyId: 'owner-private' }),
    );
    const svcC = await openWorkspace(rootRaw);
    const result = await scanAuthorizedClientMeetings(matterFolder, svcC);
    expect(result.scanFailed).toBe(false);
    expect(result.meetings).toHaveLength(3);
  });

  it('tolerates a mixed-separator meetingDir (forward-slash matterFolder + backslash-joined subpath, as Rust may return) across a restart', async () => {
    const rootRaw = 'C:\\Northcrest Wealth Partners';
    fakeFs.mkdir(rootRaw);
    const matterFolder = 'C:/Northcrest Wealth Partners/Clients/Caldwell, Jennifer';
    // Simulate Rust's capture_start/capture_stop returning a meetingDir that
    // mixes the forward-slash matterFolder it was given with backslash-joined
    // path segments of its own construction.
    const meetingDirMixed = `${matterFolder}\\Meetings\\2026-07-04-mixed-sep`;

    const svc1 = await openWorkspace(rootRaw);
    await svc1.writeFile(
      `${meetingDirMixed}/meeting.json`,
      JSON.stringify({ matterId: 'm1', startedAt: '2026-07-04T00:00:00Z', consent: { mode: 'two-party', confirmedBy: 'user', confirmedAt: '2026-07-04T00:00:00Z' }, ownerRef: FIXTURE_OWNER, visibilityPolicyId: 'owner-private' }),
    );

    const svc2 = await openWorkspace(rootRaw);
    const result = await scanAuthorizedClientMeetings(matterFolder, svc2);
    expect(result.scanFailed).toBe(false);
    expect(result.meetings).toHaveLength(1);
  });
});

describe('listClientMeetings — scan-failure vs genuine-empty distinction', () => {
  // codex-review P2 (2026-07-04): a client with no linked folder at all
  // (CRM/email-only, or a pre-QA-5 matter from before every client got a
  // scoped folder) passes matterFolder='' — `${matterFolder}/Meetings`
  // resolves to the workspace-root-relative '/Meetings', which
  // PathValidator correctly rejects as outside the workspace. That rejection
  // must read as the old, honest "no meetings" empty state, never as a
  // scanFailed error — an empty matterFolder is a precondition that isn't
  // met, not a backend hiccup to retry.
  it('reports scanFailed=false for a client with no linked folder (empty matterFolder), never a false scan error', async () => {
    const rootRaw = 'C:\\Northcrest Wealth Partners';
    fakeFs.mkdir(rootRaw);

    const svc = await openWorkspace(rootRaw);
    const result = await scanAuthorizedClientMeetings('', svc);
    expect(result).toEqual({ meetings: [], scanFailed: false });
  });

  it('reports scanFailed=false (fast, no retry) when the Meetings folder genuinely does not exist yet', async () => {
    const rootRaw = 'C:\\Northcrest Wealth Partners';
    fakeFs.mkdir(rootRaw);
    const matterFolder = 'C:/Northcrest Wealth Partners/Clients/Brand New Client';
    fakeFs.mkdir(matterFolder); // the client folder exists; it just has no Meetings/ yet

    const svc = await openWorkspace(rootRaw);
    const result = await scanAuthorizedClientMeetings(matterFolder, svc);
    expect(result).toEqual({ meetings: [], scanFailed: false });
  });

  it('retries a transient list() failure and recovers without reporting scanFailed', async () => {
    const rootRaw = 'C:\\Northcrest Wealth Partners';
    fakeFs.mkdir(rootRaw);
    const matterFolder = 'C:/Northcrest Wealth Partners/Clients/Caldwell, Jennifer';
    const svc = await openWorkspace(rootRaw);
    await svc.writeFile(
      `${matterFolder}/Meetings/2026-07-04-abc/meeting.json`,
      JSON.stringify({ matterId: 'm1', startedAt: '2026-07-04T00:00:00Z', consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T00:00:00Z' }, ownerRef: FIXTURE_OWNER, visibilityPolicyId: 'owner-private' }),
    );

    // Fake a backend hiccup: fail list() on the Meetings folder exactly twice,
    // then let it succeed — a real IPC/permissions blip right after reopening
    // the workspace, not a genuinely missing/unreadable folder.
    const realList = svc.list.bind(svc);
    let calls = 0;
    svc.list = (async (p: string) => {
      if (p.endsWith('/Meetings') && ++calls <= 2) throw new Error('transient IPC hiccup');
      return realList(p);
    }) as typeof svc.list;

    const result = await scanAuthorizedClientMeetings(matterFolder, svc, { retryDelayMs: 1 });
    expect(result.scanFailed).toBe(false);
    expect(result.meetings).toHaveLength(1);
  });

  it('reports scanFailed=true (never a false empty state) when the Meetings folder exists but keeps failing to list', async () => {
    const rootRaw = 'C:\\Northcrest Wealth Partners';
    fakeFs.mkdir(rootRaw);
    const matterFolder = 'C:/Northcrest Wealth Partners/Clients/Caldwell, Jennifer';
    const svc = await openWorkspace(rootRaw);
    await svc.writeFile(
      `${matterFolder}/Meetings/2026-07-04-abc/meeting.json`,
      JSON.stringify({ matterId: 'm1', startedAt: '2026-07-04T00:00:00Z', consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-04T00:00:00Z' }, ownerRef: FIXTURE_OWNER, visibilityPolicyId: 'owner-private' }),
    );
    svc.list = (async () => { throw new Error('permanently broken'); }) as typeof svc.list;

    const result = await scanAuthorizedClientMeetings(matterFolder, svc, { retryDelayMs: 1 });
    expect(result).toEqual({ meetings: [], scanFailed: true });
  });
});
