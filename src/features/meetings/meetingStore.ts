/**
 * useMeetingStore — drives the local meeting-capture pipeline end to end:
 * startRecording -> consent -> capture_start; stopRecording -> capture_stop
 * -> meeting.json -> transcribe per setting -> notes template -> explicit
 * meeting-file indexing.
 *
 * Kept free of React (no hooks) so it's plain-testable; components own
 * timers/effects (RecordPill ticks elapsedMs; ClientMeetingsTab/MeetingEntry
 * read status + meeting-folder contents).
 *
 * meeting.json shape note: Task 8 (lane w3b, not yet landed) defines the
 * Rust-read core `{ matterId, startedAt, consent }`. This store adds
 * TS-only UI fields on the SAME file (`reviewedAt`, `followupDraftedAt`,
 * `typeId`, `dictation`) rather than a sidecar file — reconcile with w3b's
 * struct on merge if it turns out to reject unknown fields.
 */
import { create } from 'zustand';
import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CaptureStatus, TranscriptFile } from '@/platform/types/meeting';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { MemoryService } from '@/platform/rag/MemoryService';
import {
  formatCitationsForDisplay,
} from '@/features/meetings/meetingNoteTemplate';
import {
  generateMeetingNoteMarkdown,
  MeetingNotesLocalOnlyError,
  type ResolvedMeetingNotesProvider,
} from '@/features/meetings/meetingNotesAi';
import { withMeetingNotesTimeout, isMeetingNotesTimeoutError } from '@/features/meetings/meetingNotesTimeout';
import {
  LocalOnlyEgressError,
  LocalOnlyExternalError,
  ConfidentialityChoiceRequiredError,
} from '@/platform/privacy/localOnlyGuard';
import { AuditService } from '@/platform/audit/AuditService';
import { detectMeetingType, makeMeetingTypesStore } from './meetingTypes';
import { dictationToMeeting } from './dictationToMeeting';
import { makeConsentLedger } from './consentLedger';
import { customNoticeScript } from './noticeSettings';
import { startNoticeCard, stopNoticeCard } from './noticeCard/noticeCardLifecycle';
import type { NoticeCardStatus } from './noticeCard/supervisor';
import type { NoticeCardPlatform } from './noticeCard/noticeCardTypes';
import type { NoticeCardVisual } from './noticeCard/canvasCard';
import { ensureNoticeVerified, type NoticeVerificationDeps } from './noticeVerification';
import type { NoticeLocale } from './noticeMatcher';
import i18n from '@/i18n';
import type { MeetingDeliveryPlan } from './meetingRecipientPlan';
import type { MeetingDeliveryStatus } from './meetingArtifactDelivery';
import {
  addMeetingFileVisibilityEntries,
  createAccountlessUnrestrictedMeetingFileVisibilityManifest,
  createMeetingFileVisibilityManifest,
  meetingFileVisibilityManifestFromMeta,
  readCurrentMeetingFileVisibilityContext,
  readCurrentMeetingViewerId,
  resolveMeetingFilePathsVisibility,
  withMeetingFileVisibility,
  type MeetingFileVisibilityManifest,
} from './meetingFileVisibility';

const DEFAULT_MEETING_VISIBILITY_FILES = [
  'meeting.json',
  'audio.wav',
  'transcript.json',
  'notes.docx',
] as const;

function createCurrentMeetingFileVisibilityManifest(): MeetingFileVisibilityManifest {
  const ownerRef = readCurrentMeetingViewerId();
  return ownerRef
    ? createMeetingFileVisibilityManifest({
        ownerRef,
        fileNames: DEFAULT_MEETING_VISIBILITY_FILES,
      })
    : createAccountlessUnrestrictedMeetingFileVisibilityManifest({
        fileNames: DEFAULT_MEETING_VISIBILITY_FILES,
      });
}

export interface StartOpts {
  consentMode: 'one-party' | 'two-party';
  consentNote?: string;
  /** The matched calendar event's title, when the recording started from one
   *  (Wave 1's calendar match) — feeds Task 12c's type detection. Absent for
   *  ad-hoc recordings with no matched event. */
  calendarTitle?: string;
  /** The selected calendar event at record-start, when there is one. Kept as a
   *  small snapshot so later features can prefill recipients and match this
   *  recording back to the invite without re-reading the calendar. */
  calendarEvent?: MeetingCalendarEventMeta;
  /** Recording Notice Kit — the firm's custom spoken-notice script ('' = the
   *  built-in wording) and app language AT START, captured so verification
   *  later checks against exactly what was shown for this recording, even if
   *  the firm edits the setting afterward (codex-review R6). */
  noticeCustomScript?: string;
  noticeLanguage?: string;
  /** Notice Card — when set (and on desktop), the local notice participant
   *  joins the online meeting on record-start and leaves on record-stop.
   *  Absent for phone/in-person or when the advisor unchecked the offer.
   *  Never gates recording. */
  noticeCard?: {
    joinUrl: string;
    platform: NoticeCardPlatform;
    /** Guest display name (already resolved from the firm template + advisor). */
    displayName: string;
    meetingTitle?: string;
    /** Advisor first name, for the visual card's headline. */
    advisorName: string;
    /** The advisor attested they will also use Zoom's native Record. */
    zoomNativeRecordAttested?: boolean;
  };
  /** Exact file-backed visibility identity created before capture starts. */
  meetingFileVisibility?: MeetingFileVisibilityManifest;
}

export interface MeetingCalendarAttendeeMeta {
  email: string;
  name: string;
}

export interface MeetingCalendarEventMeta {
  id: string;
  title: string;
  startUtc: string;
  endUtc: string;
  joinUrl?: string;
  attendees: MeetingCalendarAttendeeMeta[];
}

/** The on-disk `meeting.json` shape this lane reads/writes. */
export interface MeetingMeta {
  matterId: string;
  startedAt: string;
  consent: {
    mode: 'one-party' | 'two-party';
    confirmedBy: string;
    confirmedAt: string;
    note?: string;
  };
  /** Recorded length in ms, persisted by the TS layer from capture_stop's
   *  return (Rust's core meeting.json doesn't carry it). Absent for dictated
   *  notes and meetings recorded before this field existed. */
  durationMs?: number;
  reviewedAt?: string;
  followupDraftedAt?: string;
  typeId?: string;
  /** The matched calendar event's title at record time, if any — the key
   *  Task 12c's learned-correction map corrects against (see meetingTypes.ts). */
  calendarTitle?: string;
  /** MF0 — selected calendar event at record-start, if the advisor started
   *  from a matched invite. Absent for ad-hoc recordings. */
  calendarEvent?: MeetingCalendarEventMeta;
  /** Advisor-edited display title. Kept separate from calendarTitle/typeId. */
  customTitle?: string;
  /** MF1 — local recipient choices per artifact. Nothing is sent by this field;
   *  MF2 will read it only after an advisor-reviewed send step exists. */
  deliveryPlan?: MeetingDeliveryPlan;
  /** MF2 — durable local send receipts. Exact recipients stay on this meeting's
   *  own file so the advisor can later answer who received which artifact. */
  deliveryStatus?: MeetingDeliveryStatus;
  dictation?: boolean;
  /** QA-31 — set when the notes-generation step (tryGenerateNotes) fails or
   *  times out, so the UI can show an honest "couldn't write notes" state
   *  with a retry instead of an eternal spinner or silent nothing. Cleared
   *  (omitted) the moment notes.docx is written successfully. */
  notesError?: MeetingNotesError;
  /** QA-40 — set when transcribe_meeting fails (a missing voice engine/model,
   *  a wedged sidecar past its own timeout, or any other transcription
   *  error), so the UI can show an honest failed state with retry instead of
   *  a permanently "queued" transcript that looks identical to a hang.
   *  Cleared (omitted) the moment transcript.json is written successfully. */
  transcriptError?: MeetingTranscriptError;
  /** QA-35 — set when `capture_stop` itself failed (a chunk write hit
   *  disk-full/permissions mid-recording, or the disk was still full when
   *  Stop tried to finalize), so a truncated/incomplete meeting is visible
   *  and auditable later instead of just a toast that vanished. Never
   *  cleared automatically — a truncated recording stays truncated. */
  recordingError?: MeetingRecordingError;
  /** Stable meeting + file identities. Missing/malformed values fail closed. */
  meetingFileVisibility?: MeetingFileVisibilityManifest;
}

