/**
 * MeetingEntry — the meeting page: date/duration/consent, a retention
 * action, an audio scrubber, and a split view (notes.docx left,
 * TranscriptViewer right, with audio seek). Opened from both the client's
 * Meetings tab and its Activity timeline entry (both just mount this same
 * component with the meeting's dir).
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Trash2, Check } from 'lucide-react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { arrayBufferToDataUrl } from '@/platform/utils/file-utils';
import { AudioPlayer, type AudioPlayerHandle } from '@/features/dictation/audio/AudioPlayer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Button as DialogButton } from '@/ui/button';
import { TranscriptViewer } from './TranscriptViewer';
import { SpeakerNamesPanel } from './SpeakerNamesPanel';
import { AuditService } from '@/platform/audit/AuditService';
import { markMeetingReviewed, writeMeetingJson, retryMeetingNotes, retryMeetingTranscript, ensureMeetingNoticeVerified, resolveMatterFolder } from './meetingStore';
import type { MeetingMeta } from './meetingStore';
import { NoticeTrail } from './NoticeTrail';
import { makeConsentLedger } from './consentLedger';
import type { NoticeEntry } from './noticeLedger';
import { useNoticeSettings } from './noticeSettings';
import { meetingDisplayTitle, meetingTypeLabel, formatMeetingDate, formatMeetingDuration } from './meetingDisplay';
import { makeMeetingTypesStore, BUILT_IN_TYPES } from './meetingTypes';
import type { TranscriptFile } from '@/platform/types/meeting';
import type { ComponentType } from 'react';
import type { TFunction } from 'i18next';

export interface MeetingEntryProps {
  matterId: string;
  meetingDir: string;
  folderName: string;
  clientName: string;
  workspaceRoot: string;
  onBack: () => void;
  /** Set when opened via a `meeting:<dir>#<ms>` Client Map source link
   *  (Task 11) — seeks the transcript/audio to this moment on open. */
  initialSeekMs?: number;
  /** Injected by MatterHub (ultimately the app-layer active WorkspaceService) —
   *  features must not reach for the app-layer singleton themselves, per
   *  ARCHITECTURE.md's DAG. Null before a workspace is open. */
  workspaceService: WorkspaceService | null;
}

const audit = new AuditService('meetings');

function consentLabel(meta: MeetingMeta | null, t: (k: string) => string): string | null {
  if (!meta?.consent) return null;
  const modeLabel = meta.consent.mode === 'one-party' ? t('meetings.entry.consent-one-party') : t('meetings.entry.consent-two-party');
  return `${t('meetings.entry.consent-noted')} · ${modeLabel}`;
}

/** "Jun 30, 2026 · 41 min" — the meta the advisor scans for, kept apart from
 *  the human title (the raw folder name never renders; see meetingDisplay). */
