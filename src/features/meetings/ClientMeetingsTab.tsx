/**
 * ClientMeetingsTab — the per-client Meetings sub-tab (MatterHub, between
 * Email and Activity). Lists THIS client's meetings chronologically (reading
 * only its own `Meetings/` folder — never a cross-client inbox), and opens
 * `MeetingEntry` on a row click. A "Record a meeting" affordance starts a
 * new recording; the interim direct `startRecording` call here is replaced
 * by the real consent dialog in Task 13.
 */
import { useEffect, useState, useCallback, useMemo } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, Video } from 'lucide-react';
import { Badge, EmptyState } from '@/ui/kp';
import { useCrmWriteQueueStore } from '@/platform/state/crmWriteQueueStore';
import { useMeetingStore, needsReview, type ReviewItem } from './meetingStore';
import type { MeetingMeta } from './meetingStore';
import { ConsentDialog, isMacPermissionError } from './ConsentDialog';
import { consentModeFor } from './recordingConsentLaw';
import { makeConsentLedger, type ConsentEntry } from './consentLedger';

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
}

/** Scans `<matterFolder>/Meetings/` for meeting folders, reading each one's
 *  `meeting.json` + checking for notes/audio/transcript presence. Returns
 *  newest-first. An unreadable/absent Meetings folder yields an empty list
 *  (no meetings recorded yet), never a throw. */
export async function listClientMeetings(matterFolder: string, ws: ListableWorkspace): Promise<MeetingSummary[]> {
  let entries: { name: string; path: string; type: 'file' | 'folder' }[];
  try {
    entries = await ws.list(`${matterFolder}/Meetings`);
  } catch {
    return [];
  }
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
  return summaries.sort((a, b) => (b.meta?.startedAt ?? b.folderName).localeCompare(a.meta?.startedAt ?? a.folderName));
}

