/**
 * MeetingEntry — the meeting page: date/duration/consent, a retention
 * action, and composable review tabs. Audio remains a secondary media handoff,
 * not a detail tab. Opened from both the client's Meetings tab and its Activity
 * timeline entry.
 */
import { useEffect, useRef, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { ChevronLeft, Check, Pencil } from 'lucide-react';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { arrayBufferToDataUrl } from '@/platform/utils/file-utils';
import {
  AudioPlayer,
  type AudioPlayerHandle,
} from '@/features/dictation/audio/AudioPlayer';
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogFooter,
} from '@/ui/dialog';
import { Button as DialogButton } from '@/ui/button';
import { Badge, SlidePanel } from '@/ui/kp';
import { MeetingSendPanel } from './MeetingSendPanel';
import { AuditService } from '@/platform/audit/AuditService';
import {
  updateMeetingJson,
  retryMeetingNotes,
  retryMeetingTranscript,
  ensureMeetingNoticeVerified,
  resolveMatterFolder,
} from './meetingStore';
import { markMeetingReviewed } from './insights/review/meetingReviewArtifactStore';
import type { MeetingMeta } from './meetingStore';
import { NoticeTrail } from './NoticeTrail';
import { makeConsentLedger } from './consentLedger';
import type { NoticeEntry } from './noticeLedger';
import { useNoticeSettings } from './noticeSettings';
import {
  meetingDisplayTitle,
  meetingTypeLabel,
  formatMeetingDate,
  formatMeetingDuration,
} from './meetingDisplay';
import { mmss } from './meetingSources';
import { makeMeetingTypesStore, BUILT_IN_TYPES } from './meetingTypes';
import type { TranscriptFile } from '@/platform/types/meeting';
import type { TFunction } from 'i18next';
import {
  markdownToDocxBytes,
  applyLetterheadIfConfigured,
  extractDocxText,
  type DocxTextExtraction,
} from '@/platform/utils/docx-io';
import { docxConvertToPdf } from '@/platform/utils/docx-commands';
import { useMatterStore } from '@/platform/matter/matterStore';
import { readTauriFile } from '@/platform/fs/tauriFsPlugin';
import { meetingNoteOutboundGate } from './outboundNoteGate';
import { deriveNoticeState } from './noticeLedger';
import { useFirm } from '@/platform/hooks/useFirm';
import {
  getMeetingPanelComposition,
  type MeetingPanelId,
} from './meetingPanelRegistry';
import { getMeetingHeaderActionComposition } from './meetingHeaderActionRegistry';
import { getMeetingInsightComposition } from './meetingInsightRegistry';
import type { MeetingOpenTarget } from './foundation/contract';
import { resolveMeetingEntryHostIdentity } from './meetingEntryHostIdentity';

export interface MeetingEntryProps {
  matterId: string;
  meetingDir: string;
  folderName: string;
  clientName: string;
  workspaceRoot: string;
  /**
   * Supplied only by the canonical opener after it has resolved the real
   * meeting projection and client boundary. This host never reconstructs
   * canonical identity from its legacy folder path.
   */
  openTarget?: MeetingOpenTarget;
  onBack: () => void;
  /** Set when opened via a `meeting:<dir>#<ms>` Client Map source link
   *  (Task 11) — seeks the transcript/audio to this moment on open. */
  initialSeekMs?: number;
  /** Injected by MatterHub (ultimately the app-layer active WorkspaceService) —
   *  features must not reach for the app-layer singleton themselves, per
   *  ARCHITECTURE.md's DAG. Null before a workspace is open. */
  workspaceService: WorkspaceService | null;
  /** Optional hook for embedded master-detail views to refresh their rail after
   *  this detail page changes meeting files or notice evidence. */
  onChanged?: () => void;
  /** The master-detail meetings rail already provides navigation context. */
  showBackButton?: boolean;
}

const audit = new AuditService('meetings');

