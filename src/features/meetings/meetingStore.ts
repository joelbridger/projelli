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
import { invoke } from '@tauri-apps/api/core';
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
import { AuditService } from '@/platform/audit/AuditService';
import { detectMeetingType, makeMeetingTypesStore } from './meetingTypes';
import { dictationToMeeting } from './dictationToMeeting';
import { makeConsentLedger } from './consentLedger';
import type { MeetingSummary } from './ClientMeetingsTab';

export interface StartOpts {
  consentMode: 'one-party' | 'two-party';
  consentNote?: string;
  /** The matched calendar event's title, when the recording started from one
   *  (Wave 1's calendar match) — feeds Task 12c's type detection. Absent for
   *  ad-hoc recordings with no matched event. */
  calendarTitle?: string;
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

/**
 * Best-effort: read the transcript, generate notes.docx via the Task 10
 * template, and write it into the meeting folder. Never throws — a failure
 * here (no transcript yet, no provider configured, provider error) leaves
 * the meeting recorded with transcription/notes queued, never blocks or
 * corrupts the capture itself.
 */
async function tryGenerateNotes(
  meetingDir: string,
  matterId: string,
  resolveProvider: () => ReturnType<typeof buildResolvedProviderForGlance>
): Promise<void> {
  const ws = activeWorkspaceService;
  if (!ws) return;
  try {
    const raw = await ws.readFile(`${meetingDir}/transcript.json`);
    const transcript = JSON.parse(raw) as TranscriptFile;
    const matter = useMatterStore
      .getState()
      .matters.find((m) => m.id === matterId);
    const clientName = matter ? matterLabel(matter) : matterId;
    const { provider } = await resolveProvider();
    const markdown = await meetingNoteFromTranscript.run({
      transcript,
      clientName,
      provider,
    });
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
  } catch {
    // Queued for later — capture and transcription never depend on this.
  }
}

export type ReviewItemKind = 'unreviewed-note' | 'crm-waiting' | 'no-followup';
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
  now: number = Date.now()
): ReviewItem[] {
  const items: ReviewItem[] = [];
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
      void makeConsentLedger(ws, () => matterFolder)
        .recordConsent(matterId, {
          mode: opts.consentMode,
          scope: 'per-meeting',
          confirmedAt: new Date().toISOString(),
          meetingDir: r.meetingDir,
          ...(opts.consentNote ? { note: opts.consentNote } : {}),
        })
        .catch(() => {});
    }
  },

  async stopRecording(opts) {
    const { activeMatterId, activeConsent, status } = get();
    const startedMeetingDir = status.meetingDir;
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
        try {
          await invoke('transcribe_meeting', {
            workspaceRoot: resolveWorkspaceRoot(),
            meetingDir,
            model: null,
          });
        } catch {
          // Queued until the voice engine is installed — capture never depends on it.
        }
      }

      if (meetingDir && matterId) {
        await tryGenerateNotes(
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