function dateDurationLine(meta: MeetingMeta | null, t: TFunction): string | null {
  if (!meta) return null;
  const parts = [formatMeetingDate(meta.startedAt), formatMeetingDuration(meta.durationMs, t)].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

export function MeetingEntry({ matterId, meetingDir, folderName, clientName, workspaceRoot, onBack, initialSeekMs, workspaceService }: MeetingEntryProps) {
  const { t } = useTranslation();
  const [meta, setMeta] = useState<MeetingMeta | null>(null);
  const [transcript, setTranscript] = useState<TranscriptFile | null>(null);
  const [hasNotes, setHasNotes] = useState(false);
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [DocxEditorComp, setDocxEditorComp] = useState<ComponentType<{ filePath: string; fileName: string }> | null>(null);
  const [seekMs, setSeekMs] = useState<number | undefined>(initialSeekMs);
  const [editingType, setEditingType] = useState(false);
  const [typeInput, setTypeInput] = useState('');
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [retryingNotes, setRetryingNotes] = useState(false);
  const [retryingTranscript, setRetryingTranscript] = useState(false);
  const [notices, setNotices] = useState<NoticeEntry[]>([]);
  const audioRef = useRef<AudioPlayerHandle>(null);
  const { policy: noticePolicy } = useNoticeSettings();

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const ws = workspaceService;
      if (!ws) return;
      try {
        const raw = await ws.readFile(`${meetingDir}/meeting.json`);
        if (!cancelled) setMeta(JSON.parse(raw) as MeetingMeta);
      } catch { /* pre-Task-8 meeting, or not yet written */ }
      try {
        const raw = await ws.readFile(`${meetingDir}/transcript.json`);
        if (!cancelled) setTranscript(JSON.parse(raw) as TranscriptFile);
      } catch { /* transcription still queued */ }
      try {
        // codex-review (coordinator P2): notes.docx is binary — readFile is
        // the TEXT reader (readTextFile on Tauri) and can throw decoding real
        // docx bytes even though the file exists. exists() is the correct,
        // decode-free presence check.
        const notesExists = await ws.exists(`${meetingDir}/notes.docx`);
        if (!cancelled) setHasNotes(notesExists);
      } catch { /* couldn't check — treat as not-yet-generated */ }
      try {
        const buffer = await ws.readFileBinary(`${meetingDir}/audio.wav`);
        if (!cancelled) {
          setAudioSrc(arrayBufferToDataUrl(buffer, 'audio/wav'));
          setHasAudio(true);
        }
      } catch { /* audio deleted (retention) or not yet finalized */ }
    })();
    return () => { cancelled = true; };
  }, [meetingDir, workspaceService]);

  useEffect(() => {
    let cancelled = false;
    void import('@/features/documents/media/DocxEditor').then((mod) => {
      if (!cancelled) setDocxEditorComp(() => mod.DocxEditor);
    });
    return () => { cancelled = true; };
  }, []);

  // Recording Notice Kit — the per-client ledger for this meeting's notices.
  // matterFolder is derived from matterId (falls back to stripping the meeting
  // dir when the matter isn't loaded, e.g. in isolated tests).
  const matterFolder = (() => {
    try {
      return resolveMatterFolder(matterId);
    } catch {
      return meetingDir.replace(/\/Meetings\/[^/]+$/, '');
    }
  })();

  const reloadNotices = useCallback(async () => {
    const ws = workspaceService;
    if (!ws) return;
    try {
      setNotices(await makeConsentLedger(ws, () => matterFolder).noticesForMeeting(meetingDir));
    } catch { /* ledger unreadable — leave notices as-is */ }
  }, [workspaceService, matterFolder, meetingDir]);

  // Verify the spoken notice (idempotent; no-ops until the transcript exists)
  // and load the notice trail whenever the meeting or its transcript changes.
  // reloadNotices is keyed to meetingDir, so a dir change re-runs with the
  // correct target; setNotices after unmount is a harmless no-op in React 18.
  useEffect(() => {
    void (async () => {
      await ensureMeetingNoticeVerified(meetingDir, matterId);
      await reloadNotices();
    })();
  }, [meetingDir, matterId, transcript, reloadNotices]);

  const handleRecordNotice = useCallback(async (entry: NoticeEntry) => {
    const ws = workspaceService;
    if (!ws) return;
    try {
      await makeConsentLedger(ws, () => matterFolder).recordNotice(entry);
      await reloadNotices();
    } catch { /* best-effort */ }
  }, [workspaceService, matterFolder, reloadNotices]);

  const handleSeek = useCallback((ms: number) => {
    setSeekMs(ms);
    audioRef.current?.seek(ms);
  }, []);

  // codex-review (P2): AudioPlayer only mounts once the async audio.wav read
  // resolves (hasAudio flips true), so seeking on component-mount alone hit
  // audioRef.current === null most of the time. Fire once hasAudio becomes
  // true instead, guarded so it only runs the one time (not on every
  // subsequent hasAudio-true render).
  const didInitialSeek = useRef(false);
  useEffect(() => {
    if (initialSeekMs === undefined || didInitialSeek.current || !hasAudio) return;
    didInitialSeek.current = true;
    audioRef.current?.seek(initialSeekMs);
  }, [initialSeekMs, hasAudio]);

  const handleDeleteAudio = useCallback(async () => {
    const ws = workspaceService;
    if (!ws) return;
    await ws.delete(`${meetingDir}/audio.wav`);
    setAudioSrc(null);
    setHasAudio(false);
    void audit.logDurable('meeting_audio_deleted', 'Meeting audio deleted (transcript kept)', {
      metadata: { matterId, meetingDir },
    });
  }, [matterId, meetingDir, workspaceService]);

  const handleMarkReviewed = useCallback(async () => {
    if (!meta) return;
    await markMeetingReviewed(meetingDir, meta);
    setMeta({ ...meta, reviewedAt: new Date().toISOString() });
  }, [meetingDir, meta]);

  // QA-31 — "Retry" once notesError is set: re-runs generation, then
  // re-reads meeting.json (for the cleared/updated notesError) and notes.docx
  // (for the newly-written file) so the pane reflects the outcome without a
  // manual reload.
  const handleRetryNotes = useCallback(async () => {
    const ws = workspaceService;
    setRetryingNotes(true);
    try {
      await retryMeetingNotes(meetingDir, matterId);
    } finally {
      setRetryingNotes(false);
    }
    if (!ws) return;
    try {
      setMeta(JSON.parse(await ws.readFile(`${meetingDir}/meeting.json`)) as MeetingMeta);
    } catch { /* unreadable */ }
    try {
      // codex-review (coordinator P2): notes.docx is binary — reading it as
      // text can throw on real docx bytes even though the write succeeded,
      // which would have fallen back to the "still generating" state right
      // after a SUCCESSFUL retry. exists() is a decode-free presence check.
      setHasNotes(await ws.exists(`${meetingDir}/notes.docx`));
    } catch {
      setHasNotes(false);
    }
  }, [meetingDir, matterId, workspaceService]);

  // QA-40 — "Retry" once transcriptError is set: re-runs transcription (Rust
  // resumes from .transcribe-progress.json), then re-reads meeting.json and
  // transcript.json so the pane reflects the outcome without a manual reload.
  const handleRetryTranscript = useCallback(async () => {
    const ws = workspaceService;
    setRetryingTranscript(true);
    try {
      await retryMeetingTranscript(meetingDir, workspaceRoot, matterId);
    } finally {
      setRetryingTranscript(false);
    }
    if (!ws) return;
    try {
      setMeta(JSON.parse(await ws.readFile(`${meetingDir}/meeting.json`)) as MeetingMeta);
    } catch { /* unreadable */ }
    try {
      const raw = await ws.readFile(`${meetingDir}/transcript.json`);
      setTranscript(JSON.parse(raw) as TranscriptFile);
    } catch { /* still not there */ }
    try {
      setHasNotes(await ws.exists(`${meetingDir}/notes.docx`));
    } catch {
      setHasNotes(false);
    }
  }, [meetingDir, matterId, workspaceRoot, workspaceService]);

  const handleSaveType = useCallback(async () => {
    const entered = typeInput.trim();
    if (!entered || !meta || !workspaceService) { setEditingType(false); return; }
    // The input shows the human label, never the internal id — map a label
    // back to its built-in type id; anything else is saved as a custom type.
    const typeId =
      BUILT_IN_TYPES.find((id) => meetingTypeLabel(id, t).toLowerCase() === entered.toLowerCase()) ?? entered;
    const updated: MeetingMeta = { ...meta, typeId };
    await writeMeetingJson(meetingDir, updated);
    await makeMeetingTypesStore(workspaceService).learnCorrection(meta.calendarTitle ?? folderName, typeId);
    setMeta(updated);
    setEditingType(false);
  }, [typeInput, meta, meetingDir, folderName, workspaceService, t]);

  return (
    <div data-testid="meeting-entry" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--kp-divider)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" data-testid="meeting-entry-back" onClick={onBack} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex' }}>
            <ChevronLeft style={{ width: 18, height: 18 }} />
          </button>
          <div style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--color-muted-foreground)' }}>
            {clientName} / {t('meetings.entry.breadcrumb-meetings')} / <span style={{ color: 'var(--kp-navy)', fontWeight: 'var(--kp-weight-semibold)' }}>{meetingDisplayTitle(meta, t)}</span>
            {dateDurationLine(meta, t) && (
              <span> · {dateDurationLine(meta, t)}</span>
            )}
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          {meta && !meta.reviewedAt && (
            <button
              type="button"
              data-testid="meeting-entry-mark-reviewed"
              onClick={() => { void handleMarkReviewed(); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <Check style={{ width: 12, height: 12 }} />
              {t('meetings.entry.mark-reviewed')}
            </button>
          )}
          {meta?.reviewedAt && (
            <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>{t('meetings.entry.reviewed')}</span>
          )}
          {hasAudio && (
            <button
              type="button"
              data-testid="meeting-entry-delete-audio"
              onClick={() => { setConfirmingDelete(true); }}
              style={{ display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: 'pointer', fontFamily: 'inherit' }}
            >
              <Trash2 style={{ width: 12, height: 12 }} />
              {t('meetings.entry.delete-audio')}
            </button>
          )}
        </div>
      </div>

      {(consentLabel(meta, t) ?? meta?.typeId) && (
        <div style={{ padding: '8px var(--kp-gutter) 0', display: 'flex', alignItems: 'center', gap: 8, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
          {consentLabel(meta, t) && <span>{consentLabel(meta, t)}</span>}
          {meta?.typeId && !editingType && (
            <span data-testid="meeting-type-chip" style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              · {meetingTypeLabel(meta.typeId, t)}
              <button
                type="button"
                data-testid="meeting-type-change"
                onClick={() => { setTypeInput(meta.typeId ? meetingTypeLabel(meta.typeId, t) : ''); setEditingType(true); }}
                style={{ border: 'none', background: 'transparent', color: 'var(--kp-accent)', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit', padding: 0 }}
              >
                {t('meetings.entry.type-chip-change')}
              </button>
            </span>
          )}
          {editingType && (
            <span style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
              <input
                data-testid="meeting-type-input"
                value={typeInput}
                onChange={(e) => { setTypeInput(e.target.value); }}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') void handleSaveType();
                  if (e.key === 'Escape') setEditingType(false);
                }}
                style={{ fontSize: 'var(--kp-font-xs)', border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-sm)', padding: '2px 6px' }}
              />
              <button type="button" data-testid="meeting-type-save" onClick={() => { void handleSaveType(); }} style={{ border: 'none', background: 'transparent', color: 'var(--kp-accent)', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit', padding: 0 }}>
                <Check style={{ width: 12, height: 12 }} />
              </button>
            </span>
          )}
        </div>
      )}

      {/* Recording Notice Kit — the notice trail (verified chip / needs-review
          / quarantine + copy actions), bound to this meeting. Hidden for
          dictated notes, which have no meeting audio or spoken notice. */}
      {meta && !meta.dictation && (
        <NoticeTrail
          meetingDir={meetingDir}
          notices={notices}
          policy={noticePolicy}
          inviteDisclosure={t('meetings.notice.invite-disclosure')}
          chatNotice={t('meetings.notice.chat-notice')}
          onRecordNotice={handleRecordNotice}
        />
      )}

      {hasAudio && audioSrc && (
        <div style={{ padding: '8px var(--kp-gutter)', borderBottom: '1px solid var(--kp-divider)' }}>
          {/* compact: a slim scrub row — the meeting page's stars are the
              notes + transcript below, never the player (UX review B4). */}
          <AudioPlayer ref={audioRef} audioSrc={audioSrc} filename={meetingDisplayTitle(meta, t)} compact />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--kp-divider)', overflow: 'auto' }}>
          {hasNotes && DocxEditorComp ? (
            <DocxEditorComp filePath={`${meetingDir}/notes.docx`} fileName="notes.docx" />
          ) : meta?.notesError ? (
            <div
              data-testid="meeting-entry-notes-failed"
              style={{ padding: 'var(--kp-gutter)', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}
            >
              <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)' }}>
                {meta.notesError.kind === 'gate-blocked' && t('meetings.entry.notes-failed-blocked')}
                {meta.notesError.kind === 'timeout' && t('meetings.entry.notes-failed-timeout')}
                {meta.notesError.kind === 'error' && t('meetings.entry.notes-failed-error')}
              </div>
              <button
                type="button"
                data-testid="meeting-entry-retry-notes"
                onClick={() => { void handleRetryNotes(); }}
                disabled={retryingNotes}
                style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {retryingNotes ? t('meetings.entry.retrying-notes') : t('meetings.tab.retry-button')}
              </button>
            </div>
          ) : (
            <div data-testid="meeting-entry-notes-pending" style={{ padding: 'var(--kp-gutter)', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
              {t('meetings.entry.notes-pending')}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 'var(--kp-gutter)' }}>
          {transcript ? (
            <TranscriptViewer transcript={transcript} onSeek={handleSeek} {...(seekMs !== undefined ? { activeMs: seekMs } : {})} />
          ) : meta?.transcriptError ? (
            <div
              data-testid="meeting-entry-transcript-failed"
              style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}
            >
              <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)' }}>
                {meta.transcriptError.kind === 'not-installed' && t('meetings.entry.transcript-failed-not-installed')}
                {meta.transcriptError.kind === 'timeout' && t('meetings.entry.transcript-failed-timeout')}
                {meta.transcriptError.kind === 'error' && t('meetings.entry.transcript-failed-error')}
              </div>
              <button
                type="button"
                data-testid="meeting-entry-retry-transcript"
                onClick={() => { void handleRetryTranscript(); }}
                disabled={retryingTranscript}
                style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: 'pointer', fontFamily: 'inherit' }}
              >
                {retryingTranscript ? t('meetings.entry.retrying-transcript') : t('meetings.tab.retry-button')}
              </button>
            </div>
          ) : (
            <div data-testid="meeting-entry-transcript-pending" style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
              {t('meetings.entry.transcript-pending')}
            </div>
          )}
          {transcript && (
            <div style={{ marginTop: 'var(--kp-space-lg)' }}>
              <SpeakerNamesPanel meetingDir={meetingDir} matterId={matterId} workspaceRoot={workspaceRoot} />
            </div>
          )}
        </div>
      </div>

      {/* Deleting the only recording of a client meeting is irreversible —
          destructive ops always confirm (core app rule; UX review B7). */}
      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent className="sm:max-w-[400px]" data-testid="delete-audio-confirm">
          <DialogHeader>
            <DialogTitle>{t('meetings.entry.delete-audio-confirm-title')}</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>
            {t('meetings.entry.delete-audio-confirm-body')}
          </p>
          <DialogFooter>
            <DialogButton variant="secondary" onClick={() => { setConfirmingDelete(false); }}>
              {t('meetings.dictation.cancel')}
            </DialogButton>
            <DialogButton
              variant="destructive"
              data-testid="delete-audio-confirm-button"
              onClick={() => {
                setConfirmingDelete(false);
                void handleDeleteAudio();
              }}
            >
              {t('meetings.entry.delete-audio-confirm-button')}
            </DialogButton>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  );
}

export default MeetingEntry;
