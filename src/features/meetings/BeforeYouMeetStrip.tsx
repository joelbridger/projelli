/**
 * Collapsible "Before you meet" strip on a client's Map (MatterHub overview
 * panel). Shows today's pre-generated brief with source chips; one keystroke
 * exports it as Word. "It was ready before you asked."
 *
 * Matches the approved p2-before-you-meet.html prototype: each bullet
 * carries its own citation chip with a hover popover showing the exact
 * quoted line (generateBrief.ts's per-bullet `bullets`, each grounded in a
 * real retrieved excerpt — never a model-authored quote). Falls back to the
 * older one-markdown-blob + flat-citation-row rendering when `bullets` is
 * empty (bullet generation degraded, or the brief was persisted before this
 * field existed).
 */

import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ChevronDown,
  ChevronUp,
  FileType,
  RefreshCw,
  CheckCircle2,
  MoreVertical,
} from 'lucide-react';
import {
  isValidMeetingBrief,
  localDay,
  useBriefStore,
  type MeetingBrief,
} from './briefStore';
import { enqueueBriefs } from './briefQueue';
import { useActiveMeetingClientBoundary } from './foundation/contract';
import { calendarListEvents } from '@/platform/utils/calendar-commands';
import { todayWindowUtc } from './todayWindow';
import { agendaMarkdownFromBrief } from './agendaExport';
import { useMatterStore } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { CiteChip } from '@/ui/kp/CiteChip';
import { FileText } from 'lucide-react';
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuTrigger,
} from '@/ui/dropdown-menu';

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function BeforeYouMeetStrip({ matterId }: { matterId: string }) {
  const { t } = useTranslation();
  const briefs = useBriefStore((s) => s.briefs);
  const matter = useMatterStore((s) =>
    s.matters.find((m) => m.id === matterId)
  );
  const activeClientBoundary = useActiveMeetingClientBoundary();
  const [collapsed, setCollapsed] = useState(true);
  const [busy, setBusy] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [savedAgendaKey, setSavedAgendaKey] = useState<string | null>(null);

  const today = localDay();
  const todays: MeetingBrief[] = Object.values(briefs)
    .filter((b) => {
      if (
        !activeClientBoundary ||
        activeClientBoundary.matterId !== matterId ||
        !isValidMeetingBrief(b) ||
        b.householdRef !== activeClientBoundary.householdRef ||
        b.matterId !== activeClientBoundary.matterId
      )
        return false;
      if (b.day === today) return true;
      return matter?.isSample === true && b.isSample === true;
    })
    .sort((a, b) => a.eventId.localeCompare(b.eventId));

  if (todays.length === 0) return null;
  const firstBrief = todays[0];
  const summary =
    todays.length === 1 && firstBrief
      ? firstBrief.eventTitle
      : t('meetings.before-you-meet.count', { count: todays.length });

  async function exportDocx(brief: MeetingBrief) {
    setBusy(true);
    try {
      const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
      const { saveFile } = await import('@/platform/utils/saveFile');
      const firmName = (() => {
        try {
          return localStorage.getItem('lantern_firm_name') ?? '';
        } catch {
          return '';
        }
      })();
      const suggestedName = `Meeting-Brief-${brief.day}.docx`;
      const bytes = await markdownToDocxBytes(brief.markdown, suggestedName, {
        firmName,
      });
      await saveFile(bytes, {
        suggestedName,
        types: [
          {
            description: 'Word Documents',
            accept: {
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                ['.docx'],
            },
          },
        ],
      });
      setSavedKey(brief.key);
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Failed to export brief as .docx:', error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function exportAgenda(brief: MeetingBrief) {
    setBusy(true);
    try {
      const clientLabel = matter ? matterLabel(matter) : matterId;
      const md = await agendaMarkdownFromBrief(brief, {
        clientLabel,
        eventTitle: brief.eventTitle,
        matterId,
      });
      const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
      const { saveFile } = await import('@/platform/utils/saveFile');
      const suggestedName = `Agenda - ${clientLabel}.docx`;
      const bytes = await markdownToDocxBytes(md, suggestedName, {});
      await saveFile(bytes, {
        suggestedName,
        types: [
          {
            description: 'Word Documents',
            accept: {
              'application/vnd.openxmlformats-officedocument.wordprocessingml.document':
                ['.docx'],
            },
          },
        ],
      });
      setSavedAgendaKey(brief.key);
    } catch (error) {
      if (error instanceof Error && error.name !== 'AbortError') {
        console.error('Failed to export agenda as .docx:', error);
      }
    } finally {
      setBusy(false);
    }
  }

  async function refresh(brief: MeetingBrief) {
    const { fromUtc, toUtc } = todayWindowUtc();
    const events = await calendarListEvents(fromUtc, toUtc).catch(() => []);
    const event = events.find((e) => e.id === brief.eventId);
    if (
      event &&
      activeClientBoundary &&
      brief.householdRef === activeClientBoundary.householdRef &&
      brief.matterId === activeClientBoundary.matterId
    ) {
      // COORDINATOR FINDING (P2): enqueueBriefs() skips any job whose
      // EXISTING store status is already 'pending'/'generating' — setting
      // status: 'pending' here BEFORE calling it made that skip-check trip
      // on our own write, so the brief froze on "Preparing your briefing…"
      // forever with nothing ever re-queued. Only mark it stale (status
      // stays 'ready', so neither of enqueueBriefs' skip conditions fire);
      // enqueueBriefs' own internal upsert transitions it through pending
      // -> generating -> ready once the job actually runs.
      useBriefStore.getState().markStale({
        clientBoundary: activeClientBoundary,
        eventId: brief.eventId,
        day: brief.day,
      });
      enqueueBriefs([{ clientBoundary: activeClientBoundary, event }]);
    }
  }

  return (
    <div
      data-testid="before-you-meet"
      className="mb-[var(--kp-surface-gap)] rounded-md border border-slate-200 bg-white px-3.5 py-2.5"
    >
      <button
        type="button"
        data-testid="brief-collapse-toggle"
        onClick={() => {
          setCollapsed((v) => !v);
        }}
        className="flex w-full cursor-pointer items-center gap-2 border-none bg-transparent p-0 text-left"
        aria-expanded={!collapsed}
        aria-label={t('meetings.before-you-meet.toggle')}
      >
        <span className="text-sm font-bold text-[var(--kp-navy)]">
          {t('meetings.before-you-meet.title')}
        </span>
        <span className="min-w-0 flex-1 truncate text-xs text-slate-500">
          {summary}
        </span>
        {collapsed ? (
          <ChevronDown size={16} aria-hidden />
        ) : (
          <ChevronUp size={16} aria-hidden />
        )}
      </button>
      {!collapsed &&
        todays.map((brief) => (
          <div key={brief.key} className="mt-2">
            {brief.status === 'ready' && (
              <>
                <div className="mb-1.5 flex items-center gap-2">
                  <span className="min-w-0 flex-1 truncate text-xs font-semibold text-[var(--kp-navy)]">
                    {brief.eventTitle}
                  </span>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <button
                        type="button"
                        data-testid="brief-actions-menu"
                        aria-label={t('meetings.before-you-meet.actions')}
                        className="kp-icon-btn kp-icon-btn--ghost kp-icon-btn--xs"
                      >
                        <MoreVertical
                          size={14}
                          strokeWidth={1.75}
                          aria-hidden
                        />
                      </button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="end" className="w-36">
                      <DropdownMenuItem
                        data-testid="brief-export-docx"
                        disabled={busy}
                        onSelect={() => {
                          void exportDocx(brief);
                        }}
                      >
                        <FileType size={13} aria-hidden />
                        {t('meetings.before-you-meet.brief')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid="agenda-export-docx"
                        disabled={busy}
                        onSelect={() => {
                          void exportAgenda(brief);
                        }}
                      >
                        <FileType size={13} aria-hidden />
                        {t('meetings.before-you-meet.agenda')}
                      </DropdownMenuItem>
                      <DropdownMenuItem
                        data-testid="brief-refresh"
                        onSelect={() => {
                          void refresh(brief);
                        }}
                      >
                        <RefreshCw size={13} aria-hidden />
                        {t('meetings.before-you-meet.refresh')}
                      </DropdownMenuItem>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </div>
                {brief.stale && (
                  <span
                    data-testid="brief-stale-chip"
                    className="mb-1.5 inline-block rounded-full bg-amber-100 px-2 py-px text-[11px] text-amber-800"
                  >
                    {t('meetings.before-you-meet.new-files')}
                  </span>
                )}
                {brief.bullets != null && brief.bullets.length > 0 ? (
                  <div data-testid="brief-bullets" className="flex flex-col">
                    {brief.bullets.map((b) => (
                      <div
                        key={b.id}
                        className="flex items-start gap-2.5 border-t border-slate-100 py-2 first:border-t-0 first:pt-0"
                      >
                        <span className="mt-[7px] h-1.5 w-1.5 flex-none rounded-full bg-slate-400" />
                        <div className="min-w-0">
                          <div className="text-[13.5px] leading-snug text-[var(--kp-navy)]">
                            {b.text}
                          </div>
                          <div className="mt-1">
                            <CiteChip
                              docLabel={basename(b.sourcePath)}
                              quote={b.quote}
                              icon={<FileText size={11} strokeWidth={1.75} />}
                              popoverPosition="above"
                            >
                              {basename(b.sourcePath)}
                            </CiteChip>
                          </div>
                        </div>
                      </div>
                    ))}
                  </div>
                ) : (
                  <>
                    <div className="whitespace-pre-wrap text-[13px] text-[var(--kp-navy)]">
                      {brief.markdown}
                    </div>
                    <div className="mt-2 flex flex-wrap gap-1.5">
                      {brief.citations.map((c) => (
                        <span
                          key={c.path}
                          title={c.path}
                          className="rounded-full border border-slate-200 bg-white px-2 py-px text-[11px] text-slate-500"
                        >
                          {basename(c.path)}
                        </span>
                      ))}
                    </div>
                  </>
                )}
                <div className="mt-2 flex items-center gap-2">
                  {(savedKey === brief.key || savedAgendaKey === brief.key) && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--kp-success)]">
                      <CheckCircle2 size={14} />
                      {t('meetings.before-you-meet.saved')}
                    </span>
                  )}
                </div>
              </>
            )}
            {(brief.status === 'pending' || brief.status === 'generating') && (
              <p className="text-xs text-slate-500">
                {t('meetings.before-you-meet.preparing')}
              </p>
            )}
            {brief.status === 'failed' && (
              <p className="text-xs text-red-700">
                {t('meetings.before-you-meet.failed', {
                  error:
                    brief.error ?? t('meetings.before-you-meet.unknown-error'),
                })}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}
