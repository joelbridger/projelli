import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, ChevronDown, ChevronRight, Video, XCircle } from 'lucide-react';
import { calendarListEvents, CALENDAR_SYNC_EVENT } from '@/platform/utils/calendar-commands';
import { useActiveMatters } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { useSelectionOperationDecision } from '@/platform/client-context';
import { Badge, Button, Card } from '@/ui/kp';
import {
  AUTO_JOIN_LOOKAHEAD_MS,
  discoverAutoJoinMeetings,
  type AutoJoinCandidate,
} from './meetingAutoJoin';
import {
  setAutoJoinEventDisabled,
  markAutoJoinOccurrencesPresented,
  useAutoJoinCalendarPrefs,
  useDisabledAutoJoinEventKeys,
} from './autoJoinSettings';
import {
  useActiveMeetingClientBoundary,
} from './foundation/contract';
import {
  filterAutoJoinCandidatesForManagement,
  type AutoJoinManagementScope,
} from './autoJoinManagementScope';

const AUTOMATIONS_SELECTION_REQUEST = {
  operationClass: 'matter-scoped',
  allowAllMatters: true,
  requireFollowerAgreement: true,
} as const;

const PROVIDER_LABEL: Record<string, string> = {
  outlook: 'Outlook',
  google: 'Google',
  ics: 'ICS',
};

function formatStart(utc: string): string {
  return new Date(utc).toLocaleString([], {
    weekday: 'short',
    hour: 'numeric',
    minute: '2-digit',
  });
}

