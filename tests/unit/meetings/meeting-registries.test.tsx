import { describe, expect, it } from 'vitest';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import {
  getMeetingHeaderActions,
  type MeetingHeaderActionDescriptor,
  validateMeetingHeaderActionDescriptors,
} from '@/features/meetings/meetingHeaderActionRegistry';
import {
  getMeetingInsights,
  getRegisteredMeetingInsights,
  type MeetingInsightArtifact,
  type MeetingInsightDescriptor,
  validateMeetingInsightDescriptors,
} from '@/features/meetings/meetingInsightRegistry';
import {
  BLESSED_MEETING_PANEL_IDS,
  type BlessedMeetingPanelId,
} from '@/features/meetings';
import {
  getMeetingPanels,
  type MeetingPanelDescriptor,
  validateMeetingPanelDescriptors,
} from '@/features/meetings/meetingPanelRegistry';

declare module '@/features/meetings/meetingWorkspaceTypes' {
  interface MeetingHeaderActionIdMap {
    dummy_action: true;
    second_dummy_action: true;
  }

  interface MeetingInsightIdMap {
    dummy_insight: true;
    second_dummy_insight: true;
  }
}

const dummyPanel = {
  id: 'dummy_panel',
  order: 10,
  labelKey: 'meetings.test.dummy-panel',
  mount: ({ t }) => (
    <div data-testid="dummy-panel">{t('meetings.test.dummy-panel')}</div>
  ),
} as unknown as MeetingPanelDescriptor;

function blessedPanel(id: BlessedMeetingPanelId): MeetingPanelDescriptor {
  return {
    id,
    order: 10,
    labelKey: `meetings.test.${id}`,
    mount: ({ t }) => (
      <div data-testid={`panel-${id}`}>{t(`meetings.test.${id}`)}</div>
    ),
  };
}

const dummyAction: MeetingHeaderActionDescriptor = {
  id: 'dummy_action',
  order: 10,
  labelKey: 'meetings.test.dummy-action',
  placement: 'primary',
  mount: ({ t }) => (
    <button data-testid="dummy-action">
      {t('meetings.test.dummy-action')}
    </button>
  ),
};

const dummyInsight: MeetingInsightDescriptor = {
  id: 'dummy_insight',
  order: 10,
  version: 1,
  mounts: { meetingSummary: true, clientSummary: true },
  prerequisites: [{ artifactId: 'transcript', minimumVersion: 1 }],
  artifactStore: {
    artifactId: 'dummy-insight-artifact',
    version: 1,
    read: () => Promise.resolve(null),
    write: (_context, artifact) => Promise.resolve(artifact),
  },
  artifactProducer: {
    artifactId: 'dummy-insight-artifact',
    produce: () =>
      Promise.resolve({
        artifactId: 'dummy-insight-artifact',
        version: 1,
        payload: null,
      }),
  },
  selectors: { selectDummy: () => null },
  settings: {
    id: 'dummy-insight-settings',
    labelKey: 'meetings.test.dummy-insight-settings',
    mount: () => <div data-testid="dummy-settings" />,
  },
  renderMeetingSummary: () => <div data-testid="dummy-insight" />,
  renderClientSummary: () => <div data-testid="dummy-client-insight" />,
};

