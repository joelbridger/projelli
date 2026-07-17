import { afterEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { setDevFlagOverride } from '@/platform/flags';
import { LIVE_CRM_RECORDS_CHANGED } from '@/platform/crm/useLiveCrmRecords';
import {
  approvedMeetingArtifactsForClient,
  createMeetingArtifactStore,
  createMeetingStore,
  type ClientBoundary,
  type MeetingKeywordCatalogueStore,
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
    vi.restoreAllMocks();
    setDevFlagOverride('meeting-keywords', undefined);
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

  it('renders the loading, empty, and populated topic states with shared controls', async () => {
    setDevFlagOverride('meeting-keywords', true);
    let resolveTerms: ((terms: readonly string[]) => void) | undefined;
    const get = vi.fn(
      () =>
        new Promise<readonly string[]>((resolve) => {
          resolveTerms = resolve;
        })
    );
    const catalogue: MeetingKeywordCatalogueStore = {
      terms: [],
      error: null,
      get,
      save: vi.fn(),
    };

    const firstRender = render(
      <MeetingKeywordSettingsPanel useCatalogue={() => catalogue} />
    );
    expect(
      screen.getByTestId('meeting-keywords-settings-loading')
    ).toBeVisible();

    resolveTerms?.([]);
    expect(
      await screen.findByTestId('meeting-keywords-settings-empty')
    ).toBeVisible();

    firstRender.unmount();
    get.mockResolvedValueOnce(['Retirement']);
    render(<MeetingKeywordSettingsPanel useCatalogue={() => catalogue} />);
    const list = await screen.findByTestId('meeting-keywords-settings-list');
    expect(list).toHaveTextContent('Retirement');
    expect(screen.getByTestId('meeting-keywords-settings-input')).toHaveClass(
      'border-input'
    );
    expect(
      screen.getByRole('button', { name: /remove retirement/i })
    ).toHaveClass('kp-btn');
    expect(screen.getByTestId('meeting-keywords-settings-add')).toHaveClass(
      'kp-btn'
    );
  });

  it('clears a live catalogue error through its reload path before retrying', async () => {
    setDevFlagOverride('meeting-keywords', true);
    let liveError: string | null = 'The live records could not load.';
    const get = vi.fn().mockResolvedValue(['Retirement']);
    const catalogue = {
      get,
      save: vi.fn(),
      get terms() {
        return [];
      },
      get error() {
        return liveError;
      },
    } satisfies MeetingKeywordCatalogueStore;
    const clearLiveError = () => {
      liveError = null;
    };
    window.addEventListener(LIVE_CRM_RECORDS_CHANGED, clearLiveError);

    try {
      render(<MeetingKeywordSettingsPanel useCatalogue={() => catalogue} />);
      expect(
        await screen.findByTestId('meeting-keywords-settings-error')
      ).toBeVisible();

      fireEvent.click(screen.getByTestId('meeting-keywords-settings-retry'));
      await waitFor(() => {
        expect(
          screen.queryByTestId('meeting-keywords-settings-error')
        ).not.toBeInTheDocument();
      });
      expect(
        await screen.findByTestId('meeting-keywords-settings-list')
      ).toHaveTextContent('Retirement');
      expect(get).toHaveBeenCalledTimes(2);
    } finally {
      window.removeEventListener(LIVE_CRM_RECORDS_CHANGED, clearLiveError);
    }
  });
});