export function AutoJoinMeetingsPanel() {
  const { t } = useTranslation();
  const matters = useActiveMatters();
  const selection = useSelectionOperationDecision(
    AUTOMATIONS_SELECTION_REQUEST
  );
  const activeClient = useActiveMeetingClientBoundary();
  const activeClientRef = useRef(activeClient);
  const activeClientKey = activeClient
    ? `${activeClient.householdRef}\u0000${activeClient.matterId}`
    : '';
  const previousClient = activeClientRef.current;
  if (
    (previousClient
      ? `${previousClient.householdRef}\u0000${previousClient.matterId}`
      : '') !== activeClientKey
  ) {
    activeClientRef.current = activeClient;
  }
  const stableActiveClient = activeClientRef.current;
  const prefs = useAutoJoinCalendarPrefs();
  const disabledKeys = useDisabledAutoJoinEventKeys();
  const [willJoin, setWillJoin] = useState<AutoJoinCandidate[]>([]);
  const [error, setError] = useState(false);
  const [loading, setLoading] = useState(true);
  const [expanded, setExpanded] = useState(false);
  const refreshRequestRef = useRef(0);
  const mountedRef = useRef(true);
  const scopeKeyRef = useRef('');

  const scope = useMemo<AutoJoinManagementScope | null>(() => {
    if (selection.kind === 'all-matters') return { kind: 'firm-wide' };
    if (
      selection.kind !== 'matter' ||
      selection.sourceKind !== 'matter' ||
      !selection.client ||
      !stableActiveClient ||
      selection.matter.id !== stableActiveClient.matterId ||
      selection.client.householdId !== stableActiveClient.householdRef
    ) {
      return null;
    }
    return { kind: 'selected-client', client: stableActiveClient };
  }, [selection, stableActiveClient]);
  const scopeKey = scope?.kind === 'selected-client'
    ? `selected\u0000${scope.client.householdRef}\u0000${scope.client.matterId}`
    : scope?.kind ?? 'refused';
  scopeKeyRef.current = scopeKey;

  const refresh = useCallback(async (showLoading = false) => {
    const requestId = ++refreshRequestRef.current;
    const requestedScopeKey = scopeKey;
    const isCurrentRequest = () =>
      mountedRef.current &&
      requestId === refreshRequestRef.current &&
      requestedScopeKey === scopeKeyRef.current;
    if (showLoading) setLoading(true);
    if (!scope) {
      setWillJoin([]);
      setError(false);
      setLoading(false);
      return;
    }
    const nowMs = Date.now();
    try {
      const events = await calendarListEvents(
        new Date(nowMs).toISOString(),
        new Date(nowMs + AUTO_JOIN_LOOKAHEAD_MS).toISOString(),
      );
      const discovery = discoverAutoJoinMeetings(events, matters, prefs, disabledKeys, nowMs);
      if (!isCurrentRequest()) return;
      setWillJoin(
        filterAutoJoinCandidatesForManagement(
          discovery.willJoin,
          matters,
          scope
        )
      );
      setError(false);
    } catch {
      if (!isCurrentRequest()) return;
      setWillJoin([]);
      setError(true);
    } finally {
      if (isCurrentRequest()) setLoading(false);
    }
  }, [disabledKeys, matters, prefs, scope, scopeKey]);

  useEffect(() => {
    markAutoJoinOccurrencesPresented(willJoin.map((candidate) => candidate.key));
  }, [willJoin]);

  useEffect(() => {
    mountedRef.current = true;
    void refresh(true).catch(() => {
      setError(true);
      setLoading(false);
    });
    const timer = window.setInterval(() => {
      void refresh().catch(() => {
        setError(true);
        setLoading(false);
      });
    }, 60 * 1000);
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        stop = await listen(CALENDAR_SYNC_EVENT, () => {
          void refresh().catch(() => {
            setError(true);
            setLoading(false);
          });
        });
      } catch (err) {
        console.debug('[AutoJoinMeetingsPanel] calendar sync listener unavailable', err);
      }
    })().catch((err: unknown) => {
      console.debug('[AutoJoinMeetingsPanel] calendar sync listener setup failed', err);
    });
    return () => {
      mountedRef.current = false;
      refreshRequestRef.current += 1;
      window.clearInterval(timer);
      stop?.();
    };
  }, [refresh]);

  return (
    <Card
      variant="raised"
      data-testid="meeting-auto-join-panel"
      style={{ marginTop: 'var(--kp-space-md)' }}
    >
      {/* Slim strip by default (item 25): a one-line summary + chevron; the
          rows and Don't join controls appear only once expanded. */}
      <button
        type="button"
        data-testid="meeting-auto-join-toggle"
        aria-expanded={expanded}
        onClick={() => { setExpanded((open) => !open); }}
        style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-sm)', width: '100%', border: 'none', background: 'transparent', padding: 0, cursor: willJoin.length > 0 ? 'pointer' : 'default', fontFamily: 'inherit', textAlign: 'left' }}
        disabled={willJoin.length === 0}
      >
        <CalendarClock aria-hidden="true" style={{ width: 18, height: 18, color: 'var(--kp-accent)', flex: 'none' }} />
        <div
          data-testid={loading ? 'meeting-auto-join-loading' : undefined}
          style={{ flex: 1, minWidth: 0, fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}
        >
          {loading
            ? t('meetings.auto-join.loading')
            : willJoin.length > 0
            ? t('meetings.auto-join.summary', { count: willJoin.length })
            : t('meetings.auto-join.heading')}
        </div>
        {willJoin.length > 0 && (
          expanded
            ? <ChevronDown aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--color-muted-foreground)', flex: 'none' }} />
            : <ChevronRight aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--color-muted-foreground)', flex: 'none' }} />
        )}
      </button>

      {!loading && !scope && (
        <div
          data-testid="meeting-auto-join-scope-error"
          role="alert"
          style={{ marginTop: 'var(--kp-space-sm)', fontSize: 'var(--kp-font-xs)', color: 'var(--color-danger)' }}
        >
          {t('meetings.auto-join.scope-error')}
        </div>
      )}

      {!loading && error && (
        <div data-testid="meeting-auto-join-error" style={{ marginTop: 'var(--kp-space-sm)', fontSize: 'var(--kp-font-xs)', color: 'var(--color-danger)' }}>
          {t('meetings.auto-join.error')}
          <div style={{ marginTop: 'var(--kp-space-xs)' }}>
            <Button
              size="sm"
              variant="secondary"
              data-testid="meeting-auto-join-retry"
              onClick={() => {
                void refresh(true).catch(() => {
                  setError(true);
                  setLoading(false);
                });
              }}
            >
              {t('meetings.auto-join.retry')}
            </Button>
          </div>
        </div>
      )}

      {!loading && scope && !error && willJoin.length === 0 && (
        <div
          data-testid="meeting-auto-join-empty"
          role="status"
          style={{ marginTop: 'var(--kp-space-sm)', fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}
        >
          {t(
            scope.kind === 'firm-wide'
              ? 'meetings.auto-join.empty-firm'
              : 'meetings.auto-join.empty-client'
          )}
        </div>
      )}

      {expanded && willJoin.length > 0 && (
        <div style={{ marginTop: 'var(--kp-space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-xs)' }}>
          <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
            {t('meetings.auto-join.body')}
          </div>
          {willJoin.map((candidate) => {
            const matter = matters.find((m) => m.id === candidate.matterId);
            return (
              <div
                key={candidate.key}
                data-testid="meeting-auto-join-row"
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--kp-space-sm)',
                  padding: 'var(--kp-space-sm)',
                  border: '1px solid var(--color-border)',
                  borderRadius: 8,
                  background: 'var(--color-background)',
                }}
              >
                <Video aria-hidden="true" style={{ width: 16, height: 16, color: 'var(--kp-accent)', flex: 'none' }} />
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    {candidate.event.title}
                  </div>
                  <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', marginTop: 2 }}>
                    {formatStart(candidate.event.startUtc)}
                    {scope?.kind === 'firm-wide'
                      ? ` · ${matter ? matterLabel(matter) : t('meetings.auto-join.client-hidden')}`
                      : ''}
                    {' · '}{PROVIDER_LABEL[candidate.event.provider] ?? candidate.event.provider}
                  </div>
                </div>
                <Badge variant="success" size="sm">{candidate.platform}</Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={XCircle}
                  data-testid="meeting-auto-join-disable"
                  onClick={() => {
                    setAutoJoinEventDisabled(candidate.disabledKey, true);
                  }}
                >
                  {t('meetings.auto-join.disable')}
                </Button>
              </div>
            );
          })}
        </div>
      )}
    </Card>
  );
}