export interface MeetingRecordingError {
  /** 'disk-full': at least one audio chunk failed to write during this
   *  recording — Rust's `CaptureEngine::stop` (engine.rs) bails with
   *  "...part of the audio failed to save...; partial audio at <path>" in
   *  exactly this case, and `audio.wav` still exists with whatever was
   *  captured before the failure (see the capture_enospc.rs integration
   *  test). 'error': `capture_stop` failed for any other reason — most
   *  commonly `finalize_session` itself couldn't write the merged
   *  `audio.wav` because the disk was STILL full at Stop time; the raw
   *  per-channel chunks under `.capture/` are never deleted on a failed
   *  finalize, so nothing already captured is lost, but there's no viewable
   *  meeting yet. */
  kind: 'disk-full' | 'error';
  at: string;
  message: string;
}

export interface MeetingNotesError {
  /** 'gate-blocked': a confidentiality-mode guard refused the send (the
   *  advisor needs to change a Privacy setting, not just retry blindly).
   *  'timeout': the provider call never returned within
   *  MEETING_NOTES_TIMEOUT_MS. 'error': any other provider/docx failure.
   *  Retry is offered for all three — this only changes the copy shown. */
  kind: 'gate-blocked' | 'timeout' | 'error';
  at: string;
}

export interface MeetingTranscriptError {
  /** 'not-installed': the bundled voice engine binary or its model file
   *  isn't staged on this machine (see resolve_sidecar_path/resolve_models_dir
   *  in commands/voice.rs) — reinstalling the voice engine fixes it, a blind
   *  retry alone won't. 'timeout': a transcription window exceeded the
   *  sidecar's own internal bound (TRANSCRIBE_TIMEOUT_SECS,
   *  sidecars/parakeet.rs) — the engine process is killed, not left running.
   *  'error': any other engine/subprocess failure. All three still offer
   *  retry — transcribe_meeting resumes from .transcribe-progress.json, so a
   *  retry only redoes the windows that never completed. */
  kind: 'not-installed' | 'timeout' | 'error';
  at: string;
}

interface MeetingState {
  status: CaptureStatus;
  /** Count of post-stop pipelines (transcription + notes) still running —
   *  the RecordPill shows a "writing your notes" state while > 0, so
   *  stopping never feels like the work silently vanished. A COUNT, not a
   *  boolean: the advisor can legally start (and stop) meeting B while
   *  meeting A's notes are still being written, and A's completion must not
   *  hide the indicator while B is mid-write (codex-review P2). */
  processingCount: number;
  /** Tracked alongside `status` (not part of the shared CaptureStatus shape,
   *  which mirrors the Rust struct) so stopRecording knows which matter/
   *  consent to write into meeting.json without a second lookup. */
  activeMatterId: string | null;
  activeConsent: StartOpts | null;
  /** Notice Card status for the record pill (null when no card is running). */
  noticeCardStatus: NoticeCardStatus | null;
  /** QA-35 — the most recent chunk-write failure that cut a recording short,
   *  if any and not yet dismissed. Kept separate from `status` (which resets
   *  to idle the moment the recording actually stops) so the RecordPill can
   *  still show an honest "Recording can't continue — disk is full" pill
   *  AFTER `status.recording` has already flipped back to false — otherwise
   *  the pill would just disappear the instant the auto-stop completes, with
   *  no lasting sign anything went wrong. Cleared on the next
   *  `startRecording` and by the explicit `dismissWriteFailure` action. */
  lastWriteFailure: { message: string; at: string } | null;
  dismissWriteFailure: () => void;
  startRecording: (matterId: string, opts: StartOpts) => Promise<void>;
  stopRecording: (opts?: {
    resolveProvider?: () => Promise<ResolvedMeetingNotesProvider>;
  }) => Promise<void>;
  /** Polls the REAL backend recording status (elapsed time + any chunk-write
   *  failure) every second — called by RecordPill's own timer. QA-35: this
   *  used to just increment a local clock with no connection to the Rust
   *  side at all, so the pill kept "counting" indefinitely even once
   *  disk-full chunk writes were already failing — nothing ever asked the
   *  backend whether recording was actually still healthy. Now, a newly
   *  observed `writeError` stops the recording automatically instead of
   *  waiting for the advisor to notice a silently-broken recording and click
   *  Stop themselves. */
  tick: () => Promise<void>;
}

/** QA-35 — a cheap, best-effort disk-space preflight the caller runs right
 *  before opening the consent dialog, so a genuinely low-disk advisor is
 *  warned ("Low disk space — long recordings may not fit") BEFORE a chunk
 *  write ever has a chance to actually fail.
 *
 *  QA-35 review round 3: this must be sized off PEAK usage, not the
 *  steady-state chunk-write rate. While recording, the raw per-channel chunk
 *  files under `.capture/` accumulate at ~64KB/s (mono 16kHz/16-bit PCM,
 *  both channels combined). But `finalize_session` (session.rs) writes the
 *  ENTIRE merged stereo `audio.wav` — another ~64KB/s worth of data — BEFORE
 *  it deletes `.capture/`, so for that window both copies of the recording
 *  exist on disk at once: effectively ~128KB/s of PEAK disk usage, double
 *  the raw chunk-write rate alone. Basing this threshold on the lower,
 *  steady-state rate (a prior version of this comment did exactly that)
 *  under-warns: an advisor could sit at ~350-450MiB free with no warning at
 *  all, then genuinely run out of space mid-finalize on a long meeting. 600MB
 *  is roughly 1.3 hours of headroom at the correct ~128KB/s peak rate —
 *  comfortably under "a typical meeting won't fit" while still leaving real
 *  headroom before the warning fires. Returns null (no warning) if the
 *  workspace root isn't resolvable or the check itself fails — this is
 *  advisory only, never a blocker, so a failed check must never prevent
 *  recording. (The honest failure-on-actual-write-error path — write_error/
 *  capture_status/the auto-stop in tick() — is unaffected by this: it reacts
 *  to a REAL failure regardless of this preflight's estimate.) */
