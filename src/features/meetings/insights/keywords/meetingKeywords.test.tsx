import { afterEach, describe, expect, it, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { setDevFlagOverride } from '@/platform/flags';
import {
  approvedMeetingArtifactsForClient,
  createMeetingArtifactStore,
  createMeetingStore,
  type ClientBoundary,
} from '../../foundation/contract';
import { getMeetingInsightComposition } from '../../meetingInsightRegistry';
import {
  detectCitedMeetingKeywordInsights,
  MeetingKeywordSettingsPanel,
  MEETING_KEYWORD_ARTIFACT_REQUIREMENTS,
} from './meetingKeywords';

function livePort() {
  let records: LiveCrmRecord[] = [];
  let activeMatterId: string | null = 'matter-a';
  return {
    getActiveMatterId: () => activeMatterId,
    setActiveMatterId: (next: string | null) => {
      activeMatterId = next;
    },
    records: () => structuredClone(records),
    workspaceRoot: '/workspace',
    error: null,
    save: (record: LiveCrmRecord) => {
      records = records.some((item) => item.id === record.id)
        ? records.map((item) =>
            item.id === record.id ? structuredClone(record) : item
          )
        : [...records, structuredClone(record)];
      return Promise.resolve(structuredClone(record));
    },
    reloadRecords: () => Promise.resolve(structuredClone(records)),
  };
}

const clientA: ClientBoundary = {
  householdRef: 'household-a',
  matterId: 'matter-a',
};

describe('meeting keywords', () => {
  afterEach(() => {
    setDevFlagOverride('meeting-keywords', undefined);
    vi.restoreAllMocks();
  });

  it('detects only approved allowed artifacts, cites their real ids, and fails closed across A → B → none', async () => {
    const live = livePort();
    const meetingStore = createMeetingStore({
      ...live,
      records: live.records(),
    });
    const meeting = await meetingStore.createDraft({
      workspaceId: 'workspace-a',
      householdRef: clientA.householdRef,
      matterId: clientA.matterId,
      typeId: 'review',
      ownerRef: 'advisor-a',
      scheduledStartUtc: '2026-07-17T09:00:00.000Z',
      scheduledEndUtc: '2026-07-17T10:00:00.000Z',
      timezone: 'America/Chicago',
      references: [],
    });
    const artifactStore = createMeetingArtifactStore({
      ...live,
      records: live.records(),
    });
    const approved = await artifactStore.append({
      meetingId: meeting.id,
      kind: 'summary',
      schemaVersion: 1,
      producedAt: '2026-07-17T10:00:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'Retirement planning and retirement income.' },
    });
    await artifactStore.approve(approved.id, {
      from: 'produced',
      to: 'approved',
      at: '2026-07-17T10:01:00.000Z',
    });
    await artifactStore.append({
      meetingId: meeting.id,
      kind: 'summary',
      schemaVersion: 1,
      producedAt: '2026-07-17T10:02:00.000Z',
      sourceRefs: [],
      provenance: 'local-entry',
      payload: { summary: 'Retirement must not appear before approval.' },
    });

    const reader = approvedMeetingArtifactsForClient(
      createMeetingStore({ ...live, records: live.records() }),
      createMeetingArtifactStore({ ...live, records: live.records() }),
      clientA,
      MEETING_KEYWORD_ARTIFACT_REQUIREMENTS
    );
    expect(
      detectCitedMeetingKeywordInsights(
        reader,
        meeting.id,
        clientA.householdRef,
        ['Retirement']
      )
    ).toEqual([
      expect.objectContaining({
        descriptorId: 'meeting_keywords',
        meetingId: meeting.id,
        householdRef: clientA.householdRef,
        sourceArtifactIds: [approved.id],
      }),
    ]);

    live.setActiveMatterId('matter-b');
    expect(
      detectCitedMeetingKeywordInsights(
        reader,
        meeting.id,
        clientA.householdRef,
        ['Retirement']
      )
    ).toEqual([]);
    live.setActiveMatterId(null);
    expect(
      detectCitedMeetingKeywordInsights(
        reader,
        meeting.id,
        clientA.householdRef,
        ['Retirement']
      )
    ).toEqual([]);
  });

  it('does not start the catalogue hook while the flag is off', () => {
    const useCatalogue = vi.fn();
    const { container } = render(
      <MeetingKeywordSettingsPanel useCatalogue={useCatalogue} />
    );
    expect(container).toBeEmptyDOMElement();
    expect(useCatalogue).not.toHaveBeenCalled();
    expect(
      getMeetingInsightComposition().registered.map(
        (descriptor) => descriptor.id
      )
    ).not.toContain('meeting_keywords');
  });

  it('registers and renders the Settings section through the real doorway', async () => {
    const { getSettingsPanelDescriptors } =
      await import('@/features/settings/registry/settingsModuleRegistry');
    const { renderRegisteredSettingsPanels } =
      await import('@/features/settings');
    setDevFlagOverride('meeting-keywords', true);
    expect(
      getSettingsPanelDescriptors('organization').find(
        (panel) => panel.id === 'meeting-keywords'
      )
    ).toBeDefined();
    render(
      <>
        {renderRegisteredSettingsPanels('organization', {
          getSetting: () => undefined,
          setSetting: () => undefined,
          onAction: () => undefined,
          filteredKeys: new Set(),
          searchQuery: '',
          searchActive: false,
          onNavigate: () => undefined,
          hasWorkspaceOpen: true,
        })}
      </>
    );
    expect(screen.getByTestId('meeting-keywords-settings')).toBeInTheDocument();
  });
});
