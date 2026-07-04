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
import { TranscriptViewer } from './TranscriptViewer';
import { SpeakerNamesPanel } from './SpeakerNamesPanel';
import { AuditService } from '@/platform/audit/AuditService';
import { markMeetingReviewed, writeMeetingJson } from './meetingStore';
import type { MeetingMeta } from './meetingStore';
import { makeMeetingTypesStore, BUILT_IN_TYPES, type BuiltInMeetingType } from './meetingTypes';
import type { TranscriptFile } from '@/platform/types/meeting';
import type { ComponentType } from 'react';

function isBuiltInType(id: string): id is BuiltInMeetingType {
  return (BUILT_IN_TYPES as readonly string[]).includes(id);
}

function typeLabel(typeId: string, t: (k: string) => string): string {
  return isBuiltInType(typeId) ? t(`meetings.types.${typeId}`) : typeId;
}

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
  const audioRef = useRef<AudioPlayerHandle>(null);

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
        await ws.readFile(`${meetingDir}/notes.docx`);
        if (!cancelled) setHasNotes(true);
      } catch { /* notes still generating */ }
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

  const handleSaveType = useCallback(async () => {
    const typeId = typeInput.trim();
    if (!typeId || !meta || !workspaceService) { setEditingType(false); return; }
    const updated: MeetingMeta = { ...meta, typeId };
    await writeMeetingJson(meetingDir, updated);
    await makeMeetingTypesStore(workspaceService).learnCorrection(meta.calendarTitle ?? folderName, typeId);
    setMeta(updated);
    setEditingType(false);
  }, [typeInput, meta, meetingDir, folderName, workspaceService]);

  return (
    <div data-testid="meeting-entry" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--kp-divider)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" data-testid="meeting-entry-back" onClick={onBack} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex' }}>
            <ChevronLeft style={{ width: 18, height: 18 }} />
          </button>
          <div style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--color-muted-foreground)' }}>
            {clientName} / {t('meetings.entry.breadcrumb-meetings')} / <span style={{ color: 'var(--kp-navy)', fontWeight: 'var(--kp-weight-semibold)' }}>{folderName}</span>
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
              onClick={() => { void handleDeleteAudio(); }}
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
              · {typeLabel(meta.typeId, t)}
              <button
                type="button"
                data-testid="meeting-type-change"
                onClick={() => { setTypeInput(meta.typeId ?? ''); setEditingType(true); }}
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
                onKeyDown={(e) => { if (e.key === 'Enter') void handleSaveType(); }}
                style={{ fontSize: 'var(--kp-font-xs)', border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-sm)', padding: '2px 6px' }}
              />
              <button type="button" data-testid="meeting-type-save" onClick={() => { void handleSaveType(); }} style={{ border: 'none', background: 'transparent', color: 'var(--kp-accent)', cursor: 'pointer', fontSize: 'inherit', fontFamily: 'inherit', padding: 0 }}>
                <Check style={{ width: 12, height: 12 }} />
              </button>
            </span>
          )}
        </div>
      )}

      {hasAudio && audioSrc && (
        <div style={{ padding: '8px var(--kp-gutter)' }}>
          <AudioPlayer ref={audioRef} audioSrc={audioSrc} filename={folderName} />
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, display: 'flex' }}>
        <div style={{ flex: 1, minWidth: 0, borderRight: '1px solid var(--kp-divider)', overflow: 'auto' }}>
          {hasNotes && DocxEditorComp ? (
            <DocxEditorComp filePath={`${meetingDir}/notes.docx`} fileName="notes.docx" />
          ) : (
            <div data-testid="meeting-entry-notes-pending" style={{ padding: 'var(--kp-gutter)', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
              {t('meetings.entry.notes-pending')}
            </div>
          )}
        </div>
        <div style={{ flex: 1, minWidth: 0, overflow: 'auto', padding: 'var(--kp-gutter)' }}>
          {transcript ? (
            <TranscriptViewer transcript={transcript} onSeek={handleSeek} {...(seekMs !== undefined ? { activeMs: seekMs } : {})} />
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
    </div>
  );
}

export default MeetingEntry;