const LOW_DISK_WARNING_THRESHOLD_BYTES = 600 * 1024 * 1024;

export async function checkLowDiskSpaceWarning(): Promise<boolean> {
  const workspace = resolveWorkspaceRoot();
  if (!workspace) return false;
  try {
    const bytes = await invoke<number>('capture_free_disk_bytes', { path: workspace });
    return bytes < LOW_DISK_WARNING_THRESHOLD_BYTES;
  } catch {
    return false;
  }
}

const audit = new AuditService('meetings');

/**
 * The active WorkspaceService, pushed in by the app layer (mirrors
 * `setActiveWorkspaceService` in `src/app/fileOps/flushDirtyTabs.ts`, kept as
 * its own module-level singleton here rather than importing that app-layer
 * module directly — features must not import app, per ARCHITECTURE.md's DAG).
 * `useWorkspaceLifecycle`/`useTestModeWorkspace` call `setMeetingsWorkspaceService`
 * alongside `setActiveWorkspaceService` so the two stay in sync.
 */
let activeWorkspaceService: WorkspaceService | null = null;
export function setMeetingsWorkspaceService(
  service: WorkspaceService | null
): void {
  activeWorkspaceService = service;
  // Some narrow meeting-store test doubles predate the visibility seam. The
  // production MemoryService always supplies both methods.
  const visibilityMemory = MemoryService as Partial<
    Pick<
      typeof MemoryService,
      | 'resetMeetingFileVisibilityResolver'
      | 'setMeetingFileVisibilityResolver'
    >
  >;
  if (!service) {
    visibilityMemory.resetMeetingFileVisibilityResolver?.();
    return;
  }
  visibilityMemory.setMeetingFileVisibilityResolver?.(async (
    sourceIds,
    meetingDerivedSourceIds
  ) => {
    const context = await readCurrentMeetingFileVisibilityContext(
      resolveWorkspaceRoot()
    );
    const decisions = await resolveMeetingFilePathsVisibility({
      paths: sourceIds,
      workspace: service,
      context,
      meetingDerivedPaths: meetingDerivedSourceIds,
    });
    return new Map(
      [...decisions].map(([sourceId, decision]) => [
        sourceId,
        decision.kind,
      ])
    );
  });
}

export function resolveMatterFolder(matterId: string): string {
  const { matters } = useMatterStore.getState();
  const matter = matters.find((m) => m.id === matterId);
  const folder = matter?.folderPaths[0];
  if (!folder) throw new Error(`No folder on disk for matter ${matterId}`);
  return folder;
}

export function resolveWorkspaceRoot(): string {
  return useWorkspaceStore.getState().rootPath ?? '';
}

export async function writeMeetingJson(
  meetingDir: string,
  meta: MeetingMeta
): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws) return;
  await ws.writeFile(
    `${meetingDir}/meeting.json`,
    JSON.stringify(meta, null, 2)
  );
}

export async function updateMeetingJson(
  meetingDir: string,
  update: (current: MeetingMeta) => MeetingMeta
): Promise<MeetingMeta | null> {
  const ws = activeWorkspaceService;
  if (!ws) return null;
  const current = JSON.parse(await ws.readFile(`${meetingDir}/meeting.json`)) as MeetingMeta;
  const next = update(current);
  await ws.writeFile(
    `${meetingDir}/meeting.json`,
    JSON.stringify(next, null, 2)
  );
  return next;
}

function meetingStartCalendarFields(opts: StartOpts): Pick<MeetingMeta, 'calendarTitle' | 'calendarEvent'> {
  if (opts.calendarEvent) {
    return {
      calendarTitle: opts.calendarEvent.title,
      calendarEvent: opts.calendarEvent,
    };
  }
  return opts.calendarTitle ? { calendarTitle: opts.calendarTitle } : {};
}

async function recordStartCalendarMetadata(
  meetingDir: string,
  opts: StartOpts
): Promise<void> {
  const fields = meetingStartCalendarFields(opts);
  const ws = activeWorkspaceService;
  if (!ws) return;
  try {
    const raw = await ws
      .readFile(`${meetingDir}/meeting.json`)
      .catch(() => ws.readFile(`${meetingDir}/.capture/session.json`));
    const base = JSON.parse(raw) as MeetingMeta;
    const manifest = opts.meetingFileVisibility;
    if (!manifest) return;
    await writeMeetingJson(meetingDir, {
      ...base,
      ...fields,
      meetingFileVisibility: manifest,
    });
  } catch {
    // The post-stop and failed-stop recovery paths try the same exact merge
    // again from meeting.json or the authoritative .capture/session.json.
  }
}

/** QA-31 — classifies a notes-generation failure so the UI can tell the
 *  advisor something actionable instead of a generic "failed": a
 *  confidentiality-gate refusal means "change a setting," a timeout means
 *  "the provider never answered," anything else is a plain provider/docx
 *  error. All three still offer retry. */
function classifyNotesError(err: unknown): MeetingNotesError['kind'] {
  if (
    err instanceof LocalOnlyEgressError ||
    err instanceof LocalOnlyExternalError ||
    err instanceof ConfidentialityChoiceRequiredError ||
    err instanceof MeetingNotesLocalOnlyError
  ) {
    return 'gate-blocked';
  }
  if (isMeetingNotesTimeoutError(err)) return 'timeout';
  return 'error';
}

/** Best-effort merge-write of `notesError` into the meeting's existing
 *  meeting.json (re-read fresh so this never stomps fields written
 *  concurrently, e.g. reviewedAt/typeId). A meeting.json that can't be read
 *  is left alone — the meeting stays usable via its transcript regardless. */
async function recordNotesError(meetingDir: string, err: unknown): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws) return;
  try {
    const base = JSON.parse(await ws.readFile(`${meetingDir}/meeting.json`)) as MeetingMeta;
    await writeMeetingJson(meetingDir, {
      ...base,
      notesError: { kind: classifyNotesError(err), at: new Date().toISOString() },
    });
  } catch {
    // best-effort — see doc comment above.
  }
}

/** Clears a previously-recorded `notesError` once notes.docx writes
 *  successfully (a retry, or a slow-but-eventually-successful first attempt). */
async function clearNotesError(meetingDir: string): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws) return;
  try {
    const base = JSON.parse(await ws.readFile(`${meetingDir}/meeting.json`)) as MeetingMeta;
    if (!base.notesError) return;
    const { notesError: _clearedNotesError, ...rest } = base;
    await writeMeetingJson(meetingDir, rest);
  } catch {
    // best-effort — see recordNotesError.
  }
}

/** QA-40 — classifies a transcribe_meeting failure so the UI can say
 *  something actionable instead of leaving a permanently "queued" transcript
 *  that's indistinguishable from a genuine hang. invoke() errors cross the
 *  Tauri bridge as plain strings, not Error instances, so this matches on
 *  message content the same way the Rust side words its errors
 *  (sidecars/parakeet.rs, commands/voice.rs) rather than on error type. */
function classifyTranscriptError(err: unknown): MeetingTranscriptError['kind'] {
  const msg = err instanceof Error ? err.message : String(err);
  if (msg.includes('not bundled') || msg.includes('no voice model bundled')) return 'not-installed';
  if (msg.includes('timed out')) return 'timeout';
  return 'error';
}

