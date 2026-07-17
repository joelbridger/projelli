import { useEffect, useRef, useState, type FormEvent } from 'react';
import { useTranslation } from 'react-i18next';
import type { CalendarEventStore, CalendarOccurrence } from '@/features/calendar';
import { Dialog, DialogContent, DialogDescription, DialogHeader, DialogTitle } from '@/ui/dialog';

export interface CalendarEventSheetProps {
  readonly calendar: CalendarEventStore;
  readonly occurrence?: CalendarOccurrence;
  readonly defaultStartUtc: string;
  readonly defaultEndUtc: string;
  readonly onClose: () => void;
  readonly onSaved: () => void;
}

interface EventDraftState {
  title: string;
  start: string;
  end: string;
  notes: string;
}

function inputUtc(value: string): string {
  return value.slice(0, 16);
}

function utcFromInput(value: string): string {
  return new Date(`${value}:00.000Z`).toISOString();
}

/**
 * A calm heading still orients an advisor when imported data has no usable
 * title. Long names are deliberately shortened here only; the saved title is
 * never changed by this presentation fallback.
 */
// eslint-disable-next-line react-refresh/only-export-components -- the shared sheet contract exposes this pure title fallback.
export function eventSheetHeading(title: string | undefined, fallback: string): string {
  const clean = title?.trim() ?? '';
  if (!clean) return fallback;
  return clean.length > 72 ? `${clean.slice(0, 69).trimEnd()}…` : clean;
}

function initialDraft(occurrence: CalendarOccurrence | undefined, startUtc: string, endUtc: string): EventDraftState {
  return {
    title: occurrence?.title ?? '',
    start: inputUtc(occurrence?.startUtc ?? startUtc),
    end: inputUtc(occurrence?.endUtc ?? endUtc),
    notes: '',
  };
}

/**
 * The shared internal Event Sheet. Calendar surfaces pass their source
 * defaults into it; record and list entry points can reuse this exact layer.
 */
