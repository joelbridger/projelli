import { act, render, screen, waitFor } from '@testing-library/react';
import { createElement } from 'react';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Matter } from '@/platform/types/matter';

const selection = vi.hoisted(() => ({
  value: null as null | { householdRef: string; matterId: string },
}));

vi.mock('@/platform/client-context', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/client-context')>();
  return {
    ...actual,
    readSelectionOperationDecision: () => {
      const current = selection.value;
      return current
        ? {
            kind: 'matter' as const,
            sourceKind: 'matter' as const,
            matter: { id: current.matterId } as Matter,
            client: {
              provider: 'wealthbox' as const,
              householdId: current.householdRef,
              displayName: current.householdRef,
            },
          }
        : { kind: 'none' as const, reason: 'no-active-matter' as const };
    },
  };
});

import { ClientMeetingsTab, listClientMeetings } from './ClientMeetingsTab';
import { readActiveMeetingClientBoundary } from './foundation/contract';
import {
  createMeetingFileVisibilityManifest,
  FILE_MEETING_OWNER_PRIVATE_POLICY_ID,
} from './meetingFileVisibility';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { MeetingVisibilityPolicy } from '@/platform/meeting-visibility';
import { useFirmStore } from '@/platform/firm/firmStore';

const policy: MeetingVisibilityPolicy = {
  id: 'meeting-policy',
  mode: 'explicit-review',
  includedMemberIds: ['included'],
  excludedMemberIds: ['excluded'],
};
const privatePolicy: MeetingVisibilityPolicy = {
  id: 'meeting-private-policy',
  mode: 'explicit-review',
  includedMemberIds: [],
  excludedMemberIds: ['included', 'excluded'],
};

function meta(
  id: string,
  ownerRef: string,
  visibilityPolicy: MeetingVisibilityPolicy = policy
) {
  return JSON.stringify({
    matterId: 'matter-1',
    startedAt: `2026-07-22T0${id.length}:00:00.000Z`,
    consent: {
      mode: 'one-party',
      confirmedBy: ownerRef,
      confirmedAt: '2026-07-22T00:00:00.000Z',
    },
    meetingFileVisibility: createMeetingFileVisibilityManifest({
      meetingSubjectId: `meeting-file:${id}`,
      ownerRef,
      visibilityPolicyId: visibilityPolicy.id,
      fileNames: ['meeting.json', 'transcript.json', 'notes.docx'],
    }),
  });
}

