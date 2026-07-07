import { useCallback, useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarClock, Video, XCircle } from 'lucide-react';
import { calendarListEvents, CALENDAR_SYNC_EVENT } from '@/platform/utils/calendar-commands';
import { useActiveMatters } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { Badge, Button, Card } from '@/ui/kp';
import {
  AUTO_JOIN_LOOKAHEAD_MS,
  discoverAutoJoinMeetings,
  type AutoJoinCandidate,
} from './meetingAutoJoin';
import {
  setAutoJoinEventDisabled,
  useAutoJoinCalendarPrefs,
  useDisabledAutoJoinEventKeys,
} from './autoJoinSettings';

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
  const prefs = useAutoJoinCalendarPrefs();
  const disabledKeys = useDisabledAutoJoinEventKeys();
  const [willJoin, setWillJoin] = useState<AutoJoinCandidate[]>([]);
  const [error, setError] = useState(false);

  const refresh = useCallback(async () => {
    const nowMs = Date.now();
    try {
      const events = await calendarListEvents(
        new Date(nowMs).toISOString(),
        new Date(nowMs + AUTO_JOIN_LOOKAHEAD_MS).toISOString(),
      );
      const discovery = discoverAutoJoinMeetings(events, matters, prefs, disabledKeys, nowMs);
      setWillJoin(discovery.willJoin);
      setError(false);
    } catch {
      setError(true);
    }
  }, [disabledKeys, matters, prefs]);

  useEffect(() => {
    void refresh().catch(() => {
      setError(true);
    });
    const timer = window.setInterval(() => {
      void refresh().catch(() => {
        setError(true);
      });
    }, 60 * 1000);
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        stop = await listen(CALENDAR_SYNC_EVENT, () => {
          void refresh().catch(() => {
            setError(true);
          });
        });
      } catch (err) {
        console.debug('[AutoJoinMeetingsPanel] calendar sync listener unavailable', err);
      }
    })().catch((err: unknown) => {
      console.debug('[AutoJoinMeetingsPanel] calendar sync listener setup failed', err);
    });
    return () => {
      window.clearInterval(timer);
      stop?.();
    };
  }, [refresh]);

  if (willJoin.length === 0 && !error) return null;

  return (
    <Card variant="raised" data-testid="meeting-auto-join-panel" style={{ marginTop: 'var(--kp-space-md)' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-sm)' }}>
        <CalendarClock aria-hidden="true" style={{ width: 18, height: 18, color: 'var(--kp-accent)' }} />
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
            {t('meetings.auto-join.heading')}
          </div>
          <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', marginTop: 2 }}>
            {t('meetings.auto-join.body')}
          </div>
        </div>
        <Badge variant="neutral" size="sm">{String(willJoin.length)}</Badge>
      </div>

      {error && (
        <div data-testid="meeting-auto-join-error" style={{ marginTop: 'var(--kp-space-sm)', fontSize: 'var(--kp-font-xs)', color: 'var(--color-danger)' }}>
          {t('meetings.auto-join.error')}
        </div>
      )}

      {willJoin.length > 0 && (
        <div style={{ marginTop: 'var(--kp-space-md)', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-xs)' }}>
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
                    {formatStart(candidate.event.startUtc)} · {matter ? matterLabel(matter) : candidate.matterId} · {PROVIDER_LABEL[candidate.event.provider] ?? candidate.event.provider}
                  </div>
                </div>
                <Badge variant="success" size="sm">{candidate.platform}</Badge>
                <Button
                  size="sm"
                  variant="secondary"
                  iconLeft={XCircle}
                  data-testid="meeting-auto-join-disable"
                  onClick={() => {
                    setAutoJoinEventDisabled(candidate.key, true);
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
