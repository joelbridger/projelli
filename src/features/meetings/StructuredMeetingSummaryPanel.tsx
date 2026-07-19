import { useCallback, useEffect, useState } from 'react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { Badge } from '@/ui/kp';
import {
  useMeetingArtifactStore,
  useMeetingFoundationStore,
  type MeetingProjection,
  type SealedMeetingClientBoundary,
} from './foundation/contract';
import type { MeetingPanelContext } from './meetingWorkspaceTypes';
import {
  createStructuredMeetingSummaryReader,
  type StructuredMeetingSummary,
} from './structuredMeetingSummary';

export interface StructuredMeetingSummaryContent {
  readonly summary?: string;
  readonly decisions: readonly string[];
  readonly personalNotes: readonly string[];
}

export type StructuredMeetingSummaryPanelLoadResult =
  | {
      readonly kind: 'ready';
      readonly content: StructuredMeetingSummaryContent;
      readonly reviewState: 'needs-review' | 'reviewed';
    }
  | { readonly kind: 'empty' }
  | { readonly kind: 'not-ready' }
  | { readonly kind: 'pending' }
  | { readonly kind: 'refused' }
  | { readonly kind: 'error' };

export interface StructuredMeetingSummaryLoadRequest {
  readonly meeting: MeetingProjection;
  readonly boundary: SealedMeetingClientBoundary;
  readonly meetingDir: string;
  readonly workspaceService: WorkspaceService | null;
}

export type StructuredMeetingSummaryLoader = (
  request: StructuredMeetingSummaryLoadRequest
) => Promise<StructuredMeetingSummaryPanelLoadResult>;

export interface StructuredMeetingSummaryPanelProps {
  readonly context: MeetingPanelContext;
  /** Test seam. Production reads through the sealed client artifact store. */
  readonly loadSummary?: StructuredMeetingSummaryLoader;
}

const EMPTY_CONTENT: StructuredMeetingSummaryContent = Object.freeze({
  decisions: [],
  personalNotes: [],
});

function cleanLine(line: string): string {
  return line.replace(/^\s*(?:[-*•]|\d+[.)])\s*/, '').trim();
}

type LegacySummarySection =
  | 'summary'
  | 'decisions'
  | 'personalNotes'
  | 'ignored';

