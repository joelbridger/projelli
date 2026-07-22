import { act, renderHook, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const boundary = vi.hoisted(() => ({
  viewerId: 'member-1' as string | null,
  records: [] as LiveCrmRecord[],
  commands: [] as string[],
  published: [] as LiveCrmRecord[],
  invoke:
    vi.fn<
      (command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>
    >(),
}));

vi.mock('@/platform/firm/firmStore', () => {
  const useFirmStore = Object.assign(
    <T,>(selector: (state: { session: { userId: string } | null }) => T) =>
      selector({
        session: boundary.viewerId ? { userId: boundary.viewerId } : null,
      }),
    {
      getState: () => ({
        session: boundary.viewerId ? { userId: boundary.viewerId } : null,
      }),
    }
  );
  return { useFirmStore };
});

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({
    kind: 'matter',
    sourceKind: 'matter',
    matter: { id: 'matter-1' },
    client: { provider: 'wealthbox', householdId: 'household-1', displayName: 'Household 1' },
  }),
  readSelectionOperationDecision: () => ({
    kind: 'matter',
    sourceKind: 'matter',
    matter: { id: 'matter-1' },
    client: { provider: 'wealthbox', householdId: 'household-1', displayName: 'Household 1' },
  }),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) =>
    boundary.invoke(command, args),
}));
vi.mock('@/platform/utils/wealthbox-commands', () => ({
  crmSetWorkspace: () => Promise.resolve(),
}));
vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: <T,>(selector: (state: { rootPath: string }) => T) =>
    selector({ rootPath: '/workspace' }),
}));
vi.mock('@/platform/matter/matterStore', () => {
  // A real session has an active client (matter). The foundation stores are
  // fail-closed on the active matter, so the round-trip runs under matter-1.
  // getState is the LIVE source the store resolver reads at every operation.
  const state: {
    matters: { id: string; shared?: boolean; firmMatterId?: string }[];
    activeMatterId: string | null;
  } = { matters: [{ id: 'matter-1' }], activeMatterId: 'matter-1' };
  const useMatterStore = Object.assign(
    <T,>(selector: (s: typeof state) => T): T => selector(state),
    { getState: () => state }
  );
  return { useMatterStore };
});
vi.mock('@/platform/crm/store', () => ({
  getCrmEngineFreshness: () => ({ kind: 'idle' }),
  subscribeCrmEngineFreshness: () => () => undefined,
}));
vi.mock('@/platform/crm/liveRecordRelay', () => ({
  clearLiveRecordRelay: vi.fn(),
  ensureLiveRecordRelay: vi.fn(() => Promise.resolve(null)),
  removeLiveRecordRelayWriter: vi.fn(),
  publishLiveRecord: (record: LiveCrmRecord) => {
    boundary.published.push(structuredClone(record));
  },
}));

import { LIVE_CRM_RECORDS_CHANGED } from '@/platform/crm/useLiveCrmRecords';
import {
  MEETING_VISIBILITY_MIGRATION_FIELD,
  MEETING_VISIBILITY_MIGRATION_VERSION,
} from '@/platform/crm/meetingVisibilityMigration';
import {
  useMeetingArtifactStore,
  useMeetingFoundationPreferencesStore,
  useMeetingFoundationStore,
  useMeetingIntelligenceSettingsStore,
  useMeetingKeywordCatalogueStore,
  useMeetingTemplateStore,
  useMeetingTypeStore,
  type SealedMeetingClientBoundary,
} from './contract';

const draft = {
  workspaceId: 'workspace-1',
  householdRef: 'household-1',
  matterId: 'matter-1',
  typeId: 'review',
  ownerRef: 'member-1',
  scheduledStartUtc: '2026-07-20T09:00:00.000Z',
  scheduledEndUtc: '2026-07-20T10:00:00.000Z',
  timezone: 'America/Chicago',
  references: ['existing'],
};