/** Best-effort merge-write of `transcriptError` into the meeting's existing
 *  meeting.json — mirrors recordNotesError above. */
async function recordTranscriptError(meetingDir: string, err: unknown): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws) return;
  try {
    const base = JSON.parse(await ws.readFile(`${meetingDir}/meeting.json`)) as MeetingMeta;
    await writeMeetingJson(meetingDir, {
      ...base,
      transcriptError: { kind: classifyTranscriptError(err), at: new Date().toISOString() },
    });
  } catch {
    // best-effort — see recordNotesError.
  }
}

/** Clears a previously-recorded `transcriptError` once transcript.json writes
 *  successfully — mirrors clearNotesError above. */
async function clearTranscriptError(meetingDir: string): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws) return;
  try {
    const base = JSON.parse(await ws.readFile(`${meetingDir}/meeting.json`)) as MeetingMeta;
    if (!base.transcriptError) return;
    const { transcriptError: _clearedTranscriptError, ...rest } = base;
    await writeMeetingJson(meetingDir, rest);
  } catch {
    // best-effort — see recordNotesError.
  }
}

/** QA-35 — classifies a `capture_stop` failure. Matches the exact wording
 *  Rust's `CaptureEngine::stop` (engine.rs) uses when it bails specifically
 *  because a chunk write failed during the recording ("...part of the audio
 *  failed to save...") — any other failure (most commonly `finalize_session`
 *  itself failing to write the merged audio.wav because the disk was STILL
 *  full at Stop time) falls back to the generic 'error' kind. A genuine
 *  mid-recording chunk-write failure is realistically always disk space
 *  (permissions are checked at file-open time, not typically failing
 *  mid-write), so 'disk-full' is used for that whole category rather than
 *  trying to sub-classify the underlying OS errno. */
function classifyRecordingError(err: unknown): MeetingRecordingError['kind'] {
  const msg = err instanceof Error ? err.message : String(err);
  return msg.includes('part of the audio failed to save') ? 'disk-full' : 'error';
}

/** Best-effort merge-write of `recordingError` into the meeting's existing
 *  meeting.json — mirrors recordNotesError/recordTranscriptError above. A
 *  meeting.json that doesn't exist yet (the worst case: the disk was so full
 *  that even `finalize_session`'s own metadata write never landed) is left
 *  alone — there's nothing durable yet to annotate, and the raw chunks under
 *  `.capture/` already survive untouched on that failure path (session.rs). */
async function recordRecordingError(meetingDir: string, err: unknown): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws) return;
  try {
    const existing = await ws.readFile(`${meetingDir}/meeting.json`).catch(() => null);
    if (!existing) return;
    const base = JSON.parse(existing) as MeetingMeta;
    const message = err instanceof Error ? err.message : String(err);
    await writeMeetingJson(meetingDir, {
      ...base,
      recordingError: { kind: classifyRecordingError(err), at: new Date().toISOString(), message },
    });
  } catch {
    // best-effort — see recordNotesError.
  }
}

/**
 * Runs transcribe_meeting and always resolves (never throws) — a missing
 * sidecar, a wedged engine past its own timeout, or any other failure is
 * recorded as an honest, classified `transcriptError` instead of vanishing
 * into a bare catch (QA-40: that used to make an already-failed, ~100ms
 * invoke() call look identical to a permanent hang, since nothing ever
 * changed on screen afterward either way).
 */
async function runTranscribeMeeting(
  meetingDir: string,
  workspaceRoot: string,
  model: string | null
): Promise<boolean> {
  try {
    if (
      !(await meetingFilesVisible(meetingDir, [
        'meeting.json',
        'audio.wav',
        'transcript.json',
      ]))
    )
      return false;
    await invoke('transcribe_meeting', { workspaceRoot, meetingDir, model });
    await clearTranscriptError(meetingDir);
    return true;
  } catch (err) {
    await recordTranscriptError(meetingDir, err);
    return false;
  }
}

/** Keyed in-flight map so the natural post-stop transcription and a manual
 *  "Retry" can never race each other for the same meetingDir — same
 *  reasoning as inFlightNotesGenerations below. */
const inFlightTranscriptions = new Map<string, Promise<boolean>>();

function transcribeMeetingSerialized(
  meetingDir: string,
  workspaceRoot: string,
  model: string | null = null
): Promise<boolean> {
  const existing = inFlightTranscriptions.get(meetingDir);
  if (existing) return existing;
  const run = runTranscribeMeeting(meetingDir, workspaceRoot, model).finally(() => {
    inFlightTranscriptions.delete(meetingDir);
  });
  inFlightTranscriptions.set(meetingDir, run);
  return run;
}

async function indexMeetingFile(
  meetingDir: string,
  filename: 'transcript.json' | 'notes.docx',
  matterId: string
): Promise<void> {
  try {
    await MemoryService.indexMeetingFile(`${meetingDir}/${filename}`, matterId);
  } catch (err) {
    console.warn(`[meetings] failed to index ${filename} for ${meetingDir}:`, err);
  }
}

async function ensureMeetingFileEntries(
  meetingDir: string,
  fileNames: readonly string[],
  fallbackManifest?: MeetingFileVisibilityManifest
): Promise<MeetingFileVisibilityManifest | null> {
  const ws = activeWorkspaceService;
  if (!ws) return null;
  try {
    const current = JSON.parse(
      await ws.readFile(`${meetingDir}/meeting.json`)
    ) as MeetingMeta;
    const existing = meetingFileVisibilityManifestFromMeta(current);
    const manifest = addMeetingFileVisibilityEntries(
      existing ?? fallbackManifest ?? (() => {
        throw new Error('Meeting visibility identity is missing.');
      })(),
      fileNames
    );
    await writeMeetingJson(
      meetingDir,
      withMeetingFileVisibility(current, manifest)
    );
    return manifest;
  } catch {
    return null;
  }
}

async function meetingFilesVisible(
  meetingDir: string,
  fileNames: readonly string[]
): Promise<boolean> {
  const ws = activeWorkspaceService;
  if (!ws) return false;
  const paths = fileNames.map((fileName) => `${meetingDir}/${fileName}`);
  const context = await readCurrentMeetingFileVisibilityContext(
    resolveWorkspaceRoot()
  );
  const decisions = await resolveMeetingFilePathsVisibility({
    paths,
    workspace: ws,
    context,
    meetingDerivedPaths: new Set(paths),
  });
  return paths.every((path) => decisions.get(path)?.kind === 'visible');
}

