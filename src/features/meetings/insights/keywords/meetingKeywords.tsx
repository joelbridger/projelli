import { useEffect, useMemo, useRef, useState } from 'react';
import { isEnabled, useFlag } from '@/platform/flags';
import {
  approvedMeetingArtifactsForClient,
  useMeetingArtifactStore,
  useMeetingFoundationStore,
  useMeetingKeywordCatalogueStore,
  type ApprovedMeetingArtifactReader,
  type CitedMeetingInsight,
  type MeetingArtifactRequirement,
  type MeetingKeywordCatalogueStore,
} from '../../foundation/contract';
import {
  registerMeetingInsight,
  type MeetingInsightDescriptor,
} from '../../meetingInsightRegistry';
import type {
  MeetingInsightClientSummaryContext,
  MeetingInsightMeetingSummaryContext,
} from '../../meetingWorkspaceTypes';

declare module '../../meetingWorkspaceTypes' {
  interface MeetingInsightIdMap {
    meeting_keywords: true;
  }
}

export const MEETING_KEYWORD_ARTIFACT_REQUIREMENTS: readonly MeetingArtifactRequirement[] =
  [
    { kind: 'structured-notes', minimumSchemaVersion: 1 },
    { kind: 'summary', minimumSchemaVersion: 1 },
    { kind: 'transcript', minimumSchemaVersion: 1 },
  ];

const MEETING_KEYWORDS_INSIGHT_ID = 'meeting_keywords' as const;
const MEETING_KEYWORDS_INSIGHT_VERSION = 1;

export interface MeetingKeywordMatch {
  readonly term: string;
  readonly count: number;
  readonly sourceArtifactIds: readonly string[];
}

/** Literal, case-insensitive matching. Terms are never sent anywhere. */
function occurrences(text: string, term: string): number {
  const escaped = term.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const startsWord = /^\w/.test(term);
  const endsWord = /\w$/.test(term);
  const pattern = new RegExp(
    `${startsWord ? '\\b' : ''}${escaped}${endsWord ? '\\b' : ''}`,
    'giu'
  );
  return Array.from(text.matchAll(pattern)).length;
}

function payloadText(
  value: unknown,
  seen = new Set<object>()
): readonly string[] {
  if (typeof value === 'string') return [value];
  if (!value || typeof value !== 'object' || seen.has(value)) return [];
  seen.add(value);
  if (Array.isArray(value))
    return value.flatMap((item) => payloadText(item, seen));
  return Object.values(value).flatMap((item) => payloadText(item, seen));
}

/**
 * Detect configured terms only in the caller's approved, explicitly allowed
 * artifacts. The reader supplies the live client boundary; this function adds
 * no cache, copied client identity, synthetic artifact, or provider call.
 */
export function detectMeetingKeywordMatches(
  reader: ApprovedMeetingArtifactReader,
  meetingId: string,
  householdRef: string,
  terms: readonly string[]
): readonly MeetingKeywordMatch[] {
  if (reader.client.householdRef !== householdRef) return [];
  const artifacts = reader.listApproved(
    meetingId,
    MEETING_KEYWORD_ARTIFACT_REQUIREMENTS.map((item) => item.kind)
  );

  return terms.flatMap((rawTerm) => {
    const term = rawTerm.trim();
    if (!term) return [];
    let count = 0;
    const sourceArtifactIds: string[] = [];
    for (const artifact of artifacts) {
      const matches = payloadText(artifact.payload).reduce(
        (total, text) => total + occurrences(text, term),
        0
      );
      if (matches > 0) {
        count += matches;
        sourceArtifactIds.push(artifact.id);
      }
    }
    return count > 0 ? [{ term, count, sourceArtifactIds }] : [];
  });
}