function headingName(line: string): LegacySummarySection | null {
  const heading = line
    .trim()
    .replace(/^#{1,6}\s*/, '')
    .replace(/:$/, '')
    .trim()
    .toLowerCase();
  if (heading === 'summary' || heading === 'what changed') return 'summary';
  if (heading === 'decisions') return 'decisions';
  if (
    heading === 'personal notes' ||
    heading === 'personal updates' ||
    heading === 'facts worth keeping'
  ) {
    return 'personalNotes';
  }
  if (heading === 'action items' || heading === 'follow-ups') return 'ignored';
  return null;
}

/**
 * Compatibility projection for the existing exact meeting notes document.
 * Only headings and words already present in that document are used. Missing
 * sections stay missing; an action-item section is deliberately left to Tasks.
 */
// eslint-disable-next-line react-refresh/only-export-components -- Pure public projection is tested and reused by the compatibility reader.
export function structuredSummaryFromText(
  value: string
): StructuredMeetingSummaryContent {
  const text = value.trim();
  if (!text) return EMPTY_CONTENT;
  const sections: Record<LegacySummarySection, string[]> = {
    summary: [],
    decisions: [],
    personalNotes: [],
    ignored: [],
  };
  let current: LegacySummarySection | null = null;
  let foundHeading = false;
  for (const rawLine of text.replace(/\r/g, '').split('\n')) {
    const heading = headingName(rawLine);
    if (heading) {
      current = heading;
      foundHeading = true;
      continue;
    }
    const line = cleanLine(rawLine);
    if (line && current) sections[current].push(line);
  }
  if (!foundHeading) {
    return { summary: text, decisions: [], personalNotes: [] };
  }

  const summary = sections['summary'].join('\n').trim();
  return {
    ...(summary ? { summary } : {}),
    decisions: sections['decisions'],
    personalNotes: sections['personalNotes'],
  };
}

function contentFromArtifact(
  summary: StructuredMeetingSummary
): StructuredMeetingSummaryContent {
  return {
    ...(summary.summary ? { summary: summary.summary } : {}),
    decisions: summary.decisions,
    personalNotes: summary.personalNotes,
  };
}

async function loadDefaultSummary(
  meetings: ReturnType<typeof useMeetingFoundationStore>,
  artifacts: ReturnType<typeof useMeetingArtifactStore>,
  {
    meeting,
    boundary,
  }: StructuredMeetingSummaryLoadRequest
): Promise<StructuredMeetingSummaryPanelLoadResult> {
  const artifactResult = await createStructuredMeetingSummaryReader(
    meetings,
    artifacts,
    boundary
  ).read(meeting);
  if (artifactResult.kind === 'refused') return { kind: 'refused' };
  if (artifactResult.kind === 'error') return { kind: 'error' };
  if (artifactResult.kind === 'ready') {
    return {
      kind: 'ready',
      content: contentFromArtifact(artifactResult.summary),
      reviewState: artifactResult.summary.reviewState,
    };
  }
  return { kind: 'empty' };
}

function summaryIdentity(context: MeetingPanelContext): string | null {
  const meeting = context.canonicalMeeting;
  const boundary = context.clientBoundary;
  if (!meeting || !boundary) return null;
  if (
    meeting.householdRef !== boundary.householdRef ||
    meeting.matterId !== boundary.matterId
  ) {
    return null;
  }
  return [boundary.householdRef, boundary.matterId, meeting.id].join('\u0000');
}

function SummaryState({
  context,
  result,
  onRetryRead,
}: {
  context: MeetingPanelContext;
  result:
    | StructuredMeetingSummaryPanelLoadResult
    | { readonly kind: 'loading' };
  onRetryRead: () => void;
}) {
  if (result.kind === 'loading') {
    return (
      <div
        data-testid="meeting-entry-summary-loading"
        style={{
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-sm)',
        }}
      >
        {context.t('meetings.entry.structured-summary-loading')}
      </div>
    );
  }
  if (result.kind === 'empty' || result.kind === 'not-ready') {
    return (
      <div
        data-testid="meeting-entry-summary-not-ready"
        style={{
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-sm)',
        }}
      >
        {context.t('meetings.entry.summary-not-ready')}
      </div>
    );
  }
  if (result.kind === 'pending') {
    return (
      <div
        data-testid="meeting-entry-notes-pending"
        style={{
          color: 'var(--color-muted-foreground)',
          fontSize: 'var(--kp-font-sm)',
        }}
      >
        {context.t('meetings.entry.notes-pending')}
      </div>
    );
  }
  if (result.kind === 'refused' || result.kind === 'error') {
    return (
      <div
        data-testid="meeting-entry-summary-read-error"
        role="alert"
        style={stateCardStyle}
      >
        <span>{context.t('meetings.entry.structured-summary-read-error')}</span>
        <button type="button" onClick={onRetryRead} style={quietButtonStyle}>
          {context.t('meetings.tab.retry-button')}
        </button>
      </div>
    );
  }

  const { content } = result;
  return (
    <div
      style={{
        display: 'flex',
        flexDirection: 'column',
        gap: 'var(--kp-space-md)',
      }}
    >
      <div
        style={{
          display: 'grid',
          gridTemplateColumns: 'minmax(0, 2fr) minmax(180px, 1fr)',
          gap: 'var(--kp-space-md)',
        }}
      >
        <section style={summaryCardStyle}>
          <header style={cardHeaderStyle}>
            <strong>
              {context.t('meetings.entry.structured-summary-title')}
            </strong>
            <Badge
              variant={
                result.reviewState === 'reviewed' ? 'success' : 'warning'
              }
              size="sm"
            >
              {context.t(
                result.reviewState === 'reviewed'
                  ? 'meetings.entry.reviewed'
                  : 'meetings.entry.structured-summary-needs-review'
              )}
            </Badge>
          </header>
          <div style={cardBodyStyle}>
            {content.summary && (
              <section data-testid="meeting-summary-recap">
                <h3 style={sectionHeadingStyle}>
                  {context.t('meetings.entry.structured-summary-recap')}
                </h3>
                <p data-testid="meeting-summary-text" style={paragraphStyle}>
                  {content.summary}
                </p>
              </section>
            )}
            {content.decisions.length > 0 && (
              <section data-testid="meeting-summary-decisions">
                <h3 style={sectionHeadingStyle}>
                  {context.t('meetings.entry.structured-summary-decisions')}
                </h3>
                <ul style={listStyle}>
                  {content.decisions.map((decision) => (
                    <li key={decision}>{decision}</li>
                  ))}
                </ul>
              </section>
            )}
            {content.personalNotes.length > 0 && (
              <section data-testid="meeting-summary-personal-notes">
                <h3 style={sectionHeadingStyle}>
                  {context.t(
                    'meetings.entry.structured-summary-personal-notes'
                  )}
                </h3>
                <div style={listStyle}>
                  {content.personalNotes.map((note) => (
                    <div key={note}>• {note}</div>
                  ))}
                </div>
              </section>
            )}
          </div>
        </section>

        <aside
          data-testid="meeting-summary-processing"
          style={summaryCardStyle}
        >
          <header style={cardHeaderStyle}>
            <strong>
              {context.t('meetings.entry.structured-summary-processing')}
            </strong>
          </header>
          <div style={{ ...cardBodyStyle, alignItems: 'flex-start' }}>
            <Badge variant="success" size="sm">
              {context.t('meetings.entry.structured-summary-ready')}
            </Badge>
            <Badge
              variant={
                result.reviewState === 'reviewed' ? 'success' : 'warning'
              }
              size="sm"
            >
              {context.t(
                result.reviewState === 'reviewed'
                  ? 'meetings.entry.reviewed'
                  : 'meetings.entry.structured-summary-needs-review'
              )}
            </Badge>
          </div>
        </aside>
      </div>
    </div>
  );
}