describe('meeting workspace registries', () => {
  it('keeps the seven-slot manifest frozen and only bridges legacy content tabs', () => {
    expect(BLESSED_MEETING_PANEL_IDS).toEqual([
      'prep',
      'agenda',
      'summary',
      'transcript',
      'tasks',
      'crm-update',
      'follow-up',
    ]);
    expect(Object.isFrozen(BLESSED_MEETING_PANEL_IDS)).toBe(true);
    expect(getMeetingPanels().map((descriptor) => descriptor.id)).toEqual([
      'summary',
      'transcript',
    ]);
    expect(getMeetingPanels().map((descriptor) => descriptor.id)).not.toContain(
      'recording'
    );
    expect(
      getMeetingHeaderActions().map((descriptor) => descriptor.id)
    ).toEqual(['send', 'mark_reviewed', 'utilities']);
    expect(getMeetingInsights()).toEqual([]);
    expect(
      getRegisteredMeetingInsights().map((descriptor) => descriptor.id)
    ).toEqual(['review_status']);
  });

  it('orders blessed panels by the manifest rather than caller order', () => {
    const secondPanel = blessedPanel('agenda');
    const firstPanel = blessedPanel('tasks');
    const secondAction: MeetingHeaderActionDescriptor = {
      ...dummyAction,
      id: 'second_dummy_action',
    };
    const secondInsight: MeetingInsightDescriptor = {
      ...dummyInsight,
      id: 'second_dummy_insight',
    };

    expect(
      getMeetingPanels([firstPanel, secondPanel]).map((item) => item.id)
    ).toEqual(['agenda', 'tasks']);
    expect(
      getMeetingHeaderActions([dummyAction, secondAction]).map(
        (item) => item.id
      )
    ).toEqual(['dummy_action', 'second_dummy_action']);
    expect(
      getMeetingInsights([dummyInsight, secondInsight]).map((item) => item.id)
    ).toEqual(['dummy_insight', 'second_dummy_insight']);
  });

  it('rejects duplicate ids in every registry with a clear registry name', () => {
    expect(() => {
      const prepPanel = blessedPanel('prep');
      validateMeetingPanelDescriptors([prepPanel, prepPanel]);
    }).toThrow('[meetingPanelRegistry] duplicate panel id: prep');
    expect(() => {
      validateMeetingHeaderActionDescriptors([dummyAction, dummyAction]);
    }).toThrow(
      '[meetingHeaderActionRegistry] duplicate action id: dummy_action'
    );
    expect(() => {
      validateMeetingInsightDescriptors([dummyInsight, dummyInsight]);
    }).toThrow('[meetingInsightRegistry] duplicate insight id: dummy_insight');
  });

  it('rejects off-list panel ids before the host can render them', () => {
    expect(() => {
      getMeetingPanels([dummyPanel]);
    }).toThrow(
      '[meetingPanelRegistry] panel id is not in the blessed manifest: dummy_panel'
    );
  });

  it('rejects incomplete panel and header action contracts', () => {
    expect(() => {
      validateMeetingPanelDescriptors([
        { ...blessedPanel('prep'), labelKey: 'not-namespaced' },
      ]);
    }).toThrow('labelKey must be namespaced: prep');
    expect(() => {
      validateMeetingPanelDescriptors([
        { ...blessedPanel('prep'), mount: undefined as never },
      ]);
    }).toThrow('invalid panel contract: prep');
    expect(() => {
      validateMeetingHeaderActionDescriptors([
        { ...dummyAction, placement: 'floating' as never },
      ]);
    }).toThrow('invalid action contract: dummy_action');
  });

  it('rejects missing or invalid required insight metadata', () => {
    expect(() => {
      validateMeetingInsightDescriptors([{ ...dummyInsight, version: 0 }]);
    }).toThrow('version must be a positive integer: dummy_insight');
    expect(() => {
      validateMeetingInsightDescriptors([
        { ...dummyInsight, mounts: undefined as never },
      ]);
    }).toThrow('mounts are required: dummy_insight');
    expect(() => {
      validateMeetingInsightDescriptors([
        { ...dummyInsight, prerequisites: undefined as never },
      ]);
    }).toThrow('prerequisites are required: dummy_insight');
    expect(() => {
      validateMeetingInsightDescriptors([
        { ...dummyInsight, artifactProducer: undefined as never },
      ]);
    }).toThrow('artifact producer is required: dummy_insight');
    expect(() => {
      validateMeetingInsightDescriptors([
        { ...dummyInsight, artifactStore: undefined as never },
      ]);
    }).toThrow('artifact store is required: dummy_insight');
    expect(() => {
      validateMeetingInsightDescriptors([{ ...dummyInsight, selectors: {} }]);
    }).toThrow('selectors are required: dummy_insight');
    expect(() => {
      validateMeetingInsightDescriptors([
        { ...dummyInsight, settings: undefined as never },
      ]);
    }).toThrow('settings descriptor is required: dummy_insight');
    expect(() => {
      validateMeetingInsightDescriptors([
        { ...dummyInsight, renderClientSummary: undefined as never },
      ]);
    }).toThrow(
      'meeting and client summary renderers are required: dummy_insight'
    );
  });

  it('reads and writes a registered insight artifact with the exact meeting.json shape', async () => {
    const descriptor = getRegisteredMeetingInsights().find(
      (item) => item.id === 'review_status'
    );
    expect(descriptor).toBeDefined();

    let stored = JSON.stringify(
      {
        matterId: 'matter-1',
        startedAt: '2026-07-15T09:00:00.000Z',
        consent: {
          mode: 'one-party',
          confirmedBy: 'user',
          confirmedAt: '2026-07-15T09:00:00.000Z',
        },
        customTitle: 'Annual review',
      },
      null,
      2
    );
    const workspaceService = {
      readFile: async () => stored,
      writeFile: async (_path: string, content: string) => {
        stored = content;
      },
    } as unknown as WorkspaceService;
    const context = {
      matterId: 'matter-1',
      meetingDir: 'Clients/A/Meetings/one',
      workspaceService,
    };
    const artifact: MeetingInsightArtifact = {
      artifactId: 'meeting-review-status',
      version: 1,
      payload: { reviewedAt: '2026-07-15T10:00:00.000Z' },
    };

    await descriptor?.artifactStore.write(context, artifact);

    expect(stored).toBe(
      JSON.stringify(
        {
          matterId: 'matter-1',
          startedAt: '2026-07-15T09:00:00.000Z',
          consent: {
            mode: 'one-party',
            confirmedBy: 'user',
            confirmedAt: '2026-07-15T09:00:00.000Z',
          },
          customTitle: 'Annual review',
          reviewedAt: '2026-07-15T10:00:00.000Z',
        },
        null,
        2
      )
    );
    await expect(descriptor?.artifactStore.read(context)).resolves.toEqual(
      artifact
    );
  });
});
