import { useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { isEnabled } from '@/platform/flags';
import {
  approvedMeetingArtifactsForClient,
  useMeetingArtifactStore,
  useMeetingFoundationStore,
  useMeetingKeywordCatalogueStore,
  type ApprovedMeetingArtifactReader,
  type CitedMeetingInsight,
  type MeetingArtifactRequirement,
  type MeetingArtifactKind,
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
import { Button } from '@/ui/kp';

declare module '../../meetingWorkspaceTypes' {
  interface MeetingInsightIdMap {
    meeting_keywords: true;
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- This is the public local insight contract consumed outside React.
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
// eslint-disable-next-line react-refresh/only-export-components -- This local detector is the public non-React insight contract.
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

// eslint-disable-next-line react-refresh/only-export-components -- This local detector is the public non-React insight contract.
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
        .map((match) => `${match.term} (${String(match.count)})`)
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
  if (!isEnabled('meeting-keywords')) return null;
  return <MeetingKeywordsInsightCardEnabled context={context} />;
}

function MeetingKeywordsInsightCardEnabled({
  context,
}: {
  context: MeetingInsightMeetingSummaryContext;
}) {
  const { t } = useTranslation();
  const meetings = useMeetingFoundationStore();
  const artifacts = useMeetingArtifactStore();
  const catalogue = useMeetingKeywordCatalogueStore();
  const [terms, setTerms] = useState<readonly string[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadKey, setReloadKey] = useState(0);
  const catalogueRef = useRef(catalogue);

  useEffect(() => {
    catalogueRef.current = catalogue;
  }, [catalogue]);

  useEffect(() => {
    let active = true;
    void catalogueRef.current
      .get()
      .then((next) => {
        if (active) setTerms(next);
      })
      .catch(() => {
        if (active) setError(t('meeting-keywords.errors.load'));
      });
    return () => {
      active = false;
    };
  }, [reloadKey, t]);

  const retryLoad = () => {
    setError(null);
    setTerms(null);
    setReloadKey((value) => value + 1);
  };

  const matchResults = useMemo(() => {
    if (!context.canonicalMeeting || !context.clientBoundary || !terms)
      return null;
    const reader = approvedMeetingArtifactsForClient(
      meetings,
      artifacts,
      context.clientBoundary,
      MEETING_KEYWORD_ARTIFACT_REQUIREMENTS
    );
    const matches = detectMeetingKeywordMatches(
      reader,
      context.canonicalMeeting.id,
      context.clientBoundary.householdRef,
      terms
    );
    return {
      matches,
      sourceKinds: [
        ...new Set(
          matches.flatMap((match) =>
            match.sourceArtifactIds.flatMap((id) => {
              const artifact = reader.get(id);
              return artifact ? [artifact.kind] : [];
            })
          )
        ),
      ],
    };
  }, [
    artifacts,
    context.canonicalMeeting,
    context.clientBoundary,
    meetings,
    terms,
  ]);

  if (error || catalogue.error) {
    return (
      <div
        data-testid="meeting-keywords-error"
        role="alert"
        style={quietStateStyle}
      >
        <span>{error ?? catalogue.error}</span>
        <Button
          data-testid="meeting-keywords-retry"
          onClick={() => {
            retryLoad();
          }}
          size="sm"
          variant="secondary"
        >
          {t('meeting-keywords.retry')}
        </Button>
      </div>
    );
  }
  if (!context.canonicalMeeting || !context.clientBoundary) return null;
  if (!terms)
    return (
      <div
        data-testid="meeting-keywords-loading"
        role="status"
        style={quietStateStyle}
      >
        {t('meeting-keywords.loading')}
      </div>
    );
  if (terms.length === 0) {
    return (
      <div
        data-testid="meeting-keywords-empty"
        role="status"
        style={quietStateStyle}
      >
        {t('meeting-keywords.insight-empty')}
      </div>
    );
  }
  if (!matchResults || matchResults.matches.length === 0)
    return (
      <div
        data-testid="meeting-keywords-none"
        role="status"
        style={quietStateStyle}
      >
        {t('meeting-keywords.insight-none')}
      </div>
    );

  const headingId = 'meeting-keywords-insight-heading';
  return (
    <section
      data-testid="meeting-keywords-insight"
      style={cardStyle}
      aria-labelledby={headingId}
    >
      <h3 id={headingId} style={headingStyle}>
        {t('meeting-keywords.title')}
      </h3>
      <div style={{ marginTop: 6 }}>
        {matchResults.matches.map((match) => (
          <div key={match.term}>
            {match.term} ·{' '}
            {t('meeting-keywords.mentions', { count: match.count })}
          </div>
        ))}
      </div>
      <div
        style={{
          marginTop: 8,
          fontSize: 12,
          color: 'var(--color-muted-foreground)',
        }}
      >
        <span>{t('meeting-keywords.approved-sources')}</span>
        <span
          aria-label={t('meeting-keywords.approved-sources')}
          role="list"
          style={sourceListStyle}
        >
          {matchResults.sourceKinds.map((kind) => (
            <span key={kind} role="listitem">
              <button
                aria-label={t('meeting-keywords.source-preview-unavailable', {
                  source: sourceLabel(t, kind),
                })}
                className="kp-chip kp-chip--sm"
                disabled
                type="button"
              >
                {sourceLabel(t, kind)}
              </button>
            </span>
          ))}
        </span>
        <div style={{ marginTop: 6 }}>
          {t('meeting-keywords.source-preview-pending')}
        </div>
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

const quietStateStyle = {
  ...cardStyle,
  alignItems: 'center',
  background: 'var(--color-muted)',
  borderStyle: 'dashed',
  color: 'var(--color-muted-foreground)',
  display: 'flex',
  flexDirection: 'column',
  fontSize: 13,
  gap: 12,
  boxShadow: 'none',
  padding: 26,
  textAlign: 'center',
} as const;

const headingStyle = { margin: 0, fontSize: 14 } as const;

const sourceListStyle = {
  display: 'inline-flex',
  flexWrap: 'wrap',
  gap: 6,
  marginLeft: 6,
} as const;

function sourceLabel(t: (key: string) => string, kind: MeetingArtifactKind) {
  switch (kind) {
    case 'structured-notes':
      return t('meeting-keywords.sources.notes');
    case 'summary':
      return t('meeting-keywords.sources.summary');
    case 'transcript':
      return t('meeting-keywords.sources.transcript');
    default:
      return t('meeting-keywords.sources.meeting-record');
  }
}

// eslint-disable-next-line react-refresh/only-export-components -- The registered descriptor intentionally composes this React surface.
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
    read: () => Promise.resolve(null),
    write: () => Promise.resolve(null),
  },
  artifactProducer: {
    artifactId: 'meeting-keywords-local-projection',
    produce: () => Promise.resolve(null),
  },
  selectors: { detectMeetingKeywordMatches, detectCitedMeetingKeywordInsights },
  settings: {
    id: 'meeting-keywords-settings',
    labelKey: 'meeting-keywords.title',
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
  if (!isEnabled('meeting-keywords')) return null;
  return <MeetingKeywordSettingsPanelEnabled useCatalogue={useCatalogue} />;
}

function MeetingKeywordSettingsPanelEnabled({
  useCatalogue,
}: {
  useCatalogue: () => MeetingKeywordCatalogueStore;
}) {
  const { t } = useTranslation();
  const catalogue = useCatalogue();
  const [terms, setTerms] = useState<readonly string[] | null>(null);
  const [draft, setDraft] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [reloadKey, setReloadKey] = useState(0);
  const [retryTerms, setRetryTerms] = useState<readonly string[] | null>(null);
  const catalogueRef = useRef(catalogue);

  useEffect(() => {
    catalogueRef.current = catalogue;
  }, [catalogue]);

  useEffect(() => {
    let active = true;
    void catalogueRef.current
      .get()
      .then((next) => {
        if (active) setTerms(next);
      })
      .catch(() => {
        if (active) setError(t('meeting-keywords.errors.load'));
      });
    return () => {
      active = false;
    };
  }, [reloadKey, t]);

  const retryLoad = () => {
    setError(null);
    setTerms(null);
    setRetryTerms(null);
    setReloadKey((value) => value + 1);
  };

  const save = async (next: readonly string[]) => {
    setSaving(true);
    setError(null);
    setRetryTerms(next);
    try {
      setTerms(await catalogue.save(next));
      setRetryTerms(null);
    } catch (reason) {
      setError(
        reason instanceof Error
          ? reason.message
          : t('meeting-keywords.errors.save')
      );
    } finally {
      setSaving(false);
    }
  };
  const add = () => {
    const term = draft.trim();
    if (!term || !terms) return;
    startSave([...terms, term]);
    setDraft('');
  };
  const startSave = (next: readonly string[]) => {
    void save(next).catch(() => {
      setError(t('meeting-keywords.errors.save'));
    });
  };

  const currentError = error ?? catalogue.error;
  const headingId = 'meeting-keywords-settings-heading';

  return (
    <section
      data-testid="meeting-keywords-settings"
      style={cardStyle}
      aria-busy={saving || undefined}
      aria-labelledby={headingId}
    >
      <h2 id={headingId} style={headingStyle}>
        {t('meeting-keywords.settings-title')}
      </h2>
      <p
        style={{
          margin: '6px 0 12px',
          fontSize: 13,
          color: 'var(--color-muted-foreground)',
        }}
      >
        {t('meeting-keywords.settings-description')}
      </p>
      {currentError ? (
        <div
          data-testid="meeting-keywords-settings-error"
          role="alert"
          style={quietStateStyle}
        >
          <span>{currentError}</span>
          <Button
            data-testid="meeting-keywords-settings-retry"
            disabled={saving}
            onClick={() => {
              if (retryTerms) {
                startSave(retryTerms);
                return;
              }
              retryLoad();
            }}
            size="sm"
            variant="secondary"
          >
            {t('meeting-keywords.retry')}
          </Button>
        </div>
      ) : terms === null ? (
        <div
          data-testid="meeting-keywords-settings-loading"
          role="status"
          style={quietStateStyle}
        >
          {t('meeting-keywords.loading')}
        </div>
      ) : (
        <>
          {terms.length === 0 ? (
            <div
              data-testid="meeting-keywords-settings-empty"
              role="status"
              style={quietStateStyle}
            >
              {t('meeting-keywords.settings-empty')}
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
                    aria-label={t('meeting-keywords.remove-topic', {
                      topic: term,
                    })}
                    type="button"
                    disabled={saving}
                    onClick={() => {
                      startSave(terms.filter((item) => item !== term));
                    }}
                  >
                    {t('meeting-keywords.remove')}
                  </button>
                </li>
              ))}
            </ul>
          )}
          <form
            onSubmit={(event) => {
              event.preventDefault();
              add();
            }}
            style={{ display: 'flex', flexDirection: 'column', gap: 6 }}
          >
            <label htmlFor="meeting-keywords-settings-input">
              {t('meeting-keywords.input-label')}
            </label>
            <div style={{ display: 'flex', gap: 8 }}>
              <input
                data-testid="meeting-keywords-settings-input"
                disabled={saving}
                id="meeting-keywords-settings-input"
                onChange={(event) => {
                  setDraft(event.target.value);
                }}
                placeholder={t('meeting-keywords.input-placeholder')}
                value={draft}
              />
              <button
                data-testid="meeting-keywords-settings-add"
                disabled={!draft.trim() || saving}
                type="submit"
              >
                {t('meeting-keywords.add')}
              </button>
            </div>
          </form>
        </>
      )}
    </section>
  );
}