function BoundStructuredSummary({
  context,
  loadSummary,
  identity,
}: {
  context: MeetingPanelContext;
  loadSummary: StructuredMeetingSummaryLoader;
  identity: string;
}) {
  const [result, setResult] = useState<
    StructuredMeetingSummaryPanelLoadResult | { readonly kind: 'loading' }
  >({ kind: 'loading' });
  const [reloadKey, setReloadKey] = useState(0);

  useEffect(() => {
    let current = true;
    const meeting = context.canonicalMeeting;
    const boundary = context.clientBoundary;
    if (!meeting || !boundary) return () => undefined;
    void loadSummary({
      meeting,
      boundary,
      meetingDir: context.meetingDir,
      workspaceService: context.workspaceService,
    })
      .then((next) => {
        if (current) setResult(next);
      })
      .catch(() => {
        if (current) setResult({ kind: 'error' });
      });
    return () => {
      current = false;
    };
  }, [context, identity, loadSummary, reloadKey]);

  return (
    <SummaryState
      context={context}
      result={result}
      onRetryRead={() => {
        setResult({ kind: 'loading' });
        setReloadKey((value) => value + 1);
      }}
    />
  );
}

/**
 * F11 still owns removal of the folder-only host. Until then this binding must
 * stay dark: a folder path and its extracted text never prove a client pair.
 */
function LegacySummaryCompatibility({
  context,
}: {
  context: MeetingPanelContext;
}) {
  return (
    <SummaryState
      context={context}
      result={{ kind: 'empty' }}
      onRetryRead={() => undefined}
    />
  );
}

function ConnectedStructuredSummary({
  context,
}: {
  context: MeetingPanelContext;
}) {
  const meetings = useMeetingFoundationStore();
  const artifacts = useMeetingArtifactStore();
  const loader = useCallback(
    (request: StructuredMeetingSummaryLoadRequest) =>
      loadDefaultSummary(meetings, artifacts, request),
    [meetings, artifacts]
  );
  const identity = summaryIdentity(context);
  if (!identity) return <LegacySummaryCompatibility context={context} />;
  return (
    <BoundStructuredSummary
      key={identity}
      context={context}
      loadSummary={loader}
      identity={identity}
    />
  );
}

/** The component rebound behind the one existing blessed `summary` slot. */
export function StructuredMeetingSummaryPanel({
  context,
  loadSummary,
}: StructuredMeetingSummaryPanelProps) {
  const identity = summaryIdentity(context);
  let content;
  if (!identity) {
    content = <LegacySummaryCompatibility context={context} />;
  } else if (loadSummary) {
    content = (
      <BoundStructuredSummary
        key={identity}
        context={context}
        loadSummary={loadSummary}
        identity={identity}
      />
    );
  } else {
    content = <ConnectedStructuredSummary context={context} />;
  }
  return <div data-testid="meeting-summary-tab">{content}</div>;
}

const quietButtonStyle = {
  alignSelf: 'flex-start',
  border: '1px solid var(--kp-divider)',
  background: 'transparent',
  borderRadius: 'var(--radius-md)',
  padding: '6px 10px',
  fontSize: 'var(--kp-font-xs)',
  cursor: 'pointer',
  fontFamily: 'inherit',
} as const;

const stateCardStyle = {
  display: 'flex',
  flexDirection: 'column',
  alignItems: 'flex-start',
  gap: 'var(--kp-space-sm)',
  color: 'var(--kp-navy)',
  fontSize: 'var(--kp-font-sm)',
} as const;

const summaryCardStyle = {
  border: '1px solid var(--kp-divider)',
  borderRadius: 'var(--radius-lg)',
  background: 'var(--color-card)',
  overflow: 'hidden',
} as const;

const cardHeaderStyle = {
  minHeight: 44,
  display: 'flex',
  alignItems: 'center',
  justifyContent: 'space-between',
  gap: 'var(--kp-space-sm)',
  padding: '10px 14px',
  borderBottom: '1px solid var(--kp-divider)',
  color: 'var(--kp-navy)',
  fontSize: 'var(--kp-font-sm)',
} as const;

const cardBodyStyle = {
  display: 'flex',
  flexDirection: 'column',
  gap: 'var(--kp-space-lg)',
  padding: 14,
} as const;

const sectionHeadingStyle = {
  margin: '0 0 8px',
  color: 'var(--kp-navy)',
  fontSize: 'var(--kp-font-sm)',
} as const;

const paragraphStyle = {
  margin: 0,
  whiteSpace: 'pre-wrap',
  color: 'var(--kp-navy)',
  fontSize: 'var(--kp-font-sm)',
  lineHeight: 1.6,
} as const;

const listStyle = {
  margin: 0,
  paddingLeft: 22,
  color: 'var(--kp-navy)',
  fontSize: 'var(--kp-font-sm)',
  lineHeight: 1.6,
} as const;
