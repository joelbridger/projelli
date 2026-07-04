/**
 * useMeetingStore — drives the local meeting-capture pipeline end to end:
 * startRecording -> consent -> capture_start; stopRecording -> capture_stop
 * -> meeting.json -> transcribe per setting -> notes template -> (Task 14
 * indexing, out of this lane's scope).
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
import { buildResolvedProviderForGlance } from '@/platform/matter/matterAtAGlance';
import { matterLabel } from '@/platform/rag/matterResolver';
import {
  meetingNoteFromTranscript,
  formatCitationsForDisplay,
} from '@/features/meetings/meetingNoteTemplate';
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
import type { NoticeState } from './noticeLedger';
import { customNoticeScript, type NoticePolicy } from './noticeSettings';
import {
  noticeEvidenceSatisfied,
  type NoticeCardEvidence,
  type NoticeEvidenceRule,
} from './noticeCard/noticeCardEvidence';
import { startNoticeCard, stopNoticeCard } from './noticeCard/noticeCardLifecycle';
import type { NoticeCardStatus } from './noticeCard/supervisor';
import type { NoticeCardPlatform } from './noticeCard/noticeCardTypes';
import type { NoticeCardVisual } from './noticeCard/canvasCard';
import { ensureNoticeVerified, type NoticeVerificationDeps } from './noticeVerification';
import type { NoticeLocale } from './noticeMatcher';
import i18n from '@/i18n';
import type { MeetingSummary } from './ClientMeetingsTab';

export interface StartOpts {
  consentMode: 'one-party' | 'two-party';
  consentNote?: string;
  /** The matched calendar event's title, when the recording started from one
   *  (Wave 1's calendar match) — feeds Task 12c's type detection. Absent for
   *  ad-hoc recordings with no matched event. */
  calendarTitle?: string;
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
  startRecording: (matterId: string, opts: StartOpts) => Promise<void>;
  stopRecording: (opts?: {
    resolveProvider?: () => ReturnType<typeof buildResolvedProviderForGlance>;
  }) => Promise<void>;
  /** Advances elapsedMs by 1000ms; called by RecordPill's own timer. */
  tick: () => void;
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

/** QA-31 — classifies a notes-generation failure so the UI can tell the
 *  advisor something actionable instead of a generic "failed": a
 *  confidentiality-gate refusal means "change a setting," a timeout means
 *  "the provider never answered," anything else is a plain provider/docx
 *  error. All three still offer retry. */
