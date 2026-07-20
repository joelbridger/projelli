/* eslint-disable lantern-i18n/no-hardcoded-string */
/**
 * "Today" strip at the top of Client Map — the morning moment. Data comes
 * from the local encrypted calendar store (calendar_list_events); matching
 * runs here in TS so a taught mapping applies instantly. Renders null when
 * there is nothing today. Matches the approved p1-morning-moment.html
 * prototype: card-per-meeting, a popover assign flow for unmatched
 * meetings ("Whose meeting is this?"), and a confirmation micro-copy card
 * that replaces the unmatched card once taught.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import { Calendar, Clock, HelpCircle, CheckCircle2, X } from 'lucide-react';
import {
  calendarListEvents,
  CALENDAR_SYNC_EVENT,
  type CalendarEventDto,
} from '@/platform/utils/calendar-commands';
import {
  buildCalendarMatterMap,
  matterLabel,
  resolveMattersForCalendarEvent,
} from '@/platform/rag/matterResolver';
import {
  useActiveMatters,
  useMatterStore,
} from '@/platform/matter/matterStore';
import { useMeetingAutoprep, useAutoprepRescan } from './useMeetingAutoprep';
import { useBriefStaleness } from './useBriefStaleness';
import { todayWindowUtc } from './todayWindow';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

function formatTime(utc: string): string {
  return new Date(utc).toLocaleTimeString([], {
    hour: 'numeric',
    minute: '2-digit',
  });
}

/**
 * Plausible client-identifying addresses for an unmatched event, deduped.
 * COORDINATOR FINDING (P1, merge blocker): organizerEmail and the first
 * attendee's email can be the SAME person's two roles (advisor organizes,
 * client attends) OR two DIFFERENT people (client organizes, advisor is
 * the only attendee — resolveMattersForCalendarEvent already handles this
 * asymmetry for matching). When they differ, we genuinely cannot tell which
 * one is the client without asking — teaching the wrong one would silently
 * misfile every future meeting carrying that address. A single candidate
 * (the common case: they're equal, or only one is present) stays teachable
 * with no extra step.
 */
function candidateKeysForEvent(event: CalendarEventDto): string[] {
  const raw = [event.organizerEmail, event.attendees[0]?.email].filter(
    (k): k is string => Boolean(k)
  );
  return Array.from(new Set(raw));
}

interface PendingIdentifierPick {
  eventId: string;
  matterId: string;
  matterName: string;
  candidates: string[];
}

const PROVIDER_LABEL: Record<string, string> = {
  outlook: 'Outlook',
  google: 'Google',
  ics: 'ICS',
};