export function CalendarEventSheet({
  calendar,
  occurrence,
  defaultStartUtc,
  defaultEndUtc,
  onClose,
  onSaved,
}: CalendarEventSheetProps) {
  const { t } = useTranslation();
  const [draft, setDraft] = useState(() => initialDraft(occurrence, defaultStartUtc, defaultEndUtc));
  const [validationError, setValidationError] = useState<string | null>(null);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const titleRef = useRef<HTMLInputElement>(null);
  const isEdit = occurrence !== undefined;

  useEffect(() => {
    window.setTimeout(() => titleRef.current?.focus(), 0);
  }, []);

  const update = (next: Partial<EventDraftState>) => {
    setDraft((current) => ({ ...current, ...next }));
    setValidationError(null);
    setSaveError(null);
  };

  const submit = (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    if (!draft.title.trim()) {
      setValidationError(t('calendar-grid.editor.title-required'));
      titleRef.current?.focus();
      return;
    }
    const startMs = Date.parse(`${draft.start}:00.000Z`);
    const endMs = Date.parse(`${draft.end}:00.000Z`);
    if (!draft.start || !draft.end || !Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      setValidationError(t('calendar-grid.editor.end-after-start'));
      return;
    }

    const startUtc = utcFromInput(draft.start);
    const endUtc = utcFromInput(draft.end);
    setSaving(true);
    setSaveError(null);
    const save = isEdit
      ? calendar.update(occurrence.sourceEventId, { title: draft.title.trim(), startUtc, endUtc, notes: draft.notes || null })
      : calendar.create({
        title: draft.title.trim(),
        startUtc,
        endUtc,
        displayTimezone: 'UTC',
        allDay: false,
        calendarId: 'calendar:local',
      });
    void save.then(() => {
      onSaved();
      onClose();
    }).catch((reason: unknown) => {
      setSaveError(reason instanceof Error ? reason.message : t('calendar-grid.editor.save-error'));
    }).finally(() => { setSaving(false); });
  };

  const contextLabel = occurrence?.contextRef?.label ?? t('calendar-grid.editor.not-linked');
  const heading = isEdit
    ? eventSheetHeading(occurrence.title, t('calendar-grid.editor.untitled'))
    : t('calendar-grid.editor.new-title');

  return <Dialog open onOpenChange={(open) => { if (!open && !saving) onClose(); }}>
    <DialogContent
      data-testid="calendar-event-sheet"
      className="w-[min(520px,calc(100vw-32px))] max-w-none gap-4 rounded-lg border-[var(--kp-divider)] bg-[var(--kp-surface)] p-[22px] shadow-[var(--kp-shadow-3)]"
    >
      <DialogHeader>
        <DialogTitle data-testid="calendar-event-sheet-heading" className="pr-8 text-[length:var(--kp-font-lg)] font-semibold text-[var(--kp-navy)]">
          {heading}
        </DialogTitle>
        <DialogDescription className="text-[length:var(--kp-font-sm)] text-[var(--kp-text-faint)]">
          {t('calendar-grid.editor.local-status')}
        </DialogDescription>
      </DialogHeader>
      <form className="grid gap-3" onSubmit={submit}>
        <label className="grid gap-1 text-[length:var(--kp-font-xs)] font-semibold text-[var(--kp-navy)]" htmlFor="calendar-event-title">
          {t('calendar-grid.editor.title-label')}
          <input
            ref={titleRef}
            id="calendar-event-title"
            data-testid="calendar-event-title"
            className="h-8 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-surface)] px-[11px] py-2 text-[length:var(--kp-font-sm)] font-normal text-[var(--kp-navy)]"
            value={draft.title}
            placeholder={t('calendar-grid.editor.title-placeholder')}
            aria-describedby={validationError ? 'calendar-event-validation' : undefined}
            onChange={(item) => { update({ title: item.target.value }); }}
          />
        </label>
        <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
          <label className="grid gap-1 text-[length:var(--kp-font-xs)] font-semibold text-[var(--kp-navy)]" htmlFor="calendar-event-start">
            {t('calendar-grid.editor.start-label')}
            <input id="calendar-event-start" data-testid="calendar-event-start" type="datetime-local" className="h-8 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-surface)] px-[11px] py-2 text-[length:var(--kp-font-sm)] font-normal text-[var(--kp-navy)]" value={draft.start} onChange={(item) => { update({ start: item.target.value }); }} />
          </label>
          <label className="grid gap-1 text-[length:var(--kp-font-xs)] font-semibold text-[var(--kp-navy)]" htmlFor="calendar-event-end">
            {t('calendar-grid.editor.end-label')}
            <input id="calendar-event-end" data-testid="calendar-event-end" type="datetime-local" className="h-8 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-surface)] px-[11px] py-2 text-[length:var(--kp-font-sm)] font-normal text-[var(--kp-navy)]" value={draft.end} onChange={(item) => { update({ end: item.target.value }); }} />
          </label>
        </div>
        {validationError ? <p id="calendar-event-validation" role="alert" data-testid="calendar-event-validation" className="m-0 flex gap-2 rounded-md border border-[var(--kp-danger)] bg-[var(--kp-danger-bg)] px-3 py-2 text-[length:var(--kp-font-xs)] text-[var(--kp-navy)]">
          <span aria-hidden>!</span>{validationError}
        </p> : null}
        <label className="grid gap-1 text-[length:var(--kp-font-xs)] font-semibold text-[var(--kp-navy)]" htmlFor="calendar-event-context">
          {t('calendar-grid.editor.context-label')}
          <input id="calendar-event-context" data-testid="calendar-event-context" readOnly value={contextLabel} className="h-8 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-[11px] py-2 text-[length:var(--kp-font-sm)] font-normal text-[var(--kp-text-dim)]" />
        </label>
        <details className="rounded-lg border border-[var(--kp-divider)] px-3 py-2 text-[length:var(--kp-font-sm)] text-[var(--kp-text-dim)]">
          <summary className="cursor-pointer font-semibold text-[var(--kp-navy)]">{t('calendar-grid.editor.more-options')}</summary>
          <label className="mt-3 grid gap-1 text-[length:var(--kp-font-xs)] font-semibold text-[var(--kp-navy)]" htmlFor="calendar-event-notes">
            {t('calendar-grid.editor.notes-label')}
            <textarea id="calendar-event-notes" data-testid="calendar-event-notes" value={draft.notes} className="min-h-20 rounded-lg border border-[var(--kp-divider)] bg-[var(--kp-surface)] px-[11px] py-2 text-[length:var(--kp-font-sm)] font-normal text-[var(--kp-navy)]" onChange={(item) => { update({ notes: item.target.value }); }} />
          </label>
        </details>
        <div className="flex flex-wrap items-center justify-between gap-3 border-t border-[var(--kp-divider)] pt-3">
          <span data-testid="calendar-event-status" className="rounded-full border border-[var(--kp-divider)] bg-[var(--kp-bg-soft)] px-2 py-1 text-[length:var(--kp-font-xs)] text-[var(--kp-text-dim)]">{t('calendar-grid.editor.local-status')}</span>
          <div className="flex gap-2">
            <button type="button" className="kp-btn kp-btn--secondary kp-btn--sm" disabled={saving} onClick={onClose}>{t('calendar-grid.editor.cancel')}</button>
            <button type="submit" data-testid="calendar-event-save" className="kp-btn kp-btn--primary kp-btn--sm" disabled={saving}>{saving ? t('calendar-grid.editor.saving') : t('calendar-grid.editor.save')}</button>
          </div>
        </div>
        {saveError ? <p role="alert" data-testid="calendar-event-save-error" className="m-0 flex gap-2 rounded-md border border-[var(--kp-danger)] bg-[var(--kp-danger-bg)] px-3 py-2 text-[length:var(--kp-font-xs)] text-[var(--kp-navy)]"><span aria-hidden>!</span>{saveError}</p> : null}
      </form>
    </DialogContent>
  </Dialog>;
}
