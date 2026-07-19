/* eslint-disable lantern-i18n/no-hardcoded-string, react-refresh/only-export-components -- The composition lane owns this frozen Prep copy and its pure projector; translation extraction follows the meetings UI unification wave. */
import { useMemo } from 'react';
import { AlertTriangle, ExternalLink, FileText, RefreshCw } from 'lucide-react';
import { Badge, Button, Callout, Card } from '@/ui/kp';
import {
  selectExactMeetingBrief,
  useBriefStore,
  type ExactMeetingBriefTarget,
  type MeetingBrief,
} from './briefStore';
import {
  projectMeetingSurface,
  type MeetingSurfaceFacts,
  type MeetingSurfaceRow,
} from './foundation/contract';

export interface MeetingPrepHandoffs {
  /** Opens the exact linked meeting URL. Omit when no real handoff exists. */
  readonly join?: () => void;
  /** Opens the existing consent-first recording flow. Omit when unavailable. */
  readonly record?: () => void;
  /** Opens one exact cited source in the existing workspace navigation flow. */
  readonly openSource?: (path: string) => void;
  /** Requeues this exact event. Omit when the event cannot be loaded exactly. */
  readonly retry?: () => void;
}

export interface MeetingPrepPanelProps {
  readonly target: ExactMeetingBriefTarget | null;
  /** F8 owner facts. This component projects them; it never guesses readiness. */
  readonly surfaceFacts: readonly MeetingSurfaceFacts[];
  readonly nowUtc?: string;
  readonly handoffs?: MeetingPrepHandoffs;
}

export interface MeetingPrepSections {
  readonly recentChanges: string;
  readonly priorDecisions: string;
  readonly openItems: string;
  readonly personalAndPortfolio: string;
}

const EMPTY_SECTION = 'No matching detail was included in this brief.';

