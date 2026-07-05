/* eslint-disable lantern-i18n/no-hardcoded-string */
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
import {
  ChevronDown,
  ChevronUp,
  FileType,
  RefreshCw,
  CheckCircle2,
} from 'lucide-react';
import { localDay, useBriefStore, type MeetingBrief } from './briefStore';
import { enqueueBriefs } from './briefQueue';
import { calendarListEvents } from '@/platform/utils/calendar-commands';
import { todayWindowUtc } from './todayWindow';
import { agendaMarkdownFromBrief } from './agendaExport';
import { useMatterStore } from '@/platform/matter/matterStore';
import { matterLabel } from '@/platform/rag/matterResolver';
import { CiteChip } from '@/ui/kp/CiteChip';
import { FileText } from 'lucide-react';

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function BeforeYouMeetStrip({ matterId }: { matterId: string }) {
  const briefs = useBriefStore((s) => s.briefs);
  const matter = useMatterStore((s) =>
    s.matters.find((m) => m.id === matterId)
  );
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);
  const [savedAgendaKey, setSavedAgendaKey] = useState<string | null>(null);

  const today = localDay();
  const todays: MeetingBrief[] = Object.values(briefs)
    .filter((b) => b.matterId === matterId && b.day === today)
    .sort((a, b) => a.eventId.localeCompare(b.eventId));

  if (todays.length === 0) return null;

  async function exportDocx(brief: MeetingBrief) {
    setBusy(true);
    try {
      const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
      const { saveFile } = await import('@/platform/utils/saveFile');
      const firmName = (() => {
        try {
          return localStorage.getItem('keepance_firm_name') ?? '';
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
    if (event) {
      // COORDINATOR FINDING (P2): enqueueBriefs() skips any job whose
      // EXISTING store status is already 'pending'/'generating' — setting
      // status: 'pending' here BEFORE calling it made that skip-check trip
      // on our own write, so the brief froze on "Preparing your briefing…"
      // forever with nothing ever re-queued. Only mark it stale (status
      // stays 'ready', so neither of enqueueBriefs' skip conditions fire);
      // enqueueBriefs' own internal upsert transitions it through pending
      // -> generating -> ready once the job actually runs.
      useBriefStore.getState().upsert({ ...brief, stale: true });
      enqueueBriefs([{ matterId, event }]);
    }
  }

  return (
    <div
      data-testid="before-you-meet"
      className="mb-[var(--kp-surface-gap)] rounded-lg border border-slate-200 bg-[var(--kp-bg-soft)] px-3.5 py-2.5 shadow-sm"
    >
      <div className="flex items-center gap-2">
        <span className="text-sm font-bold text-[var(--kp-navy)]">
          Before you meet
        </span>
        <button
          type="button"
          data-testid="brief-collapse-toggle"
          onClick={() => {
            setCollapsed((v) => !v);
          }}
          className="flex cursor-pointer items-center border-none bg-transparent"
          aria-label="Toggle briefing"
        >
          {collapsed ? <ChevronDown size={16} /> : <ChevronUp size={16} />}
        </button>
      </div>
      {!collapsed &&
        todays.map((brief) => (
          <div key={brief.key} className="mt-2">
            {brief.status === 'ready' && (
              <>
                {brief.stale && (
                  <span
                    data-testid="brief-stale-chip"
                    className="mb-1.5 inline-block rounded-full bg-amber-100 px-2 py-px text-[11px] text-amber-800"
                  >
                    New documents arrived since this was written
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
                  <button
                    type="button"
                    data-testid="brief-export-docx"
                    onClick={() => {
                      void exportDocx(brief);
                    }}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-[var(--kp-navy)] hover:bg-slate-50 disabled:opacity-60"
                  >
                    <FileType size={13} />
                    Export brief (Word)
                  </button>
                  <button
                    type="button"
                    data-testid="agenda-export-docx"
                    onClick={() => {
                      void exportAgenda(brief);
                    }}
                    disabled={busy}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-[var(--kp-navy)] hover:bg-slate-50 disabled:opacity-60"
                  >
                    <FileType size={13} />
                    Agenda (Word)
                  </button>
                  <button
                    type="button"
                    data-testid="brief-refresh"
                    onClick={() => {
                      void refresh(brief);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-[var(--kp-navy)] hover:bg-slate-50"
                  >
                    <RefreshCw size={13} />
                    Refresh
                  </button>
                  {(savedKey === brief.key || savedAgendaKey === brief.key) && (
                    <span className="inline-flex items-center gap-1 text-xs font-semibold text-[var(--kp-success)]">
                      <CheckCircle2 size={14} />
                      Saved
                    </span>
                  )}
                </div>
              </>
            )}
            {(brief.status === 'pending' || brief.status === 'generating') && (
              <p className="text-xs text-slate-500">Preparing your briefing…</p>
            )}
            {brief.status === 'failed' && (
              <p className="text-xs text-red-700">
                {`Could not prepare this briefing: ${brief.error ?? 'unknown error'}`}
              </p>
            )}
          </div>
        ))}
    </div>
  );
}