export function detectCitedMeetingKeywordInsights(
  reader: ApprovedMeetingArtifactReader,
  meetingId: string,
  householdRef: string,
  terms: readonly string[]
): readonly CitedMeetingInsight[] {
  const matches = detectMeetingKeywordMatches(
    reader,
    meetingId,
    householdRef,
    terms
  );
  if (matches.length === 0) return [];
  return [
    {
      descriptorId: MEETING_KEYWORDS_INSIGHT_ID,
      meetingId,
      householdRef,
      summary: `Tracked topics: ${matches
        .map((match) => `${match.term} (${match.count})`)
        .join(', ')}`,
      sourceArtifactIds: [
        ...new Set(matches.flatMap((match) => match.sourceArtifactIds)),
      ],
    },
  ];
}

function MeetingKeywordsInsightCard({
  context,
}: {
  context: MeetingInsightMeetingSummaryContext;
}) {
  const enabled = useFlag('meeting-keywords');
  if (!enabled) return null;
  return <MeetingKeywordsInsightCardEnabled context={context} />;
}

function MeetingKeywordsInsightCardEnabled({
  context,
}: {
  context: MeetingInsightMeetingSummaryContext;
}) {
  const meetings = useMeetingFoundationStore();
  const artifacts = useMeetingArtifactStore();
  const catalogue = useMeetingKeywordCatalogueStore();
  const [terms, setTerms] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void catalogue
      .get()
      .then(setTerms)
      .catch(() => setError('Could not load tracked topics.'));
  }, [catalogue]);

  const insight = useMemo(() => {
    if (!context.canonicalMeeting || !context.clientBoundary || !terms)
      return null;
    const reader = approvedMeetingArtifactsForClient(
      meetings,
      artifacts,
      context.clientBoundary,
      MEETING_KEYWORD_ARTIFACT_REQUIREMENTS
    );
    return (
      detectCitedMeetingKeywordInsights(
        reader,
        context.canonicalMeeting.id,
        context.clientBoundary.householdRef,
        terms
      )[0] ?? null
    );
  }, [
    artifacts,
    context.canonicalMeeting,
    context.clientBoundary,
    meetings,
    terms,
  ]);

  if (error || catalogue.error) {
    return (
      <div data-testid="meeting-keywords-error" style={cardStyle}>
        {error ?? catalogue.error}
      </div>
    );
  }
  if (!context.canonicalMeeting || !context.clientBoundary) return null;
  if (!terms)
    return (
      <div data-testid="meeting-keywords-loading" style={cardStyle}>
        Loading tracked topics…
      </div>
    );
  if (terms.length === 0) {
    return (
      <div data-testid="meeting-keywords-empty" style={cardStyle}>
        No tracked topics yet. Add them in Settings to see them here.
      </div>
    );
  }
  if (!insight)
    return (
      <div data-testid="meeting-keywords-none" style={cardStyle}>
        No tracked topics were found in approved meeting artifacts.
      </div>
    );

  return (
    <section
      data-testid="meeting-keywords-insight"
      style={cardStyle}
      aria-label="Tracked topics"
    >
      <strong>Tracked topics</strong>
      <div style={{ marginTop: 6 }}>
        {insight.summary.replace('Tracked topics: ', '')}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: 'var(--color-muted-foreground)',
        }}
      >
        Approved sources: {insight.sourceArtifactIds.join(', ')}
      </div>
    </section>
  );
}

const cardStyle = {
  marginTop: 12,
  padding: 16,
  border: '1px solid var(--kp-divider-strong)',
  borderRadius: 8,
  background: 'var(--color-card)',
  color: 'var(--color-card-foreground)',
  boxShadow: 'var(--kp-shadow-1)',
} as const;

