import { describe, expect, it, vi } from 'vitest';
import type {
  MeetingVisibilityPolicy,
  MeetingVisibilitySubject,
} from '@/platform/meeting-visibility';
import {
  createAccountlessUnrestrictedMeetingFileVisibilityManifest,
  createMeetingFileVisibilityManifest,
  decideMeetingFileVisibility,
  MEETING_FILE_ACCESS_CHECK_TIMEOUT_MESSAGE,
  MEETING_FILE_ACCESS_CHECK_TIMEOUT_MS,
  meetingFileVisibilityContextIdentity,
  migrateLegacyMeetingFileVisibility,
  readCurrentMeetingViewerId,
  requireCurrentMeetingFileAccess,
  resolveMeetingFilePathVisibility,
  type MeetingFileVisibilityManifest,
} from './meetingFileVisibility';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

const { loadMeetingVisibilityPoliciesMock } = vi.hoisted(() => ({
  loadMeetingVisibilityPoliciesMock: vi.fn(),
}));

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  loadMeetingVisibilityPoliciesForFileAccess: loadMeetingVisibilityPoliciesMock,
}));

const policy: MeetingVisibilityPolicy = {
  id: 'policy-one-meeting',
  mode: 'explicit-review',
  includedMemberIds: ['included'],
  excludedMemberIds: ['excluded'],
};

function manifest(): MeetingFileVisibilityManifest {
  return createMeetingFileVisibilityManifest({
    meetingSubjectId: 'meeting-file:exact-1',
    ownerRef: 'owner',
    visibilityPolicyId: policy.id,
    fileNames: ['meeting.json', 'transcript.json', 'notes.docx'],
  });
}