/**
 * Reads the transcript, generates notes.docx via the Task 10 template, and
 * writes it into the meeting folder. Never throws (capture/transcription
 * never depend on this), but unlike a bare try/catch it distinguishes two
 * cases:
 *   - transcript.json genuinely isn't there yet (transcription still
 *     queued, confirmed via `ws.exists()` — NOT just "the read threw"):
 *     silently wait for a future call — this is not a notes failure.
 *   - the transcript IS there (or `exists()` itself couldn't tell — an
 *     access problem is a real failure, not "not ready yet") but reading,
 *     parsing, generation, or writing fails or hangs (QA-31/QA-41): record
 *     an honest, classified `notesError` on meeting.json instead of silently
 *     discarding the failure, and bound the provider call with
 *     withMeetingNotesTimeout so a stalled call can never hang this (and
 *     therefore stopRecording's processingCount-clearing `finally`) forever.
 *
 * QA-41: the old version wrapped the read in a bare `try { ... } catch {
 * return; }`, which treated ANY failure — not just "not created yet" — as
 * "still queued." On real Windows hardware the read itself could fail even
 * though transcript.json provably existed on disk (a `meetingDir` in the
 * Windows extended-length `\\?\C:\...` form, from Rust's canonicalized
 * meeting-capture commands, could throw a `SecurityError` from
 * `PathValidator` before any real file I/O — see
 * PathValidator.windows.test.ts), and that error vanished into the same
 * catch as a genuinely-not-ready-yet read, leaving notes permanently
 * "being written" with no error and no retry. Checking `exists()` FIRST
 * (the same pattern already used by `TauriFSBackend.setRootPath`/`exists`)
 * makes the two cases distinguishable: `exists()` resolving `false` is the
 * only "not ready yet" signal; anything else — `exists()` throwing, or
 * `exists()` true but the read/parse failing — is a real, classified error.
 */
async function tryGenerateNotes(
  meetingDir: string,
  matterId: string,
  resolveProvider?: () => Promise<ResolvedMeetingNotesProvider>
): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws) return;
  if (
    !(await meetingFilesVisible(meetingDir, [
      'meeting.json',
      'transcript.json',
      'notes.docx',
    ]))
  )
    return;
  let transcript: TranscriptFile;
  try {
    const transcriptExists = await ws.exists(`${meetingDir}/transcript.json`);
    if (!transcriptExists) return; // transcription genuinely still queued — not a notes failure.
    const raw = await ws.readFile(`${meetingDir}/transcript.json`);
    transcript = JSON.parse(raw) as TranscriptFile;
  } catch (err) {
    await recordNotesError(meetingDir, err);
    return;
  }
  try {
    const markdown = await withMeetingNotesTimeout((signal) =>
      generateMeetingNoteMarkdown({
        transcript,
        matterId,
        signal,
        ...(resolveProvider ? { resolveProvider } : {}),
      })
    );
    const { markdownToDocxBytes, applyLetterheadIfConfigured } =
      await import('@/platform/utils/docx-io');
    // The advisor reads this file — machine `[t:ms]` tokens become "(at m:ss)"
    // text. transcript.json keeps the ms-precision record (Client Map source
    // links are built from it, never from notes.docx).
    const bytes = await markdownToDocxBytes(
      formatCitationsForDisplay(markdown),
      'notes.docx'
    );
    const finalBytes = await applyLetterheadIfConfigured(bytes);
    await ws.writeFileBinary(`${meetingDir}/notes.docx`, finalBytes);
    await indexMeetingFile(meetingDir, 'notes.docx', matterId);
    await clearNotesError(meetingDir);
  } catch (err) {
    await recordNotesError(meetingDir, err);
  }
}

/**
 * codex-review (P2): the natural post-stop pipeline and a manual "Retry" can
 * otherwise overlap for the SAME meetingDir — e.g. a fast retry succeeds
 * (writes notes.docx, clears notesError) while a slower, independently-
 * started run for the same meeting later fails and writes notesError back,
 * leaving a stale failure recorded even though the notes file exists. Keying
 * an in-flight promise per meetingDir means a second caller joins the same
 * run instead of starting an independent, racing one.
 */
const inFlightNotesGenerations = new Map<string, Promise<void>>();

function generateNotesSerialized(
  meetingDir: string,
  matterId: string,
  resolveProvider?: () => Promise<ResolvedMeetingNotesProvider>
): Promise<void> {
  const existing = inFlightNotesGenerations.get(meetingDir);
  if (existing) return existing;
  const run = tryGenerateNotes(meetingDir, matterId, resolveProvider).finally(() => {
    inFlightNotesGenerations.delete(meetingDir);
  });
  inFlightNotesGenerations.set(meetingDir, run);
  return run;
}

/**
 * QA-31 — the "Retry" action in the Meetings UI once notesError is set.
 * Mirrors stopRecording's own processingCount bump/decrement so the same
 * "writing your notes" indicator (RecordPill / ClientMeetingsTab) lights up
 * during a manual retry too, rather than looking like nothing is happening.
 */
export async function retryMeetingNotes(
  meetingDir: string,
  matterId: string,
  resolveProvider?: () => Promise<ResolvedMeetingNotesProvider>
): Promise<void> {
  if (
    !(await meetingFilesVisible(meetingDir, [
      'meeting.json',
      'transcript.json',
      'notes.docx',
    ]))
  )
    throw new Error('This meeting note is not available to the current user.');
  useMeetingStore.setState((s) => ({ processingCount: s.processingCount + 1 }));
  try {
    await generateNotesSerialized(meetingDir, matterId, resolveProvider);
  } finally {
    useMeetingStore.setState((s) => ({ processingCount: Math.max(0, s.processingCount - 1) }));
  }
}

/**
 * QA-40 — the "Retry" action once transcriptError is set. Re-invokes
 * transcribe_meeting; the Rust side resumes from .transcribe-progress.json,
 * so only the windows that never completed re-run. Chains into notes
 * generation on the same pass (a no-op if the transcript still isn't there),
 * mirroring the natural post-stop pipeline so a successful retry doesn't
 * leave notes stuck waiting on a manual second click.
 */
export async function retryMeetingTranscript(
  meetingDir: string,
  workspaceRoot: string,
  matterId: string,
  resolveProvider?: () => Promise<ResolvedMeetingNotesProvider>
): Promise<void> {
  if (
    !(await meetingFilesVisible(meetingDir, [
      'meeting.json',
      'audio.wav',
      'transcript.json',
      'notes.docx',
    ]))
  )
    throw new Error('This meeting recording is not available to the current user.');
  useMeetingStore.setState((s) => ({ processingCount: s.processingCount + 1 }));
  try {
    const transcribed = await transcribeMeetingSerialized(meetingDir, workspaceRoot);
    if (transcribed) {
      await indexMeetingFile(meetingDir, 'transcript.json', matterId);
    }
    await generateNotesSerialized(meetingDir, matterId, resolveProvider);
  } finally {
    useMeetingStore.setState((s) => ({ processingCount: Math.max(0, s.processingCount - 1) }));
  }
}

/** Maps the app's UI language to the matcher's supported locales (de/es ship;
 *  everything else verifies against English). */
function noticeLocaleFromLanguage(lang: string | undefined): NoticeLocale {
  const base = (lang ?? 'en').toLowerCase().split('-')[0];
  return base === 'de' || base === 'es' ? base : 'en';
}

/**
 * Recording Notice Kit — verify (once) whether the spoken recording notice was
 * given in this meeting, stamping the outcome into the notice ledger. Wires the
 * pure `ensureNoticeVerified` to the real WorkspaceService, the per-client
 * ledger, the firm custom script, and the app locale. Best-effort and
 * idempotent: safe to call from the post-stop pipeline AND when a meeting page
 * opens (batch-transcribed or pre-existing meetings get verified on view).
 * Fully local — reads only the on-device transcript.
 */
