/**
 * ClientMeetingsTab — the per-client Meetings sub-tab (MatterHub, between
 * Email and Activity). Lists THIS client's meetings chronologically (reading
 * only its own `Meetings/` folder — never a cross-client inbox), and opens
 * `MeetingEntry` on a row click. A "Record a meeting" affordance starts a
 * new recording; the interim direct `startRecording` call here is replaced
 * by the real consent dialog in Task 13.
 */
import { useEffect, useState, useCallback } from 'react';
import { useTranslation } from 'react-i18next';
import { Info, Mic, AlertTriangle } from 'lucide-react';
import { Badge, Button, Callout, EmptyState } from '@/ui/kp';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMeetingStore, needsReview, checkLowDiskSpaceWarning } from './meetingStore';
import type { MeetingMeta } from './meetingStore';
import { meetingDisplayTitle, formatMeetingDate, formatMeetingDuration } from './meetingDisplay';
import { ConsentDialog, isMacPermissionError } from './ConsentDialog';
import { consentModeFor } from './recordingConsentLaw';
import { makeConsentLedger, type ConsentEntry } from './consentLedger';
import { deriveNoticeState, meetingDirKey, type NoticeEntry, type NoticeState } from './noticeLedger';
import { useNoticeSettings } from './noticeSettings';

export interface MeetingSummary {
  dir: string;
  folderName: string;
  meta: MeetingMeta | null;
  hasNotes: boolean;
  hasAudio: boolean;
  hasTranscript: boolean;
}

interface ListableWorkspace {
  list(path: string): Promise<{ name: string; path: string; type: 'file' | 'folder' }[]>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  /** Optional — test doubles may omit it. When present, `listClientMeetings`
   *  uses it to tell a genuinely-absent `Meetings/` folder (a real "no
   *  meetings yet" client) apart from a `list()` failure on a folder that IS
   *  there, so a transient scan error can never masquerade as emptiness. */
  exists?(path: string): Promise<boolean>;
}

export interface MeetingsScanResult {
  meetings: MeetingSummary[];
  /** True when the Meetings folder exists but scanning it kept failing after
   *  retries (a permissions hiccup, a timing race right after the workspace
   *  reopened, or any other backend error) — distinct from a genuinely empty
   *  client, so the caller never claims "no meetings recorded" when the
   *  honest answer is "couldn't check." */
  scanFailed: boolean;
}

/** A P1 fix (2026-07): meetings recorded in a PRIOR session were reported to
 *  vanish from the tab after an app restart, though the files were intact on
 *  disk (docs/evidence/meetings-verify-20260704/RUN-LOG.md, finding #6). The
 *  disk-scan/path-resolution pipeline itself was verified correct under a
 *  simulated restart (tests/unit/meetings/meetings-restart-scan.test.ts), but
 *  `listClientMeetings` previously turned ANY `list()` failure — including a
 *  transient one — into the exact same result as a genuinely empty client, so
 *  a real (if rare) backend hiccup right after reopening a workspace read as
 *  "your recordings are gone." Retrying + reporting `scanFailed` closes that
 *  gap regardless of the failure's exact cause. */
const SCAN_RETRY_ATTEMPTS = 3;
const SCAN_RETRY_DELAY_MS = 200;

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/** Scans `<matterFolder>/Meetings/` for meeting folders, reading each one's
 *  `meeting.json` + checking for notes/audio/transcript presence. Returns
 *  newest-first. A genuinely absent Meetings folder yields an empty,
 *  non-failed result (no meetings recorded yet); a folder that exists but
 *  can't be listed is retried before being reported as `scanFailed`. */
