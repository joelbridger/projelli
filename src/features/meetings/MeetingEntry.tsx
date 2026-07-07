/**
 * MeetingEntry — the meeting page: date/duration/consent, a retention
 * action, and three review tabs: Recording, Transcript, Summary. Opened from
 * both the client's Meetings tab and its Activity timeline entry.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Trash2, Check, Pencil, Copy, Download, FileText } from 'lucide-react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { arrayBufferToDataUrl } from '@/platform/utils/file-utils';
import { AudioPlayer, type AudioPlayerHandle } from '@/features/dictation/audio/AudioPlayer';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from '@/ui/dialog';
import { Button as DialogButton } from '@/ui/button';
import { TranscriptViewer } from './TranscriptViewer';
import { SpeakerNamesPanel } from './SpeakerNamesPanel';
import { MeetingRecipientsPanel } from './MeetingRecipientsPanel';
import { AuditService } from '@/platform/audit/AuditService';
import { markMeetingReviewed, updateMeetingJson, retryMeetingNotes, retryMeetingTranscript, ensureMeetingNoticeVerified, resolveMatterFolder } from './meetingStore';
import type { MeetingMeta } from './meetingStore';
import { NoticeTrail } from './NoticeTrail';
import { makeConsentLedger } from './consentLedger';
import type { NoticeEntry } from './noticeLedger';
import { useNoticeSettings } from './noticeSettings';
import { meetingDisplayTitle, meetingTypeLabel, formatMeetingDate, formatMeetingDuration } from './meetingDisplay';
import { mmss } from './meetingSources';
import { makeMeetingTypesStore, BUILT_IN_TYPES } from './meetingTypes';
import type { TranscriptFile } from '@/platform/types/meeting';
import type { TFunction } from 'i18next';
import { markdownToDocxBytes, applyLetterheadIfConfigured, extractDocxText } from '@/platform/utils/docx-io';
import { docxConvertToPdf } from '@/platform/utils/docx-commands';
import { useMatterStore } from '@/platform/matter/matterStore';

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

type MeetingEntryTab = 'recording' | 'transcript' | 'summary';

function sanitizeFileStem(value: string): string {
  return value
    .trim()
    .replace(/[\\/:*?"<>|]+/g, '-')
    .replace(/\s+/g, ' ')
    .slice(0, 80)
    .replace(/[.\s-]+$/g, '') || 'meeting';
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength);
}

function transcriptToText(transcript: TranscriptFile | null): string {
  if (!transcript) return '';
  return transcript.segments
    .map((seg) => `${mmss(seg.startMs)} ${seg.speaker}: ${seg.text}`)
    .join('\n');
}

function transcriptLooksSilent(transcript: TranscriptFile | null): boolean {
  return !!transcript && transcript.segments.every((seg) => !seg.text.trim());
}

export function MeetingEntry({ matterId, meetingDir, folderName, clientName, workspaceRoot, onBack, initialSeekMs, workspaceService }: MeetingEntryProps) {
  const { t } = useTranslation();
  const [meta, setMeta] = useState<MeetingMeta | null>(null);
  const [transcript, setTranscript] = useState<TranscriptFile | null>(null);
  const [hasNotes, setHasNotes] = useState(false);
  const [summaryText, setSummaryText] = useState('');
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [seekMs, setSeekMs] = useState<number | undefined>(initialSeekMs);
  const [activeTab, setActiveTab] = useState<MeetingEntryTab>('recording');
  const [editingType, setEditingType] = useState(false);
  const [typeInput, setTypeInput] = useState('');
  const [renaming, setRenaming] = useState(false);
  const [titleInput, setTitleInput] = useState('');
  const [exporting, setExporting] = useState<string | null>(null);
  const [exportNotice, setExportNotice] = useState<string | null>(null);
  const [confirmingDelete, setConfirmingDelete] = useState(false);
  const [retryingNotes, setRetryingNotes] = useState(false);
  const [retryingTranscript, setRetryingTranscript] = useState(false);
  const [notices, setNotices] = useState<NoticeEntry[]>([]);
  const audioRef = useRef<AudioPlayerHandle>(null);
  const didInitialSeek = useRef(false);
  const meetingLoadToken = useRef(0);
  const { policy: noticePolicy } = useNoticeSettings();
  const matter = useMatterStore((state) => state.matters.find((candidate) => candidate.id === matterId) ?? null);
  const hasTranscript = transcript !== null;
  const summaryReady = hasNotes && summaryText.trim().length > 0;

  useEffect(() => {
    const token = ++meetingLoadToken.current;
    const isCurrentLoad = () => token === meetingLoadToken.current;
    setMeta(null);
    setTranscript(null);
    setHasNotes(false);
    setSummaryText('');
    setAudioSrc(null);
    setHasAudio(false);
    setSeekMs(initialSeekMs);
    setExporting(null);
    setExportNotice(null);
    setNotices([]);
    setRetryingNotes(false);
    setRetryingTranscript(false);
    didInitialSeek.current = false;
    // eslint-disable-next-line lantern-async/no-silent-failure -- each meeting-file read below renders a safe empty/pending state on failure
    void (async () => {
      const ws = workspaceService;
      if (!ws) return;
      try {
        const raw = await ws.readFile(`${meetingDir}/meeting.json`);
        if (isCurrentLoad()) setMeta(JSON.parse(raw) as MeetingMeta);
      } catch {
        if (isCurrentLoad()) setMeta(null);
      }
      try {
        const raw = await ws.readFile(`${meetingDir}/transcript.json`);
        if (isCurrentLoad()) setTranscript(JSON.parse(raw) as TranscriptFile);
      } catch {
        if (isCurrentLoad()) setTranscript(null);
      }
      try {
        // codex-review (coordinator P2): notes.docx is binary — readFile is
        // the TEXT reader (readTextFile on Tauri) and can throw decoding real
        // docx bytes even though the file exists. exists() is the correct,
        // decode-free presence check.
        const notesExists = await ws.exists(`${meetingDir}/notes.docx`);
        if (isCurrentLoad()) setHasNotes(notesExists);
        if (notesExists) {
          try {
            const notesBytes = await ws.readFileBinary(`${meetingDir}/notes.docx`);
            const extracted = await extractDocxText(notesBytes);
            if (isCurrentLoad()) setSummaryText(extracted.plainText.trim());
          } catch {
            if (isCurrentLoad()) setSummaryText('');
          }
        } else if (isCurrentLoad()) {
          setSummaryText('');
        }
      } catch {
        if (isCurrentLoad()) {
          setHasNotes(false);
          setSummaryText('');
        }
      }
      try {
        const buffer = await ws.readFileBinary(`${meetingDir}/audio.wav`);
        if (isCurrentLoad()) {
          setAudioSrc(arrayBufferToDataUrl(buffer, 'audio/wav'));
          setHasAudio(true);
        }
      } catch {
        if (isCurrentLoad()) {
          setAudioSrc(null);
          setHasAudio(false);
        }
      }
    })();
    return () => { meetingLoadToken.current += 1; };
  }, [meetingDir, workspaceService, initialSeekMs]);

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
  const documentsDir = `${matterFolder}/Documents`;

  // A monotonically-increasing token, bumped whenever the displayed meeting
  // changes. A notices read for a PRIOR meeting that finishes late must NOT set
  // state for the meeting now on screen — showing a different meeting's
  // verified/resolved/quarantined status is the one thing this compliance
  // surface must never do (coordinator P2). The load is guarded by this token,
  // and the trail is cleared on every meeting switch.
  const noticeLoadToken = useRef(0);

  const loadNotices = useCallback(async (token: number) => {
    const ws = workspaceService;
    if (!ws) return;
    let loaded: NoticeEntry[];
    try {
      loaded = await makeConsentLedger(ws, () => matterFolder).noticesForMeeting(meetingDir);
    } catch {
      if (token === noticeLoadToken.current) setNotices([]);
      return; // failed read — leave the cleared state; never show a stale trail.
    }
    if (token === noticeLoadToken.current) setNotices(loaded);
  }, [workspaceService, matterFolder, meetingDir]);

  // Verify the spoken notice (idempotent; no-ops until the transcript exists)
  // and load THIS meeting's notice trail. Clears the trail immediately on a
  // meeting switch, then guards the async result by token so a slow read for
  // the previous meeting is discarded rather than rendered under the new one.
  useEffect(() => {
    const token = ++noticeLoadToken.current;
    setNotices([]);
    void (async () => {
      await ensureMeetingNoticeVerified(meetingDir, matterId);
      await loadNotices(token);
    })().catch(() => {
      if (token === noticeLoadToken.current) setNotices([]);
    });
  }, [meetingDir, matterId, transcript, loadNotices]);

  const handleRecordNotice = useCallback(async (entry: NoticeEntry) => {
    const ws = workspaceService;
    if (!ws) return;
    try {
      await makeConsentLedger(ws, () => matterFolder).recordNotice(entry);
      await loadNotices(noticeLoadToken.current);
    } catch {
      setNotices([]);
    }
  }, [workspaceService, matterFolder, loadNotices]);

  const handleSeek = useCallback((ms: number) => {
    setSeekMs(ms);
    audioRef.current?.seek(ms);
  }, []);

  // codex-review (P2): AudioPlayer only mounts once the async audio.wav read
  // resolves (hasAudio flips true), so seeking on component-mount alone hit
  // audioRef.current === null most of the time. Fire once hasAudio becomes
  // true instead, guarded so it only runs the one time (not on every
  // subsequent hasAudio-true render).
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
    }).catch((err: unknown) => {
      setExportNotice(err instanceof Error ? err.message : String(err));
    });
  }, [matterId, meetingDir, workspaceService]);

  const handleMarkReviewed = useCallback(async () => {
    if (!meta) return;
    const updated = await markMeetingReviewed(meetingDir);
    if (updated) setMeta(updated);
  }, [meetingDir, meta]);

  // QA-31 — "Retry" once notesError is set: re-runs generation, then
  // re-reads meeting.json (for the cleared/updated notesError) and notes.docx
  // (for the newly-written file) so the pane reflects the outcome without a
  // manual reload.
  const handleRetryNotes = useCallback(async () => {
    const ws = workspaceService;
    const token = meetingLoadToken.current;
    const isCurrentLoad = () => token === meetingLoadToken.current;
    setRetryingNotes(true);
    try {
      await retryMeetingNotes(meetingDir, matterId);
    } finally {
      if (isCurrentLoad()) setRetryingNotes(false);
    }
    if (!ws || !isCurrentLoad()) return;
    try {
      const raw = await ws.readFile(`${meetingDir}/meeting.json`);
      if (isCurrentLoad()) setMeta(JSON.parse(raw) as MeetingMeta);
    } catch {
      if (isCurrentLoad()) setMeta(null);
    }
    try {
      // codex-review (coordinator P2): notes.docx is binary — reading it as
      // text can throw on real docx bytes even though the write succeeded,
      // which would have fallen back to the "still generating" state right
      // after a SUCCESSFUL retry. exists() is a decode-free presence check.
      const notesExists = await ws.exists(`${meetingDir}/notes.docx`);
      if (!isCurrentLoad()) return;
      setHasNotes(notesExists);
      if (notesExists) {
        try {
          const notesBytes = await ws.readFileBinary(`${meetingDir}/notes.docx`);
          const extracted = await extractDocxText(notesBytes);
          if (isCurrentLoad()) setSummaryText(extracted.plainText.trim());
        } catch {
          if (isCurrentLoad()) setSummaryText('');
        }
      } else {
        setSummaryText('');
      }
    } catch {
      if (isCurrentLoad()) {
        setHasNotes(false);
        setSummaryText('');
      }
    }
  }, [meetingDir, matterId, workspaceService]);

  // QA-40 — "Retry" once transcriptError is set: re-runs transcription (Rust
  // resumes from .transcribe-progress.json), then re-reads meeting.json and
  // transcript.json so the pane reflects the outcome without a manual reload.
  const handleRetryTranscript = useCallback(async () => {
    const ws = workspaceService;
    const token = meetingLoadToken.current;
    const isCurrentLoad = () => token === meetingLoadToken.current;
    setRetryingTranscript(true);
    try {
      await retryMeetingTranscript(meetingDir, workspaceRoot, matterId);
    } finally {
      if (isCurrentLoad()) setRetryingTranscript(false);
    }
    if (!ws || !isCurrentLoad()) return;
    try {
      const raw = await ws.readFile(`${meetingDir}/meeting.json`);
      if (isCurrentLoad()) setMeta(JSON.parse(raw) as MeetingMeta);
    } catch {
      if (isCurrentLoad()) setMeta(null);
    }
    try {
      const raw = await ws.readFile(`${meetingDir}/transcript.json`);
      if (isCurrentLoad()) setTranscript(JSON.parse(raw) as TranscriptFile);
    } catch {
      if (isCurrentLoad()) setTranscript(null);
    }
    try {
      const notesExists = await ws.exists(`${meetingDir}/notes.docx`);
      if (isCurrentLoad()) setHasNotes(notesExists);
    } catch {
      if (isCurrentLoad()) setHasNotes(false);
    }
  }, [meetingDir, matterId, workspaceRoot, workspaceService]);

  const handleSaveType = useCallback(async () => {
    const entered = typeInput.trim();
    if (!entered || !meta || !workspaceService) { setEditingType(false); return; }
    // The input shows the human label, never the internal id — map a label
    // back to its built-in type id; anything else is saved as a custom type.
    const typeId =
      BUILT_IN_TYPES.find((id) => meetingTypeLabel(id, t).toLowerCase() === entered.toLowerCase()) ?? entered;
    const updated = await updateMeetingJson(meetingDir, (current) => ({ ...current, typeId }));
    await makeMeetingTypesStore(workspaceService).learnCorrection(meta.calendarTitle ?? folderName, typeId);
    if (updated) setMeta(updated);
    setEditingType(false);
  }, [typeInput, meta, meetingDir, folderName, workspaceService, t]);

  const handleSaveTitle = useCallback(async () => {
    if (!meta || !workspaceService) { setRenaming(false); return; }
    const entered = titleInput.trim();
    const updated = await updateMeetingJson(meetingDir, (current) => {
      if (entered) return { ...current, customTitle: entered };
      const { customTitle: _customTitle, ...rest } = current;
      return rest;
    });
    if (updated) setMeta(updated);
    setRenaming(false);
  }, [meta, titleInput, meetingDir, workspaceService]);

  const copyText = useCallback(async (text: string, notice: string) => {
    await navigator.clipboard.writeText(text);
    setExportNotice(notice);
  }, []);

  const summaryMarkdown = useCallback(() => {
    if (!summaryReady) throw new Error(t('meetings.entry.summary-not-ready'));
    const title = meetingDisplayTitle(meta, t);
    return `# ${title}\n\n${summaryText.trim()}`;
  }, [meta, summaryReady, summaryText, t]);

  const uniqueExportPath = useCallback(async (stem: string, ext: 'docx' | 'pdf'): Promise<string> => {
    const ws = workspaceService;
    if (!ws) return `${documentsDir}/${stem}.${ext}`;
    let candidate = `${documentsDir}/${stem}.${ext}`;
    let suffix = 2;
    while (await ws.exists(candidate)) {
      candidate = `${documentsDir}/${stem} ${String(suffix)}.${ext}`;
      suffix += 1;
    }
    return candidate;
  }, [workspaceService, documentsDir]);

  const exportSummaryDocx = useCallback(async (): Promise<string | null> => {
    const ws = workspaceService;
    if (!ws) return null;
    if (!summaryReady) throw new Error(t('meetings.entry.summary-not-ready'));
    const stem = sanitizeFileStem(`${meetingDisplayTitle(meta, t)} summary`);
    const path = await uniqueExportPath(stem, 'docx');
    const bytes = await markdownToDocxBytes(summaryMarkdown(), `${stem}.docx`);
    const finalBytes = await applyLetterheadIfConfigured(bytes);
    await ws.writeFileBinary(path, toExactArrayBuffer(finalBytes));
    return path;
  }, [workspaceService, summaryReady, meta, t, uniqueExportPath, summaryMarkdown]);

  const buildSummaryDocxBytes = useCallback(async (): Promise<Uint8Array> => {
    if (!summaryReady) throw new Error(t('meetings.entry.summary-not-ready'));
    const stem = sanitizeFileStem(`${meetingDisplayTitle(meta, t)} summary`);
    const bytes = await markdownToDocxBytes(summaryMarkdown(), `${stem}.docx`);
    return applyLetterheadIfConfigured(bytes);
  }, [summaryReady, meta, t, summaryMarkdown]);

  const runExport = useCallback(async (kind: string, work: () => Promise<string | null>) => {
    setExporting(kind);
    setExportNotice(null);
    try {
      const path = await work();
      if (path) setExportNotice(t('meetings.entry.export-saved', { path }));
    } catch (err) {
      setExportNotice(err instanceof Error ? err.message : String(err));
    } finally {
      setExporting(null);
    }
  }, [t]);

  const handleExportSummaryDocx = useCallback(() => {
    void runExport('summary-docx', exportSummaryDocx).catch((err: unknown) => {
      setExportNotice(err instanceof Error ? err.message : String(err));
    });
  }, [runExport, exportSummaryDocx]);

  const handleExportSummaryPdf = useCallback(() => {
    void runExport('summary-pdf', async () => {
      const ws = workspaceService;
      if (!ws) return null;
      const tempStem = sanitizeFileStem(`${meetingDisplayTitle(meta, t)} summary`);
      const tempDocxPath = `${meetingDir}/.summary-pdf-${String(Date.now())}-${Math.random().toString(36).slice(2)}.docx`;
      try {
        const finalBytes = await buildSummaryDocxBytes();
        await ws.writeFileBinary(tempDocxPath, toExactArrayBuffer(finalBytes));
        const pdfSource = await docxConvertToPdf(tempDocxPath);
        const { readFile } = await import('@tauri-apps/plugin-fs');
        const pdfBytes = await readFile(pdfSource);
        const pdfPath = await uniqueExportPath(tempStem, 'pdf');
        await ws.writeFileBinary(pdfPath, toExactArrayBuffer(pdfBytes));
        return pdfPath;
      } finally {
        await ws.delete(tempDocxPath).catch(() => undefined);
      }
    }).catch((err: unknown) => {
      setExportNotice(err instanceof Error ? err.message : String(err));
    });
  }, [workspaceService, runExport, meta, t, meetingDir, buildSummaryDocxBytes, uniqueExportPath]);

  const handleExportTranscript = useCallback(() => {
    void runExport('transcript', async () => {
      const ws = workspaceService;
      if (!ws || !transcript) return null;
      const path = `${meetingDir}/transcript.txt`;
      await ws.writeFile(path, transcriptToText(transcript));
      return path;
    }).catch((err: unknown) => {
      setExportNotice(err instanceof Error ? err.message : String(err));
    });
  }, [workspaceService, transcript, meetingDir, runExport]);

  const handleDownloadAudio = useCallback(() => {
    if (!audioSrc) return;
    const a = document.createElement('a');
    a.href = audioSrc;
    a.download = `${sanitizeFileStem(meetingDisplayTitle(meta, t))}.wav`;
    a.click();
  }, [audioSrc, meta, t]);

  return (
    <div data-testid="meeting-entry" style={{ display: 'flex', flexDirection: 'column', height: '100%' }}>
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: 'var(--kp-surface-header-pad)', borderBottom: '1px solid var(--kp-divider)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
          <button type="button" data-testid="meeting-entry-back" onClick={onBack} style={{ border: 'none', background: 'transparent', cursor: 'pointer', display: 'flex' }}>
            <ChevronLeft style={{ width: 18, height: 18 }} />
          </button>
          <div style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--color-muted-foreground)', display: 'flex', alignItems: 'center', gap: 6, flexWrap: 'wrap' }}>
            <span>{clientName} / {t('meetings.entry.breadcrumb-meetings')} /</span>
            {renaming ? (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <input
                  data-testid="meeting-title-input"
                  value={titleInput}
                  onChange={(e) => { setTitleInput(e.target.value); }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') void handleSaveTitle().catch((err: unknown) => {
                      setExportNotice(err instanceof Error ? err.message : String(err));
                    });
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  style={{ fontSize: 'var(--kp-font-sm)', border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-sm)', padding: '3px 6px' }}
                />
                <button type="button" data-testid="meeting-title-save" onClick={() => { void handleSaveTitle().catch((err: unknown) => { setExportNotice(err instanceof Error ? err.message : String(err)); }); }} style={{ border: 'none', background: 'transparent', color: 'var(--kp-accent)', cursor: 'pointer', display: 'inline-flex' }}>
                  <Check style={{ width: 13, height: 13 }} />
                </button>
              </span>
            ) : (
              <span style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}>
                <span style={{ color: 'var(--kp-navy)', fontWeight: 'var(--kp-weight-semibold)' }}>{meetingDisplayTitle(meta, t)}</span>
                <button
                  type="button"
                  data-testid="meeting-title-rename"
                  aria-label={t('meetings.entry.rename')}
                  onClick={() => { setTitleInput(meetingDisplayTitle(meta, t)); setRenaming(true); }}
                  style={{ border: 'none', background: 'transparent', color: 'var(--color-muted-foreground)', cursor: 'pointer', display: 'inline-flex', padding: 2 }}
                >
                  <Pencil style={{ width: 12, height: 12 }} />
                </button>
              </span>
            )}
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
	              onClick={() => { void handleMarkReviewed().catch((err: unknown) => { setExportNotice(err instanceof Error ? err.message : String(err)); }); }}
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
              {t(hasTranscript ? 'meetings.entry.delete-audio' : 'meetings.entry.delete-audio-no-transcript')}
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

      {meta && (
        <MeetingRecipientsPanel
          matterId={matterId}
          meetingDir={meetingDir}
          meta={meta}
          matter={matter}
          workspaceService={workspaceService}
          onSaved={setMeta}
        />
      )}

      <div style={{ borderBottom: '1px solid var(--kp-divider)', padding: '10px var(--kp-gutter) 0', display: 'flex', gap: 6 }}>
        <button
          type="button"
          data-testid="meeting-subtab-recording"
          onClick={() => { setActiveTab('recording'); }}
          style={{
            border: 'none',
            borderBottom: activeTab === 'recording' ? '2px solid var(--kp-accent)' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'recording' ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
            fontFamily: 'inherit',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: activeTab === 'recording' ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-regular)',
            padding: '8px 10px',
            cursor: 'pointer',
          }}
        >
          {t('meetings.entry.tab-recording')}
        </button>
        <button
          type="button"
          data-testid="meeting-subtab-transcript"
          onClick={() => { setActiveTab('transcript'); }}
          style={{
            border: 'none',
            borderBottom: activeTab === 'transcript' ? '2px solid var(--kp-accent)' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'transcript' ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
            fontFamily: 'inherit',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: activeTab === 'transcript' ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-regular)',
            padding: '8px 10px',
            cursor: 'pointer',
          }}
        >
          {t('meetings.entry.tab-transcript')}
        </button>
        <button
          type="button"
          data-testid="meeting-subtab-summary"
          onClick={() => { setActiveTab('summary'); }}
          style={{
            border: 'none',
            borderBottom: activeTab === 'summary' ? '2px solid var(--kp-accent)' : '2px solid transparent',
            background: 'transparent',
            color: activeTab === 'summary' ? 'var(--kp-navy)' : 'var(--color-muted-foreground)',
            fontFamily: 'inherit',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: activeTab === 'summary' ? 'var(--kp-weight-semibold)' : 'var(--kp-weight-regular)',
            padding: '8px 10px',
            cursor: 'pointer',
          }}
        >
          {t('meetings.entry.tab-summary')}
        </button>
      </div>

      {exportNotice && (
        <div data-testid="meeting-entry-export-notice" style={{ padding: '8px var(--kp-gutter) 0', color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-xs)' }}>
          {exportNotice}
        </div>
      )}

      <div style={{ flex: 1, minHeight: 0, overflow: 'auto', padding: 'var(--kp-gutter)' }}>
        {activeTab === 'recording' && (
          <div data-testid="meeting-recording-tab" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
            {hasAudio && audioSrc ? (
              <>
                <AudioPlayer ref={audioRef} audioSrc={audioSrc} filename={meetingDisplayTitle(meta, t)} compact />
                <button
                  type="button"
                  data-testid="meeting-audio-download"
                  onClick={handleDownloadAudio}
                  style={{ alignSelf: 'flex-start', display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: 'pointer', fontFamily: 'inherit' }}
                >
                  <Download style={{ width: 13, height: 13 }} />
                  {t('meetings.entry.download-audio')}
                </button>
              </>
            ) : meta?.recordingError && !hasAudio ? (
              <div data-testid="meeting-entry-recording-incomplete" style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)' }}>
                {t('meetings.entry.recording-incomplete')}
              </div>
            ) : (
              <div data-testid="meeting-entry-no-audio" style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
                {t('meetings.entry.no-audio')}
              </div>
            )}
            {transcriptLooksSilent(transcript) && (
              <div data-testid="meeting-entry-no-one-spoke" style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
                {t('meetings.entry.no-one-spoke')}
              </div>
            )}
          </div>
        )}

        {activeTab === 'transcript' && (
          <div data-testid="meeting-transcript-tab" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button
                type="button"
                data-testid="meeting-transcript-copy"
                onClick={() => { void copyText(transcriptToText(transcript), t('meetings.entry.transcript-copied')); }}
                disabled={!transcript}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: transcript ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
              >
                <Copy style={{ width: 13, height: 13 }} />
                {t('meetings.entry.copy')}
              </button>
              <button
                type="button"
                data-testid="meeting-transcript-export"
                onClick={handleExportTranscript}
                disabled={!transcript || exporting === 'transcript'}
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: transcript ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}
              >
                <Download style={{ width: 13, height: 13 }} />
                {t('meetings.entry.export')}
              </button>
            </div>
            {transcript ? (
              <>
                <TranscriptViewer transcript={transcript} onSeek={handleSeek} {...(seekMs !== undefined ? { activeMs: seekMs } : {})} />
                <div style={{ marginTop: 'var(--kp-space-lg)' }}>
                  <SpeakerNamesPanel meetingDir={meetingDir} matterId={matterId} workspaceRoot={workspaceRoot} />
                </div>
              </>
            ) : meta?.transcriptError ? (
              <div data-testid="meeting-entry-transcript-failed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
                <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)' }}>
                  {meta.transcriptError.kind === 'not-installed' && t('meetings.entry.transcript-failed-not-installed')}
                  {meta.transcriptError.kind === 'timeout' && t('meetings.entry.transcript-failed-timeout')}
                  {meta.transcriptError.kind === 'error' && t('meetings.entry.transcript-failed-error')}
                </div>
                <button type="button" data-testid="meeting-entry-retry-transcript" onClick={() => { void handleRetryTranscript(); }} disabled={retryingTranscript} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {retryingTranscript ? t('meetings.entry.retrying-transcript') : t('meetings.tab.retry-button')}
                </button>
              </div>
            ) : meta?.recordingError && !hasAudio ? (
              <div data-testid="meeting-entry-recording-incomplete-transcript" style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)' }}>
                {t('meetings.entry.recording-incomplete')}
              </div>
            ) : (
              <div data-testid="meeting-entry-transcript-pending" style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
                {t('meetings.entry.transcript-pending')}
              </div>
            )}
          </div>
        )}

        {activeTab === 'summary' && (
          <div data-testid="meeting-summary-tab" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-md)' }}>
            <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
              <button type="button" data-testid="meeting-summary-copy" onClick={() => { void copyText(summaryText.trim(), t('meetings.entry.summary-copied')); }} disabled={!summaryReady} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: summaryReady ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                <Copy style={{ width: 13, height: 13 }} />
                {t('meetings.entry.copy')}
              </button>
              <button type="button" data-testid="meeting-summary-export-docx" onClick={handleExportSummaryDocx} disabled={!summaryReady || exporting === 'summary-docx'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: summaryReady ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                <FileText style={{ width: 13, height: 13 }} />
                {t('meetings.entry.export-word')}
              </button>
              <button type="button" data-testid="meeting-summary-export-pdf" onClick={handleExportSummaryPdf} disabled={!summaryReady || exporting === 'summary-pdf'} style={{ display: 'inline-flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: summaryReady ? 'pointer' : 'not-allowed', fontFamily: 'inherit' }}>
                <Download style={{ width: 13, height: 13 }} />
                {t('meetings.entry.export-pdf')}
              </button>
            </div>
            {summaryReady ? (
              <pre data-testid="meeting-summary-text" style={{ whiteSpace: 'pre-wrap', margin: 0, fontFamily: 'inherit', color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)', lineHeight: 1.6 }}>
                {summaryText.trim()}
              </pre>
            ) : hasNotes ? (
              <div data-testid="meeting-entry-summary-not-ready" style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
                {t('meetings.entry.summary-not-ready')}
              </div>
            ) : meta?.notesError ? (
              <div data-testid="meeting-entry-notes-failed" style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-sm)' }}>
                <div style={{ color: 'var(--kp-navy)', fontSize: 'var(--kp-font-sm)' }}>
                  {meta.notesError.kind === 'gate-blocked' && t('meetings.entry.notes-failed-blocked')}
                  {meta.notesError.kind === 'timeout' && t('meetings.entry.notes-failed-timeout')}
                  {meta.notesError.kind === 'error' && t('meetings.entry.notes-failed-error')}
                </div>
                <button type="button" data-testid="meeting-entry-retry-notes" onClick={() => { void handleRetryNotes(); }} disabled={retryingNotes} style={{ alignSelf: 'flex-start', display: 'flex', alignItems: 'center', gap: 6, border: '1px solid var(--kp-divider)', background: 'transparent', borderRadius: 'var(--radius-md)', padding: '6px 10px', fontSize: 'var(--kp-font-xs)', cursor: 'pointer', fontFamily: 'inherit' }}>
                  {retryingNotes ? t('meetings.entry.retrying-notes') : t('meetings.tab.retry-button')}
                </button>
              </div>
            ) : (
              <div data-testid="meeting-entry-notes-pending" style={{ color: 'var(--color-muted-foreground)', fontSize: 'var(--kp-font-sm)' }}>
                {t('meetings.entry.notes-pending')}
              </div>
            )}
          </div>
        )}
      </div>

      {/* Deleting the only recording of a client meeting is irreversible —
          destructive ops always confirm (core app rule; UX review B7). */}
      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent className="sm:max-w-[400px]" data-testid="delete-audio-confirm">
          <DialogHeader>
            <DialogTitle>{t('meetings.entry.delete-audio-confirm-title')}</DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>
            {t(hasTranscript ? 'meetings.entry.delete-audio-confirm-body' : 'meetings.entry.delete-audio-confirm-body-no-transcript')}
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