function consentLabel(
  meta: MeetingMeta | null,
  t: (k: string) => string
): string | null {
  if (!meta?.consent) return null;
  const modeLabel =
    meta.consent.mode === 'one-party'
      ? t('meetings.entry.consent-one-party')
      : t('meetings.entry.consent-two-party');
  return `${t('meetings.entry.consent-noted')}: ${modeLabel}`;
}

/** "Jun 30, 2026 · 41 min" — the meta the advisor scans for, kept apart from
 *  the human title (the raw folder name never renders; see meetingDisplay). */
function dateDurationLine(
  meta: MeetingMeta | null,
  t: TFunction
): string | null {
  if (!meta) return null;
  const parts = [
    formatMeetingDate(meta.startedAt),
    formatMeetingDuration(meta.durationMs, t),
  ].filter(Boolean);
  return parts.length ? parts.join(' · ') : null;
}

function sanitizeFileStem(value: string): string {
  return (
    value
      .trim()
      .replace(/[\\/:*?"<>|]+/g, '-')
      .replace(/\s+/g, ' ')
      .slice(0, 80)
      .replace(/[.\s-]+$/g, '') || 'meeting'
  );
}

function toExactArrayBuffer(bytes: Uint8Array): ArrayBuffer {
  return bytes.buffer.slice(
    bytes.byteOffset,
    bytes.byteOffset + bytes.byteLength
  );
}

function transcriptToText(transcript: TranscriptFile | null): string {
  if (!transcript) return '';
  return transcript.segments
    .map((seg) => `${mmss(seg.startMs)} ${seg.speaker}: ${seg.text}`)
    .join('\n');
}

export function MeetingEntry({
  matterId: legacyMatterId,
  meetingDir: legacyMeetingDir,
  folderName,
  clientName,
  workspaceRoot,
  openTarget,
  onBack,
  initialSeekMs,
  workspaceService,
  onChanged,
  showBackButton = true,
}: MeetingEntryProps) {
  // A canonical opener owns identity — but ONLY a target the trusted resolver
  // actually minted is believed (see resolveMeetingEntryHostIdentity). A forged
  // target confers no identity and this host falls back to its legacy props.
  const hostIdentity = resolveMeetingEntryHostIdentity(
    openTarget,
    legacyMatterId,
    legacyMeetingDir
  );
  const { matterId, meetingDir } = hostIdentity;
  const canonicalTarget = hostIdentity.canonicalMeeting
    ? {
        meeting: hostIdentity.canonicalMeeting,
        client: hostIdentity.clientBoundary,
      }
    : null;
  const { t } = useTranslation();
  const firm = useFirm();
  const [meta, setMeta] = useState<MeetingMeta | null>(null);
  const [transcript, setTranscript] = useState<TranscriptFile | null>(null);
  const [hasNotes, setHasNotes] = useState(false);
  const [summaryExtraction, setSummaryExtraction] =
    useState<DocxTextExtraction | null>(null);
  const summaryText = summaryExtraction?.plainText ?? '';
  const [audioSrc, setAudioSrc] = useState<string | null>(null);
  const [hasAudio, setHasAudio] = useState(false);
  const [seekMs, setSeekMs] = useState<number | undefined>(initialSeekMs);
  const [activeTab, setActiveTab] = useState<MeetingPanelId>('summary');
  const [sendOpen, setSendOpen] = useState(false);
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
  const matter = useMatterStore(
    (state) =>
      state.matters.find((candidate) => candidate.id === matterId) ?? null
  );
  const hasTranscript = transcript !== null;
  const summaryReady = hasNotes && summaryText.trim().length > 0;
  const crmBlockedReason = meetingNoteOutboundGate({
    reviewedAt: meta?.reviewedAt,
    notesError: meta?.notesError,
    noticeStatus: deriveNoticeState(notices).status,
    policy: noticePolicy,
  });

  useEffect(() => {
    const token = ++meetingLoadToken.current;
    const isCurrentLoad = () => token === meetingLoadToken.current;
    setMeta(null);
    setTranscript(null);
    setHasNotes(false);
    setSummaryExtraction(null);
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
            const notesBytes = await ws.readFileBinary(
              `${meetingDir}/notes.docx`
            );
            const extracted = await extractDocxText(notesBytes);
            if (isCurrentLoad()) {
              setSummaryExtraction({
                ...extracted,
                plainText: extracted.plainText.trim(),
              });
            }
          } catch {
            if (isCurrentLoad()) setSummaryExtraction(null);
          }
        } else if (isCurrentLoad()) {
          setSummaryExtraction(null);
        }
      } catch {
        if (isCurrentLoad()) {
          setHasNotes(false);
          setSummaryExtraction(null);
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
    return () => {
      meetingLoadToken.current += 1;
    };
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

  const loadNotices = useCallback(
    async (token: number) => {
      const ws = workspaceService;
      if (!ws) return;
      let loaded: NoticeEntry[];
      try {
        loaded = await makeConsentLedger(
          ws,
          () => matterFolder
        ).noticesForMeeting(meetingDir);
      } catch {
        if (token === noticeLoadToken.current) setNotices([]);
        return; // failed read — leave the cleared state; never show a stale trail.
      }
      if (token === noticeLoadToken.current) setNotices(loaded);
    },
    [workspaceService, matterFolder, meetingDir]
  );

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
      onChanged?.();
    })().catch(() => {
      if (token === noticeLoadToken.current) setNotices([]);
    });
  }, [meetingDir, matterId, transcript, loadNotices, onChanged]);

  const handleRecordNotice = useCallback(
    async (entry: NoticeEntry) => {
      const ws = workspaceService;
      if (!ws) return;
      try {
        await makeConsentLedger(ws, () => matterFolder).recordNotice(entry);
        await loadNotices(noticeLoadToken.current);
        onChanged?.();
      } catch {
        setNotices([]);
      }
    },
    [workspaceService, matterFolder, loadNotices, onChanged]
  );

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
    if (initialSeekMs === undefined || didInitialSeek.current || !hasAudio)
      return;
    didInitialSeek.current = true;
    audioRef.current?.seek(initialSeekMs);
  }, [initialSeekMs, hasAudio]);

  const handleDeleteAudio = useCallback(async () => {
    const ws = workspaceService;
    if (!ws) return;
    await ws.delete(`${meetingDir}/audio.wav`);
    setAudioSrc(null);
    setHasAudio(false);
    onChanged?.();
    void audit
      .logDurable(
        'meeting_audio_deleted',
        'Meeting audio deleted (transcript kept)',
        {
          metadata: { matterId, meetingDir },
        }
      )
      .catch((err: unknown) => {
        setExportNotice(err instanceof Error ? err.message : String(err));
      });
  }, [matterId, meetingDir, workspaceService, onChanged]);

  const handleMarkReviewed = useCallback(async () => {
    if (!meta) return;
    const updated = await markMeetingReviewed(meetingDir);
    if (updated) setMeta(updated);
    onChanged?.();
  }, [meetingDir, meta, onChanged]);

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
          const notesBytes = await ws.readFileBinary(
            `${meetingDir}/notes.docx`
          );
          const extracted = await extractDocxText(notesBytes);
          if (isCurrentLoad()) {
            setSummaryExtraction({
              ...extracted,
              plainText: extracted.plainText.trim(),
            });
          }
        } catch {
          if (isCurrentLoad()) setSummaryExtraction(null);
        }
      } else {
        setSummaryExtraction(null);
      }
    } catch {
      if (isCurrentLoad()) {
        setHasNotes(false);
        setSummaryExtraction(null);
      }
    }
    onChanged?.();
  }, [meetingDir, matterId, workspaceService, onChanged]);

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
    onChanged?.();
  }, [meetingDir, matterId, workspaceRoot, workspaceService, onChanged]);

  const handleSaveType = useCallback(async () => {
    const entered = typeInput.trim();
    if (!entered || !meta || !workspaceService) {
      setEditingType(false);
      return;
    }
    // The input shows the human label, never the internal id — map a label
    // back to its built-in type id; anything else is saved as a custom type.
    const typeId =
      BUILT_IN_TYPES.find(
        (id) => meetingTypeLabel(id, t).toLowerCase() === entered.toLowerCase()
      ) ?? entered;
    const updated = await updateMeetingJson(meetingDir, (current) => ({
      ...current,
      typeId,
    }));
    await makeMeetingTypesStore(workspaceService).learnCorrection(
      meta.calendarTitle ?? folderName,
      typeId
    );
    if (updated) setMeta(updated);
    setEditingType(false);
    onChanged?.();
  }, [typeInput, meta, meetingDir, folderName, workspaceService, t, onChanged]);

  const handleSaveTitle = useCallback(async () => {
    if (!meta || !workspaceService) {
      setRenaming(false);
      return;
    }
    const entered = titleInput.trim();
    const updated = await updateMeetingJson(meetingDir, (current) => {
      if (entered) return { ...current, customTitle: entered };
      const { customTitle: _customTitle, ...rest } = current;
      return rest;
    });
    if (updated) setMeta(updated);
    setRenaming(false);
    onChanged?.();
  }, [meta, titleInput, meetingDir, workspaceService, onChanged]);

  const copyText = useCallback(async (text: string, notice: string) => {
    await navigator.clipboard.writeText(text);
    setExportNotice(notice);
  }, []);

  const summaryMarkdown = useCallback(() => {
    if (!summaryReady) throw new Error(t('meetings.entry.summary-not-ready'));
    const title = meetingDisplayTitle(meta, t);
    return `# ${title}\n\n${summaryText.trim()}`;
  }, [meta, summaryReady, summaryText, t]);

  const uniqueExportPath = useCallback(
    async (stem: string, ext: 'docx' | 'pdf'): Promise<string> => {
      const ws = workspaceService;
      if (!ws) return `${documentsDir}/${stem}.${ext}`;
      let candidate = `${documentsDir}/${stem}.${ext}`;
      let suffix = 2;
      while (await ws.exists(candidate)) {
        candidate = `${documentsDir}/${stem} ${String(suffix)}.${ext}`;
        suffix += 1;
      }
      return candidate;
    },
    [workspaceService, documentsDir]
  );

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
  }, [
    workspaceService,
    summaryReady,
    meta,
    t,
    uniqueExportPath,
    summaryMarkdown,
  ]);

  const buildSummaryDocxBytes = useCallback(async (): Promise<Uint8Array> => {
    if (!summaryReady) throw new Error(t('meetings.entry.summary-not-ready'));
    const stem = sanitizeFileStem(`${meetingDisplayTitle(meta, t)} summary`);
    const bytes = await markdownToDocxBytes(summaryMarkdown(), `${stem}.docx`);
    return applyLetterheadIfConfigured(bytes);
  }, [summaryReady, meta, t, summaryMarkdown]);

  const runExport = useCallback(
    async (kind: string, work: () => Promise<string | null>) => {
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
    },
    [t]
  );

  const handleExportSummaryDocx = useCallback(() => {
    void runExport('summary-docx', exportSummaryDocx).catch((err: unknown) => {
      setExportNotice(err instanceof Error ? err.message : String(err));
    });
  }, [runExport, exportSummaryDocx]);

  const handleExportSummaryPdf = useCallback(() => {
    void runExport('summary-pdf', async () => {
      const ws = workspaceService;
      if (!ws) return null;
      const tempStem = sanitizeFileStem(
        `${meetingDisplayTitle(meta, t)} summary`
      );
      const tempDocxPath = `${meetingDir}/.summary-pdf-${String(Date.now())}-${Math.random().toString(36).slice(2)}.docx`;
      try {
        const finalBytes = await buildSummaryDocxBytes();
        await ws.writeFileBinary(tempDocxPath, toExactArrayBuffer(finalBytes));
        const pdfSource = await docxConvertToPdf(tempDocxPath);
        const pdfBytes = await readTauriFile(pdfSource);
        const pdfPath = await uniqueExportPath(tempStem, 'pdf');
        await ws.writeFileBinary(pdfPath, toExactArrayBuffer(pdfBytes));
        return pdfPath;
      } finally {
        // eslint-disable-next-line lantern-async/no-silent-failure -- cleanup is best-effort after the export result is already known
        await ws.delete(tempDocxPath).catch(() => undefined);
      }
    }).catch((err: unknown) => {
      setExportNotice(err instanceof Error ? err.message : String(err));
    });
  }, [
    workspaceService,
    runExport,
    meta,
    t,
    meetingDir,
    buildSummaryDocxBytes,
    uniqueExportPath,
  ]);

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

  const handleSendChanged = useCallback(
    (updated: MeetingMeta) => {
      setMeta(updated);
      onChanged?.();
    },
    [onChanged]
  );

  const handleActionError = useCallback((error: unknown) => {
    setExportNotice(error instanceof Error ? error.message : String(error));
  }, []);

  // The real Meetings host renders the LIVE host composition: the base
  // compatibility tabs/actions/insights PLUS every feature that called
  // registerMeetingPanel / registerMeetingHeaderAction / registerMeetingInsight.
  // A registered contribution is therefore load-bearing — it renders here, not
  // in a private returned array.
  const meetingPanels = getMeetingPanelComposition().panels;
  const activePanel =
    meetingPanels.find((descriptor) => descriptor.id === activeTab) ??
    meetingPanels[0];
  const meetingHeaderActions = getMeetingHeaderActionComposition().actions;
  const meetingInsights = getMeetingInsightComposition().meetingSummary;
  const panelContext = {
    t,
    matterId,
    canonicalMeeting: canonicalTarget?.meeting ?? null,
    clientBoundary: canonicalTarget?.client ?? null,
    meetingDir,
    clientName,
    workspaceRoot,
    workspaceService,
    firm,
    meta,
    transcript,
    summaryExtraction,
    summaryText,
    audioSrc,
    renderAudioPlayer: () =>
      audioSrc ? (
        <AudioPlayer
          ref={audioRef}
          audioSrc={audioSrc}
          filename={meetingDisplayTitle(meta, t)}
          compact
        />
      ) : null,
    seekMs,
    hasAudio,
    hasNotes,
    summaryReady,
    crmBlockedReason,
    retryingNotes,
    retryingTranscript,
    onSeek: handleSeek,
    onRetryNotes: () => {
      // PARITY: preserves pre-refactor silent handling; surfacing these errors to the user is a tracked design finding, not a refactor-lane change.
      void handleRetryNotes();
    },
    onRetryTranscript: () => {
      // PARITY: preserves pre-refactor silent handling; surfacing these errors to the user is a tracked design finding, not a refactor-lane change.
      void handleRetryTranscript();
    },
  };
  const headerActionContext = {
    t,
    canonicalMeeting: canonicalTarget?.meeting ?? null,
    clientBoundary: canonicalTarget?.client ?? null,
    meta,
    transcript,
    summaryText,
    hasAudio,
    hasTranscript,
    summaryReady,
    exporting,
    onOpenSend: () => {
      setSendOpen(true);
    },
    onMarkReviewed: handleMarkReviewed,
    onDownloadAudio: handleDownloadAudio,
    onCopyTranscript: () => {
      // PARITY: preserves pre-refactor silent handling; surfacing these errors to the user is a tracked design finding, not a refactor-lane change.
      void copyText(
        transcriptToText(transcript),
        t('meetings.entry.transcript-copied')
      );
    },
    onCopySummary: () => {
      // PARITY: preserves pre-refactor silent handling; surfacing these errors to the user is a tracked design finding, not a refactor-lane change.
      void copyText(summaryText.trim(), t('meetings.entry.summary-copied'));
    },
    onExportTranscript: handleExportTranscript,
    onExportSummaryDocx: handleExportSummaryDocx,
    onExportSummaryPdf: handleExportSummaryPdf,
    onRequestDeleteAudio: () => {
      setConfirmingDelete(true);
    },
    onActionError: handleActionError,
  };

  return (
    <div
      data-testid="meeting-entry"
      style={{
        display: 'flex',
        flexDirection: 'column',
        height: '100%',
        flex: 1,
        minHeight: 0,
        overflow: 'hidden',
      }}
    >
      <div
        style={{
          display: 'flex',
          alignItems: 'flex-start',
          justifyContent: 'space-between',
          gap: 8,
          padding: 'var(--kp-surface-header-pad)',
          borderBottom: '1px solid var(--kp-divider)',
        }}
      >
        <div
          style={{
            display: 'flex',
            alignItems: 'flex-start',
            gap: 8,
            minWidth: 0,
          }}
        >
          {showBackButton && (
            <button
              type="button"
              data-testid="meeting-entry-back"
              onClick={onBack}
              style={{
                border: 'none',
                background: 'transparent',
                cursor: 'pointer',
                display: 'flex',
                marginTop: 2,
              }}
            >
              <ChevronLeft style={{ width: 18, height: 18 }} />
            </button>
          )}
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 4,
              minWidth: 0,
            }}
          >
            {/* First line: meeting title only (item 8) — the client + Meetings
                breadcrumb is dropped; the rail already says where you are. */}
            {renaming ? (
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 4 }}
              >
                <input
                  data-testid="meeting-title-input"
                  value={titleInput}
                  onChange={(e) => {
                    setTitleInput(e.target.value);
                  }}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter')
                      void handleSaveTitle().catch((err: unknown) => {
                        setExportNotice(
                          err instanceof Error ? err.message : String(err)
                        );
                      });
                    if (e.key === 'Escape') setRenaming(false);
                  }}
                  style={{
                    fontSize: 'var(--kp-font-md)',
                    border: '1px solid var(--kp-divider)',
                    borderRadius: 'var(--radius-sm)',
                    padding: '3px 6px',
                  }}
                />
                <button
                  type="button"
                  data-testid="meeting-title-save"
                  onClick={() => {
                    void handleSaveTitle().catch((err: unknown) => {
                      setExportNotice(
                        err instanceof Error ? err.message : String(err)
                      );
                    });
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--kp-accent)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                  }}
                >
                  <Check style={{ width: 14, height: 14 }} />
                </button>
              </span>
            ) : (
              <span
                style={{
                  display: 'inline-flex',
                  alignItems: 'center',
                  gap: 6,
                  minWidth: 0,
                }}
              >
                <span
                  style={{
                    color: 'var(--kp-navy)',
                    fontWeight: 'var(--kp-weight-semibold)',
                    fontSize: 'var(--kp-font-md)',
                    overflow: 'hidden',
                    textOverflow: 'ellipsis',
                    whiteSpace: 'nowrap',
                  }}
                >
                  {meetingDisplayTitle(meta, t)}
                </span>
                <button
                  type="button"
                  data-testid="meeting-title-rename"
                  aria-label={t('meetings.entry.rename')}
                  title={t('meetings.entry.rename')}
                  onClick={() => {
                    setTitleInput(meetingDisplayTitle(meta, t));
                    setRenaming(true);
                  }}
                  style={{
                    border: 'none',
                    background: 'transparent',
                    color: 'var(--color-muted-foreground)',
                    cursor: 'pointer',
                    display: 'inline-flex',
                    padding: 2,
                    flex: 'none',
                  }}
                >
                  <Pencil style={{ width: 13, height: 13 }} />
                </button>
              </span>
            )}
            {/* Second line: date + duration + compact status chips (item 8). */}
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                gap: 8,
                flexWrap: 'wrap',
                fontSize: 'var(--kp-font-xs)',
                color: 'var(--color-muted-foreground)',
              }}
            >
              {dateDurationLine(meta, t) && (
                <span>{dateDurationLine(meta, t)}</span>
              )}
              {consentLabel(meta, t) && (
                <Badge variant="neutral" size="sm">
                  {consentLabel(meta, t)}
                </Badge>
              )}
              {meta?.typeId && !editingType && (
                <span
                  data-testid="meeting-type-chip"
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <Badge variant="neutral" size="sm">
                    {meetingTypeLabel(meta.typeId, t)}
                  </Badge>
                  <button
                    type="button"
                    data-testid="meeting-type-change"
                    aria-label={t('meetings.entry.type-change')}
                    title={t('meetings.entry.type-change')}
                    onClick={() => {
                      setTypeInput(
                        meta.typeId ? meetingTypeLabel(meta.typeId, t) : ''
                      );
                      setEditingType(true);
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--color-muted-foreground)',
                      cursor: 'pointer',
                      display: 'inline-flex',
                      padding: 0,
                    }}
                  >
                    <Pencil style={{ width: 11, height: 11 }} />
                  </button>
                </span>
              )}
              {editingType && (
                <span
                  style={{
                    display: 'inline-flex',
                    alignItems: 'center',
                    gap: 4,
                  }}
                >
                  <input
                    data-testid="meeting-type-input"
                    value={typeInput}
                    onChange={(e) => {
                      setTypeInput(e.target.value);
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        // PARITY: preserves pre-refactor silent handling; surfacing these errors to the user is a tracked design finding, not a refactor-lane change.
                        void handleSaveType();
                      }
                      if (e.key === 'Escape') setEditingType(false);
                    }}
                    style={{
                      fontSize: 'var(--kp-font-xs)',
                      border: '1px solid var(--kp-divider)',
                      borderRadius: 'var(--radius-sm)',
                      padding: '2px 6px',
                    }}
                  />
                  <button
                    type="button"
                    data-testid="meeting-type-save"
                    onClick={() => {
                      // PARITY: preserves pre-refactor silent handling; surfacing these errors to the user is a tracked design finding, not a refactor-lane change.
                      void handleSaveType();
                    }}
                    style={{
                      border: 'none',
                      background: 'transparent',
                      color: 'var(--kp-accent)',
                      cursor: 'pointer',
                      fontSize: 'inherit',
                      fontFamily: 'inherit',
                      padding: 0,
                    }}
                  >
                    <Check style={{ width: 12, height: 12 }} />
                  </button>
                </span>
              )}
              {meta?.reviewedAt && (
                <Badge
                  variant="neutral"
                  size="sm"
                  data-testid="meeting-reviewed-chip"
                >
                  {t('meetings.entry.reviewed')}
                </Badge>
              )}
            </div>
          </div>
        </div>
        <div
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 8,
            flex: 'none',
          }}
        >
          {meetingHeaderActions.map((descriptor) => (
            <span
              key={descriptor.id}
              data-meeting-header-action={descriptor.id}
              data-placement={descriptor.placement}
              style={{ display: 'contents' }}
            >
              {descriptor.mount(headerActionContext)}
            </span>
          ))}
          {/* Compatibility actions above preserve Send, review, and the utilities menu. */}
        </div>
      </div>

      <div
        style={{
          borderBottom: '1px solid var(--kp-divider)',
          padding: '10px var(--kp-gutter) 0',
          display: 'flex',
          gap: 6,
        }}
      >
        {meetingPanels.map((descriptor) => {
          const active = descriptor.id === activePanel?.id;
          return (
            <button
              key={descriptor.id}
              type="button"
              role="tab"
              aria-selected={active}
              data-testid={`meeting-subtab-${descriptor.id}`}
              onClick={() => {
                setActiveTab(descriptor.id);
              }}
              style={{
                border: 'none',
                borderBottom: active
                  ? '2px solid var(--kp-accent)'
                  : '2px solid transparent',
                background: 'transparent',
                color: active
                  ? 'var(--kp-navy)'
                  : 'var(--color-muted-foreground)',
                fontFamily: 'inherit',
                fontSize: 'var(--kp-font-sm)',
                fontWeight: active
                  ? 'var(--kp-weight-semibold)'
                  : 'var(--kp-weight-regular)',
                padding: '8px 10px',
                cursor: 'pointer',
              }}
            >
              {t(descriptor.labelKey)}
            </button>
          );
        })}
      </div>

      <div
        data-testid="meeting-entry-tab-scroll"
        style={{ flex: 1, minHeight: 0, overflow: 'auto' }}
      >
        {exportNotice && (
          <div
            data-testid="meeting-entry-export-notice"
            style={{
              padding: '8px var(--kp-gutter) 0',
              color: 'var(--color-muted-foreground)',
              fontSize: 'var(--kp-font-xs)',
            }}
          >
            {exportNotice}
          </div>
        )}

        {/* Recording Notice Kit — the notice trail (verified chip / needs-review
            / quarantine + copy actions), bound to this meeting. It stays
            visible for every tab while the tab content owns scrolling. Hidden
            for dictated notes, which have no meeting audio or spoken notice. */}
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

        <div style={{ padding: 'var(--kp-gutter)' }}>
          {activePanel?.mount(panelContext)}

          {meetingInsights.length > 0 && (
            <div data-testid="meeting-insight-mounts">
              {meetingInsights.map((descriptor) => (
                <div key={descriptor.id} data-meeting-insight={descriptor.id}>
                  {descriptor.renderMeetingSummary({
                    matterId,
                    canonicalMeeting: canonicalTarget?.meeting ?? null,
                    clientBoundary: canonicalTarget?.client ?? null,
                    meetingDir,
                    clientName,
                    workspaceService,
                  })}
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Send (item 1) — the merged send surface opens in a right drawer from
          the header Send action, so sending never crowds the review tabs. */}
      <SlidePanel
        open={sendOpen && !!meta}
        onClose={() => {
          setSendOpen(false);
        }}
        width={520}
        closeLabel={t('common.actions.cancel')}
        data-testid="meeting-send-drawer"
        title={
          <span
            style={{
              color: 'var(--kp-navy)',
              fontWeight: 'var(--kp-weight-semibold)',
              fontSize: 'var(--kp-font-md)',
            }}
          >
            {t('meetings.entry.tab-send-to-team')}
          </span>
        }
      >
        {meta && (
          <MeetingSendPanel
            matterId={matterId}
            meetingDir={meetingDir}
            meta={meta}
            matter={matter}
            clientName={clientName}
            workspaceService={workspaceService}
            hasAudio={hasAudio}
            hasTranscript={hasTranscript}
            hasNotes={hasNotes}
            summaryReady={summaryReady}
            transcript={transcript}
            buildSummaryDocxBytes={buildSummaryDocxBytes}
            onChanged={handleSendChanged}
          />
        )}
      </SlidePanel>

      {/* Deleting the only recording of a client meeting is irreversible —
          destructive ops always confirm (core app rule; UX review B7). */}
      <Dialog open={confirmingDelete} onOpenChange={setConfirmingDelete}>
        <DialogContent
          className="sm:max-w-[400px]"
          data-testid="delete-audio-confirm"
        >
          <DialogHeader>
            <DialogTitle>
              {t('meetings.entry.delete-audio-confirm-title')}
            </DialogTitle>
          </DialogHeader>
          <p style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--kp-navy)' }}>
            {hasTranscript
              ? t('meetings.entry.delete-audio-confirm-body')
              : t('meetings.entry.delete-audio-confirm-body-no-transcript')}
          </p>
          <DialogFooter>
            <DialogButton
              variant="secondary"
              onClick={() => {
                setConfirmingDelete(false);
              }}
            >
              {t('meetings.dictation.cancel')}
            </DialogButton>
            <DialogButton
              variant="destructive"
              data-testid="delete-audio-confirm-button"
              onClick={() => {
                setConfirmingDelete(false);
                // PARITY: preserves pre-refactor silent handling; surfacing these errors to the user is a tracked design finding, not a refactor-lane change.
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