describe('ClientMeetingsTab file visibility doorway', () => {
  beforeEach(() => {
    useFirmStore.setState({ session: null });
    selection.value = { householdRef: 'household-1', matterId: 'matter-1' };
    useMatterStore.setState({
      matters: [
        {
          id: 'matter-1',
          name: 'Client',
          client: 'Client',
          folderPaths: ['/ws/client'],
          crmHouseholdKeys: ['household-1'],
          createdAt: '2026-07-22T00:00:00.000Z',
        } as Matter,
      ],
    });
  });

  it('returns owner/included meetings and removes excluded meetings before direct or canonical selection', async () => {
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected sealed boundary');
    const files = new Map([
      ['/ws/client/Meetings/owner/meeting.json', meta('owner', 'included')],
      ['/ws/client/Meetings/shared/meeting.json', meta('shared', 'another-owner')],
      ['/ws/client/Meetings/private/meeting.json', meta('private', 'excluded', privatePolicy)],
    ]);
    const workspace = {
      exists: vi.fn(async () => true),
      list: vi.fn(async (path: string) => {
        if (path === '/ws/client/Meetings') {
          return ['owner', 'shared', 'private'].map((name) => ({
            name,
            path: `/ws/client/Meetings/${name}`,
            type: 'folder' as const,
          }));
        }
        return [
          { name: 'meeting.json', path: `${path}/meeting.json`, type: 'file' as const },
          { name: 'transcript.json', path: `${path}/transcript.json`, type: 'file' as const },
          { name: 'notes.docx', path: `${path}/notes.docx`, type: 'file' as const },
        ];
      }),
      readFile: vi.fn(async (path: string) => {
        const value = files.get(path);
        if (!value) throw new Error('missing');
        return value;
      }),
      writeFile: vi.fn(async () => undefined),
    };

    const result = await listClientMeetings({
      clientBoundary: boundary,
      getActiveClientBoundary: () => boundary,
      matterFolder: '/ws/client',
      workspaceService: workspace,
      visibilityContext: { viewerId: 'included', policies: [policy, privatePolicy] },
    });

    expect(result.kind).toBe('ready');
    if (result.kind !== 'ready') return;
    expect(result.meetings.map((entry) => entry.meeting.folderName).sort()).toEqual([
      'owner',
      'shared',
    ]);
    expect(
      result.meetings.some(
        (entry) => entry.target.meetingDir === '/ws/client/Meetings/private'
      )
    ).toBe(false);
  });

  it('re-evaluates the same folder snapshot for a switched viewer', async () => {
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected sealed boundary');
    const meetingJson = meta('private', 'owner', privatePolicy);
    const workspace = {
      exists: vi.fn(async () => true),
      list: vi.fn(async (path: string) =>
        path === '/ws/client/Meetings'
          ? [{ name: 'private', path: '/ws/client/Meetings/private', type: 'folder' as const }]
          : [{ name: 'meeting.json', path: `${path}/meeting.json`, type: 'file' as const }]
      ),
      readFile: vi.fn(async () => meetingJson),
      writeFile: vi.fn(async () => undefined),
    };
    const scan = (viewerId: string) =>
      listClientMeetings({
        clientBoundary: boundary,
        getActiveClientBoundary: () => boundary,
        matterFolder: '/ws/client',
        workspaceService: workspace,
        visibilityContext: { viewerId, policies: [policy, privatePolicy] },
      });

    const owner = await scan('owner');
    const excluded = await scan('excluded');
    expect(owner.kind === 'ready' ? owner.meetings : []).toHaveLength(1);
    expect(excluded.kind === 'ready' ? excluded.meetings : []).toHaveLength(0);
  });

  it('never lets an older authorized scan repopulate the list after the firm viewer changes', async () => {
    const boundary = readActiveMeetingClientBoundary();
    if (!boundary) throw new Error('expected sealed boundary');
    let releaseFirstList: (() => void) | undefined;
    const firstList = new Promise<void>((resolve) => {
      releaseFirstList = resolve;
    });
    let meetingsListCalls = 0;
    const privateMeta = JSON.stringify({
      matterId: 'matter-1',
      startedAt: '2026-07-22T09:00:00.000Z',
      consent: {
        mode: 'one-party',
        confirmedBy: 'owner',
        confirmedAt: '2026-07-22T09:00:00.000Z',
      },
      meetingFileVisibility: createMeetingFileVisibilityManifest({
        meetingSubjectId: 'meeting-file:viewer-race',
        ownerRef: 'owner',
        visibilityPolicyId: FILE_MEETING_OWNER_PRIVATE_POLICY_ID,
        fileNames: ['meeting.json'],
      }),
    });
    const workspace = {
      exists: vi.fn(async () => true),
      list: vi.fn(async (path: string) => {
        if (path === '/ws/client/Meetings') {
          meetingsListCalls += 1;
          if (meetingsListCalls === 1) await firstList;
          return [{
            name: 'private',
            path: '/ws/client/Meetings/private',
            type: 'folder' as const,
          }];
        }
        return [{
          name: 'meeting.json',
          path: `${path}/meeting.json`,
          type: 'file' as const,
        }];
      }),
      readFile: vi.fn(async (path: string) => {
        if (path.endsWith('meeting.json')) return privateMeta;
        throw new Error('ENOENT');
      }),
      writeFile: vi.fn(async () => undefined),
    };
    const session = (userId: string) => ({
      userId,
      email: `${userId}@example.com`,
      role: 'member' as const,
      org: null,
      seatId: null,
      tier: null,
      packs: [],
      seats: 0,
      lastValidatedAt: null,
      activated: false,
    });
    useFirmStore.setState({ session: session('owner') });

    render(
      createElement(ClientMeetingsTab, {
        clientBoundary: boundary,
        getActiveClientBoundary: () => boundary,
        matterFolder: '/ws/client',
        workspaceService: workspace,
      })
    );
    await waitFor(() => expect(meetingsListCalls).toBe(1));

    act(() => {
      useFirmStore.setState({ session: session('excluded') });
      releaseFirstList?.();
    });

    await waitFor(() => expect(meetingsListCalls).toBeGreaterThan(1));
    await waitFor(() =>
      expect(screen.queryByTestId('client-meetings-loading')).toBeNull()
    );
    expect(screen.queryByTestId('meeting-row')).toBeNull();
    expect(screen.queryByTestId('meeting-entry')).toBeNull();
  });
});