function classifyNotesError(err: unknown): MeetingNotesError['kind'] {
  if (
    err instanceof LocalOnlyEgressError ||
    err instanceof LocalOnlyExternalError ||
    err instanceof ConfidentialityChoiceRequiredError
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
): Promise<void> {
  try {
    await invoke('transcribe_meeting', { workspaceRoot, meetingDir, model });
    await clearTranscriptError(meetingDir);
  } catch (err) {
    await recordTranscriptError(meetingDir, err);
  }
}

/** Keyed in-flight map so the natural post-stop transcription and a manual
 *  "Retry" can never race each other for the same meetingDir — same
 *  reasoning as inFlightNotesGenerations below. */
const inFlightTranscriptions = new Map<string, Promise<void>>();

function transcribeMeetingSerialized(
  meetingDir: string,
  workspaceRoot: string,
  model: string | null = null
): Promise<void> {
  const existing = inFlightTranscriptions.get(meetingDir);
  if (existing) return existing;
  const run = runTranscribeMeeting(meetingDir, workspaceRoot, model).finally(() => {
    inFlightTranscriptions.delete(meetingDir);
  });
  inFlightTranscriptions.set(meetingDir, run);
  return run;
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
  resolveProvider: () => ReturnType<typeof buildResolvedProviderForGlance>
): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws) return;
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
    const matter = useMatterStore
      .getState()
      .matters.find((m) => m.id === matterId);
    const clientName = matter ? matterLabel(matter) : matterId;
    const { provider } = await resolveProvider();
    const markdown = await withMeetingNotesTimeout((signal) =>
      meetingNoteFromTranscript.run({ transcript, clientName, provider, signal })
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
  resolveProvider: () => ReturnType<typeof buildResolvedProviderForGlance>
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
  resolveProvider: () => ReturnType<typeof buildResolvedProviderForGlance> = buildResolvedProviderForGlance
): Promise<void> {
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
  resolveProvider: () => ReturnType<typeof buildResolvedProviderForGlance> = buildResolvedProviderForGlance
): Promise<void> {
  useMeetingStore.setState((s) => ({ processingCount: s.processingCount + 1 }));
  try {
    await transcribeMeetingSerialized(meetingDir, workspaceRoot);
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

export type ReviewItemKind =
  | 'unreviewed-note'
  | 'crm-waiting'
  | 'no-followup'
  | 'unreadable-meta'
  // Recording Notice Kit: no spoken recording notice was detected in the
  // meeting's first minutes. 'notice-unverified' is the Standard-policy flag;
  // 'notice-quarantined' is the stronger Strict-policy state (meeting stays
  // in-review until a human resolves it — never auto-deleted or auto-stopped).
  | 'notice-unverified'
  | 'notice-quarantined'
  // QA-40: transcribe_meeting failed (missing engine/model, wedged sidecar, or
  // other error) — surfaced honestly with a retry rather than an eternal queue.
  | 'transcript-failed';
export interface ReviewItem {
  kind: ReviewItemKind;
}

interface CrmQueueItemLike {
  matterId: string;
  sourceRef: string;
  status: string;
}

/**
 * Task 12b — per-client (never practice-wide) "Needs review" flags for one
 * meeting. Pure so it's cheap to call per row in ClientMeetingsTab's list.
 */
export function needsReview(
  meeting: MeetingSummary,
  crmQueue: CrmQueueItemLike[],
  now: number = Date.now(),
  // Recording Notice Kit: the meeting's derived notice state + the firm policy.
  // Optional so existing callers (meeting, crmQueue) keep working unchanged.
  // Notice Card (additive): full-duration card presence + the firm evidence
  // rule. When absent, behavior is identical to before (verbal-only, 'either').
  notice?: {
    state: NoticeState;
    policy: NoticePolicy;
    cardEvidence?: NoticeCardEvidence;
    evidenceRule?: NoticeEvidenceRule;
  }
): ReviewItem[] {
  const items: ReviewItem[] = [];
  // A meeting folder with a missing/corrupt meeting.json is an orphaned or
  // incomplete recording — it must be surfaced honestly here, never silently
  // hidden or rendered as if it were a normal, fully-formed meeting.
  if (meeting.meta === null) items.push({ kind: 'unreadable-meta' });
  // QA-40: a failed transcription is a silent dead-end otherwise — surface
  // it in the same review queue the advisor already checks, not just on the
  // meeting's own detail page.
  if (meeting.meta?.transcriptError) items.push({ kind: 'transcript-failed' });
  if (meeting.hasNotes && !meeting.meta?.reviewedAt)
    items.push({ kind: 'unreviewed-note' });
  const waiting = crmQueue.some(
    (q) =>
      q.status === 'proposed' &&
      q.sourceRef.startsWith(`meeting:${meeting.dir}`)
  );
  if (waiting) items.push({ kind: 'crm-waiting' });
  // "No follow-up drafted" only nags once the meeting is a day old — flagging
  // a meeting recorded five minutes ago is noise, not a review queue.
  const ageMs = now - Date.parse(meeting.meta?.startedAt ?? '');
  if (
    !meeting.meta?.followupDraftedAt &&
    Number.isFinite(ageMs) &&
    ageMs > 24 * 3_600_000
  ) {
    items.push({ kind: 'no-followup' });
  }
  // Recording Notice Kit + Notice Card: a meeting needs attention when its
  // notice is NOT satisfied by the firm's evidence rule. By default ('either'),
  // a verified spoken notice OR the card present for the whole recording
  // satisfies it; a firm can require both. 'unchecked' (not yet transcribed)
  // never flags. Strict escalates the same condition to a quarantine state
  // instead of a plain review flag. With no card evidence + the default rule,
  // this is identical to the verbal-only behavior it replaces.
  if (notice && notice.state.status !== 'unchecked') {
    const cardEvidence: NoticeCardEvidence = notice.cardEvidence ?? { presentForEntireRecording: false };
    const rule: NoticeEvidenceRule = notice.evidenceRule ?? 'either';
    if (!noticeEvidenceSatisfied(notice.state, cardEvidence, rule)) {
      items.push({ kind: notice.policy === 'strict' ? 'notice-quarantined' : 'notice-unverified' });
    }
  }
  return items;
}

/** Task 12b — set `meeting.json.reviewedAt`, marking a meeting reviewed. */
export async function markMeetingReviewed(
  meetingDir: string,
  meta: MeetingMeta
): Promise<void> {
  await writeMeetingJson(meetingDir, {
    ...meta,
    reviewedAt: new Date().toISOString(),
  });
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
  void audit.logDurable(
    'meeting_recorded',
    'Dictated note filed as a meeting note',
    {
      metadata: { matterId, meetingDir, dictation: true },
    }
  );
  return { meetingDir };
}

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

  async startRecording(matterId, opts) {
    if (get().status.recording) throw new Error('already recording');
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
      activeConsent: opts,
    });
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
          mode: opts.consentMode,
          scope: 'per-meeting',
          confirmedAt: new Date().toISOString(),
          meetingDir: r.meetingDir,
          ...(opts.consentNote ? { note: opts.consentNote } : {}),
        })
        .catch(() => {});
      // Recording Notice Kit — capture the script/locale shown for THIS
      // recording so verification checks against it later (codex-review R6).
      void ledger
        .recordNotice({
          kind: 'notice-context',
          meetingDir: r.meetingDir,
          at: new Date().toISOString(),
          customScript: opts.noticeCustomScript ?? '',
          locale: noticeLocaleFromLanguage(opts.noticeLanguage ?? i18n.language),
        })
        .catch(() => {});
      // Notice Card — join the online meeting as the local notice participant.
      // Desktop-only; NEVER gates the recording (already running above). All
      // transitions are ledgered by the supervisor via this same ledger.
      if (opts.noticeCard && isTauri()) {
        const nc = opts.noticeCard;
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

  async stopRecording(opts) {
    const { activeMatterId, activeConsent, status } = get();
    const startedMeetingDir = status.meetingDir;
    // Notice Card — leave the meeting the moment the advisor hits Stop. The hard
    // guarantee: this runs BEFORE capture_stop (and independently of it) so the
    // companion window can never linger in the call even if capture_stop itself
    // rejects. supervisor.stop() always closes the window (with a watchdog). Its
    // departure is the honest "recording has ended" signal.
    void stopNoticeCard();
    const r = await invoke<{
      meetingDir: string;
      audioPath: string;
      durationMs: number;
    }>('capture_stop', {});
    set({
      status: {
        recording: false,
        meetingDir: null,
        elapsedMs: 0,
        writeError: null,
      },
      activeMatterId: null,
      activeConsent: null,
      noticeCardStatus: null,
    });
    set((s) => ({ processingCount: s.processingCount + 1 }));
    try {
      const meetingDir = r.meetingDir || startedMeetingDir || '';
      const matterId = activeMatterId ?? '';
      if (meetingDir && matterId && activeConsent) {
        // meeting.json's matterId/startedAt/consent are ALREADY written,
        // authoritatively, by Rust's finalize_session (session.rs's
        // MeetingMeta — landed with lane w3b) by the time capture_stop
        // resolves here. This TS layer only EXTENDS that file with its own
        // UI-only fields (typeId, reviewedAt, ...) — it must never
        // reconstruct/overwrite matterId/startedAt/consent from JS-side state,
        // which would silently replace Rust's real recorded values (e.g. the
        // actual start time) with wrong ones (e.g. stop time).
        const existing = await activeWorkspaceService
          ?.readFile(`${meetingDir}/meeting.json`)
          .catch(() => null);
        const base = existing ? (JSON.parse(existing) as MeetingMeta) : null;
        if (base) {
          // Task 12c: thin type detection — a matched calendar title (when the
          // recording started from one) plus any taught corrections decide the
          // type; ad-hoc recordings (no title) simply get no typeId.
          const typeId = await (async () => {
            if (!activeConsent.calendarTitle || !activeWorkspaceService)
              return undefined;
            try {
              const { learned } = await makeMeetingTypesStore(
                activeWorkspaceService
              ).load();
              return (
                detectMeetingType(activeConsent.calendarTitle, learned) ??
                undefined
              );
            } catch {
              return undefined;
            }
          })();
          await writeMeetingJson(meetingDir, {
            ...base,
            // Duration is only known here (capture_stop's return) — persist it
            // so the list can show "· 41 min" without opening the audio.
            ...(r.durationMs > 0 ? { durationMs: r.durationMs } : {}),
            ...(typeId ? { typeId } : {}),
            ...(activeConsent.calendarTitle
              ? { calendarTitle: activeConsent.calendarTitle }
              : {}),
          }).catch(() => {});
        }
        // No TS-side audit.logDurable('meeting_recorded', ...) here either —
        // capture_stop's Rust side already appends it (same reasoning as
        // startRecording above).
      }

      // meetings.transcribeMode (src/platform/settings/schema.ts): 'live'
      // (default) transcribes the moment recording stops; 'battery saver'
      // defers it (AC-power auto-trigger / a manual "Transcribe now" action
      // are a separate follow-up, not built here — this just honors the
      // setting by skipping the immediate call).
      const transcribeMode = useSettingsStore
        .getState()
        .getSetting<string>('meetings.transcribeMode');
      if (meetingDir && transcribeMode !== 'batch') {
        // QA-40: was a bare try/catch that silently swallowed every failure
        // (see runTranscribeMeeting above) — capture still never depends on
        // this succeeding, but a failure is now recorded as an honest,
        // retryable transcriptError instead of vanishing.
        await transcribeMeetingSerialized(meetingDir, resolveWorkspaceRoot());
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
          opts?.resolveProvider ?? buildResolvedProviderForGlance
        );
      }
    } finally {
      set((s) => ({ processingCount: Math.max(0, s.processingCount - 1) }));
    }
  },

  tick() {
    set((s) =>
      s.status.recording
        ? { status: { ...s.status, elapsedMs: s.status.elapsedMs + 1000 } }
        : s
    );
  },
}));