export async function listClientMeetings(
  matterFolder: string,
  ws: ListableWorkspace,
  opts?: { retryDelayMs?: number },
): Promise<MeetingsScanResult> {
  // A client with no linked folder (CRM/email-only, or a pre-QA-5 matter
  // created before every client got a scoped folder) legitimately has no
  // `matterFolder` — `${matterFolder}/Meetings` would then resolve to the
  // workspace-root-relative `/Meetings`, which PathValidator correctly
  // rejects as outside the workspace. That rejection must read as "there is
  // nowhere to look" (a real empty state), never as a scan failure — a
  // missing folder is a precondition that isn't met, not a backend error to
  // retry (codex-review P2, 2026-07-04).
  if (!matterFolder.trim()) return { meetings: [], scanFailed: false };

  const meetingsPath = `${matterFolder}/Meetings`;

  // Fast path: a brand-new client with no Meetings folder yet is the COMMON
  // case, and must resolve instantly — never pay the retry delay below for it.
  if (ws.exists) {
    const meetingsFolderExists = await ws.exists(meetingsPath).catch(() => true);
    if (!meetingsFolderExists) return { meetings: [], scanFailed: false };
  }

  const retryDelayMs = opts?.retryDelayMs ?? SCAN_RETRY_DELAY_MS;
  let entries: { name: string; path: string; type: 'file' | 'folder' }[] | null = null;
  for (let attempt = 0; attempt < SCAN_RETRY_ATTEMPTS; attempt++) {
    try {
      entries = await ws.list(meetingsPath);
      break;
    } catch {
      if (attempt < SCAN_RETRY_ATTEMPTS - 1) await delay(retryDelayMs);
    }
  }
  if (entries === null) return { meetings: [], scanFailed: true };

  const folders = entries.filter((e) => e.type === 'folder');
  const summaries = await Promise.all(
    folders.map(async (f): Promise<MeetingSummary> => {
      const children = await ws.list(f.path).catch(() => []);
      const names = new Set(children.map((c) => c.name));
      let meta: MeetingMeta | null = null;
      try {
        meta = JSON.parse(await ws.readFile(`${f.path}/meeting.json`)) as MeetingMeta;
      } catch {
        meta = null;
      }
      return {
        dir: f.path,
        folderName: f.name,
        meta,
        hasNotes: names.has('notes.docx'),
        hasAudio: names.has('audio.wav'),
        hasTranscript: names.has('transcript.json'),
      };
    }),
  );
  return {
    meetings: summaries.sort((a, b) => (b.meta?.startedAt ?? b.folderName).localeCompare(a.meta?.startedAt ?? a.folderName)),
    scanFailed: false,
  };
}

export interface ClientMeetingsTabProps {
  matterId: string;
  matterFolder: string;
  onOpenMeeting: (meeting: MeetingSummary) => void;
  /** Injected by MatterHub (ultimately the app-layer active WorkspaceService) —
   *  features must not reach for the app-layer singleton themselves, per
   *  ARCHITECTURE.md's DAG. Null before a workspace is open. */
  workspaceService: ListableWorkspace | null;
}

