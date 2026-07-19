import { useState } from 'react';
import { buildResolvedProviderForGlance } from '@/platform/matter/matterAtAGlance';
import { SearchField } from '@/ui/kp';
import { createPreparedMeetingTemplateFillProvider } from './meetingTemplateAi';
import { MeetingTemplatePanel } from './MeetingTemplatePanel';
import type { MeetingPanelContext } from './meetingWorkspaceTypes';
import { SpeakerNamesPanel } from './SpeakerNamesPanel';
import { TranscriptViewer } from './TranscriptViewer';

export function TranscriptCompatibilityPanel({
  context,
}: {
  context: MeetingPanelContext;
}) {
  const [query, setQuery] = useState('');
  const transcript = context.transcript;
  const hostIdentity = context.hostIdentity;

  if (!transcript) return null;

  const normalizedQuery = query.trim().toLocaleLowerCase();
  const visibleSegments = normalizedQuery
    ? transcript.segments.filter((segment) =>
        `${segment.speaker}\n${segment.text}`
          .toLocaleLowerCase()
          .includes(normalizedQuery)
      )
    : transcript.segments;
  const projectedTranscript = {
    ...transcript,
    segments: visibleSegments,
  };

  return (
    <>
      <div
        data-testid="meeting-transcript-search"
        style={{
          display: 'flex',
          alignItems: 'center',
          gap: 'var(--kp-space-sm)',
          flexWrap: 'wrap',
        }}
      >
        <SearchField
          data-testid="meeting-transcript-search-input"
          aria-label={context.t('meetings.entry.transcript-search-label')}
          placeholder={context.t(
            'meetings.entry.transcript-search-placeholder'
          )}
          value={query}
          onChange={setQuery}
          onClear={() => {
            setQuery('');
          }}
          size="sm"
          style={{ minWidth: 220, flex: '1 1 280px' }}
        />
        {normalizedQuery && (
          <span
            data-testid="meeting-transcript-search-count"
            role="status"
            aria-live="polite"
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-xs)',
            }}
          >
            {context.t('meetings.entry.transcript-search-count', {
              count: visibleSegments.length,
              total: transcript.segments.length,
            })}
          </span>
        )}
      </div>
      {visibleSegments.length > 0 ? (
        <TranscriptViewer
          transcript={projectedTranscript}
          onSeek={context.onSeek}
          {...(context.seekMs !== undefined
            ? { activeMs: context.seekMs }
            : {})}
        />
      ) : (
        <div
          data-testid="meeting-transcript-search-empty"
          role="status"
          style={{
            color: 'var(--color-muted-foreground)',
            fontSize: 'var(--kp-font-sm)',
          }}
        >
          {context.t('meetings.entry.transcript-search-empty')}
        </div>
      )}
      <div style={{ marginTop: 'var(--kp-space-lg)' }}>
        <SpeakerNamesPanel
          meetingDir={context.meetingDir}
          matterId={context.matterId}
          workspaceRoot={context.workspaceRoot}
        />
      </div>
      {context.workspaceService && context.firm.org && (
        <MeetingTemplatePanel
          workspace={context.workspaceService}
          firmId={context.firm.org.org_id}
          canManageTemplates={context.firm.role === 'admin'}
          {...(hostIdentity
            ? {
                fill: {
                  activeClientBoundary: hostIdentity.clientBoundary,
                  target: hostIdentity.target,
                  transcript,
                  clientName: context.clientName,
                  getProvider: async () => {
                    const resolved = await buildResolvedProviderForGlance();
                    return createPreparedMeetingTemplateFillProvider({
                      matterId: hostIdentity.matterId,
                      resolved,
                    });
                  },
                },
              }
            : {})}
        />
      )}
    </>
  );
}
