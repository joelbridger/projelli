import {
  Check,
  Copy,
  Download,
  FileText,
  MoreVertical,
  Send,
  Trash2,
} from 'lucide-react';
import { MeetingNotesReview } from '@/platform/meetingNotesReview/MeetingNotesReview';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';
import { buildResolvedProviderForGlance } from '@/platform/matter/matterAtAGlance';
import { mmss } from './meetingSources';
import { MeetingTemplatePanel } from './MeetingTemplatePanel';
import { createPreparedMeetingTemplateFillProvider } from './meetingTemplateAi';
import { SpeakerNamesPanel } from './SpeakerNamesPanel';
import { TranscriptViewer } from './TranscriptViewer';
import type {
  MeetingHeaderActionDescriptor,
  MeetingPanelContext,
  MeetingPanelDescriptor,
} from './meetingWorkspaceTypes';

declare module './meetingWorkspaceTypes' {
  interface MeetingPanelIdMap {
    recording: true;
    transcript: true;
    summary: true;
  }

  interface MeetingHeaderActionIdMap {
    send: true;
    mark_reviewed: true;
    utilities: true;
  }
}

function transcriptLooksSilent(context: MeetingPanelContext): boolean {
  return (
    context.transcript !== null &&
    context.transcript.segments.every((segment) => !segment.text.trim())
  );
}

