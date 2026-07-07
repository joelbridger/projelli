import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import type { Matter } from '@/platform/types/matter';
import {
  buildCalendarMatterMap,
  resolveMattersForCalendarEvent,
} from '@/platform/rag/matterResolver';
import { canAutoJoin, type NoticeCardPlatform } from './noticeCard/noticeCardTypes';
import { detectPlatform } from './noticeCard/meetingPlatform';
import type { MeetingCalendarEventMeta } from './meetingStore';
import type { AutoJoinCalendarPrefs } from './autoJoinSettings';

export const AUTO_JOIN_LOOKAHEAD_MS = 24 * 60 * 60 * 1000;
export const AUTO_JOIN_POLL_MS = 30 * 1000;
export const AUTO_JOIN_STOP_WAIT_MS = 5 * 1000;

export type AutoJoinSkipReason =
  | 'calendar-not-opted-in'
  | 'meeting-disabled'
  | 'cancelled'
  | 'declined'
  | 'no-link'
  | 'unsupported-platform'
  | 'unmatched-client'
  | 'ambiguous-client'
  | 'invalid-time'
  | 'ended';

export interface AutoJoinCandidate {
  /** Per-occurrence key. Used for the visible-before-join gate and started-once guard. */
  key: string;
  /** Stable provider+event key. Used for advisor disables so reschedules stay disabled. */
  disabledKey: string;
  event: CalendarEventDto;
  matterId: string;
  joinUrl: string;
  platform: NoticeCardPlatform;
  startMs: number;
  endMs: number;
}

export interface AutoJoinSkippedEvent {
  key: string;
  disabledKey: string;
  event: CalendarEventDto;
  reason: AutoJoinSkipReason;
  platform: NoticeCardPlatform;
}

export interface AutoJoinDiscovery {
  willJoin: AutoJoinCandidate[];
  skipped: AutoJoinSkippedEvent[];
}

export interface AutoJoinAction {
  type: 'start' | 'handoff';
  candidate: AutoJoinCandidate;
}

export function autoJoinEventKey(event: Pick<CalendarEventDto, 'provider' | 'id' | 'startUtc'>): string {
  return `${event.provider}:${event.id}`;
}

export function autoJoinOccurrenceKey(event: Pick<CalendarEventDto, 'provider' | 'id' | 'startUtc'>): string {
  return `${event.provider}:${event.id}:${event.startUtc}`;
}

export function calendarEventSnapshot(event: CalendarEventDto): MeetingCalendarEventMeta {
  return {
    id: event.id,
    title: event.title,
    startUtc: event.startUtc,
    endUtc: event.endUtc,
    ...(event.joinUrl ? { joinUrl: event.joinUrl } : {}),
    attendees: event.attendees.map((a) => ({ email: a.email, name: a.name })),
  };
}

export function discoverAutoJoinMeetings(
  events: CalendarEventDto[],
  matters: Matter[],
  prefs: AutoJoinCalendarPrefs,
  disabledKeys: ReadonlySet<string>,
  nowMs: number,
): AutoJoinDiscovery {
  const map = buildCalendarMatterMap(matters);
  const willJoin: AutoJoinCandidate[] = [];
  const skipped: AutoJoinSkippedEvent[] = [];

  const skip = (event: CalendarEventDto, reason: AutoJoinSkipReason, platform = detectPlatform(event.joinUrl)): void => {
    skipped.push({
      key: autoJoinOccurrenceKey(event),
      disabledKey: autoJoinEventKey(event),
      event,
      reason,
      platform,
    });
  };

  for (const event of events) {
    const key = autoJoinOccurrenceKey(event);
    const disabledKey = autoJoinEventKey(event);
    const platform = detectPlatform(event.joinUrl);
    const startMs = Date.parse(event.startUtc);
    const endMs = Date.parse(event.endUtc);

    if (!Number.isFinite(startMs) || !Number.isFinite(endMs) || endMs <= startMs) {
      skip(event, 'invalid-time', platform);
      continue;
    }
    if (endMs <= nowMs) {
      skip(event, 'ended', platform);
      continue;
    }
    if (prefs[event.provider] !== true) {
      skip(event, 'calendar-not-opted-in', platform);
      continue;
    }
    if (disabledKeys.has(disabledKey)) {
      skip(event, 'meeting-disabled', platform);
      continue;
    }
    if (event.isCancelled) {
      skip(event, 'cancelled', platform);
      continue;
    }
    if (event.selfDeclined) {
      skip(event, 'declined', platform);
      continue;
    }
    if (!event.joinUrl) {
      skip(event, 'no-link', platform);
      continue;
    }
    if (!canAutoJoin(platform)) {
      skip(event, 'unsupported-platform', platform);
      continue;
    }

    const matterIds = resolveMattersForCalendarEvent(event, map);
    if (matterIds.length === 0) {
      skip(event, 'unmatched-client', platform);
      continue;
    }
    if (matterIds.length > 1) {
      skip(event, 'ambiguous-client', platform);
      continue;
    }
    const matterId = matterIds[0];
    if (!matterId) {
      skip(event, 'unmatched-client', platform);
      continue;
    }
    willJoin.push({
      key,
      disabledKey,
      event,
      matterId,
      joinUrl: event.joinUrl,
      platform,
      startMs,
      endMs,
    });
  }

  willJoin.sort((a, b) => a.startMs - b.startMs || a.event.title.localeCompare(b.event.title));
  return { willJoin, skipped };
}

export function nextAutoJoinAction(
  candidates: AutoJoinCandidate[],
  nowMs: number,
  recording: boolean,
  startedKeys: ReadonlySet<string>,
  presentedKeys: ReadonlySet<string> = new Set(),
): AutoJoinAction | null {
  const due = candidates.find(
    (candidate) =>
      candidate.startMs <= nowMs &&
      nowMs < candidate.endMs &&
      !startedKeys.has(candidate.key) &&
      presentedKeys.has(candidate.key),
  );
  if (!due) return null;
  return { type: recording ? 'handoff' : 'start', candidate: due };
}
