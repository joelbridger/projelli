import { render, screen } from '@testing-library/react';
import type { TFunction } from 'i18next';
import { describe, expect, it } from 'vitest';
import { MeetingWorkspace } from '@/features/meetings/MeetingWorkspace';
import {
  getMeetingHeaderActions,
  type MeetingHeaderActionContext,
  type MeetingHeaderActionDescriptor,
  validateMeetingHeaderActionDescriptors,
} from '@/features/meetings/meetingHeaderActionRegistry';
import {
  getMeetingInsights,
  type MeetingInsightDescriptor,
  validateMeetingInsightDescriptors,
} from '@/features/meetings/meetingInsightRegistry';
import {
  getMeetingPanels,
  type MeetingPanelContext,
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
  prerequisites: [{ artifactId: 'transcript', minimumVersion: 1 }],
  artifactProducer: {
    artifactId: 'dummy-insight-artifact',
    produce: () =>
      Promise.resolve({
        artifactId: 'dummy-insight-artifact',
        version: 1,
        payload: null,
      }),
  },
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

  it('mounts one dummy panel, action, and insight with descriptor registration only', () => {
    const t = ((key: string) => key) as TFunction;
    render(
      <MeetingWorkspace
        headerLead={<div data-testid="dummy-header" />}
        headerActionContext={{ t } as MeetingHeaderActionContext}
        panelContext={{ t } as MeetingPanelContext}
        insightContext={{
          matterId: 'matter-1',
          meetingDir: 'Clients/A/Meetings/one',
          clientName: 'Ada Client',
          workspaceService: null,
        }}
        panelDescriptors={[dummyPanel]}
        headerActionDescriptors={[dummyAction]}
        insightDescriptors={[dummyInsight]}
      />
    );

    expect(screen.getByTestId('dummy-panel')).toHaveTextContent(
      'meetings.test.dummy-panel'
    );
    expect(screen.getByTestId('dummy-action')).toHaveTextContent(
      'meetings.test.dummy-action'
    );
    expect(screen.getByTestId('dummy-insight')).toBeInTheDocument();
  });
});