export async function ensureMeetingNoticeVerified(meetingDir: string, matterId: string): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws || !meetingDir || !matterId) return;
  if (!(await meetingFilesVisible(meetingDir, ['transcript.json']))) return;
  let matterFolder: string;
  try {
    matterFolder = resolveMatterFolder(matterId);
  } catch {
    return; // no folder on disk — nothing to verify against.
  }
  const ledger = makeConsentLedger(ws, () => matterFolder);
  // Prefer the script/locale captured at recording start; fall back to current
  // settings only for meetings that predate this (or imported ones) — so a
  // later settings edit can't change how a past recording is judged
  // (codex-review R6).
  const ctx = await ledger.noticeContext(meetingDir).catch(() => null);
  const custom = ctx ? ctx.customScript : customNoticeScript((k) => useSettingsStore.getState().getSetting(k));
  const locale = ctx ? ctx.locale : noticeLocaleFromLanguage(i18n.language);
  const deps: NoticeVerificationDeps = {
    async readTranscript() {
      try {
        return JSON.parse(await ws.readFile(`${meetingDir}/transcript.json`)) as TranscriptFile;
      } catch {
        return null; // transcription still queued.
      }
    },
    ledger,
    locale,
    ...(custom ? { customPhrases: [custom] } : {}),
  };
  try {
    await ensureNoticeVerified(meetingDir, deps);
  } catch {
    // best-effort — verification never blocks capture or notes.
  }
}

/**
 * Recording Notice Kit — record that the advisor copied the chat notice for the
 * currently-recording meeting (offered on the RecordPill at recording start).
 * Best-effort ledger append bound to the active meeting; the clipboard copy
 * itself happens in the UI. No-ops if nothing is recording.
 */
export async function recordChatNoticeForActiveMeeting(text: string): Promise<void> {
  const { activeMatterId, status } = useMeetingStore.getState();
  const meetingDir = status.meetingDir;
  const ws = activeWorkspaceService;
  if (!ws || !activeMatterId || !meetingDir) return;
  let matterFolder: string;
  try {
    matterFolder = resolveMatterFolder(activeMatterId);
  } catch {
    return;
  }
  try {
    await makeConsentLedger(ws, () => matterFolder).recordNotice({
      kind: 'chat-notice-copied',
      meetingDir,
      at: new Date().toISOString(),
      text,
    });
  } catch {
    // best-effort — copying to the clipboard still worked.
  }
}

/**
 * Task 10b — the one entry point for "File as meeting note…": files an
 * already-transcribed dictation voice note into `matterId`'s Meetings/ as a
 * dictated meeting (no audio, no re-transcription), and logs it the same
 * way a real recording's stop does.
 */
export async function fileDictationAsMeeting(
  noteText: string,
  matterId: string,
  recordedAt: string
): Promise<{ meetingDir: string } | null> {
  const ws = activeWorkspaceService;
  if (!ws) return null;
  const matterFolder = resolveMatterFolder(matterId);
  const { meetingDir } = await dictationToMeeting(
    ws,
    noteText,
    matterId,
    matterFolder,
    recordedAt
  );
  const manifest = createCurrentMeetingFileVisibilityManifest();
  const savedManifest = await ensureMeetingFileEntries(
    meetingDir,
    ['meeting.json', 'transcript.json', 'notes.docx'],
    manifest
  );
  if (!savedManifest) return null;
  await indexMeetingFile(meetingDir, 'transcript.json', matterId);
  await indexMeetingFile(meetingDir, 'notes.docx', matterId);
  void audit.logDurable(
    'meeting_recorded',
    'Dictated note filed as a meeting note',
    {
      metadata: { matterId, meetingDir, dictation: true },
    }
  );
  return { meetingDir };
}

/** QA-35 review round 2 — the exact (and only) string Rust's `capture_stop`
 *  command (engine.rs) returns when there's genuinely nothing for THIS call
 *  to stop: the engine was already `Idle` or already `Stopping` before this
 *  call ran. The most common real cause is a double-clicked Stop button —
 *  RecordPill doesn't disable itself mid-click, so two `stopRecording()`
 *  calls can both start before the first one's `set({ status: ... })` runs.
 *  `stopRecordingInFlight` below already prevents a second call from ever
 *  reaching a real `capture_stop` invoke while the first is still pending,
 *  but this stays as defense-in-depth for any other path that could reach
 *  `Idle`/`Stopping` out from under this store's own state (a future
 *  recovery flow, for instance). Treating this string the same as a genuine
 *  write failure would show a false "disk is full" pill on a perfectly
 *  healthy, already-saved recording — this recording is fine; there was
 *  simply nothing left for this call to do. */
function isBenignStopStateError(err: unknown): boolean {
  return err instanceof Error ? err.message === 'not recording' : err === 'not recording';
}

/**
 * The post-stop pipeline shared by BOTH a normal successful stop and — QA-35
 * review round 2 — a 'disk-full' write-failure stop: extends meeting.json
 * (typeId/duration/calendarTitle) when known, transcribes (unless deferred),
 * verifies the recording notice, and generates notes. A 'disk-full' failure
 * still leaves a real, valid, salvaged partial `audio.wav` behind (proven by
 * `src-tauri/tests/capture_enospc.rs`) — running this same pipeline on it is
 * what stops that salvaged meeting from sitting at "pending" forever with
 * nothing ever having been asked to generate it (the same eternal-pending
 * class QA-31/QA-40/QA-41 killed for the healthy-recording path).
 * `durationMs` is `undefined` on the failure path (capture_stop's normal
 * return, which carries it, was never received) — meeting.json simply keeps
 * whatever duration it already has rather than a guessed one.
 */
