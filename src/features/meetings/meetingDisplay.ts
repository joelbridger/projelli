/**
 * Advisor-facing display helpers for meetings. Meeting folders on disk are
 * machine-named (`<date>-<matter-slug>`, or `<date>-dictated-<epoch>` for
 * filed dictations) — those names must never be shown as titles. The
 * human title comes from what we actually know about the meeting
 * (type > calendar title > dictated), falling back to a plain "Meeting";
 * the date/duration always render as a separate meta line.
 */
import type { TFunction } from 'i18next';
import type { MeetingMeta } from './meetingStore';
import { BUILT_IN_TYPES, type BuiltInMeetingType } from './meetingTypes';

export function isBuiltInType(id: string): id is BuiltInMeetingType {
  return (BUILT_IN_TYPES as readonly string[]).includes(id);
}

export function meetingTypeLabel(typeId: string, t: (k: string) => string): string {
  return isBuiltInType(typeId) ? t(`meetings.types.${typeId}`) : typeId;
}

/** The human title for a meeting — never the raw folder name. */
export function meetingDisplayTitle(
  meta: MeetingMeta | null,
  t: (k: string) => string
): string {
  if (meta?.typeId) return meetingTypeLabel(meta.typeId, t);
  if (meta?.calendarTitle) return meta.calendarTitle;
  if (meta?.dictation) return t('meetings.entry.dictated-title');
  return t('meetings.entry.generic-title');
}

/** "Jun 30, 2026" from an ISO timestamp; '' when absent/invalid. */
export function formatMeetingDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  });
}

/** "41 min" (minimum "1 min") from a duration in ms; null when unknown. */
export function formatMeetingDuration(
  durationMs: number | undefined,
  t: TFunction
): string | null {
  if (!durationMs || durationMs <= 0) return null;
  return t('meetings.tab.duration', {
    minutes: Math.max(1, Math.round(durationMs / 60000)),
  });
}