describe('meetings canonical live-record round trip', () => {
  beforeEach(() => {
    boundary.viewerId = 'member-1';
    boundary.records = [];
    boundary.commands = [];
    boundary.published = [];
    boundary.invoke.mockReset();
    boundary.invoke.mockImplementation((command, args) => {
      boundary.commands.push(command);
      if (command === 'crm_live_list')
        return Promise.resolve(structuredClone(boundary.records));
      if (command === 'crm_live_upsert' && args?.record) {
        const echo = structuredClone(args.record);
        const canonical = { ...echo, canonicalReloadMarker: true };
        boundary.records = boundary.records.some(
          (item) => item.id === canonical.id
        )
          ? boundary.records.map((item) =>
              item.id === canonical.id ? canonical : item
            )
          : [...boundary.records, canonical];
        return Promise.resolve(echo);
      }
      return Promise.reject(new Error(`Unexpected command ${command}`));
    });
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('survives save, independent fresh mounts, and peer relay refresh without losing fields', async () => {
    const writer = renderHook(() => useMeetingFoundationStore());
    const created = await writer.result.current.createDraft(draft);
    boundary.records = boundary.records.map((record) =>
      record.id === created.id
        ? { ...record, futureField: { survives: true } }
        : record
    );
    await writer.result.current.update(created.id, { references: ['added'] });
    writer.unmount();

    const freshMeeting = renderHook(() => useMeetingFoundationStore());
    await waitFor(async () => {
      await expect(
        freshMeeting.result.current.get(created.id)
      ).resolves.toMatchObject({
        references: ['existing', 'added'],
      });
    });
    expect(
      boundary.records.find((record) => record.id === created.id)
    ).toMatchObject({
      futureField: { survives: true },
      canonicalReloadMarker: true,
    });

    const artifactWriter = renderHook(() => useMeetingArtifactStore());
    const artifact = await artifactWriter.result.current.append({
      meetingId: created.id,
      kind: 'structured-notes',
      schemaVersion: 2,
      producedAt: '2026-07-20T10:00:00.000Z',
      sourceRefs: ['document-1'],
      provenance: 'local-entry',
      payload: { summary: 'Fresh record proof' },
    });
    await artifactWriter.result.current.approve(artifact.id, {
      from: 'produced',
      to: 'approved',
      at: '2026-07-20T10:01:00.000Z',
    });
    artifactWriter.unmount();
    const freshArtifact = renderHook(() => useMeetingArtifactStore());
    await waitFor(() => {
      expect(
        freshArtifact.result.current
          .readerFor(
            freshMeeting.result.current,
            { householdRef: 'household-1', matterId: 'matter-1' } as SealedMeetingClientBoundary,
            [{ kind: 'structured-notes', minimumSchemaVersion: 2 }]
          )
          .get(artifact.id)
      ).toMatchObject({
        state: 'approved',
        sourceRefs: ['document-1'],
      });
    });

    const types = renderHook(() => useMeetingTypeStore());
    await types.result.current.save([{ id: 'review', label: 'Review' }]);
    types.unmount();
    const freshTypes = renderHook(() => useMeetingTypeStore());
    await expect(freshTypes.result.current.get()).resolves.toEqual([
      { id: 'review', label: 'Review' },
    ]);

    const templates = renderHook(() => useMeetingTemplateStore());
    await templates.result.current.save([
      { id: 'notes', label: 'Notes', artifactKinds: ['structured-notes'] },
    ]);
    templates.unmount();
    const freshTemplates = renderHook(() => useMeetingTemplateStore());
    await expect(freshTemplates.result.current.get()).resolves.toMatchObject([
      { id: 'notes' },
    ]);

    const keywords = renderHook(() => useMeetingKeywordCatalogueStore());
    await keywords.result.current.save(['  Retirement  ', 'Tax planning']);
    keywords.unmount();
    const freshKeywords = renderHook(() => useMeetingKeywordCatalogueStore());
    await expect(freshKeywords.result.current.get()).resolves.toEqual([
      'Retirement',
      'Tax planning',
    ]);

    const settings = renderHook(() => useMeetingIntelligenceSettingsStore());
    await settings.result.current.save({
      keywordTrackingEnabled: true,
      clientSignalsEnabled: true,
      displayPreference: 'compact',
    });
    settings.unmount();
    const freshSettings = renderHook(() =>
      useMeetingIntelligenceSettingsStore()
    );
    await expect(freshSettings.result.current.get()).resolves.toMatchObject({
      clientSignalsEnabled: true,
      displayPreference: 'compact',
    });

    const preferences = renderHook(() =>
      useMeetingFoundationPreferencesStore()
    );
    await preferences.result.current.save({
      visibilityPolicies: [{ id: 'inherit', mode: 'inherit-household' }],
      owners: [{ id: 'member-1', label: 'Maya' }],
      deferredDescriptors: [
        { id: 'automation', kind: 'automation-rule', label: 'Draft follow-up' },
      ],
    });
    preferences.unmount();
    const freshPreferences = renderHook(() =>
      useMeetingFoundationPreferencesStore()
    );
    await expect(freshPreferences.result.current.get()).resolves.toMatchObject({
      owners: [{ id: 'member-1', label: 'Maya' }],
    });

    boundary.records = boundary.records.map((record) =>
      record.id === created.id ? { ...record, ownerRef: 'peer-member' } : record
    );
    act(() => {
      window.dispatchEvent(new Event(LIVE_CRM_RECORDS_CHANGED));
    });
    await waitFor(() => {
      expect(
        freshMeeting.result.current.list.find(
          (meeting) => meeting.id === created.id
        )
      ).toMatchObject({ ownerRef: 'peer-member' });
    });

    expect(boundary.published.some((record) => record.id === created.id)).toBe(
      true
    );
    const firstUpsert = boundary.commands.indexOf('crm_live_upsert');
    expect(boundary.commands.slice(firstUpsert + 1)).toContain('crm_live_list');
  });

  it('never reloads an excluded coworker meeting or its artifact into feature stores', async () => {
    boundary.viewerId = 'excluded-member';
    boundary.records = [
      {
        id: 'meeting-preferences',
        kind: 'meeting_foundation_preferences',
        matterId: 'firm_home',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
        visibilityPolicies: [{
          id: 'private-policy',
          mode: 'explicit-review',
          includedMemberIds: ['member-1'],
          excludedMemberIds: ['excluded-member'],
        }],
        owners: [],
        deferredDescriptors: [],
        [MEETING_VISIBILITY_MIGRATION_FIELD]:
          MEETING_VISIBILITY_MIGRATION_VERSION,
      },
      {
        id: 'private-meeting',
        kind: 'meeting',
        matterId: 'matter-1',
        householdRef: 'household-1',
        workspaceId: 'workspace-1',
        typeId: 'review',
        ownerRef: 'member-1',
        scheduledStartUtc: '2026-07-20T09:00:00.000Z',
        scheduledEndUtc: '2026-07-20T10:00:00.000Z',
        timezone: 'America/Chicago',
        state: 'draft',
        references: [],
        visibilityPolicyId: 'private-policy',
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
      {
        id: 'private-artifact',
        kind: 'meeting_artifact',
        meetingId: 'private-meeting',
        householdRef: 'household-1',
        matterId: 'matter-1',
        artifactKind: 'structured-notes',
        schemaVersion: 2,
        producedAt: '2026-07-20T10:00:00.000Z',
        sourceRefs: [],
        provenance: 'local-entry',
        payload: { secret: true },
        createdAt: '2026-07-01T00:00:00.000Z',
        updatedAt: '2026-07-01T00:00:00.000Z',
      },
    ];

    const meetings = renderHook(() => useMeetingFoundationStore());
    await waitFor(() => {
      expect(boundary.commands.filter((command) => command === 'crm_live_list').length)
        .toBeGreaterThan(0);
    });
    await expect(meetings.result.current.get('private-meeting')).resolves.toBeUndefined();
    expect(meetings.result.current.list).toEqual([]);

    const artifacts = renderHook(() => useMeetingArtifactStore());
    await waitFor(() => {
      expect(
        artifacts.result.current.readerFor(
          meetings.result.current,
          { householdRef: 'household-1', matterId: 'matter-1' } as SealedMeetingClientBoundary,
          [{ kind: 'structured-notes', minimumSchemaVersion: 2 }]
        ).get('private-artifact')
      ).toBeNull();
    });
  });
});