async function runPostStopPipeline(
  meetingDir: string,
  matterId: string,
  activeConsent: StartOpts | null,
  durationMs: number | undefined,
  resolveProvider: (() => Promise<ResolvedMeetingNotesProvider>) | undefined
): Promise<void> {
  useMeetingStore.setState((s) => ({ processingCount: s.processingCount + 1 }));
  try {
    if (matterId && activeConsent) {
      // meeting.json's matterId/startedAt/consent are ALREADY written,
      // authoritatively, by Rust's finalize_session (session.rs's
      // MeetingMeta) by the time this runs. This TS layer only EXTENDS that
      // file with its own UI-only fields (typeId, reviewedAt, ...) — it must
      // never reconstruct/overwrite matterId/startedAt/consent from JS-side
      // state, which would silently replace Rust's real recorded values
      // (e.g. the actual start time) with wrong ones (e.g. stop time).
      const existing = await activeWorkspaceService
        ?.readFile(`${meetingDir}/meeting.json`)
        .catch(() => null);
      const base = existing ? (JSON.parse(existing) as MeetingMeta) : null;
      if (base) {
        // Task 12c: thin type detection — a matched calendar title (when the
        // recording started from one) plus any taught corrections decide the
        // type; ad-hoc recordings (no title) simply get no typeId.
        const calendarTitle = activeConsent.calendarEvent?.title ?? activeConsent.calendarTitle;
        const typeId = await (async () => {
          if (!calendarTitle || !activeWorkspaceService)
            return undefined;
          try {
            const { learned } = await makeMeetingTypesStore(
              activeWorkspaceService
            ).load();
            return (
              detectMeetingType(calendarTitle, learned) ??
              undefined
            );
          } catch {
            return undefined;
          }
        })();
        const meta = {
          ...base,
          ...(durationMs && durationMs > 0 ? { durationMs } : {}),
          ...(typeId ? { typeId } : {}),
          ...meetingStartCalendarFields(activeConsent),
        };
        const manifest = activeConsent.meetingFileVisibility;
        await writeMeetingJson(
          meetingDir,
          manifest ? withMeetingFileVisibility(meta, manifest) : meta
        ).catch(() => {});
      }
    }

    // meetings.transcribeMode (src/platform/settings/schema.ts): 'live'
    // (default) transcribes the moment recording stops; 'battery saver'
    // defers it (AC-power auto-trigger / a manual "Transcribe now" action
    // are a separate follow-up, not built here — this just honors the
    // setting by skipping the immediate call).
    const transcribeMode = useSettingsStore
      .getState()
      .getSetting<string>('meetings.transcribeMode');
    let transcribed = false;
    if (meetingDir && transcribeMode !== 'batch') {
      // QA-40: was a bare try/catch that silently swallowed every failure
      // (see runTranscribeMeeting above) — capture still never depends on
      // this succeeding, but a failure is now recorded as an honest,
      // retryable transcriptError instead of vanishing.
      transcribed = await transcribeMeetingSerialized(meetingDir, resolveWorkspaceRoot());
      if (transcribed && matterId) {
        await indexMeetingFile(meetingDir, 'transcript.json', matterId);
      }
    }

    // Recording Notice Kit: once the transcript exists, verify the spoken
    // notice and stamp the result into the ledger. Best-effort and
    // idempotent; if transcription was deferred (batch mode) the transcript
    // isn't there yet and this no-ops — the meeting page verifies on open.
    if (meetingDir && matterId) {
      await ensureMeetingNoticeVerified(meetingDir, matterId);
    }

    if (meetingDir && matterId) {
      await generateNotesSerialized(
        meetingDir,
        matterId,
        resolveProvider
      );
    }
  } finally {
    useMeetingStore.setState((s) => ({ processingCount: Math.max(0, s.processingCount - 1) }));
  }
}

/** QA-35 review round 2 — dedups concurrent `stopRecording()` calls (most
 *  commonly a double-clicked Stop button) so only ONE real `capture_stop`
 *  invoke ever happens per actual stop: a second caller just joins the
 *  first's in-flight promise and gets the exact same outcome, instead of
 *  racing a second real invoke against Rust's own single-engine state guard.
 *  Module-level (not store state) since it's plumbing, not UI-observable
 *  state — mirrors the existing `inFlightTranscriptions`/
 *  `inFlightNotesGenerations` keyed-promise pattern elsewhere in this file. */
let stopRecordingInFlight: Promise<void> | null = null;

