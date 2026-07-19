import type { TFunction } from 'i18next';
import { meetingDisplayTitle, meetingTypeLabel } from './meetingDisplay';
import type { MeetingMeta } from './meetingStore';
import type { MeetingEntryHostIdentity } from './meetingEntryHostIdentity';
import { detectPlatform } from './noticeCard/meetingPlatform';
import type { NoticeCardPlatform } from './noticeCard/noticeCardTypes';
import type {
  MeetingState,
  SealedMeetingClientBoundary,
} from './foundation/contract';

export interface MeetingCrmNavigationHandoff {
  /** The receiver gets the complete sealed pair, never a raw id or path. */
  readonly openLinkedClient: (
    clientBoundary: SealedMeetingClientBoundary
  ) => void;
}

export type MeetingDetailAudioState =
  | 'available'
  | 'recording-incomplete'
  | 'no-audio';

export interface MeetingDetailHeaderProjection {
  readonly meetingName: string;
  readonly linkedClient: {
    readonly label: string;
    readonly clientBoundary: SealedMeetingClientBoundary;
    /** Present only when a real CRM receiver was supplied. */
    readonly open: (() => void) | null;
  };
  readonly dateTime: {
    readonly startUtc: string;
    readonly endUtc: string | null;
    readonly timezone: string | null;
  } | null;
  /** Derived only from a stored, parseable calendar join URL. */
  readonly platform: Exclude<NoticeCardPlatform, 'none'> | null;
  /** Stored calendar attendees only; the adapter never invents participants. */
  readonly attendees: readonly {
    readonly name: string | null;
    readonly email: string | null;
  }[];
  readonly type: { readonly id: string; readonly label: string } | null;
  readonly state: MeetingState | null;
  readonly audio: { readonly state: MeetingDetailAudioState };
  readonly actions: {
    readonly openLinkedClient: boolean;
    readonly renameMeeting: boolean;
    readonly changeMeetingType: boolean;
    readonly openAudioDetails: true;
  };
}

export interface MeetingDetailHeaderProjectionInput {
  readonly identity: MeetingEntryHostIdentity;
  readonly meta: MeetingMeta | null;
  readonly clientName: string;
  readonly hasAudio: boolean;
  readonly canEditMeeting: boolean;
  readonly crmNavigation?: MeetingCrmNavigationHandoff;
  readonly t: TFunction;
}

function clean(value: string | undefined): string | null {
  const trimmed = value?.trim() ?? '';
  return trimmed || null;
}

/**
 * Project only facts the detail header can support from saved state. Calendar
 * platform/attendees are absent when no exact calendar snapshot exists, and
 * edit/navigation actions are absent when their backing state/receiver is not
 * available.
 */
export function projectMeetingDetailHeader(
  input: MeetingDetailHeaderProjectionInput
): MeetingDetailHeaderProjection {
  const { identity, meta } = input;
  const calendar = meta?.calendarEvent;
  const canonical = identity.canonicalMeeting;
  const startUtc =
    clean(calendar?.startUtc) ??
    clean(canonical?.scheduledStartUtc) ??
    clean(meta?.startedAt);
  const endUtc =
    clean(calendar?.endUtc) ?? clean(canonical?.scheduledEndUtc);
  const timezone = clean(canonical?.timezone);
  const detectedPlatform = calendar?.joinUrl
    ? detectPlatform(calendar.joinUrl)
    : 'none';
  const typeId = clean(meta?.typeId) ?? clean(canonical?.typeId);
  const clientLabel =
    clean(identity.clientBoundary.displayName) ??
    clean(input.clientName) ??
    identity.clientBoundary.householdRef;
  const openLinkedClient = input.crmNavigation?.openLinkedClient;
  const crmOpen = openLinkedClient
    ? () => {
        openLinkedClient(identity.clientBoundary);
      }
    : null;
  const audioState: MeetingDetailAudioState = input.hasAudio
    ? 'available'
    : meta?.recordingError
      ? 'recording-incomplete'
      : 'no-audio';

  return Object.freeze({
    meetingName:
      meta || !typeId
        ? meetingDisplayTitle(meta, input.t)
        : meetingTypeLabel(typeId, input.t),
    linkedClient: Object.freeze({
      label: clientLabel,
      clientBoundary: identity.clientBoundary,
      open: crmOpen,
    }),
    dateTime: startUtc
      ? Object.freeze({
          startUtc,
          endUtc,
          timezone,
        })
      : null,
    platform: detectedPlatform === 'none' ? null : detectedPlatform,
    attendees: Object.freeze(
      (calendar?.attendees ?? []).flatMap((attendee) => {
        const name = clean(attendee.name);
        const email = clean(attendee.email);
        return name || email ? [Object.freeze({ name, email })] : [];
      })
    ),
    type: typeId
      ? Object.freeze({ id: typeId, label: meetingTypeLabel(typeId, input.t) })
      : null,
    state: canonical?.state ?? null,
    audio: Object.freeze({ state: audioState }),
    actions: Object.freeze({
      openLinkedClient: crmOpen !== null,
      renameMeeting: input.canEditMeeting && meta !== null,
      changeMeetingType: input.canEditMeeting && meta !== null,
      openAudioDetails: true as const,
    }),
  });
}