export const legacyMeetingPanels: readonly MeetingPanelDescriptor[] = [
  {
    id: 'recording',
    order: 10,
    labelKey: 'meetings.entry.tab-recording',
    mount: (context) => (
      <div
        data-testid="meeting-recording-tab"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--kp-space-md)',
        }}
      >
        {context.hasAudio && context.audioSrc ? (
          context.renderAudioPlayer()
        ) : context.meta?.recordingError && !context.hasAudio ? (
          <div
            data-testid="meeting-entry-recording-incomplete"
            style={{
              color: 'var(--kp-navy)',
              fontSize: 'var(--kp-font-sm)',
            }}
          >
            {context.t('meetings.entry.recording-incomplete')}
          </div>
        ) : (
          <div
            data-testid="meeting-entry-no-audio"
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-sm)',
            }}
          >
            {context.t('meetings.entry.no-audio')}
          </div>
        )}
        {transcriptLooksSilent(context) && (
          <div
            data-testid="meeting-entry-no-one-spoke"
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-sm)',
            }}
          >
            {context.t('meetings.entry.no-one-spoke')}
          </div>
        )}
      </div>
    ),
  },
  {
    id: 'transcript',
    order: 20,
    labelKey: 'meetings.entry.tab-transcript',
    mount: (context) => (
      <div
        data-testid="meeting-transcript-tab"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--kp-space-md)',
        }}
      >
        {context.transcript ? (
          <>
            <TranscriptViewer
              transcript={context.transcript}
              onSeek={context.onSeek}
              {...(context.seekMs !== undefined
                ? { activeMs: context.seekMs }
                : {})}
            />
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
                meetingDir={context.meetingDir}
                transcript={context.transcript}
                clientName={context.clientName}
                getProvider={async () => {
                  const resolved = await buildResolvedProviderForGlance();
                  return createPreparedMeetingTemplateFillProvider({
                    matterId: context.matterId,
                    resolved,
                  });
                }}
              />
            )}
          </>
        ) : context.meta?.transcriptError ? (
          <div
            data-testid="meeting-entry-transcript-failed"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--kp-space-sm)',
            }}
          >
            <div
              style={{
                color: 'var(--kp-navy)',
                fontSize: 'var(--kp-font-sm)',
              }}
            >
              {context.meta.transcriptError.kind === 'not-installed' &&
                context.t('meetings.entry.transcript-failed-not-installed')}
              {context.meta.transcriptError.kind === 'timeout' &&
                context.t('meetings.entry.transcript-failed-timeout')}
              {context.meta.transcriptError.kind === 'error' &&
                context.t('meetings.entry.transcript-failed-error')}
            </div>
            <button
              type="button"
              data-testid="meeting-entry-retry-transcript"
              onClick={() => {
                void context.onRetryTranscript().catch(context.onPanelError);
              }}
              disabled={context.retryingTranscript}
              style={{
                alignSelf: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid var(--kp-divider)',
                background: 'transparent',
                borderRadius: 'var(--radius-md)',
                padding: '6px 10px',
                fontSize: 'var(--kp-font-xs)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {context.retryingTranscript
                ? context.t('meetings.entry.retrying-transcript')
                : context.t('meetings.tab.retry-button')}
            </button>
          </div>
        ) : context.meta?.recordingError && !context.hasAudio ? (
          <div
            data-testid="meeting-entry-recording-incomplete-transcript"
            style={{
              color: 'var(--kp-navy)',
              fontSize: 'var(--kp-font-sm)',
            }}
          >
            {context.t('meetings.entry.recording-incomplete')}
          </div>
        ) : (
          <div
            data-testid="meeting-entry-transcript-pending"
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-sm)',
            }}
          >
            {context.t('meetings.entry.transcript-pending')}
          </div>
        )}
      </div>
    ),
  },
  {
    id: 'summary',
    order: 30,
    labelKey: 'meetings.entry.tab-summary',
    mount: (context) => (
      <div
        data-testid="meeting-summary-tab"
        style={{
          display: 'flex',
          flexDirection: 'column',
          gap: 'var(--kp-space-md)',
        }}
      >
        {context.summaryReady ? (
          <>
            <MeetingNotesReview
              meetingDir={context.meetingDir}
              matterId={context.matterId}
              summaryText={context.summaryText}
              summaryHtml={context.summaryExtraction?.html ?? ''}
              workspaceService={context.workspaceService}
              {...(context.crmBlockedReason
                ? {
                    crmBlockedReason:
                      'Mark this meeting reviewed before sending a CRM update.',
                  }
                : {})}
            />
            <pre
              data-testid="meeting-summary-text"
              style={{
                whiteSpace: 'pre-wrap',
                margin: 0,
                fontFamily: 'inherit',
                color: 'var(--kp-navy)',
                fontSize: 'var(--kp-font-sm)',
                lineHeight: 1.6,
              }}
            >
              {context.summaryText.trim()}
            </pre>
          </>
        ) : context.hasNotes ? (
          <div
            data-testid="meeting-entry-summary-not-ready"
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-sm)',
            }}
          >
            {context.t('meetings.entry.summary-not-ready')}
          </div>
        ) : context.meta?.notesError ? (
          <div
            data-testid="meeting-entry-notes-failed"
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--kp-space-sm)',
            }}
          >
            <div
              style={{
                color: 'var(--kp-navy)',
                fontSize: 'var(--kp-font-sm)',
              }}
            >
              {context.meta.notesError.kind === 'gate-blocked' &&
                context.t('meetings.entry.notes-failed-blocked')}
              {context.meta.notesError.kind === 'timeout' &&
                context.t('meetings.entry.notes-failed-timeout')}
              {context.meta.notesError.kind === 'error' &&
                context.t('meetings.entry.notes-failed-error')}
            </div>
            <button
              type="button"
              data-testid="meeting-entry-retry-notes"
              onClick={() => {
                void context.onRetryNotes().catch(context.onPanelError);
              }}
              disabled={context.retryingNotes}
              style={{
                alignSelf: 'flex-start',
                display: 'flex',
                alignItems: 'center',
                gap: 6,
                border: '1px solid var(--kp-divider)',
                background: 'transparent',
                borderRadius: 'var(--radius-md)',
                padding: '6px 10px',
                fontSize: 'var(--kp-font-xs)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              {context.retryingNotes
                ? context.t('meetings.entry.retrying-notes')
                : context.t('meetings.tab.retry-button')}
            </button>
          </div>
        ) : (
          <div
            data-testid="meeting-entry-notes-pending"
            style={{
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-sm)',
            }}
          >
            {context.t('meetings.entry.notes-pending')}
          </div>
        )}
      </div>
    ),
  },
];