export const useMeetingStore = create<MeetingState>((set, get) => ({
  status: {
    recording: false,
    meetingDir: null,
    elapsedMs: 0,
    writeError: null,
  },
  processingCount: 0,
  activeMatterId: null,
  activeConsent: null,
  noticeCardStatus: null,
  lastWriteFailure: null,

  dismissWriteFailure() {
    set({ lastWriteFailure: null });
  },

  async startRecording(matterId, opts) {
    if (get().status.recording) throw new Error('already recording');
    const meetingFileVisibility =
      opts.meetingFileVisibility ??
      createCurrentMeetingFileVisibilityManifest();
    const captureOpts: StartOpts = { ...opts, meetingFileVisibility };
    const matterFolder = resolveMatterFolder(matterId);
    const workspace = resolveWorkspaceRoot();
    const r = await invoke<{ meetingDir: string; startedAt: string }>(
      'capture_start',
      {
        workspace,
        matterId,
        matterFolder,
        consentMode: opts.consentMode,
        consentNote: opts.consentNote ?? null,
      }
    );
    set({
      status: {
        recording: true,
        meetingDir: r.meetingDir,
        elapsedMs: 0,
        writeError: null,
      },
      activeMatterId: matterId,
      activeConsent: captureOpts,
      // A prior recording's disk-full pill must never bleed into this new one.
      lastWriteFailure: null,
    });
    await recordStartCalendarMetadata(r.meetingDir, captureOpts);
    // No TS-side audit.logDurable('meeting_capture_started', ...) here: the
    // Rust capture_start command already appends this exact audit action
    // (append_capture_audit_best_effort in src-tauri/src/commands/capture/
    // engine.rs, from the already-merged lp/meeting-capture lane) directly
    // to the encrypted store. Logging it again here would double every
    // recording's audit trail (found via codex-review of this branch).
    if (activeWorkspaceService) {
      const ws = activeWorkspaceService;
      const ledger = makeConsentLedger(ws, () => matterFolder);
      void ledger
        .recordConsent(matterId, {
          mode: captureOpts.consentMode,
          scope: 'per-meeting',
          confirmedAt: new Date().toISOString(),
          meetingDir: r.meetingDir,
          ...(captureOpts.consentNote ? { note: captureOpts.consentNote } : {}),
        })
        .catch(() => {});
      // Recording Notice Kit — capture the script/locale shown for THIS
      // recording so verification checks against it later (codex-review R6).
      void ledger
        .recordNotice({
          kind: 'notice-context',
          meetingDir: r.meetingDir,
          at: new Date().toISOString(),
          customScript: captureOpts.noticeCustomScript ?? '',
          locale: noticeLocaleFromLanguage(captureOpts.noticeLanguage ?? i18n.language),
        })
        .catch(() => {});
      // Notice Card — join the online meeting as the local notice participant.
      // Desktop-only; NEVER gates the recording (already running above). All
      // transitions are ledgered by the supervisor via this same ledger.
      if (captureOpts.noticeCard && isTauri()) {
        const nc = captureOpts.noticeCard;
        const cameraVisual: NoticeCardVisual = {
          title: i18n.t('meetings.notice-card.card-title', { name: nc.advisorName }),
          lines: [
            i18n.t('meetings.notice-card.card-line-1'),
            i18n.t('meetings.notice-card.card-line-2'),
            i18n.t('meetings.notice-card.card-line-3'),
          ],
          footer: i18n.t('meetings.notice-card.card-footer'),
          recordingLabel: i18n.t('meetings.notice-card.card-recording-label'),
        };
        startNoticeCard({
          config: {
            joinUrl: nc.joinUrl,
            platform: nc.platform,
            displayName: nc.displayName,
            meetingDir: r.meetingDir,
            meetingTitle: nc.meetingTitle,
          },
          cameraVisual,
          startEpochMs: Date.now(),
          record: (event) => {
            void ledger.recordNotice(event).catch(() => {});
          },
          onStatus: (noticeCardStatus) => {
            set({ noticeCardStatus });
          },
          entryAnnouncement: i18n.t('meetings.notice-card.announce-recording-started'),
          stopAnnouncement: i18n.t('meetings.notice-card.announce-recording-stopped'),
        });
        if (nc.zoomNativeRecordAttested) {
          void ledger
            .recordNotice({
              kind: 'zoom-native-record-attested',
              meetingDir: r.meetingDir,
              at: new Date().toISOString(),
            })
            .catch(() => {});
        }
      }
    }
  },

  stopRecording(opts) {
    // QA-35 review round 2 — dedup: a second call while the GUARD PHASE
    // below is still resolving just joins it, so only ONE real
    // `capture_stop` invoke ever happens per actual stop (see
    // stopRecordingInFlight's doc above). Deliberately scoped to ONLY the
    // guard phase (the invoke() + immediate status reset), NOT the full
    // post-stop pipeline that follows: `processingCount`'s own doc comment
    // (above) — and its own regression test — establish that the advisor
    // can legally start (and stop) meeting B while meeting A's notes are
    // still being written, which requires meeting B's OWN, independent
    // `capture_stop` invoke to fire once A's guard phase has cleared, even
    // while A's (much longer) transcribe/notes pipeline is still running.
    // Coupling the guard to the whole pipeline broke exactly that case: B's
    // stopRecording() would have wrongly joined A's still-in-flight promise
    // instead of ever calling `capture_stop` for itself.
    if (stopRecordingInFlight) return stopRecordingInFlight;
    const guardPhase = (async (): Promise<{
      meetingDir: string;
      matterId: string;
      activeConsent: StartOpts | null;
      durationMs: number | undefined;
    } | null> => {
      const { activeMatterId, activeConsent, status } = get();
      const startedMeetingDir = status.meetingDir;
      // Notice Card — leave the meeting the moment the advisor hits Stop, BEFORE
      // capture_stop and independently of its outcome, so the companion window
      // can never linger in the call even if capture_stop rejects
      // (supervisor.stop() always closes the window, with a watchdog). Its
      // departure is the honest "recording has ended" signal.
      await stopNoticeCard();
      let r: { meetingDir: string; audioPath: string; durationMs: number };
      try {
        r = await invoke<{
          meetingDir: string;
          audioPath: string;
          durationMs: number;
        }>('capture_stop', {});
      } catch (err) {
        // QA-35 review round 2: "not recording" means there was genuinely
        // nothing for THIS call to stop (the engine was already Idle/
        // Stopping) — most commonly a benign double-click race that the
        // in-flight guard above should already prevent, kept here as
        // defense-in-depth. This recording is fine; just reconcile the local
        // status back to reality, with NO false failure pill.
        if (isBenignStopStateError(err)) {
          set((s) =>
            s.status.recording
              ? {
                  status: { recording: false, meetingDir: null, elapsedMs: 0, writeError: null },
                  activeMatterId: null,
                  activeConsent: null,
                  noticeCardStatus: null,
                }
              : s
          );
          return null;
        }
        // QA-35: capture_stop can legitimately fail — a chunk write hit
        // disk-full/permissions mid-recording (Rust's CaptureEngine::stop
        // bails on a recorded write_error even though it already finalized
        // whatever partial audio DID make it to disk), or the disk was still
        // full when finalize_session tried to merge the chunks. Either way the
        // recording is ALREADY fully stopped on the Rust side by the time this
        // rejects: capture_stop takes the engine out of `Recording` before it
        // ever calls `.stop()`, and `StoppingGuard`'s Drop always resets it to
        // `Idle` regardless of the outcome (engine.rs). The old code had no
        // catch here at all, so this reject skipped the `set({ status: ... })`
        // below entirely — leaving the RecordPill stuck showing "Recording"
        // forever with a dead Stop button, on EVERY capture_stop failure, not
        // just disk-full ones. That's the QA-35 "Stop doesn't respond" symptom.
        set({
          status: { recording: false, meetingDir: null, elapsedMs: 0, writeError: null },
          activeMatterId: null,
          activeConsent: null,
          lastWriteFailure: { message: i18n.t('meetings.pill.write-error'), at: new Date().toISOString() },
          noticeCardStatus: null,
        });
        const matterId = activeMatterId ?? '';
        if (startedMeetingDir) {
          if (activeConsent)
            await recordStartCalendarMetadata(startedMeetingDir, activeConsent);
          await recordRecordingError(startedMeetingDir, err);
        }
        // QA-35 review round 2: a 'disk-full' failure still finalizes a
        // real, valid, salvaged partial audio.wav (proven by
        // capture_enospc.rs) — run the SAME post-stop pipeline a healthy
        // stop would, so this meeting doesn't sit at "pending" forever with
        // nothing ever having been asked to transcribe/generate it. The
        // generic 'error' kind (most commonly finalize_session itself
        // failing) has no audio to transcribe — needsReview/MeetingEntry
        // surface THAT case as a durable "didn't finish saving" state
        // instead (see the recordingError + !hasAudio checks there).
        if (startedMeetingDir && classifyRecordingError(err) === 'disk-full') {
          return { meetingDir: startedMeetingDir, matterId, activeConsent, durationMs: undefined };
        }
        return null;
      }
      set({
        status: {
          recording: false,
          meetingDir: null,
          elapsedMs: 0,
          writeError: null,
        },
        activeMatterId: null,
        activeConsent: null,
        // QA-35 review round 2: a clean, successful stop is unambiguous
        // proof nothing is currently wrong — clear any stale disk-full pill
        // left over rather than requiring the advisor to dismiss it by hand.
        lastWriteFailure: null,
        noticeCardStatus: null,
      });
      const meetingDir = r.meetingDir || startedMeetingDir || '';
      const matterId = activeMatterId ?? '';
      return { meetingDir, matterId, activeConsent, durationMs: r.durationMs };
    })();
    // The guard clears as soon as the SHORT guard phase settles — never
    // held open for the (potentially long) pipeline below. `guardPhase`
    // never itself rejects (every throwable await inside it is already
    // caught), so this `.then` is just a type-erasing tap, not error
    // handling.
    stopRecordingInFlight = guardPhase.then(
      () => undefined,
      () => undefined
    );
    void stopRecordingInFlight.finally(() => {
      stopRecordingInFlight = null;
    });
    return guardPhase.then(async (pipelineArgs) => {
      if (!pipelineArgs) return;
      await runPostStopPipeline(
        pipelineArgs.meetingDir,
        pipelineArgs.matterId,
        pipelineArgs.activeConsent,
        pipelineArgs.durationMs,
        opts?.resolveProvider
      );
    });
  },

  async tick() {
    if (!get().status.recording) return;
    let result: CaptureStatus;
    try {
      result = await invoke<CaptureStatus>('capture_status');
    } catch {
      // A transient bridge hiccup shouldn't itself stop the recording — the
      // elapsed clock just stalls until the next tick tries again.
      return;
    }
    // The recording may have been stopped (or never started another one)
    // while this call was in flight — never resurrect a stale status.
    if (!get().status.recording) return;
    const hadWriteError = get().status.writeError;
    set({ status: result });
    if (result.writeError && !hadWriteError) {
      // QA-35: a chunk write just started failing (disk full, permissions,
      // ...). Don't wait for the advisor to notice a silently-broken
      // recording and click Stop themselves — stop now, cleanly, preserving
      // whatever was captured before the failure (recordRecordingError,
      // called from stopRecording's own error path, records the truncation).
      set({
        lastWriteFailure: { message: i18n.t('meetings.pill.write-error'), at: new Date().toISOString() },
      });
      await get().stopRecording();
    }
  },
}));