export function TodaysMeetingsStrip({
  onOpenClient,
}: {
  onOpenClient: (matterId: string) => void;
}) {
  const matters = useActiveMatters();
  const addMeetingKey = useMatterStore((s) => s.addMeetingKey);
  const [events, setEvents] = useState<CalendarEventDto[]>([]);
  // QA-48: a calendarListEvents failure must read as "couldn't check the
  // calendar", never as "genuinely no meetings today" — those are different
  // facts and the advisor needs to know which one happened.
  const [calendarError, setCalendarError] = useState(false);
  const [dismissed, setDismissed] = useState(false);
  const [assigning, setAssigning] = useState<string | null>(null); // event id with popover open
  const [confirmed, setConfirmed] = useState<Record<string, string>>({}); // eventId -> client label
  const [pendingIdentifier, setPendingIdentifier] =
    useState<PendingIdentifierPick | null>(null);
  const popoverRef = useRef<HTMLDivElement | null>(null);

  function teachAndConfirm(
    eventId: string,
    matterId: string,
    matterName: string,
    key: string
  ) {
    addMeetingKey(matterId, key);
    setConfirmed((c) => ({ ...c, [eventId]: matterName }));
    setAssigning(null);
    setPendingIdentifier(null);
  }

  const refresh = useCallback(async () => {
    const { fromUtc, toUtc } = todayWindowUtc();
    try {
      const fetched = await calendarListEvents(fromUtc, toUtc);
      setEvents(fetched);
      setCalendarError(false);
    } catch (err) {
      console.error('[TodaysMeetingsStrip] calendar fetch failed:', err);
      // Keep whatever events we already had — a transient fetch failure must
      // not erase an already-matched Today strip.
      setCalendarError(true);
    }
  }, []);

  useEffect(() => {
    void refresh();
    let stop: (() => void) | undefined;
    void (async () => {
      try {
        const { listen } = await import('@tauri-apps/api/event');
        stop = await listen(CALENDAR_SYNC_EVENT, () => {
          void refresh();
        });
      } catch {
        /* not in Tauri (web/test) */
      }
    })();
    return () => {
      stop?.();
    };
  }, [refresh]);

  useMeetingAutoprep(events, matters);
  useBriefStaleness();
  useAutoprepRescan(matters, () => {
    setCalendarError(true);
  });

  // Close the assign popover on an outside click.
  useEffect(() => {
    if (!assigning) return;
    function onDocClick(e: MouseEvent) {
      if (
        popoverRef.current &&
        !popoverRef.current.contains(e.target as Node)
      ) {
        setAssigning(null);
        setPendingIdentifier(null);
      }
    }
    document.addEventListener('click', onDocClick);
    return () => {
      document.removeEventListener('click', onDocClick);
    };
  }, [assigning]);

  if (dismissed) return null;
  if (events.length === 0 && !calendarError) return null;

  // No events AND the last fetch failed: we genuinely don't know whether
  // there are meetings today, so show a small retryable warning instead of
  // either a false "nothing today" (silent) or a misleading "0 meetings
  // matched" strip.
  if (events.length === 0 && calendarError) {
    return (
      <div
        data-testid="todays-meetings-strip-error"
        className="mb-5 flex items-center gap-2.5 rounded-lg border border-amber-200 bg-amber-50 p-3 text-xs text-amber-800 shadow-sm"
      >
        <Calendar className="h-4 w-4 text-amber-600" aria-hidden="true" />
        <span>Couldn&apos;t check today&apos;s calendar. It might be a connection hiccup.</span>
        <button
          type="button"
          data-testid="today-strip-calendar-retry"
          onClick={() => {
            void refresh();
          }}
          className="ml-auto font-semibold underline"
        >
          Retry
        </button>
        <button
          type="button"
          data-testid="today-strip-dismiss"
          onClick={() => {
            setDismissed(true);
          }}
          className="font-medium text-amber-600 hover:underline"
        >
          Hide for today
        </button>
      </div>
    );
  }

  const map = buildCalendarMatterMap(matters);
  const resolved = events.map((event) => ({
    event,
    matterIds: resolveMattersForCalendarEvent(event, map),
  }));
  const matchedCount = resolved.filter((r) => r.matterIds.length > 0).length;
  const unmatchedCount = resolved.length - matchedCount;
  const metaText =
    unmatchedCount === 0
      ? `${String(matchedCount)} meeting${matchedCount === 1 ? '' : 's'} matched to clients`
      : `${String(matchedCount)} matched · ${String(unmatchedCount)} need${unmatchedCount === 1 ? 's' : ''} a client`;

  return (
    <div
      data-testid="todays-meetings-strip"
      className="mb-5 rounded-lg border border-slate-200 bg-[var(--kp-bg-soft)] p-4 shadow-sm"
    >
      <div className="mb-3 flex items-center gap-2.5">
        <span className="inline-flex items-center gap-2 text-sm font-bold text-[var(--kp-navy)]">
          <Calendar
            className="h-4 w-4 text-[var(--kp-accent)]"
            aria-hidden="true"
          />
          Today
        </span>
        <span className="text-xs text-slate-400">
          {new Date().toLocaleDateString([], {
            weekday: 'long',
            month: 'long',
            day: 'numeric',
          })}
        </span>
        <span className="ml-auto text-xs text-slate-400">{metaText}</span>
        {calendarError && (
          <span
            data-testid="today-strip-calendar-stale-warning"
            className="inline-flex items-center gap-1 text-xs font-medium text-amber-600"
          >
            Calendar refresh failed — showing last known meetings.
            <button
              type="button"
              data-testid="today-strip-calendar-retry"
              onClick={() => {
                void refresh();
              }}
              className="underline"
            >
              Retry
            </button>
          </span>
        )}
        <button
          type="button"
          data-testid="today-strip-dismiss"
          onClick={() => {
            setDismissed(true);
          }}
          title="Hide until tomorrow"
          className="inline-flex items-center gap-1 rounded-md px-1.5 py-1 text-xs font-medium text-slate-400 hover:bg-slate-900/5 hover:text-[var(--kp-navy)]"
        >
          <X className="h-3 w-3" aria-hidden="true" />
          Hide for today
        </button>
      </div>

      <div className="relative flex flex-wrap items-stretch gap-3">
        {resolved.map(({ event, matterIds }) => {
          if (matterIds.length > 0) {
            return matterIds.map((matterId) => {
              const matter = matters.find((m) => m.id === matterId);
              return (
                <button
                  key={`${event.id}:${matterId}`}
                  type="button"
                  data-testid={`meeting-chip-${event.id}`}
                  onClick={() => {
                    onOpenClient(matterId);
                  }}
                  title={`${event.title} (${PROVIDER_LABEL[event.provider] ?? event.provider})`}
                  className="flex min-w-[210px] cursor-pointer flex-col gap-0.5 rounded-lg border border-slate-200 bg-white px-3.5 py-2.5 text-left shadow-sm transition-shadow hover:shadow-md"
                >
                  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[var(--kp-accent)]">
                    <Clock
                      className="h-3 w-3 text-slate-400"
                      aria-hidden="true"
                    />
                    {formatTime(event.startUtc)}
                  </span>
                  <span className="mt-0.5 text-sm font-semibold text-[var(--kp-navy)]">
                    {matter ? matterLabel(matter) : matterId}
                  </span>
                  <span className="text-xs text-slate-400">{event.title}</span>
                </button>
              );
            });
          }

          if (confirmed[event.id]) {
            return (
              <div
                key={event.id}
                className="flex min-w-[280px] max-w-[340px] items-start gap-2 rounded-lg border border-[var(--kp-success-line)] bg-[var(--kp-success-bg)] px-3.5 py-3"
              >
                <CheckCircle2
                  className="mt-0.5 h-4 w-4 shrink-0 text-[var(--kp-success)]"
                  aria-hidden="true"
                />
                <span className="text-xs leading-relaxed text-[#0a5c43]">
                  Got it. Future &ldquo;{event.title}&rdquo; meetings file with{' '}
                  {confirmed[event.id]}.
                </span>
              </div>
            );
          }

          return (
            <div
              key={event.id}
              data-testid={`meeting-chip-${event.id}`}
              className="relative flex min-w-[210px] flex-col gap-0.5 rounded-lg border border-dashed border-slate-300 bg-slate-900/[0.03] px-3.5 py-2.5"
            >
              <span className="text-xs font-bold text-slate-400">
                {formatTime(event.startUtc)}
              </span>
              <span className="mt-0.5 text-sm font-semibold text-slate-400">
                {event.title}
              </span>
              <button
                type="button"
                data-testid={`meeting-assign-${event.id}`}
                onClick={() => {
                  setAssigning(assigning === event.id ? null : event.id);
                }}
                className="mt-1 inline-flex items-center gap-1 text-xs font-semibold text-[var(--kp-accent)]"
              >
                <HelpCircle className="h-3 w-3" aria-hidden="true" />
                Whose meeting is this?
              </button>

              {assigning === event.id &&
                pendingIdentifier?.eventId !== event.id && (
                  <div
                    ref={popoverRef}
                    className="absolute left-0 top-[calc(100%+8px)] z-[1200] w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
                  >
                    <div className="px-3.5 pb-2 pt-3">
                      <div className="text-sm font-bold text-[var(--kp-navy)]">
                        Whose meeting is this?
                      </div>
                      <div className="mt-0.5 text-[11.5px] leading-snug text-slate-400">
                        {brandText(`Pick a client and ${BRAND.name} will file this one, and remember it for next time.`)}
                      </div>
                    </div>
                    <div className="flex flex-col gap-0.5 p-1">
                      {matters.map((m) => (
                        <button
                          key={m.id}
                          type="button"
                          data-testid={`meeting-assign-option-${m.id}`}
                          onClick={() => {
                            const candidates = candidateKeysForEvent(event);
                            const name = matterLabel(m);
                            if (candidates.length > 1) {
                              // COORDINATOR FINDING (P1, merge blocker):
                              // organizer and attendee point to two
                              // DIFFERENT addresses — we cannot safely
                              // guess which one is the client, so ask
                              // instead of silently teaching both (which
                              // could teach the advisor's own address and
                              // misfile every future meeting that carries
                              // it).
                              setPendingIdentifier({
                                eventId: event.id,
                                matterId: m.id,
                                matterName: name,
                                candidates,
                              });
                              return;
                            }
                            const key = candidates[0] ?? event.title;
                            teachAndConfirm(event.id, m.id, name, key);
                          }}
                          className="flex flex-col gap-px rounded-md px-2.5 py-2 text-left hover:bg-[var(--kp-accent-softer)]"
                        >
                          <span className="text-[13px] font-semibold text-[var(--kp-navy)]">
                            {matterLabel(m)}
                          </span>
                        </button>
                      ))}
                    </div>
                    <div className="border-t border-slate-100 p-1">
                      <button
                        type="button"
                        data-testid={`meeting-assign-skip-${event.id}`}
                        onClick={() => {
                          setAssigning(null);
                        }}
                        className="w-full rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-slate-400 hover:bg-[var(--kp-accent-softer)]"
                      >
                        Not a client meeting · skip
                      </button>
                    </div>
                  </div>
                )}

              {pendingIdentifier?.eventId === event.id && (
                <div
                  ref={popoverRef}
                  className="absolute left-0 top-[calc(100%+8px)] z-[1200] w-64 overflow-hidden rounded-lg border border-slate-200 bg-white shadow-lg"
                >
                  <div className="px-3.5 pb-2 pt-3">
                    <div className="text-sm font-bold text-[var(--kp-navy)]">
                      Which one is {pendingIdentifier.matterName}?
                    </div>
                    <div className="mt-0.5 text-[11.5px] leading-snug text-slate-400">
                      This meeting has two different addresses on it. Pick the
                      one that&rsquo;s actually the client, so future meetings
                      file correctly.
                    </div>
                  </div>
                  <div className="flex flex-col gap-0.5 p-1">
                    {pendingIdentifier.candidates.map((email) => (
                      <button
                        key={email}
                        type="button"
                        data-testid={`meeting-assign-identifier-${email}`}
                        onClick={() => {
                          teachAndConfirm(
                            pendingIdentifier.eventId,
                            pendingIdentifier.matterId,
                            pendingIdentifier.matterName,
                            email
                          );
                        }}
                        className="rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-[var(--kp-navy)] hover:bg-[var(--kp-accent-softer)]"
                      >
                        {email}
                      </button>
                    ))}
                  </div>
                  <div className="border-t border-slate-100 p-1">
                    <button
                      type="button"
                      onClick={() => {
                        setPendingIdentifier(null);
                      }}
                      className="w-full rounded-md px-2.5 py-2 text-left text-[13px] font-medium text-slate-400 hover:bg-[var(--kp-accent-softer)]"
                    >
                      Back
                    </button>
                  </div>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
