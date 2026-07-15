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
  getMeetingPanels,
  type MeetingPanelDescriptor,
  validateMeetingPanelDescriptors,
} from '@/features/meetings/meetingPanelRegistry';

declare module '@/features/meetings/meetingWorkspaceTypes' {
  interface MeetingPanelIdMap {
    dummy_panel: true;
    second_dummy_panel: true;
  }

  interface MeetingHeaderActionIdMap {
    dummy_action: true;
    second_dummy_action: true;
  }

  interface MeetingInsightIdMap {
    dummy_insight: true;
    second_dummy_insight: true;
  }
}

const dummyPanel: MeetingPanelDescriptor = {
  id: 'dummy_panel',
  order: 10,
  labelKey: 'meetings.test.dummy-panel',
  mount: ({ t }) => (
    <div data-testid="dummy-panel">{t('meetings.test.dummy-panel')}</div>
  ),
};

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
  it('keeps current compatibility descriptors in stable visible order', () => {
    expect(getMeetingPanels().map((descriptor) => descriptor.id)).toEqual([
      'recording',
      'transcript',
      'summary',
    ]);
    expect(
      getMeetingHeaderActions().map((descriptor) => descriptor.id)
    ).toEqual(['send', 'mark_reviewed', 'utilities']);
    expect(getMeetingInsights()).toEqual([]);
    expect(
      getRegisteredMeetingInsights().map((descriptor) => descriptor.id)
    ).toEqual(['review_status']);
  });

  it('preserves registration order when descriptors have the same order', () => {
    const secondPanel: MeetingPanelDescriptor = {
      ...dummyPanel,
      id: 'second_dummy_panel',
    };
    const secondAction: MeetingHeaderActionDescriptor = {
      ...dummyAction,
      id: 'second_dummy_action',
    };
    const secondInsight: MeetingInsightDescriptor = {
      ...dummyInsight,
      id: 'second_dummy_insight',
    };

    expect(
      getMeetingPanels([dummyPanel, secondPanel]).map((item) => item.id)
    ).toEqual(['dummy_panel', 'second_dummy_panel']);
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
      validateMeetingPanelDescriptors([dummyPanel, dummyPanel]);
    }).toThrow('[meetingPanelRegistry] duplicate panel id: dummy_panel');
    expect(() => {
      validateMeetingHeaderActionDescriptors([dummyAction, dummyAction]);
    }).toThrow(
      '[meetingHeaderActionRegistry] duplicate action id: dummy_action'
    );
    expect(() => {
      validateMeetingInsightDescriptors([dummyInsight, dummyInsight]);
    }).toThrow('[meetingInsightRegistry] duplicate insight id: dummy_insight');
  });

  it('rejects incomplete panel and header action contracts', () => {
    expect(() => {
      validateMeetingPanelDescriptors([
        { ...dummyPanel, labelKey: 'not-namespaced' },
      ]);
    }).toThrow('labelKey must be namespaced: dummy_panel');
    expect(() => {
      validateMeetingPanelDescriptors([
        { ...dummyPanel, mount: undefined as never },
      ]);
    }).toThrow('invalid panel contract: dummy_panel');
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
      validateMeetingInsightDescriptors([
        { ...dummyInsight, selectors: {} },
      ]);
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
