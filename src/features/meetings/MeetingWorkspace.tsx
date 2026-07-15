import { useMemo, useState, type ReactNode } from 'react';
import {
  getMeetingHeaderActions,
  type MeetingHeaderActionContext,
  type MeetingHeaderActionDescriptor,
} from './meetingHeaderActionRegistry';
import {
  getMeetingInsights,
  type MeetingInsightDescriptor,
  type MeetingInsightMeetingSummaryContext,
} from './meetingInsightRegistry';
import {
  getMeetingPanels,
  type MeetingPanelContext,
  type MeetingPanelDescriptor,
  type MeetingPanelId,
} from './meetingPanelRegistry';

export interface MeetingWorkspaceProps {
  headerLead: ReactNode;
  headerActionContext: MeetingHeaderActionContext;
  panelContext: MeetingPanelContext;
  insightContext: MeetingInsightMeetingSummaryContext;
  beforePanels?: ReactNode;
  footer?: ReactNode;
  panelDescriptors?: readonly MeetingPanelDescriptor[];
  headerActionDescriptors?: readonly MeetingHeaderActionDescriptor[];
  insightDescriptors?: readonly MeetingInsightDescriptor[];
}

/**
 * Generic meeting-detail shell. Feature descriptors own every selectable
 * panel, header action, and insight mount; this component only lays them out.
 */
export function MeetingWorkspace({
  headerLead,
  headerActionContext,
  panelContext,
  insightContext,
  beforePanels,
  footer,
  panelDescriptors,
  headerActionDescriptors,
  insightDescriptors,
}: MeetingWorkspaceProps) {
  const panels = useMemo(
    () => getMeetingPanels(panelDescriptors),
    [panelDescriptors]
  );
  const headerActions = useMemo(
    () => getMeetingHeaderActions(headerActionDescriptors),
    [headerActionDescriptors]
  );
  const insights = useMemo(
    () => getMeetingInsights(insightDescriptors),
    [insightDescriptors]
  );
  const [requestedPanelId, setRequestedPanelId] =
    useState<MeetingPanelId | null>(() => panels[0]?.id ?? null);
  const activePanel =
    panels.find((descriptor) => descriptor.id === requestedPanelId) ??
    panels[0];

  return (
    <div
      data-testid="meeting-entry"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--kp-divider)',
        }}
      >
        {headerLead}
        <div
          data-testid="meeting-header-actions"
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: 'none',
          }}
        >
          {headerActions.map((descriptor) => (
            <span
              key={descriptor.id}
              data-meeting-header-action={descriptor.id}
              data-placement={descriptor.placement}
              style={{ display: 'contents' }}
            >
              {descriptor.mount(headerActionContext)}
            </span>
          ))}
        </div>
      </div>

      <div
        role="tablist"
        style={{
          borderBottom: '1px solid var(--kp-divider)',
          padding: '10px var(--kp-gutter) 0',
          display: 'flex',
          gap: 6,
        }}
      >
        {panels.map((descriptor) => {
          const active = descriptor.id === activePanel?.id;
          return (
            <button
              key={descriptor.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`meeting-subtab-${descriptor.id}`}
              onClick={() => {
                setRequestedPanelId(descriptor.id);
              }}
              style={{
                border: 'none',
                borderBottom: active
                  ? '2px solid var(--kp-accent)'
                  : '2px solid transparent',
                background: 'transparent',
                color: active
                  ? 'var(--kp-navy)'
                  : 'var(--color-muted-foreground)',
                fontFamily: 'inherit',
                fontSize: 'var(--kp-font-sm)',
                fontWeight: active
                  ? 'var(--kp-weight-semibold)'
                  : 'var(--kp-weight-regular)',
                padding: '8px 10px',
                cursor: 'pointer',
              }}
            >
              {panelContext.t(descriptor.labelKey)}
            </button>
          );
        })}
      </div>

      <div
        data-testid="meeting-entry-tab-scroll"
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        {beforePanels}
        <div style={{ padding: 'var(--kp-gutter)' }}>
          {activePanel?.mount(panelContext)}
          {insights.length > 0 && (
            <div data-testid="meeting-insight-mounts">
              {insights.map((descriptor) => (
                <div key={descriptor.id} data-meeting-insight={descriptor.id}>
                  {descriptor.renderMeetingSummary(insightContext)}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>
      {footer}
    </div>
  );
}
