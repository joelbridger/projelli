/* eslint-disable lantern-i18n/no-hardcoded-string */
/**
 * Collapsible "Before you meet" strip on a client's Map (MatterHub overview
 * panel). Shows today's pre-generated brief with source chips; one keystroke
 * exports it as Word. "It was ready before you asked."
 *
 * Matches the spirit of the approved p2-before-you-meet.html prototype (card
 * look, "Export brief (Word)" copy, a save confirmation) but keeps the
 * plan's simpler data shape — one markdown blob + a flat citation-chip row,
 * not per-bullet citations. Per-bullet citation binding (each brief point
 * carrying its own individually-verifiable source, as the prototype shows)
 * would need the model to emit structured, chunk-tagged output — a bigger
 * lift than this wave's headless generation call — and was explicitly
 * flagged to the coordinator as a Wave 2+ follow-up rather than built here.
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

function basename(path: string): string {
  return path.split(/[\\/]/).pop() ?? path;
}

export function BeforeYouMeetStrip({ matterId }: { matterId: string }) {
  const briefs = useBriefStore((s) => s.briefs);
  const [collapsed, setCollapsed] = useState(false);
  const [busy, setBusy] = useState(false);
  const [savedKey, setSavedKey] = useState<string | null>(null);

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

  async function refresh(brief: MeetingBrief) {
    const { fromUtc, toUtc } = todayWindowUtc();
    const events = await calendarListEvents(fromUtc, toUtc).catch(() => []);
    const event = events.find((e) => e.id === brief.eventId);
    if (event) {
      useBriefStore
        .getState()
        .upsert({ ...brief, stale: true, status: 'pending' });
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
                    data-testid="brief-refresh"
                    onClick={() => {
                      void refresh(brief);
                    }}
                    className="inline-flex items-center gap-1 rounded-md border border-slate-200 bg-white px-2.5 py-1 text-xs text-[var(--kp-navy)] hover:bg-slate-50"
                  >
                    <RefreshCw size={13} />
                    Refresh
                  </button>
                  {savedKey === brief.key && (
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