describe('file-backed meeting visibility', () => {
  it('gives the same authority identity to semantically identical policy objects', () => {
    expect(
      meetingFileVisibilityContextIdentity({
        viewerId: 'included',
        policies: [
          {
            id: 'one',
            mode: 'explicit-review',
            includedMemberIds: ['included'],
          },
        ],
      })
    ).toBe(
      meetingFileVisibilityContextIdentity({
        viewerId: 'included',
        policies: [
          {
            includedMemberIds: ['included'],
            mode: 'explicit-review',
            id: 'one',
          },
        ],
      })
    );
  });

  it.each([
    ['owner', true],
    ['included', true],
    ['excluded', false],
    ['other', false],
    [null, false],
  ] as const)('resolves the current viewer %p before exposing a file', (viewerId, visible) => {
    expect(
      decideMeetingFileVisibility({
        manifest: manifest(),
        fileName: 'notes.docx',
        context: { viewerId, policies: [policy] },
      })
    ).toBe(visible);
  });

  it('fails closed for a missing policy, missing file identity, and malformed parent lineage', () => {
    const current = manifest();
    expect(
      decideMeetingFileVisibility({
        manifest: current,
        fileName: 'notes.docx',
        context: { viewerId: 'owner', policies: [] },
      })
    ).toBe(false);
    expect(
      decideMeetingFileVisibility({
        manifest: current,
        fileName: 'unregistered.txt',
        context: { viewerId: 'owner', policies: [policy] },
      })
    ).toBe(false);

    const wrongParent: MeetingFileVisibilityManifest = {
      ...current,
      files: {
        ...current.files,
        'notes.docx': {
          ...(current.files['notes.docx'] as MeetingVisibilitySubject),
          parentRef: { kind: 'meeting-note', id: 'another-meeting' },
        } as MeetingVisibilitySubject,
      },
    };
    expect(
      decideMeetingFileVisibility({
        manifest: wrongParent,
        fileName: 'notes.docx',
        context: { viewerId: 'owner', policies: [policy] },
      })
    ).toBe(false);
  });

  it('uses the exact sibling manifest on both slash forms, never a folder name guess', async () => {
    const current = manifest();
    const raw = JSON.stringify({ meetingFileVisibility: current });
    const workspace = {
      exists: vi.fn(async (path: string) =>
        path.replaceAll('\\', '/').endsWith('/client/Meetings/arbitrary/meeting.json')
      ),
      readFile: vi.fn(async () => raw),
    };

    await expect(
      resolveMeetingFilePathVisibility({
        path: 'C:\\workspace\\client\\Meetings\\arbitrary\\notes.docx',
        workspace,
        context: { viewerId: 'excluded', policies: [policy] },
      })
    ).resolves.toEqual({ kind: 'hidden' });
    await expect(
      resolveMeetingFilePathVisibility({
        path: 'C:/workspace/client/Meetings/arbitrary/transcript.json',
        workspace,
        context: { viewerId: 'included', policies: [policy] },
      })
    ).resolves.toEqual({ kind: 'visible' });
  });

  it('allows only an explicitly classified genuine legacy file', () => {
    const legacy: MeetingFileVisibilityManifest = {
      version: 1,
      meetingSubject: {
        id: 'legacy-meeting',
        kind: 'meeting-note',
        lineage: 'legacy-unrestricted',
      },
      files: {
        'meeting.json': {
          id: 'legacy-meeting-json',
          kind: 'file-reference',
          lineage: 'legacy-unrestricted',
        },
      },
    };
    expect(
      decideMeetingFileVisibility({
        manifest: legacy,
        fileName: 'meeting.json',
        context: { viewerId: null, policies: [] },
      })
    ).toBe(true);
    expect(
      decideMeetingFileVisibility({
        manifest: { ...legacy, files: {} },
        fileName: 'meeting.json',
        context: { viewerId: null, policies: [] },
      })
    ).toBe(false);
  });

  it('keeps accountless solo files usable without assigning a fake person id', () => {
    const solo = createAccountlessUnrestrictedMeetingFileVisibilityManifest({
      meetingSubjectId: 'meeting-file:solo-1',
      fileNames: ['meeting.json', 'notes.docx'],
    });
    expect(solo.meetingSubject).not.toHaveProperty('ownerRef');
    expect(
      decideMeetingFileVisibility({
        manifest: solo,
        fileName: 'notes.docx',
        context: { viewerId: null, policies: [] },
      })
    ).toBe(true);
  });

  it('uses only a signed-in firm member as the current viewer', () => {
    useFirmStore.setState({ session: null });
    expect(readCurrentMeetingViewerId()).toBeNull();
    useFirmStore.setState({
      session: {
        userId: 'firm-member-1',
        email: 'member@example.com',
        role: 'member',
        org: null,
        seatId: null,
        tier: null,
        packs: [],
        seats: 0,
        lastValidatedAt: null,
        activated: false,
      },
    });
    expect(readCurrentMeetingViewerId()).toBe('firm-member-1');
    useFirmStore.setState({ session: null });
  });

  it('fails closed with a stable error when the current policy read never settles', async () => {
    vi.useFakeTimers();
    try {
      useWorkspaceStore.setState({ rootPath: '/client', rootGeneration: 17 });
      useFirmStore.setState({
        session: {
          userId: 'owner',
          email: 'owner@example.com',
          role: 'member',
          org: null,
          seatId: null,
          tier: null,
          packs: [],
          seats: 0,
          lastValidatedAt: null,
          activated: false,
        },
      });
      loadMeetingVisibilityPoliciesMock.mockImplementation(
        () => new Promise<readonly unknown[]>(() => {})
      );
      const meeting = createMeetingFileVisibilityManifest({
        ownerRef: 'owner',
        meetingSubjectId: 'meeting-file:timeout',
        fileNames: ['meeting.json'],
      });
      const workspace = {
        readFile: vi.fn(async () => JSON.stringify({ meetingFileVisibility: meeting })),
        writeFile: vi.fn(),
      };

      const access = requireCurrentMeetingFileAccess({
        path: '/client/Meetings/one/meeting.json',
        workspace,
        workspaceRoot: '/client',
        workspaceGeneration: 17,
      });
      const assertion = expect(access).rejects.toThrow(
        MEETING_FILE_ACCESS_CHECK_TIMEOUT_MESSAGE
      );

      await vi.advanceTimersByTimeAsync(0);
      await vi.advanceTimersByTimeAsync(MEETING_FILE_ACCESS_CHECK_TIMEOUT_MS);
      await assertion;

      expect(loadMeetingVisibilityPoliciesMock).toHaveBeenCalledWith('/client');
      expect(workspace.writeFile).not.toHaveBeenCalled();
    } finally {
      loadMeetingVisibilityPoliciesMock.mockReset();
      useFirmStore.setState({ session: null });
      useWorkspaceStore.setState({ rootPath: null, rootGeneration: 0 });
      vi.useRealTimers();
    }
  });

  it('migrates only exact children, records mismatches, and then keeps missing manifests hidden', async () => {
    const goodDir = '/ws/client/Meetings/good';
    const wrongDir = '/ws/client/Meetings/wrong';
    const files = new Map<string, string>([
      [`${goodDir}/meeting.json`, JSON.stringify({ matterId: 'matter-1' })],
      [`${wrongDir}/meeting.json`, JSON.stringify({ matterId: 'matter-2' })],
    ]);
    const workspace = {
      readFile: vi.fn(async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error('ENOENT');
        return value;
      }),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
      exists: vi.fn(async (path: string) =>
        path === '/ws/client/Meetings' || files.has(path)
      ),
      list: vi.fn(async (path: string) => {
        if (path === '/ws/client/Meetings')
          return [
            { name: 'good', path: goodDir, type: 'folder' as const },
            { name: 'wrong', path: wrongDir, type: 'folder' as const },
          ];
        if (path === goodDir || path === wrongDir)
          return [
            {
              name: 'meeting.json',
              path: `${path}/meeting.json`,
              type: 'file' as const,
            },
          ];
        return [];
      }),
    };

    const result = await migrateLegacyMeetingFileVisibility({
      matterId: 'matter-1',
      matterFolder: '/ws/client',
      workspace,
    });
    expect(result).toMatchObject({ kind: 'completed', migrated: 1 });
    expect(result.ambiguousMeetingDirs).toContain(wrongDir);
    expect(JSON.parse(files.get(`${goodDir}/meeting.json`) as string)).toHaveProperty(
      'meetingFileVisibility'
    );
    expect(JSON.parse(files.get(`${wrongDir}/meeting.json`) as string)).not.toHaveProperty(
      'meetingFileVisibility'
    );

    files.set(`${goodDir}/meeting.json`, JSON.stringify({ matterId: 'matter-1' }));
    await expect(
      resolveMeetingFilePathVisibility({
        path: `${goodDir}/notes.docx`,
        workspace,
        context: { viewerId: null, policies: [] },
      })
    ).resolves.toEqual({ kind: 'hidden' });
  });

  it('does not write the completion receipt after a partial migration crash and safely resumes', async () => {
    const dirs = ['/ws/client/Meetings/one', '/ws/client/Meetings/two'];
    const sentinel = '.lantern/migrations/meeting-file-visibility-v1.json';
    const files = new Map<string, string>(
      dirs.map((dir) => [`${dir}/meeting.json`, JSON.stringify({ matterId: 'matter-1' })])
    );
    let failSecond = true;
    const workspace = {
      readFile: vi.fn(async (path: string) => {
        const value = files.get(path);
        if (value === undefined) throw new Error('ENOENT');
        return value;
      }),
      writeFile: vi.fn(async (path: string, content: string) => {
        if (failSecond && path === `${dirs[1]}/meeting.json`) throw new Error('disk full');
        files.set(path, content);
      }),
      exists: vi.fn(async (path: string) =>
        path === '/ws/client/Meetings' || files.has(path)
      ),
      list: vi.fn(async (path: string) => {
        if (path === '/ws/client/Meetings')
          return dirs.map((dir) => ({
            name: dir.split('/').at(-1) as string,
            path: dir,
            type: 'folder' as const,
          }));
        if (dirs.includes(path))
          return [{ name: 'meeting.json', path: `${path}/meeting.json`, type: 'file' as const }];
        return [];
      }),
    };

    await expect(
      migrateLegacyMeetingFileVisibility({
        matterId: 'matter-1',
        matterFolder: '/ws/client',
        workspace,
      })
    ).rejects.toThrow('disk full');
    expect(files.has(sentinel)).toBe(false);

    failSecond = false;
    await expect(
      migrateLegacyMeetingFileVisibility({
        matterId: 'matter-1',
        matterFolder: '/ws/client',
        workspace,
      })
    ).resolves.toMatchObject({ kind: 'completed', migrated: 1 });
    expect(JSON.parse(files.get(sentinel) as string).completedMatterIds).toContain('matter-1');
  });
});