export const legacyMeetingHeaderActions: readonly MeetingHeaderActionDescriptor[] =
  [
    {
      id: 'send',
      order: 10,
      labelKey: 'meetings.entry.send-action',
      placement: 'primary',
      mount: (context) =>
        context.meta ? (
          <button
            type="button"
            data-testid="meeting-entry-send"
            onClick={context.onOpenSend}
            disabled={!context.meta.reviewedAt}
            title={
              !context.meta.reviewedAt
                ? context.t('meetings.entry.send-review-first')
                : undefined
            }
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: '1px solid var(--kp-divider)',
              background: context.meta.reviewedAt
                ? 'var(--kp-accent)'
                : 'transparent',
              color: context.meta.reviewedAt
                ? 'var(--color-primary-foreground)'
                : 'var(--color-muted-foreground)',
              borderRadius: 'var(--radius-md)',
              padding: '6px 12px',
              fontSize: 'var(--kp-font-xs)',
              fontWeight: 'var(--kp-weight-semibold)',
              cursor: context.meta.reviewedAt ? 'pointer' : 'not-allowed',
              opacity: context.meta.reviewedAt ? 1 : 0.6,
              fontFamily: 'inherit',
            }}
          >
            <Send style={{ width: 13, height: 13 }} />
            {context.t('meetings.entry.send-action')}
          </button>
        ) : null,
    },
    {
      id: 'mark_reviewed',
      order: 20,
      labelKey: 'meetings.entry.mark-reviewed',
      placement: 'secondary',
      mount: (context) =>
        context.meta && !context.meta.reviewedAt ? (
          <button
            type="button"
            data-testid="meeting-entry-mark-reviewed"
            onClick={() => {
              void context.onMarkReviewed().catch(context.onActionError);
            }}
            style={{
              display: 'flex',
              alignItems: 'center',
              gap: 6,
              border: '1px solid var(--kp-divider)',
              background: 'transparent',
              borderRadius: 'var(--radius-md)',
              padding: '6px 10px',
              fontSize: 'var(--kp-font-xs)',
              cursor: 'pointer',
              fontFamily: 'inherit',
            }}
          >
            <Check style={{ width: 12, height: 12 }} />
            {context.t('meetings.entry.mark-reviewed')}
          </button>
        ) : null,
    },
    {
      id: 'utilities',
      order: 30,
      labelKey: 'meetings.entry.actions-menu',
      placement: 'menu',
      mount: (context) => (
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <button
              type="button"
              data-testid="meeting-entry-actions-menu"
              aria-label={context.t('meetings.entry.actions-menu')}
              title={context.t('meetings.entry.actions-menu')}
              style={{
                display: 'flex',
                alignItems: 'center',
                border: '1px solid var(--kp-divider)',
                background: 'transparent',
                borderRadius: 'var(--radius-md)',
                padding: '6px 8px',
                cursor: 'pointer',
                color: 'var(--kp-navy)',
              }}
            >
              <MoreVertical style={{ width: 15, height: 15 }} />
            </button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="end" className="w-56">
            {context.hasAudio && (
              <DropdownMenuItem
                data-testid="meeting-audio-download"
                onClick={context.onDownloadAudio}
              >
                <Download className="h-3.5 w-3.5 mr-2" />
                {context.t('meetings.entry.download-audio')}
              </DropdownMenuItem>
            )}
            <DropdownMenuItem
              data-testid="meeting-transcript-copy"
              disabled={!context.transcript}
              onClick={() => {
                void context
                  .onCopyText(
                    context.transcript
                      ? context.transcript.segments
                          .map(
                            (segment) =>
                              `${mmss(segment.startMs)} ${segment.speaker}: ${segment.text}`
                          )
                          .join('\n')
                      : '',
                    context.t('meetings.entry.transcript-copied')
                  )
                  .catch(context.onActionError);
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-2" />
              {context.t('meetings.entry.copy-transcript')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="meeting-transcript-export"
              disabled={
                !context.transcript || context.exporting === 'transcript'
              }
              onClick={context.onExportTranscript}
            >
              <Download className="h-3.5 w-3.5 mr-2" />
              {context.t('meetings.entry.export-transcript')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="meeting-summary-copy"
              disabled={!context.summaryReady}
              onClick={() => {
                void context
                  .onCopyText(
                    context.summaryText.trim(),
                    context.t('meetings.entry.summary-copied')
                  )
                  .catch(context.onActionError);
              }}
            >
              <Copy className="h-3.5 w-3.5 mr-2" />
              {context.t('meetings.entry.copy-summary')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="meeting-summary-export-docx"
              disabled={
                !context.summaryReady || context.exporting === 'summary-docx'
              }
              onClick={context.onExportSummaryDocx}
            >
              <FileText className="h-3.5 w-3.5 mr-2" />
              {context.t('meetings.entry.export-summary-word')}
            </DropdownMenuItem>
            <DropdownMenuItem
              data-testid="meeting-summary-export-pdf"
              disabled={
                !context.summaryReady || context.exporting === 'summary-pdf'
              }
              onClick={context.onExportSummaryPdf}
            >
              <Download className="h-3.5 w-3.5 mr-2" />
              {context.t('meetings.entry.export-summary-pdf')}
            </DropdownMenuItem>
            {context.hasAudio && (
              <>
                <DropdownMenuSeparator />
                <DropdownMenuItem
                  data-testid="meeting-entry-delete-audio"
                  className="text-destructive focus:text-destructive"
                  onClick={context.onRequestDeleteAudio}
                >
                  <Trash2 className="h-3.5 w-3.5 mr-2" />
                  {context.hasTranscript
                    ? context.t('meetings.entry.delete-audio')
                    : context.t('meetings.entry.delete-audio-no-transcript')}
                </DropdownMenuItem>
              </>
            )}
          </DropdownMenuContent>
        </DropdownMenu>
      ),
    },
  ];
