/* eslint-disable react-refresh/only-export-components -- This compatibility module intentionally exports the registered descriptor for composition proofs. */
import { useEffect } from 'react';
import {
  BLESSED_MEETING_PANEL_IDS,
  detectPlatform,
  enqueueBriefs,
  MeetingPrepPanel,
  registerMeetingPanel,
  useMeetingStore,
  type ExactMeetingBriefTarget,
  type MeetingPanelContext,
  type MeetingPanelDescriptor,
  type MeetingRecordingStatus,
  type MeetingSurfaceFacts,
} from '@/features/meetings';
import { EV_MATTER_LAUNCH } from '@/config/identity';

// The closed manifest is the sole source of this id. This binding never
// repeats or casts a locally invented "prep" id.
const PREP_PANEL_ID = BLESSED_MEETING_PANEL_IDS[0];

function recordingStatusFor(
  context: MeetingPanelContext,
  active: { readonly recording: boolean; readonly meetingDir: string | null }
): MeetingRecordingStatus {
  if (active.recording && active.meetingDir === context.meetingDir)
    return 'recording';
  if (context.hasAudio) return 'available';
  if (context.meta?.recordingError) return 'unavailable';
  return context.meta ? 'not-recorded' : 'unavailable';
}

function BoundMeetingPrepPanel({ context }: { context: MeetingPanelContext }) {
  const recording = useMeetingStore((state) => state.status.recording);
  const activeMeetingDir = useMeetingStore((state) => state.status.meetingDir);
  const eventId = context.meta?.calendarEvent?.id.trim() ?? '';
  const target: ExactMeetingBriefTarget | null =
    context.canonicalMeeting && context.clientBoundary && eventId
      ? {
          eventId,
          meeting: context.canonicalMeeting,
          clientBoundary: context.clientBoundary,
        }
      : null;
  const joinUrl = context.meta?.calendarEvent?.joinUrl?.trim() ?? '';
  const detectedPlatform = detectPlatform(joinUrl);
  const platform =
    detectedPlatform === 'meet'
      ? 'google-meet'
      : detectedPlatform === 'none'
        ? 'unknown'
        : detectedPlatform;
  const surfaceFacts: readonly MeetingSurfaceFacts[] = target
    ? [
        {
          meetingId: target.meeting.id,
          householdRef: target.clientBoundary.householdRef,
          matterId: target.clientBoundary.matterId,
          title: context.meta?.calendarEvent?.title ?? target.meeting.typeId,
          ...(joinUrl ? { joinUrl, platform } : {}),
          recordingStatus: recordingStatusFor(context, {
            recording,
            meetingDir: activeMeetingDir,
          }),
        },
      ]
    : [];

  useEffect(() => {
    const snapshot = context.meta?.calendarEvent;
    if (!target || !snapshot) return;
    const event = {
      ...snapshot,
      provider: 'ics' as const,
      organizerEmail: '',
    };
    enqueueBriefs([
      {
        clientBoundary: target.clientBoundary,
        event,
      },
    ]);
  }, [context.meta?.calendarEvent, target]);

  return (
    <MeetingPrepPanel
      target={target}
      surfaceFacts={surfaceFacts}
      handoffs={{
        ...(joinUrl && platform !== 'unknown'
          ? {
              join: () => {
                window.open(joinUrl, '_blank', 'noopener,noreferrer');
              },
            }
          : {}),
        openSource: (path) => {
          if (!target) return;
          window.dispatchEvent(
            new CustomEvent(EV_MATTER_LAUNCH, {
              detail: {
                matterId: target.clientBoundary.matterId,
                surface: 'files',
                source: { kind: 'document', ref: path },
              },
            })
          );
        },
      }}
    />
  );
}

/** Clean rule-(b) contribution: Prep has no base compatibility descriptor. */
export const meetingPrepPanelDescriptor: MeetingPanelDescriptor = {
  id: PREP_PANEL_ID,
  order: 10,
  labelKey: 'meetings.before-you-meet.title',
  mount: (context) => <BoundMeetingPrepPanel context={context} />,
};

const unregisterMeetingPrepPanel = registerMeetingPanel(
  meetingPrepPanelDescriptor
);

if (import.meta.hot) {
  import.meta.hot.dispose(() => {
    unregisterMeetingPrepPanel();
  });
}