export function ClientMeetingsTab({ matterId, matterFolder, onOpenMeeting, workspaceService }: ClientMeetingsTabProps) {
  const { t, i18n } = useTranslation();
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const [scanFailed, setScanFailed] = useState(false);
  const recording = useMeetingStore((s) => s.status.recording);
  const processing = useMeetingStore((s) => s.processingCount > 0);
  const startRecording = useMeetingStore((s) => s.startRecording);
  const crmQueueItems = useCrmWriteQueueStore((s) => s.items);
  const [showConsent, setShowConsent] = useState(false);
  const [macPermissionError, setMacPermissionError] = useState(false);
  const [consentError, setConsentError] = useState<string | null>(null);
  const [standingConsent, setStandingConsent] = useState<ConsentEntry | null>(null);
  // QA-35 — a cheap disk-space preflight, checked fresh each time the consent
  // dialog opens so the warning reflects the disk's state right before this
  // specific recording, not whatever it was on a previous click.
  const [lowDiskSpace, setLowDiskSpace] = useState(false);
  // Recording Notice Kit — per-meeting notice state (keyed by meeting dir) so
  // each row can flag a missing/quarantined notice, plus the firm policy.
  const [noticeStates, setNoticeStates] = useState<Record<string, NoticeState>>({});
  const { policy: noticePolicy, customScript: custom } = useNoticeSettings();
  const noticeScript = custom || t('meetings.notice.default-script');
  // No per-client state on file yet (see Matter type) — consentModeFor(null)
  // is the conservative two-party default, and stateKnown={false} below keeps
  // the dialog's wording conditional rather than asserting the law.
  const consentMode = consentModeFor(null);

  const refresh = useCallback(async () => {
    const ws = workspaceService;
    if (!ws) { setMeetings([]); setScanFailed(false); setLoading(false); return; }
    setLoading(true);
    const { meetings: list, scanFailed: failed } = await listClientMeetings(matterFolder, ws);
    setMeetings(list);
    setScanFailed(failed);
    // Recording Notice Kit — one ledger read, grouped by meeting dir, so each
    // row can reflect its notice state (verified / needs-review / quarantined).
    try {
      const notices = await makeConsentLedger(ws, () => matterFolder).allNotices();
      // Key by normalized folder name so entries written with Rust's canonical
      // meetingDir line up with the (possibly differently-prefixed) row paths
      // from the FS list (codex-review R2).
      const byDir: Record<string, NoticeEntry[]> = {};
      for (const n of notices) (byDir[meetingDirKey(n.meetingDir)] ??= []).push(n);
      const states: Record<string, NoticeState> = {};
      for (const [key, entries] of Object.entries(byDir)) states[key] = deriveNoticeState(entries);
      setNoticeStates(states);
    } catch {
      setNoticeStates({});
    }
    setLoading(false);
  }, [matterFolder, workspaceService]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Refresh once a recording for this client finishes AND its post-stop
  // pipeline (transcription + notes) is done, so the new meeting appears —
  // with its notes — without the advisor leaving and reopening the tab.
  const busy = recording || processing;
  useEffect(() => {
    if (!busy) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [busy]);

  const handleRecordClick = useCallback(() => {
    void (async () => {
      if (workspaceService) {
        const sc = await makeConsentLedger(workspaceService, () => matterFolder).standingConsent(matterId);
        setStandingConsent(sc);
      }
      setMacPermissionError(false);
      setConsentError(null);
      // QA-35 — cheap disk-space preflight, checked fresh on every open so
      // the warning reflects right now, not a stale prior check.
      setLowDiskSpace(await checkLowDiskSpaceWarning());
      setShowConsent(true);
    })();
  }, [matterId, matterFolder, workspaceService]);

  const handleConsentConfirm = useCallback((opts: { note?: string }) => {
    void (async () => {
      try {
        await startRecording(matterId, {
          consentMode,
          ...(opts.note ? { consentNote: opts.note } : {}),
          // Capture the script/locale shown for this recording (codex-review R6).
          noticeCustomScript: custom,
          noticeLanguage: i18n.language,
        });
        setShowConsent(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isMacPermissionError(message)) {
          setMacPermissionError(true);
        } else {
          // Never close on silence — the advisor must see that no recording
          // is running (2026-07-04 UX review, finding B6).
          setConsentError(message);
        }
      }
    })();
  }, [matterId, consentMode, startRecording, custom, i18n.language]);

  // Task 12b — per-client (never practice-wide) review flags, shown as a
  // badge on each row (the meeting page's "Mark reviewed" clears it).
  const matterQueue = crmQueueItems.filter((q) => q.matterId === matterId);

  // Never claim "No meetings yet" while a recording is running or its notes
  // are still being written (codex-review P2: the first-ever recording would
  // otherwise stop straight into a false empty state) — and never claim it
  // when the scan itself failed (P1 fix, 2026-07): a transient disk-scan
  // error must read as "couldn't check," never as "your recordings are gone."
  const showScanError = !loading && !busy && scanFailed;
  const showEmpty = !loading && !busy && !scanFailed && meetings.length === 0;

  return (
    <div data-testid="client-meetings-tab" style={{ padding: 'var(--kp-gutter)', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-lg)' }}>
      {/* The record affordance leads the surface (prototype: top-left, with
          the local-capture reassurance beside it). On the empty tab the
          EmptyState below carries the same button instead. */}
      {!showEmpty && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 'var(--kp-space-sm)', flexWrap: 'wrap' }}>
          <Button
            data-testid="record-meeting-button"
            onClick={handleRecordClick}
            disabled={recording}
            iconLeft={Mic}
          >
            {recording ? t('meetings.tab.recording') : t('meetings.tab.record-button')}
          </Button>
          <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
            {t('meetings.tab.record-note')}
          </span>
        </div>
      )}

      {loading && (
        <div data-testid="client-meetings-loading" style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--color-muted-foreground)' }}>
          {t('meetings.tab.loading')}
        </div>
      )}

      {!loading && processing && meetings.length === 0 && (
        <div data-testid="client-meetings-processing" style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--color-muted-foreground)' }}>
          {t('meetings.pill.processing')}
        </div>
      )}

      {showScanError && (
        <div data-testid="client-meetings-scan-error">
          <Callout variant="error" icon={AlertTriangle}>
            <div style={{ fontWeight: 'var(--kp-weight-semibold)' }}>{t('meetings.tab.scan-error-title')}</div>
            <div style={{ marginTop: 2 }}>{t('meetings.tab.scan-error-body')}</div>
            <Button
              data-testid="client-meetings-retry-button"
              size="sm"
              variant="secondary"
              onClick={() => { void refresh(); }}
              style={{ marginTop: 'var(--kp-space-sm)' }}
            >
              {t('meetings.tab.retry-button')}
            </Button>
          </Callout>
        </div>
      )}

      {showEmpty && (
        <EmptyState
          icon={Mic}
          title={t('meetings.tab.empty-title')}
          body={t('meetings.tab.empty-body')}
          data-testid="client-meetings-empty"
          actions={
            // showEmpty implies not recording/processing — no disabled state needed
            <Button data-testid="record-meeting-button" onClick={handleRecordClick} iconLeft={Mic}>
              {t('meetings.tab.record-button')}
            </Button>
          }
        />
      )}

      {meetings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-xs)' }}>
          {meetings.map((m) => {
            const noticeState = noticeStates[meetingDirKey(m.dir)];
            const reviewItems = needsReview(
              m,
              matterQueue,
              undefined,
              noticeState ? { state: noticeState, policy: noticePolicy } : undefined,
            );
            const quarantined = reviewItems.some((i) => i.kind === 'notice-quarantined');
            const duration = formatMeetingDuration(m.meta?.durationMs, t);
            return (
              <button
                key={m.dir}
                type="button"
                data-testid="meeting-row"
                className="kp-card kp-card--interactive"
                onClick={() => { onOpenMeeting(m); }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  gap: 'var(--kp-space-md)',
                  textAlign: 'left',
                  width: '100%',
                  fontFamily: 'inherit',
                }}
              >
                <span
                  aria-hidden="true"
                  style={{
                    width: 36,
                    height: 36,
                    borderRadius: 9,
                    flex: 'none',
                    display: 'inline-flex',
                    alignItems: 'center',
                    justifyContent: 'center',
                    background: 'var(--kp-accent-soft)',
                    color: 'var(--kp-navy)',
                  }}
                >
                  <Mic style={{ width: 17, height: 17 }} />
                </span>
                <span style={{ flex: 1, minWidth: 0 }}>
                  <span style={{ display: 'block', fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
                    {meetingDisplayTitle(m.meta, t)}
                  </span>
                  <span style={{ display: 'block', fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)', marginTop: 2 }}>
                    {formatMeetingDate(m.meta?.startedAt)}
                    {duration && ` · ${duration}`}
                    {!m.hasNotes &&
                      ` · ${
                        m.meta?.notesError
                          ? t('meetings.tab.notes-failed')
                          : m.meta?.recordingError && !m.hasAudio
                            ? t('meetings.tab.recording-incomplete')
                            : t('meetings.tab.notes-pending')
                      }`}
                  </span>
                </span>
                <span style={{ flex: 'none', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
                  {quarantined && (
                    <Badge variant="warning" size="sm" data-testid="meeting-quarantine-badge">{t('meetings.notice.quarantine-badge')}</Badge>
                  )}
                  {!quarantined && reviewItems.length > 0 && (
                    <Badge variant="warning" size="sm">{t('meetings.tab.needs-review-badge')}</Badge>
                  )}
                  {reviewItems.length === 0 && m.meta?.reviewedAt && (
                    <Badge variant="neutral" size="sm">{t('meetings.tab.reviewed-badge')}</Badge>
                  )}
                </span>
              </button>
            );
          })}
        </div>
      )}

      <div style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
        <Info aria-hidden="true" style={{ width: 14, height: 14, flex: 'none' }} />
        {t('meetings.tab.activity-hint')}
      </div>
      <ConsentDialog
        open={showConsent}
        onOpenChange={setShowConsent}
        consentMode={consentMode}
        stateKnown={false}
        standingConsent={standingConsent}
        macPermissionError={macPermissionError}
        errorMessage={consentError}
        lowDiskSpace={lowDiskSpace}
        noticeScript={noticeScript}
        onConfirm={handleConsentConfirm}
      />
    </div>
  );
}

export default ClientMeetingsTab;
