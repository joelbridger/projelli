/**
 * Notice Card — shared types for the local notice participant.
 *
 * The Notice Card is a second participant that runs entirely on the advisor's
 * own computer. It joins the meeting the advisor is recording, shows every
 * participant a card saying the meeting is being recorded and that the
 * recording never leaves the advisor's machine, and leaves the moment
 * recording stops. It records nothing and sends nothing.
 *
 * This file holds only the platform-agnostic vocabulary. The join automation
 * lives in `adapters/`, the lifecycle in `supervisor.ts`, and the ledger
 * integration in `noticeCardLedger.ts`.
 */

/**
 * Which meeting platform a join URL points at. `'meet'` is detected but has no
 * join adapter in this build (Google Meet generally requires a signed-in
 * account) — we surface an honest "say the notice aloud" fallback instead.
 * `'other'` is a URL we can't classify; `'none'` means no join URL at all.
 */
export type NoticeCardPlatform = 'teams' | 'zoom' | 'meet' | 'other' | 'none';

/** The platforms this build can actually drive a guest join for. */
export const AUTO_JOIN_PLATFORMS: readonly NoticeCardPlatform[] = ['teams', 'zoom'];

/** True when we ship a join adapter for this platform (Teams, Zoom). */
export function canAutoJoin(platform: NoticeCardPlatform): boolean {
  return AUTO_JOIN_PLATFORMS.includes(platform);
}

/**
 * The live state of a join attempt, as the adapter observes it in the
 * companion webview. The supervisor drives transitions off these.
 */
export type JoinState =
  | 'idle' // nothing opened yet
  | 'joining' // the join page is loading / we're filling the guest form
  | 'lobby' // waiting for the host to admit us
  | 'admitted' // we are in the meeting, showing the card
  | 'denied' // the host declined admission
  | 'left' // we left cleanly (recording stopped)
  | 'failed'; // the adapter could not join (page drift, no join form, etc.)

/** Why a join attempt failed — kept coarse and honest for the ledger + UI. */
export type NoticeCardFailureReason =
  | 'no-join-url' // no meeting link was known
  | 'unsupported-platform' // Meet / unknown URL: no adapter
  | 'denied' // the host declined to admit the card
  | 'join-timeout' // never reached "admitted" within the window
  | 'page-unrecognized' // the join page didn't match the adapter (web-client drift)
  | 'window-closed' // the companion window died unexpectedly
  | 'window-open-failed' // the companion window could not be created
  | 'internal'; // any other error

/**
 * Everything the supervisor needs to open and identify one card for one
 * recording. Built once at record-start from the calendar event + firm
 * settings; the raw meeting page never sees any of the app's internals.
 */
export interface NoticeCardConfig {
  /** The public join URL from calendar sync (or a manual paste). */
  joinUrl: string;
  platform: NoticeCardPlatform;
  /** The guest display name to show in the participant list. */
  displayName: string;
  /** The meeting this card belongs to, for the ledger. */
  meetingDir: string;
  /** Human-facing meeting title, for the ledger + status pill. */
  meetingTitle?: string | undefined;
}