function formatMeetingDate(iso: string | undefined): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' });
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
  const { t } = useTranslation();
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [loading, setLoading] = useState(true);
  const recording = useMeetingStore((s) => s.status.recording);
  const startRecording = useMeetingStore((s) => s.startRecording);
  const crmQueueItems = useCrmWriteQueueStore((s) => s.items);
  const [showConsent, setShowConsent] = useState(false);
  const [macPermissionError, setMacPermissionError] = useState(false);
  const [standingConsent, setStandingConsent] = useState<ConsentEntry | null>(null);
  const consentMode = consentModeFor(null); // no per-client state on file yet (see Matter type)

  const refresh = useCallback(async () => {
    const ws = workspaceService;
    if (!ws) { setMeetings([]); setLoading(false); return; }
    setLoading(true);
    const list = await listClientMeetings(matterFolder, ws);
    setMeetings(list);
    setLoading(false);
  }, [matterFolder, workspaceService]);

  useEffect(() => { void refresh(); }, [refresh]);
  // Refresh once a recording for this client finishes, so the new meeting
  // appears without requiring the advisor to leave and reopen the tab.
  useEffect(() => {
    if (!recording) void refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [recording]);

  const handleRecordClick = useCallback(() => {
    void (async () => {
      if (workspaceService) {
        const sc = await makeConsentLedger(workspaceService, () => matterFolder).standingConsent(matterId);
        setStandingConsent(sc);
      }
      setMacPermissionError(false);
      setShowConsent(true);
    })();
  }, [matterId, matterFolder, workspaceService]);

  const handleConsentConfirm = useCallback((opts: { note?: string }) => {
    void (async () => {
      try {
        await startRecording(matterId, { consentMode, ...(opts.note ? { consentNote: opts.note } : {}) });
        setShowConsent(false);
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        if (isMacPermissionError(message)) {
          setMacPermissionError(true);
        } else {
          setShowConsent(false);
        }
      }
    })();
  }, [matterId, consentMode, startRecording]);

  // Task 12b — per-client (never practice-wide) review queue: which of THIS
  // client's meetings still need a look, and why.
  const reviewRows = useMemo(() => {
    const matterQueue = crmQueueItems.filter((q) => q.matterId === matterId);
    return meetings
      .map((m) => ({ meeting: m, items: needsReview(m, matterQueue) }))
      .filter((r) => r.items.length > 0);
  }, [meetings, crmQueueItems, matterId]);
  const reviewCount = reviewRows.reduce((sum, r) => sum + r.items.length, 0);

  const reviewItemLabel = useCallback((item: ReviewItem): string => {
    if (item.kind === 'unreviewed-note') return t('meetings.tab.review-unreviewed-note');
    if (item.kind === 'crm-waiting') return t('meetings.tab.review-crm-waiting');
    return t('meetings.tab.review-no-followup');
  }, [t]);

  return (
    <div data-testid="client-meetings-tab" style={{ padding: 'var(--kp-gutter)', display: 'flex', flexDirection: 'column', gap: 'var(--kp-space-lg)' }}>
      <div style={{ display: 'flex', justifyContent: 'flex-end' }}>
        <button
          type="button"
          data-testid="record-meeting-button"
          onClick={handleRecordClick}
          disabled={recording}
          style={{
            display: 'flex',
            alignItems: 'center',
            gap: 6,
            border: '1px solid var(--kp-divider)',
            background: recording ? 'var(--kp-accent-soft)' : 'var(--kp-navy)',
            color: recording ? 'var(--kp-navy)' : 'white',
            borderRadius: 'var(--radius-md)',
            padding: '8px 14px',
            fontSize: 'var(--kp-font-sm)',
            fontWeight: 'var(--kp-weight-semibold)',
            cursor: recording ? 'default' : 'pointer',
            fontFamily: 'inherit',
          }}
        >
          <Mic style={{ width: 14, height: 14 }} />
          {recording ? t('meetings.tab.recording') : t('meetings.tab.record-button')}
        </button>
      </div>

      {reviewCount > 0 && (
        <div data-testid="meetings-needs-review" style={{ display: 'flex', flexDirection: 'column', gap: 6, border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-md)', padding: '10px 12px', background: 'var(--kp-accent-soft)' }}>
          <div style={{ fontSize: 'var(--kp-font-xs)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
            {t('meetings.tab.needs-review-heading', { count: reviewCount })}
          </div>
          {reviewRows.map((r) => (
            <button
              key={r.meeting.dir}
              type="button"
              data-testid="needs-review-row"
              onClick={() => { onOpenMeeting(r.meeting); }}
              style={{ display: 'flex', alignItems: 'center', gap: 8, border: 'none', background: 'transparent', textAlign: 'left', cursor: 'pointer', fontFamily: 'inherit', padding: 0 }}
            >
              <span style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--kp-navy)' }}>{r.meeting.folderName}</span>
              {r.items.map((item) => (
                <Badge key={item.kind} variant="warning" size="sm">{reviewItemLabel(item)}</Badge>
              ))}
            </button>
          ))}
        </div>
      )}

      {!loading && meetings.length === 0 && (
        <EmptyState
          icon={Video}
          title={t('meetings.tab.empty-title')}
          body={t('meetings.tab.empty-body')}
          data-testid="client-meetings-empty"
        />
      )}

      {meetings.length > 0 && (
        <div style={{ display: 'flex', flexDirection: 'column', gap: 4 }}>
          {meetings.map((m) => (
            <button
              key={m.dir}
              type="button"
              data-testid="meeting-row"
              onClick={() => { onOpenMeeting(m); }}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                textAlign: 'left',
                border: '1px solid var(--kp-divider)',
                borderRadius: 'var(--radius-md)',
                padding: '12px 14px',
                background: 'var(--kp-surface)',
                cursor: 'pointer',
                fontFamily: 'inherit',
              }}
            >
              <div>
                <div style={{ fontSize: 'var(--kp-font-sm)', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
                  {m.folderName}
                </div>
                <div style={{ fontSize: 'var(--kp-font-xs)', color: 'var(--color-muted-foreground)' }}>
                  {formatMeetingDate(m.meta?.startedAt)}
                  {!m.hasNotes && ` · ${t('meetings.tab.notes-pending')}`}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}
      <div style={{ fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
        {t('meetings.tab.activity-hint')}
      </div>
      <ConsentDialog
        open={showConsent}
        onOpenChange={setShowConsent}
        consentMode={consentMode}
        standingConsent={standingConsent}
        macPermissionError={macPermissionError}
        onConfirm={handleConsentConfirm}
      />
    </div>
  );
}

export default ClientMeetingsTab;