function cleanMarkdown(value: string): string {
  return value
    .replace(/^>\s?/gm, '')
    .replace(/^#{1,6}\s+/gm, '')
    .replace(/^[-*]\s+/gm, '• ')
    .replace(/^\d+\.\s+/gm, '• ')
    .replace(/\*\*/g, '')
    .replace(/^---+$/gm, '')
    .trim();
}

function section(markdown: string, heading: RegExp): string {
  const lines = markdown.split(/\r?\n/);
  const start = lines.findIndex((line) => heading.test(line.trim()));
  if (start < 0) return EMPTY_SECTION;
  const selected: string[] = [];
  for (let index = start + 1; index < lines.length; index += 1) {
    const line = lines[index] ?? '';
    if (/^#{2,3}\s+/.test(line.trim())) break;
    selected.push(line);
  }
  return cleanMarkdown(selected.join('\n')) || EMPTY_SECTION;
}

/** Project existing generated work; no second model run or forked generator. */
export function projectMeetingPrepSections(markdown: string): MeetingPrepSections {
  return {
    recentChanges: section(markdown, /^###\s+Current Concerns and Life Events\s*$/i),
    priorDecisions: section(markdown, /^###\s+Last Meeting Recap\s*$/i),
    openItems: section(markdown, /^##\s+Suggested Talking Points\s*$/i),
    personalAndPortfolio: section(markdown, /^###\s+Client Snapshot\s*$/i),
  };
}

function exactRow(
  target: ExactMeetingBriefTarget | null,
  facts: readonly MeetingSurfaceFacts[],
  nowUtc: string
): MeetingSurfaceRow | null {
  if (!target) return null;
  const result = projectMeetingSurface(
    {
      kind: 'selected-client',
      client: target.clientBoundary,
      meetings: [target.meeting],
    },
    facts,
    nowUtc
  );
  if (result.kind !== 'ready') return null;
  return [...result.upcoming, ...result.past].find(
    (row) => row.id === target.meeting.id
  ) ?? null;
}

function sourcePaths(brief: MeetingBrief): readonly string[] {
  return [...new Set([
    ...brief.citations.map((citation) => citation.path),
    ...(brief.bullets ?? []).map((bullet) => bullet.sourcePath),
  ].filter((path) => path.trim().length > 0))];
}

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

function Readiness({ row, handoffs }: {
  row: MeetingSurfaceRow | null;
  handoffs: MeetingPrepHandoffs | undefined;
}) {
  const join = handoffs?.join;
  const record = handoffs?.record;
  const canJoin = row?.joinReadiness === 'available' && !!join;
  const canRecord = row?.recordingStatus === 'not-recorded' && !!record;
  return (
    <Card data-testid="meeting-prep-readiness" variant="flat" className="grid gap-3 p-3 sm:grid-cols-2">
      <div>
        <strong className="text-sm text-[var(--kp-navy)]">Join</strong>
        <p className="mb-2 mt-1 text-xs text-[var(--color-muted-foreground)]">
          {canJoin ? 'Exact linked meeting ready.' : 'No proven join handoff is available.'}
        </p>
        {canJoin ? <Button size="sm" iconRight={ExternalLink} onClick={join} data-testid="meeting-prep-join">Join meeting</Button> : null}
      </div>
      <div>
        <strong className="text-sm text-[var(--kp-navy)]">Record</strong>
        <p className="mb-2 mt-1 text-xs text-[var(--color-muted-foreground)]">
          {row?.recordingStatus === 'recording'
            ? 'Recording is in progress.'
            : row?.recordingStatus === 'available'
              ? 'A recording is already available.'
              : canRecord
                ? 'Consent-first recording is ready.'
                : 'No proven recording handoff is available.'}
        </p>
        {canRecord ? <Button size="sm" variant="secondary" onClick={record} data-testid="meeting-prep-record">Review consent and record</Button> : null}
      </div>
    </Card>
  );
}

export function MeetingPrepPanel({
  target,
  surfaceFacts,
  nowUtc = new Date().toISOString(),
  handoffs,
}: MeetingPrepPanelProps) {
  const briefs = useBriefStore((state) => state.briefs);
  const brief = useMemo(
    () => selectExactMeetingBrief(briefs, target),
    [briefs, target]
  );
  const row = useMemo(
    () => exactRow(target, surfaceFacts, nowUtc),
    [target, surfaceFacts, nowUtc]
  );
  if (!target) {
    return <div data-testid="meeting-prep-empty"><Callout variant="info">This meeting does not have an exact canonical event and client link yet.</Callout></div>;
  }
  if (!brief) {
    return <div data-testid="meeting-prep-empty"><Callout variant="info">No brief is linked to this exact meeting and client.</Callout></div>;
  }
  if (brief.status === 'pending' || brief.status === 'generating') {
    return <div data-testid="meeting-prep-loading" role="status" className="flex items-center gap-2 text-sm text-[var(--color-muted-foreground)]"><RefreshCw className="h-4 w-4 animate-spin" aria-hidden="true" />Preparing this meeting brief from linked sources.</div>;
  }
  if (brief.status === 'failed') {
    return (
      <div data-testid="meeting-prep-error">
        <Callout variant="error" icon={AlertTriangle}>
          <strong>Meeting prep could not load.</strong>
          <p className="mb-2 mt-1">{brief.error?.trim() || 'The brief generator did not return a result.'}</p>
          {handoffs?.retry ? <Button size="sm" variant="secondary" onClick={handoffs.retry}>Try again</Button> : null}
        </Callout>
      </div>
    );
  }

  const sections = projectMeetingPrepSections(brief.markdown);
  const sources = sourcePaths(brief);
  const cards = [
    ['Recent changes', sections.recentChanges],
    ['Prior decisions', sections.priorDecisions],
    ['Open items', sections.openItems],
    ['Personal and portfolio context', sections.personalAndPortfolio],
  ] as const;

  return (
    <div data-testid="meeting-prep-panel" className="grid gap-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="m-0 text-xs font-semibold uppercase tracking-wide text-[var(--color-muted-foreground)]">Meeting prep</p>
          <h2 className="mb-1 mt-1 text-lg font-bold text-[var(--kp-navy)]">{brief.eventTitle}</h2>
          <p className="m-0 text-xs text-[var(--color-muted-foreground)]">Generated from {sources.length} {sources.length === 1 ? 'source' : 'sources'}.</p>
        </div>
        <Badge variant="success" data-testid="meeting-prep-client-match">Exact client match</Badge>
      </header>

      {brief.stale ? <Callout variant="warning">New client information may have arrived since this brief was prepared.</Callout> : null}
      <Readiness row={row} handoffs={handoffs} />

      <div className="grid gap-3 md:grid-cols-2">
        {cards.map(([title, content]) => (
          <Card key={title} data-testid={`meeting-prep-section-${title.toLowerCase().replaceAll(' ', '-')}`}>
            <h3 className="m-0 text-sm font-bold text-[var(--kp-navy)]">{title}</h3>
            <p className="mb-0 mt-2 whitespace-pre-line text-sm leading-6 text-[var(--kp-navy)]">{content}</p>
          </Card>
        ))}
      </div>

      <Card data-testid="meeting-prep-sources">
        <h3 className="m-0 text-sm font-bold text-[var(--kp-navy)]">Sources ({sources.length})</h3>
        {sources.length === 0 ? (
          <p className="mb-0 mt-2 text-sm text-[var(--color-muted-foreground)]">No source citations were attached to this brief.</p>
        ) : (
          <div className="mt-2 flex flex-wrap gap-2">
            {sources.map((path) => (
              <div key={path}>
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={FileText}
                  onClick={() => {
                    handoffs?.openSource?.(path);
                  }}
                  disabled={!handoffs?.openSource}
                  title={path}
                  data-testid="meeting-prep-source"
                >
                  {basename(path)}
                </Button>
              </div>
            ))}
          </div>
        )}
      </Card>
    </div>
  );
}