export const meetingKeywordsInsight: MeetingInsightDescriptor = {
  id: MEETING_KEYWORDS_INSIGHT_ID,
  order: 30,
  version: MEETING_KEYWORDS_INSIGHT_VERSION,
  isAvailable: () => isEnabled('meeting-keywords'),
  mounts: { meetingSummary: true, clientSummary: false },
  prerequisites: MEETING_KEYWORD_ARTIFACT_REQUIREMENTS.map((requirement) => ({
    artifactId: requirement.kind,
    minimumVersion: requirement.minimumSchemaVersion,
  })),
  artifactStore: {
    artifactId: 'meeting-keywords-local-projection',
    version: MEETING_KEYWORDS_INSIGHT_VERSION,
    read: async () => null,
    write: async () => null,
  },
  artifactProducer: {
    artifactId: 'meeting-keywords-local-projection',
    produce: async () => null,
  },
  selectors: { detectMeetingKeywordMatches, detectCitedMeetingKeywordInsights },
  settings: {
    id: 'meeting-keywords-settings',
    labelKey: 'meetings.entry.breadcrumb-meetings',
    mount: () => null,
  },
  renderMeetingSummary: (context) => (
    <MeetingKeywordsInsightCard context={context} />
  ),
  renderClientSummary: (_context: MeetingInsightClientSummaryContext) => null,
};

registerMeetingInsight(meetingKeywordsInsight);

export function MeetingKeywordSettingsPanel({
  useCatalogue = useMeetingKeywordCatalogueStore,
}: {
  useCatalogue?: () => MeetingKeywordCatalogueStore;
}) {
  const enabled = useFlag('meeting-keywords');
  if (!enabled) return null;
  return <MeetingKeywordSettingsPanelEnabled useCatalogue={useCatalogue} />;
}

function MeetingKeywordSettingsPanelEnabled({
  useCatalogue,
}: {
  useCatalogue: () => MeetingKeywordCatalogueStore;
}) {
  const catalogue = useCatalogue();
  const [terms, setTerms] = useState<readonly string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const loaded = useRef(false);

  useEffect(() => {
    if (loaded.current) return;
    loaded.current = true;
    void catalogue
      .get()
      .then(setTerms)
      .catch(() => setError('Could not load tracked topics.'));
  }, [catalogue]);

  const save = async (next: readonly string[]) => {
    setSaving(true);
    setError(null);
    try {
      setTerms(await catalogue.save(next));
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : 'Could not save tracked topics.'
      );
    } finally {
      setSaving(false);
    }
  };
  const add = () => {
    const term = draft.trim();
    if (!term || !terms) return;
    void save([...terms, term]);
    setDraft('');
  };

  return (
    <section
      data-testid="meeting-keywords-settings"
      style={cardStyle}
      aria-label="Tracked meeting topics"
    >
      <strong>Tracked meeting topics</strong>
      <p
        style={{
          margin: '6px 0 12px',
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
        }}
      >
        These terms are matched locally in approved meeting notes, summaries,
        and transcripts.
      </p>
      {terms === null ? (
        <div data-testid="meeting-keywords-settings-loading">
          Loading tracked topics…
        </div>
      ) : (
        <>
          {terms.length === 0 ? (
            <div data-testid="meeting-keywords-settings-empty">
              No topics are being tracked yet.
            </div>
          ) : (
            <ul
              data-testid="meeting-keywords-settings-list"
              style={{ paddingLeft: 20, margin: '0 0 12px' }}
            >
              {terms.map((term) => (
                <li key={term}>
                  {term}{' '}
                  <button
                    type="button"
                    disabled={saving}
                    onClick={() =>
                      void save(terms.filter((item) => item !== term))
                    }
                  >
                    Remove
                  </button>
                </li>
              ))}
            </ul>
          )}
          <label style={{ display: 'flex', gap: 8 }}>
            <span className="sr-only">Tracked topic</span>
            <input
              data-testid="meeting-keywords-settings-input"
              value={draft}
              onChange={(event) => setDraft(event.target.value)}
              placeholder="Add a topic"
              disabled={saving}
            />
            <button
              data-testid="meeting-keywords-settings-add"
              type="button"
              onClick={add}
              disabled={!draft.trim() || saving}
            >
              Add
            </button>
          </label>
        </>
      )}
      {(error ?? catalogue.error) && (
        <div
          data-testid="meeting-keywords-settings-error"
          style={{ marginTop: 8, color: 'var(--color-destructive)' }}
        >
          {error ?? catalogue.error}
        </div>
      )}
    </section>
  );
}
