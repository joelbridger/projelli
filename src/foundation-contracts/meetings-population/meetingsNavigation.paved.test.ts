import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createMeetingStore,
  resolveMeetingNavigation,
  type ClientScopedLivePort,
} from '@/features/meetings';
import {
  readAuthoritativeMatterScope,
  rehydrateSelectionHint,
  replaceCanonicalHouseholdDirectory,
  requestClearClientSelection,
  requestSharedClientSelection,
  useClientContextStore,
  type SealedClientBoundary,
} from '@/platform/client-context';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { setActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { Matter } from '@/platform/types/matter';

const canonical = vi.hoisted(() => ({
  load: vi.fn<
    (
      workspaceRoot: string | null | undefined
    ) => Promise<readonly LiveCrmRecord[]>
  >(),
}));

vi.mock('@/platform/crm/liveRecords', async (importOriginal) => {
  const actual =
    await importOriginal<typeof import('@/platform/crm/liveRecords')>();
  return { ...actual, loadLiveCrmRecords: canonical.load };
});

import { proveMeetingNavigationPavedPath } from './meetingsNavigation.import';

const clientA = {
  provider: 'wealthbox' as const,
  householdId: 'household-a',
  displayName: 'Alpha household',
};

function matter(
  id: string,
  householdId: string,
  patch: Partial<Matter> = {}
): Matter {
  return {
    id,
    name: `${id} name`,
    client: `${id} client`,
    folderPaths: [`/workspace/Clients/${id}`],
    crmHouseholdKeys: [householdId],
    createdAt: '2026-07-18T00:00:00.000Z',
    ...patch,
  };
}

function meeting(overrides: Partial<LiveCrmRecord> = {}): LiveCrmRecord {
  return {
    id: 'meeting-a',
    kind: 'meeting',
    matterId: 'matter-a',
    workspaceId: 'workspace-1',
    householdRef: 'household-a',
    typeId: 'review',
    ownerRef: 'advisor-1',
    scheduledStartUtc: '2026-07-20T09:00:00.000Z',
    scheduledEndUtc: '2026-07-20T10:00:00.000Z',
    timezone: 'America/Chicago',
    state: 'scheduled',
    references: [],
    createdAt: '2026-07-18T00:00:00.000Z',
    updatedAt: '2026-07-18T00:00:00.000Z',
    legacyMeetingLink: {
      meetingDir: 'Clients/Alpha/Meetings/2026-07-20',
      linkedAt: '2026-07-18T00:00:00.000Z',
    },
    ...overrides,
  };
}

function publishAuthority(): void {
  useMatterStore.setState({
    matters: [matter('matter-a', 'household-a')],
    activeMatterId: null,
  });
  replaceCanonicalHouseholdDirectory('wealthbox', [clientA]);
}

function resetToAllMatters(): void {
  rehydrateSelectionHint({
    kind: 'persisted-hint',
    value: { version: 1, source: 'explicit-all-matters' },
  });
}

function activeAuthoritativeMatterId(): string | null {
  const scope = readAuthoritativeMatterScope();
  return scope.kind === 'matter' ? scope.matterId : null;
}

beforeEach(() => {
  localStorage.clear();
  canonical.load.mockReset();
  setDevFlagOverride('selection-authority-boot-gate', false);
  useMatterStore.setState({ matters: [], activeMatterId: null });
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
  setDevFlagOverride('selection-authority-boot-gate', true);
  resetToAllMatters();
  setActiveWorkspaceService({
    getRootPath: () => '/workspace',
  } as unknown as WorkspaceService);
});

afterEach(() => {
  setActiveWorkspaceService(null);
  setDevFlagOverride('selection-authority-boot-gate', false);
  useMatterStore.setState({ matters: [], activeMatterId: null });
  replaceCanonicalHouseholdDirectory('wealthbox', null);
  requestClearClientSelection();
});

describe('firm-wide meeting navigation public doorway', () => {
  it('keeps linked, folder-only, unavailable, and unknown-refuse compile-distinct', async () => {
    publishAuthority();
    canonical.load.mockResolvedValue([meeting()]);

    const linked = await resolveMeetingNavigation('meeting-a');
    expect(linked.kind).toBe('linked');
    if (linked.kind !== 'linked') throw new Error('expected linked authority');
    expect(Object.isFrozen(linked.clientBoundary)).toBe(true);
    expect(() => JSON.stringify(linked.clientBoundary)).toThrow(/runtime-only/);
    expect(useClientContextStore.getState().client).toBeNull();
    expect(readAuthoritativeMatterScope()).toEqual({ kind: 'all-matters' });
    expect(canonical.load).toHaveBeenCalledWith('/workspace');

    canonical.load.mockResolvedValue([
      meeting({ id: 'meeting-folder', legacyMeetingLink: undefined }),
    ]);
    await expect(
      proveMeetingNavigationPavedPath('meeting-folder')
    ).resolves.toEqual({
      navigation: { kind: 'folder-only' },
      selection: null,
    });

    canonical.load.mockResolvedValue([
      meeting({
        id: 'meeting-unavailable',
        legacyMeetingLink: { meetingDir: '../escape', linkedAt: 'bad' },
      }),
    ]);
    await expect(
      proveMeetingNavigationPavedPath('meeting-unavailable')
    ).resolves.toEqual({
      navigation: { kind: 'unavailable' },
      selection: null,
    });

    canonical.load.mockResolvedValue([]);
    await expect(
      proveMeetingNavigationPavedPath('meeting-unknown')
    ).resolves.toEqual({
      navigation: { kind: 'unknown', disposition: 'refuse' },
      selection: null,
    });
  });

  it('re-derives current authority on every call and leaves stale seals unusable', async () => {
    publishAuthority();
    canonical.load.mockResolvedValue([meeting()]);
    const first = await resolveMeetingNavigation('meeting-a');
    if (first.kind !== 'linked') throw new Error('expected linked authority');

    replaceCanonicalHouseholdDirectory('wealthbox', null);

    await expect(
      requestSharedClientSelection(first.clientBoundary)
    ).resolves.toEqual({
      kind: 'refused',
      reason: 'stale-client-boundary',
    });
    await expect(resolveMeetingNavigation('meeting-a')).resolves.toEqual({
      kind: 'unavailable',
    });

    replaceCanonicalHouseholdDirectory('wealthbox', [clientA]);
    expect((await resolveMeetingNavigation('meeting-a')).kind).toBe('linked');

    canonical.load.mockResolvedValue([meeting({ matterId: 'matter-foreign' })]);
    await expect(resolveMeetingNavigation('meeting-a')).resolves.toEqual({
      kind: 'unknown',
      disposition: 'refuse',
    });
  });

  it('maps every known non-selectable classifier arm to unavailable', async () => {
    canonical.load.mockResolvedValue([meeting()]);
    const unavailablePopulations: ReadonlyArray<{
      readonly name: string;
      readonly seed: () => void;
    }> = [
      {
        name: 'provider-unavailable',
        seed: () => {
          useMatterStore.setState({
            matters: [matter('matter-a', 'household-a')],
            activeMatterId: null,
          });
          replaceCanonicalHouseholdDirectory('wealthbox', null);
        },
      },
      {
        name: 'zero-live',
        seed: () => {
          useMatterStore.setState({ matters: [], activeMatterId: null });
          replaceCanonicalHouseholdDirectory('wealthbox', [clientA]);
        },
      },
      {
        name: 'ambiguous-live',
        seed: () => {
          useMatterStore.setState({
            matters: [
              matter('matter-a', 'household-a'),
              matter('matter-b', 'household-a'),
            ],
            activeMatterId: null,
          });
          replaceCanonicalHouseholdDirectory('wealthbox', [clientA]);
        },
      },
      {
        name: 'archived-only',
        seed: () => {
          useMatterStore.setState({
            matters: [matter('matter-a', 'household-a', { archived: true })],
            activeMatterId: null,
          });
          replaceCanonicalHouseholdDirectory('wealthbox', [clientA]);
        },
      },
    ];

    for (const population of unavailablePopulations) {
      population.seed();
      resetToAllMatters();
      await expect(
        resolveMeetingNavigation('meeting-a'),
        population.name
      ).resolves.toEqual({ kind: 'unavailable' });
    }
  });

  it('reports unavailable authority when the current workspace or collection read is unavailable', async () => {
    publishAuthority();
    setActiveWorkspaceService(null);
    await expect(resolveMeetingNavigation('meeting-a')).resolves.toEqual({
      kind: 'unavailable',
    });
    expect(canonical.load).not.toHaveBeenCalled();

    setActiveWorkspaceService({
      getRootPath: () => '/workspace',
    } as unknown as WorkspaceService);
    canonical.load.mockRejectedValue(new Error('encrypted CRM unavailable'));
    await expect(resolveMeetingNavigation('meeting-a')).resolves.toEqual({
      kind: 'unavailable',
    });
  });

  it('refuses forged selection and real client-scoped reads until sanctioned selection succeeds', async () => {
    publishAuthority();
    const canonicalMeeting = meeting();
    canonical.load.mockResolvedValue([canonicalMeeting]);
    const live: ClientScopedLivePort = {
      records: [canonicalMeeting],
      workspaceRoot: '/workspace',
      error: null,
      save: (record) => Promise.resolve(record),
      reloadRecords: () => Promise.resolve([canonicalMeeting]),
      getActiveMatterId: activeAuthoritativeMatterId,
    };
    const store = createMeetingStore(live);

    await expect(store.get('meeting-a')).resolves.toBeUndefined();

    const forged = Object.freeze({}) as SealedClientBoundary;
    await expect(requestSharedClientSelection(forged)).resolves.toEqual({
      kind: 'refused',
      reason: 'unsealed-client-boundary',
    });
    await expect(store.get('meeting-a')).resolves.toBeUndefined();

    const resolved = await resolveMeetingNavigation('meeting-a');
    if (resolved.kind !== 'linked')
      throw new Error('expected linked authority');
    await expect(
      requestSharedClientSelection(resolved.clientBoundary)
    ).resolves.toMatchObject({ kind: 'selected', client: clientA });

    await expect(store.get('meeting-a')).resolves.toMatchObject({
      id: 'meeting-a',
      householdRef: 'household-a',
      matterId: 'matter-a',
    });
  });
});
