/**
 * ClientMeetingsTab — the per-client Meetings sub-tab (MatterHub, between
 * Email and Activity). Lists THIS client's meetings chronologically (reading
 * only its own `Meetings/` folder — never a cross-client inbox), and opens
 * `MeetingEntry` beside the list. A mic affordance in the rail starts a new
 * recording; the consent-gated start flow stays here.
 */
import { useEffect, useState, useCallback, useMemo, useRef } from 'react';
import { useTranslation } from 'react-i18next';
import { Mic, MoreVertical, PanelLeftClose, PanelLeftOpen, Pencil, Plus, AlertTriangle } from 'lucide-react';
import { Badge, Button, Callout, EmptyState, IconButton, RailShell, RailShellActionMenu, RailShellHeader } from '@/ui/kp';
import type { RailShellItem } from '@/ui/kp';
import { DropdownMenuItem } from '@/ui/dropdown-menu';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useVisibleCrmWriteQueueItems } from '@/platform/state/crmWriteQueueStore';
import { useMeetingStore, checkLowDiskSpaceWarning, resolveWorkspaceRoot } from './meetingStore';
import { needsReview } from './insights/review/meetingReviewArtifactStore';
import type { MeetingCalendarEventMeta, MeetingMeta } from './meetingStore';
import { meetingDisplayTitle, formatMeetingDate, formatMeetingDuration } from './meetingDisplay';
import { MeetingEntry } from './MeetingEntry';
import { meetingEntryHostIdentity } from './meetingEntryHostIdentity';
import type { MeetingCrmNavigationHandoff } from './meetingDetailHeaderProjection';
import { ConsentDialog, isMacPermissionError } from './ConsentDialog';
import { consentModeFor } from './recordingConsentLaw';
import { makeConsentLedger, type ConsentEntry } from './consentLedger';
import { deriveNoticeState, meetingDirKey, type NoticeEntry, type NoticeState } from './noticeLedger';
import { useNoticeSettings } from './noticeSettings';
import { calendarListEvents } from '@/platform/utils/calendar-commands';
import type { CalendarEventDto } from '@/platform/utils/calendar-commands';
import { useProfileStore } from '@/platform/profile/profileStore';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useActiveMatters, useMatterStore } from '@/platform/matter/matterStore';
import { buildCalendarMatterMap, matterLabel, resolveMattersForCalendarEvent } from '@/platform/rag/matterResolver';
import { pickNoticeCardOffer, type NoticeCardOffer } from './noticeCard/pickOffer';
import { buildDisplayName, detectPlatform } from './noticeCard/meetingPlatform';
import { canAutoJoin, type NoticeCardPlatform } from './noticeCard/noticeCardTypes';
import {
  resolveNoticeCardEnabled,
  resolveNoticeCardNameTemplate,
  resolveNoticeEvidenceRule,
} from './noticeCard/noticeCardSettings';
import { deriveNoticeCardEvidence, type NoticeCardEvidence } from './noticeCard/noticeCardEvidence';
import {
  createDirectClientMeetingsAdapter,
  useActiveMeetingClientBoundary,
  type DirectClientMeetingTarget,
  type DirectClientMeetingsReadResult,
  type SealedMeetingClientBoundary,
  useMeetingFoundationPreferencesStore,
} from './foundation/contract';
import {
  FILE_MEETING_OWNER_PRIVATE_POLICY,
  decideMeetingFileVisibility,
  meetingFileVisibilityManifestFromMeta,
  migrateLegacyMeetingFileVisibility,
  readCurrentMeetingFileVisibilityContext,
  type MeetingFileVisibilityContext,
} from './meetingFileVisibility';

export interface MeetingSummary {
  dir: string;
  folderName: string;
  meta: MeetingMeta | null;
  hasNotes: boolean;
  hasAudio: boolean;
  hasTranscript: boolean;
}

function clientPairKey(client: SealedMeetingClientBoundary): string {
  return JSON.stringify([client.householdRef, client.matterId]);
}

function meetingSelectionKey(
  client: SealedMeetingClientBoundary,
  meetingDir: string
): string {
  return JSON.stringify([clientPairKey(client), meetingDir]);
}

function meetingTargetKey(target: DirectClientMeetingTarget): string {
  return meetingSelectionKey(target.client, target.meetingDir);
}

export interface ListableWorkspace {
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

function calendarEventSnapshot(event: CalendarEventDto): MeetingCalendarEventMeta {
  return {
    id: event.id,
    title: event.title,
    startUtc: event.startUtc,
    endUtc: event.endUtc,
    ...(event.joinUrl ? { joinUrl: event.joinUrl } : {}),
    attendees: event.attendees.map((a) => ({ email: a.email, name: a.name })),
  };
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Workspace backends return list rows relative to the open workspace. When a
 * client's authorized matter folder is the workspace root itself, its meeting
 * rows therefore begin with `Meetings/` instead of a client-folder prefix.
 * Rebuild the direct child from the already-authorized absolute parent rather
 * than asking the later authority gate to infer that missing prefix.
 */
function canonicalDirectMeetingDirectory(
  matterFolder: string,
  childName: string
): string {
  if (
    !childName ||
    childName !== childName.trim() ||
    childName === '.' ||
    childName === '..' ||
    childName.includes('/') ||
    childName.includes('\\') ||
    childName.includes('\0')
  ) {
    throw new Error('A listed meeting folder was not a direct child.');
  }
  return `${matterFolder}/Meetings/${childName}`;
}

/** Scans `<matterFolder>/Meetings/` for meeting folders, reading each one's
 *  `meeting.json` + checking for notes/audio/transcript presence. Returns
 *  newest-first. A genuinely absent Meetings folder yields an empty,
 *  non-failed result (no meetings recorded yet); a folder that exists but
 *  can't be listed is retried before being reported as `scanFailed`. */
async function scanClientMeetingsFolder(
  matterFolder: string,
  ws: ListableWorkspace,
  opts?: {
    retryDelayMs?: number;
    visibilityContext?: MeetingFileVisibilityContext;
    matterId?: string;
  },
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

  if (opts?.matterId) {
    try {
      await migrateLegacyMeetingFileVisibility({
        matterId: opts.matterId,
        matterFolder,
        workspace: ws,
      });
    } catch {
      return { meetings: [], scanFailed: true };
    }
  }

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

  const visibilityContext =
    opts?.visibilityContext ??
    (await readCurrentMeetingFileVisibilityContext(null));

  const folders = entries.filter((e) => e.type === 'folder');
  const summaries = await Promise.all(
    folders.map(async (f): Promise<MeetingSummary | null> => {
      const meetingDir = canonicalDirectMeetingDirectory(matterFolder, f.name);
      const children = await ws.list(meetingDir).catch(() => []);
      const names = new Set(children.map((c) => c.name));
      let meta: MeetingMeta | null = null;
      try {
        meta = JSON.parse(await ws.readFile(`${meetingDir}/meeting.json`)) as MeetingMeta;
      } catch {
        meta = null;
      }
      const manifest = meetingFileVisibilityManifestFromMeta(meta);
      if (
        !manifest ||
        !decideMeetingFileVisibility({
          manifest,
          fileName: 'meeting.json',
          context: visibilityContext,
        })
      ) {
        return null;
      }
      const canSee = (fileName: string): boolean =>
        decideMeetingFileVisibility({
          manifest,
          fileName,
          context: visibilityContext,
        });
      return {
        dir: meetingDir,
        folderName: f.name,
        meta,
        hasNotes: names.has('notes.docx') && canSee('notes.docx'),
        hasAudio: names.has('audio.wav') && canSee('audio.wav'),
        hasTranscript:
          names.has('transcript.json') && canSee('transcript.json'),
      };
    }),
  );
  return {
    meetings: summaries
      .filter((summary): summary is MeetingSummary => summary !== null)
      .sort((a, b) => (b.meta?.startedAt ?? b.folderName).localeCompare(a.meta?.startedAt ?? a.folderName)),
    scanFailed: false,
  };
}

/** Public direct-client list doorway. A matter folder by itself cannot call it. */
export function listClientMeetings(input: {
  readonly clientBoundary: SealedMeetingClientBoundary;
  readonly getActiveClientBoundary: () =>
    | SealedMeetingClientBoundary
    | null;
  readonly matterFolder: string;
  readonly workspaceService: ListableWorkspace;
  readonly retryDelayMs?: number;
  readonly visibilityContext?: MeetingFileVisibilityContext;
}): Promise<DirectClientMeetingsReadResult<MeetingSummary>> {
  return createDirectClientMeetingsAdapter<MeetingSummary>({
    client: input.clientBoundary,
    getActiveClientBoundary: input.getActiveClientBoundary,
    matterFolder: input.matterFolder,
    scan: (authorizedMatterFolder) =>
      scanClientMeetingsFolder(authorizedMatterFolder, input.workspaceService, {
        ...(input.retryDelayMs !== undefined
          ? { retryDelayMs: input.retryDelayMs }
          : {}),
        ...(input.visibilityContext
          ? { visibilityContext: input.visibilityContext }
          : {}),
        matterId: input.clientBoundary.matterId,
      }),
  }).list();
}

export interface ClientMeetingsTabProps {
  /** Required sealed household + matter identity; matter/folder alone is illegal. */
  clientBoundary: SealedMeetingClientBoundary;
  /** Required live resolver; a captured pair is not enough across async scans. */
  getActiveClientBoundary: () =>
    | SealedMeetingClientBoundary
    | null;
  matterFolder: string;
  /** Injected by MatterHub (ultimately the app-layer active WorkspaceService) —
   *  features must not reach for the app-layer singleton themselves, per
   *  ARCHITECTURE.md's DAG. Null before a workspace is open. */
  workspaceService: ListableWorkspace | null;
  /** Optional direct-open request from Client Map source links or Activity rows.
   *  The tab still owns the rail and opens this meeting inside the right pane. */
  initialSelectedMeeting?: { dir: string; folderName: string; startMs?: number };
  /** Optional CRM receiver for the detail header's sealed-pair client link. */
  crmNavigation?: MeetingCrmNavigationHandoff;
}

export function ClientMeetingsTab({ clientBoundary, getActiveClientBoundary, matterFolder, workspaceService, initialSelectedMeeting, crmNavigation }: ClientMeetingsTabProps) {
  const { t, i18n } = useTranslation();
  const matterId = clientBoundary.matterId;
  const currentViewerId = useFirmStore(
    (state) => state.session?.userId ?? null
  );
  const visibilityPreferences = useMeetingFoundationPreferencesStore();
  const visibilityContext = useMemo<MeetingFileVisibilityContext>(
    () => ({
      viewerId: currentViewerId,
      policies: [
        FILE_MEETING_OWNER_PRIVATE_POLICY,
        ...visibilityPreferences.preferences.visibilityPolicies,
      ],
    }),
    [currentViewerId, visibilityPreferences.preferences.visibilityPolicies]
  );
  const visibilityIdentity = useMemo(
    () =>
      JSON.stringify([
        currentViewerId,
        visibilityPreferences.preferences.visibilityPolicies,
      ]),
    [currentViewerId, visibilityPreferences.preferences.visibilityPolicies]
  );
  const selectionScopeIdentity = `${clientPairKey(clientBoundary)}\u0000${matterFolder}\u0000${visibilityIdentity}`;
  useActiveMeetingClientBoundary();
  const activeClientBoundary = getActiveClientBoundary();
  const hasLiveClientBoundary =
    activeClientBoundary?.householdRef === clientBoundary.householdRef &&
    activeClientBoundary.matterId === clientBoundary.matterId;
  const [meetings, setMeetings] = useState<MeetingSummary[]>([]);
  const [selectedMeetingTargetKey, setSelectedMeetingTargetKey] = useState<
    string | null
  >(null);
  const [directOpenMeeting, setDirectOpenMeeting] = useState(initialSelectedMeeting ?? null);
  const [directRead, setDirectRead] = useState<DirectClientMeetingsReadResult<MeetingSummary>>({ kind: 'loading' });
  const [meetingSearchQuery, setMeetingSearchQuery] = useState('');
  const [railCollapsed, setRailCollapsed] = useState(false);
  const [loading, setLoading] = useState(true);
  const [scanFailed, setScanFailed] = useState(false);
  const recording = useMeetingStore((s) => s.status.recording);
  const processing = useMeetingStore((s) => s.processingCount > 0);
  const startRecording = useMeetingStore((s) => s.startRecording);
  const crmQueueItems = useVisibleCrmWriteQueueItems();
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
  const [noticeCardEvidenceStates, setNoticeCardEvidence] = useState<Record<string, NoticeCardEvidence>>({});
  const { policy: noticePolicy, customScript: custom } = useNoticeSettings();
  const noticeScript = custom || t('meetings.notice.default-script');
  // Notice Card — the offer for an online meeting happening now (from calendar
  // sync), the toggle state (pre-checked per firm default), and the Zoom
  // native-record self-attest. Absent for phone/in-person.
  const soloName = useProfileStore((s) => s.soloName);
  const getSetting = useSettingsStore((s) => s.getSetting);
  const activeMatters = useActiveMatters();
  const matter = useMatterStore((s) => s.matters.find((candidate) => candidate.id === matterId) ?? null);
  const [noticeCardOffer, setNoticeCardOffer] = useState<NoticeCardOffer<CalendarEventDto> | null>(null);
  const [matchedCalendarEvent, setMatchedCalendarEvent] = useState<MeetingCalendarEventMeta | null>(null);
  const [noticeCardChecked, setNoticeCardChecked] = useState(false);
  const [noticeCardZoomAttest, setNoticeCardZoomAttest] = useState(false);
  const [renamingMeetingDir, setRenamingMeetingDir] = useState<string | null>(null);
  const [meetingTitleDraft, setMeetingTitleDraft] = useState('');
  const [selectedMeetingRevision, setSelectedMeetingRevision] = useState(0);
  const [refreshNonce, setRefreshNonce] = useState(0);
  const [resolvedVisibilityIdentity, setResolvedVisibilityIdentity] = useState<
    string | null
  >(null);
  const refreshGenerationRef = useRef(0);
  const selectionScopeIdentityRef = useRef(selectionScopeIdentity);
  const visibilityIdentityRef = useRef(visibilityIdentity);
  const skipMeetingRenameBlurRef = useRef(false);
  // Manual paste fallback when calendar sync found no online meeting: lets the
  // advisor add the card to a non-calendar (or not-yet-synced) Teams/Zoom call.
  const [noticeCardManualUrl, setNoticeCardManualUrl] = useState('');
  // No per-client state on file yet (see Matter type) — consentModeFor(null)
  // is the conservative two-party default, and stateKnown={false} below keeps
  // the dialog's wording conditional rather than asserting the law.
  const consentMode = consentModeFor(null);

  const directAdapter = useMemo(
    () =>
      createDirectClientMeetingsAdapter<MeetingSummary>({
        client: clientBoundary,
        getActiveClientBoundary,
        matterFolder,
        scan: (authorizedMatterFolder) =>
          workspaceService
              ? scanClientMeetingsFolder(authorizedMatterFolder, workspaceService, {
                visibilityContext,
                matterId: clientBoundary.matterId,
              })
            : Promise.resolve({ meetings: [], scanFailed: false }),
      }),
    [clientBoundary, getActiveClientBoundary, matterFolder, workspaceService, visibilityContext]
  );

  const refresh = useCallback(async (generation: number) => {
    const isCurrent = () => generation === refreshGenerationRef.current;
    const ws = workspaceService;
    if (!ws) {
      if (!isCurrent()) return;
      setMeetings([]);
      setSelectedMeetingTargetKey(null);
      setDirectRead({ kind: 'ready', meetings: [] });
      setScanFailed(false);
      setLoading(false);
      setResolvedVisibilityIdentity(visibilityIdentity);
      return;
    }
    const result = await directAdapter.list();
    if (!isCurrent()) return;
    setDirectRead(result);
    if (result.kind !== 'ready') {
      setMeetings([]);
      setSelectedMeetingTargetKey(null);
      setScanFailed(result.kind === 'error');
      setLoading(false);
      setResolvedVisibilityIdentity(visibilityIdentity);
      return;
    }
    const list = result.meetings.map((entry) => entry.meeting);
    setMeetings(list);
    setSelectedMeetingTargetKey((current) => {
      const directTarget = directAdapter.resolveTarget(result, directOpenMeeting);
      if (directTarget) return meetingTargetKey(directTarget);
      if (result.meetings.length === 0) return null;
      if (
        current &&
        result.meetings.some(
          (entry) => meetingTargetKey(entry.target) === current
        )
      ) {
        return current;
      }
      const first = result.meetings[0];
      return first ? meetingTargetKey(first.target) : null;
    });
    setScanFailed(false);
    // Recording Notice Kit — one ledger read, grouped by meeting dir, so each
    // row can reflect its notice state (verified / needs-review / quarantined).
    try {
      const notices = await makeConsentLedger(ws, () => matterFolder).allNotices();
      if (!isCurrent()) return;
      // Key by normalized folder name so entries written with Rust's canonical
      // meetingDir line up with the (possibly differently-prefixed) row paths
      // from the FS list (codex-review R2).
      const byDir: Record<string, NoticeEntry[]> = {};
      for (const n of notices) (byDir[meetingDirKey(n.meetingDir)] ??= []).push(n);
      const states: Record<string, NoticeState> = {};
      const cardEvidence: Record<string, NoticeCardEvidence> = {};
      for (const [key, entries] of Object.entries(byDir)) {
        states[key] = deriveNoticeState(entries);
        cardEvidence[key] = deriveNoticeCardEvidence(entries);
      }
      setNoticeStates(states);
      setNoticeCardEvidence(cardEvidence);
    } catch {
      if (!isCurrent()) return;
      setNoticeStates({});
      setNoticeCardEvidence({});
    }
    if (!isCurrent()) return;
    setLoading(false);
    setResolvedVisibilityIdentity(visibilityIdentity);
  }, [directAdapter, matterFolder, workspaceService, directOpenMeeting, visibilityIdentity]);

  const runRefresh = useCallback(() => {
    setRefreshNonce((value) => value + 1);
  }, []);
  const handleMeetingChanged = runRefresh;

  const busy = recording || processing;
  useEffect(() => {
    const generation = ++refreshGenerationRef.current;
    const selectionScopeChanged =
      selectionScopeIdentityRef.current !== selectionScopeIdentity;
    const visibilityChanged = visibilityIdentityRef.current !== visibilityIdentity;
    visibilityIdentityRef.current = visibilityIdentity;
    // A changed client or viewer/policy invalidates every prior list/detail
    // immediately. An ordinary refresh keeps the already-authorized detail
    // mounted while the same meeting is rescanned, preventing a child change
    // notification from turning into an unmount/remount loop.
    if (selectionScopeChanged || visibilityChanged) {
      setResolvedVisibilityIdentity(null);
      setMeetings([]);
      setDirectRead({ kind: 'loading' });
    }
    if (selectionScopeChanged) {
      selectionScopeIdentityRef.current = selectionScopeIdentity;
      setSelectedMeetingTargetKey(null);
      setDirectOpenMeeting(null);
    }
    setNoticeStates({});
    setNoticeCardEvidence({});
    setScanFailed(false);
    setLoading(true);
    if (!busy) {
      void refresh(generation).catch(() => {
        if (generation !== refreshGenerationRef.current) return;
        setScanFailed(true);
        setLoading(false);
        setResolvedVisibilityIdentity(visibilityIdentity);
      });
    }
    return () => {
      if (generation === refreshGenerationRef.current)
        refreshGenerationRef.current += 1;
    };
  }, [busy, refresh, refreshNonce, selectionScopeIdentity, visibilityIdentity]);

  const handleSaveMeetingTitle = useCallback(async (meeting: MeetingSummary, title: string) => {
    const ws = workspaceService;
    if (!ws) return;
    const trimmed = title.trim();
    const raw = await ws.readFile(`${meeting.dir}/meeting.json`);
    const current = JSON.parse(raw) as MeetingMeta;
    const next: MeetingMeta = trimmed
      ? { ...current, customTitle: trimmed }
      : (() => {
          const { customTitle: _customTitle, ...rest } = current;
          return rest;
        })();
    await ws.writeFile(`${meeting.dir}/meeting.json`, JSON.stringify(next, null, 2));
    setMeetings((currentMeetings) =>
      currentMeetings.map((candidate) =>
        candidate.dir === meeting.dir ? { ...candidate, meta: next } : candidate,
      ),
    );
    setRenamingMeetingDir(null);
    setMeetingTitleDraft('');
    if (
      selectedMeetingTargetKey === meetingSelectionKey(clientBoundary, meeting.dir)
    ) {
      setSelectedMeetingRevision((revision) => revision + 1);
    }
  }, [clientBoundary, selectedMeetingTargetKey, workspaceService]);

  useEffect(() => {
    if (!initialSelectedMeeting) return;
    setDirectOpenMeeting(initialSelectedMeeting);
  }, [initialSelectedMeeting]);

  // Refresh once a recording for this client finishes AND its post-stop
  // pipeline (transcription + notes) is done, so the new meeting appears —
  // with its notes — without the advisor leaving and reopening the tab.
  const handleRecordClick = useCallback(() => {
    void (async () => {
      if (workspaceService) {
        const sc = await makeConsentLedger(workspaceService, () => matterFolder).standingConsent(matterId);
        setStandingConsent(sc);
      }
      setMacPermissionError(false);
      setConsentError(null);
      // Notice Card — is an online meeting for THIS client happening now?
      // Best-effort; a calendar miss simply means no auto offer (the manual
      // paste field still lets the advisor add the card). Crucially, we filter
      // the practice-wide calendar to events that resolve to the CURRENT client
      // so we can never pre-check/launch the card into a different client's
      // concurrent meeting (Codex R7 P1). No current-client match => no auto
      // offer; the advisor explicitly pastes a link instead.
      let offer: NoticeCardOffer<CalendarEventDto> | null = null;
      try {
        const now = Date.now();
        const grace = 5 * 60 * 1000;
        const events = await calendarListEvents(
          new Date(now - grace).toISOString(),
          new Date(now + grace).toISOString(),
        );
        const map = buildCalendarMatterMap(activeMatters);
        const mine = events.filter((e) => resolveMattersForCalendarEvent(e, map).includes(matterId));
        const pickedOffer = pickNoticeCardOffer(mine, now);
        offer = pickedOffer;
        const matchedEvent = pickedOffer?.event ?? (mine.length === 1 ? mine[0] ?? null : null);
        setMatchedCalendarEvent(matchedEvent ? calendarEventSnapshot(matchedEvent) : null);
      } catch {
        offer = null;
        setMatchedCalendarEvent(null);
      }
      setNoticeCardOffer(offer);
      // Pre-check per firm default, but only for a platform we can actually
      // drive (Teams/Zoom). Meet shows an honest fallback, never a checked box.
      setNoticeCardChecked(!!offer && canAutoJoin(offer.platform) && resolveNoticeCardEnabled(getSetting));
      setNoticeCardZoomAttest(false);
      setNoticeCardManualUrl('');
      // QA-35 — cheap disk-space preflight, checked fresh on every open so
      // the warning reflects right now, not a stale prior check.
      setLowDiskSpace(await checkLowDiskSpaceWarning());
      setShowConsent(true);
    })();
  }, [matterId, matterFolder, workspaceService, getSetting, activeMatters]);

  const handleConsentConfirm = useCallback((opts: { note?: string }) => {
    void (async () => {
      try {
        // Notice Card — from the calendar offer (if kept checked) OR a manually
        // pasted link when calendar sync found nothing. Only when we can drive
        // the platform (Teams/Zoom). Build the guest name from the firm template.
        const buildCard = () => {
          let joinUrl: string | undefined;
          let platform: NoticeCardPlatform | undefined;
          let meetingTitle: string | undefined;
          if (noticeCardOffer && noticeCardChecked) {
            joinUrl = noticeCardOffer.joinUrl;
            platform = noticeCardOffer.platform;
            meetingTitle = noticeCardOffer.meetingTitle;
          } else if (!noticeCardOffer && noticeCardManualUrl.trim()) {
            joinUrl = noticeCardManualUrl.trim();
            platform = detectPlatform(joinUrl);
          }
          if (!joinUrl || !platform || !canAutoJoin(platform)) return undefined;
          const advisorName = (soloName.trim().split(/\s+/)[0] || '').trim();
          return {
            joinUrl,
            platform,
            displayName: buildDisplayName(resolveNoticeCardNameTemplate(getSetting), advisorName, platform),
            ...(meetingTitle ? { meetingTitle } : {}),
            advisorName,
            ...(platform === 'zoom' && noticeCardZoomAttest ? { zoomNativeRecordAttested: true } : {}),
          };
        };
        const card = buildCard();
        const calendarEvent = matchedCalendarEvent ?? (noticeCardOffer ? calendarEventSnapshot(noticeCardOffer.event) : null);
        await startRecording(matterId, {
          consentMode,
          ...(opts.note ? { consentNote: opts.note } : {}),
          ...(calendarEvent ? { calendarEvent } : {}),
          // Capture the script/locale shown for this recording (codex-review R6).
          noticeCustomScript: custom,
          noticeLanguage: i18n.language,
          ...(card ? { noticeCard: card } : {}),
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
  }, [
    matterId,
    consentMode,
    startRecording,
    custom,
    i18n.language,
    noticeCardOffer,
    matchedCalendarEvent,
    noticeCardChecked,
    noticeCardZoomAttest,
    noticeCardManualUrl,
    soloName,
    getSetting,
  ]);

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
  const selectedPairBoundMeeting =
    resolvedVisibilityIdentity === visibilityIdentity &&
    directRead.kind === 'ready'
      ? directRead.meetings.find(
          (entry) =>
            meetingTargetKey(entry.target) === selectedMeetingTargetKey
        ) ?? null
      : null;
  const selectedHostIdentity =
    selectedPairBoundMeeting && activeClientBoundary
      ? meetingEntryHostIdentity({
          activeClientBoundary,
          target: selectedPairBoundMeeting.target,
        })
      : null;
  const selectedMeetingTarget = selectedHostIdentity
    ? selectedPairBoundMeeting?.target ?? null
    : null;
  const selectedMeeting = selectedMeetingTarget
    ? selectedPairBoundMeeting?.meeting ?? null
    : null;
  const selectedMeetingInitialSeekMs =
    selectedMeeting && directOpenMeeting?.dir === selectedMeeting.dir
      ? directOpenMeeting.startMs
      : undefined;
  const clientName = matter ? matterLabel(matter) : matterId;

  const handleSelectMeeting = useCallback((dir: string) => {
    setDirectOpenMeeting(null);
    if (directRead.kind !== 'ready') {
      setSelectedMeetingTargetKey(null);
      return;
    }
    const match = directRead.meetings.find(
      (entry) => entry.target.meetingDir === dir
    );
    const identity =
      match && activeClientBoundary
        ? meetingEntryHostIdentity({
            activeClientBoundary,
            target: match.target,
          })
        : null;
    setSelectedMeetingTargetKey(
      identity && match ? meetingTargetKey(match.target) : null
    );
  }, [activeClientBoundary, directRead]);

  useEffect(() => {
    setSelectedMeetingTargetKey((current) => {
      if (directRead.kind !== 'ready') return null;
      if (
        current &&
        directRead.meetings.some(
          (entry) => meetingTargetKey(entry.target) === current
        )
      ) {
        return current;
      }
      const directTarget = directAdapter.resolveTarget(
        directRead,
        directOpenMeeting
      );
      if (directTarget) return meetingTargetKey(directTarget);
      const first = directRead.meetings[0];
      return first ? meetingTargetKey(first.target) : null;
    });
  }, [directAdapter, directOpenMeeting, directRead]);

  const meetingItems = useMemo<RailShellItem[]>(() => meetings.map((m) => {
    const noticeState = noticeStates[meetingDirKey(m.dir)];
    const cardEvidence = noticeCardEvidenceStates[meetingDirKey(m.dir)];
    const reviewItems = needsReview(
      m,
      matterQueue,
      undefined,
      noticeState
        ? {
            state: noticeState,
            policy: noticePolicy,
            ...(cardEvidence ? { cardEvidence } : {}),
            evidenceRule: resolveNoticeEvidenceRule(getSetting),
          }
        : undefined,
    );
    const quarantined = reviewItems.some((i) => i.kind === 'notice-quarantined');
    const title = meetingDisplayTitle(m.meta, t);
    const duration = formatMeetingDuration(m.meta?.durationMs, t);
    const metaText = [formatMeetingDate(m.meta?.startedAt), duration].filter(Boolean).join(' · ');
    const pendingText = !m.hasNotes
      ? m.meta?.notesError
        ? t('meetings.tab.notes-failed')
        : m.meta?.recordingError && !m.hasAudio
          ? t('meetings.tab.recording-incomplete')
          : t('meetings.tab.notes-pending')
      : '';
    const status = quarantined
      ? <Badge variant="warning" size="sm" data-testid="meeting-quarantine-badge">{t('meetings.notice.quarantine-badge')}</Badge>
      : pendingText
        ? (
            <span style={{ flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 86, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
              {pendingText}
            </span>
          )
        : reviewItems.length > 0
          ? <Badge variant="warning" size="sm">{t('meetings.tab.needs-review-badge')}</Badge>
          : null;
    const isRenaming = renamingMeetingDir === m.dir;
    const saveTitle = () => {
      void handleSaveMeetingTitle(m, meetingTitleDraft).catch(() => {
        setRenamingMeetingDir(null);
        setMeetingTitleDraft('');
      });
    };

    return {
      id: m.dir,
      label: title,
      testId: 'meeting-row',
      ariaLabel: `${title} ${formatMeetingDate(m.meta?.startedAt)}`,
      content: (
        <div style={{ display: 'flex', minWidth: 0, alignItems: 'center', gap: 6 }}>
          {isRenaming ? (
            <input
              data-testid="meeting-rail-rename-input"
              aria-label={t('meetings.entry.rename')}
              autoFocus
              value={meetingTitleDraft}
              onChange={(event) => { setMeetingTitleDraft(event.target.value); }}
              onBlur={() => {
                if (skipMeetingRenameBlurRef.current) {
                  skipMeetingRenameBlurRef.current = false;
                  return;
                }
                saveTitle();
              }}
              onKeyDown={(event) => {
                if (event.key === 'Enter') saveTitle();
                if (event.key === 'Escape') {
                  skipMeetingRenameBlurRef.current = true;
                  setRenamingMeetingDir(null);
                  setMeetingTitleDraft('');
                }
              }}
              style={{ minWidth: 0, flex: 1, height: 26, border: '1px solid var(--kp-divider)', borderRadius: 'var(--radius-sm)', padding: '2px 6px', fontSize: 'var(--kp-font-xs)' }}
            />
          ) : (
            <>
              <span style={{ minWidth: 0, flex: 1, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', fontWeight: 'var(--kp-weight-semibold)', color: 'var(--kp-navy)' }}>
                {title}
              </span>
              {metaText && (
                <span style={{ flex: 'none', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap', maxWidth: 86, fontSize: 'var(--kp-font-2xs)', color: 'var(--color-muted-foreground)' }}>
                  {metaText}
                </span>

              )}
              {status}
              <button
                type="button"
                data-testid="meeting-rail-rename"
                aria-label={t('meetings.entry.rename')}
                title={t('meetings.entry.rename')}
                onClick={() => {
                  skipMeetingRenameBlurRef.current = false;
                  setRenamingMeetingDir(m.dir);
                  setMeetingTitleDraft(title);
                }}
                style={{ display: 'inline-flex', alignItems: 'center', justifyContent: 'center', width: 22, height: 22, border: 'none', borderRadius: 'var(--radius-sm)', background: 'transparent', color: 'var(--color-muted-foreground)', cursor: 'pointer', flex: 'none' }}
              >
                <Pencil aria-hidden="true" style={{ width: 12, height: 12 }} />
              </button>
            </>
          )}
        </div>
      ),
    };
  }), [
    meetings,
    noticeStates,
    noticeCardEvidenceStates,
    matterQueue,
    noticePolicy,
    getSetting,
    renamingMeetingDir,
    meetingTitleDraft,
    handleSaveMeetingTitle,
    t,
  ]);

  const filteredMeetingItems = useMemo(() => {
    const q = meetingSearchQuery.trim().toLowerCase();
    if (!q) return meetingItems;
    return meetingItems.filter((item) => {
      const label = typeof item.label === 'string' ? item.label : item.ariaLabel ?? item.id;
      return label.toLowerCase().includes(q);
    });
  }, [meetingItems, meetingSearchQuery]);

  const railEmptyState = (() => {
    if (meetingSearchQuery.trim() && meetings.length > 0) {
      return (
        <div data-testid="client-meetings-search-empty" style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--color-muted-foreground)' }}>
          {t('meetings.tab.no-results')}
        </div>
      );
    }
    if (loading) {
      return (
        <div data-testid="client-meetings-loading" style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--color-muted-foreground)' }}>
          {t('meetings.tab.loading')}
        </div>
      );
    }
    if (processing && meetings.length === 0) {
      return (
        <div data-testid="client-meetings-processing" style={{ fontSize: 'var(--kp-font-sm)', color: 'var(--color-muted-foreground)' }}>
          {t('meetings.pill.processing')}
        </div>
      );
    }
    if (showScanError) {
      return (
        <div data-testid="client-meetings-scan-error">
          <Callout variant="error" icon={AlertTriangle}>
            <div style={{ fontWeight: 'var(--kp-weight-semibold)' }}>{t('meetings.tab.scan-error-title')}</div>
            <div style={{ marginTop: 2 }}>{t('meetings.tab.scan-error-body')}</div>
            <Button
              data-testid="client-meetings-retry-button"
              size="sm"
              variant="secondary"
              onClick={runRefresh}
              style={{ marginTop: 'var(--kp-space-sm)' }}
            >
              {t('meetings.tab.retry-button')}
            </Button>
          </Callout>
        </div>
      );
    }
    return null;
  })();

  // The direct route itself disappears on either pair-field change. Its scan
  // already refuses before touching the filesystem; this also removes every
  // matter-only action button while the parent catches up or has no client.
  if (!hasLiveClientBoundary) return null;

  return (
    <div
      data-testid="client-meetings-tab"
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: 'auto',
        display: 'flex',
      }}
    >
      <RailShell
        header={
          <div data-testid="client-meetings-rail-header">
            <RailShellHeader
              title={t('meetings.entry.breadcrumb-meetings')}
              search={{
                value: meetingSearchQuery,
                onChange: setMeetingSearchQuery,
                onClear: () => { setMeetingSearchQuery(''); },
                placeholder: t('meetings.tab.search-placeholder'),
                label: t('meetings.tab.search-placeholder'),
                testId: 'client-meetings-search',
              }}
              createAction={
                <IconButton
                  data-testid="record-meeting-button"
                  icon={Plus}
                  label={recording ? t('meetings.tab.recording') : t('meetings.tab.record-button')}
                  onClick={handleRecordClick}
                  disabled={recording}
                  variant="ghost"
                />
              }
              menuAction={(
                <RailShellActionMenu icon={MoreVertical} label={t('meetings.tab.more-actions')}>
                  <DropdownMenuItem onSelect={runRefresh}>
                    {t('meetings.tab.refresh')}
                  </DropdownMenuItem>
                </RailShellActionMenu>
              )}
              collapseAction={(
                <IconButton
                  icon={PanelLeftClose}
                  label={t('meetings.tab.hide-list')}
                  size="sm"
                  variant="ghost"
                  data-testid="client-meetings-rail-hide"
                  onClick={() => { setRailCollapsed(true); }}
                />
              )}
            />
          </div>
        }
        listAriaLabel={t('meetings.entry.breadcrumb-meetings')}
        items={filteredMeetingItems}
        activeId={selectedMeeting?.dir ?? null}
        onSelect={handleSelectMeeting}
        emptyState={railEmptyState}
        collapsed={railCollapsed}
        collapsedRail={(
          <div className="flex flex-col items-center gap-2">
            <IconButton
              icon={PanelLeftOpen}
              label={t('meetings.tab.show-list')}
              size="sm"
              variant="ghost"
              data-testid="client-meetings-rail-show"
              onClick={() => { setRailCollapsed(false); }}
            />
            <IconButton
              data-testid="record-meeting-button"
              icon={Plus}
              label={recording ? t('meetings.tab.recording') : t('meetings.tab.record-button')}
              onClick={handleRecordClick}
              disabled={recording}
              variant="ghost"
            />
          </div>
        )}
        className="flex-1"
      >
        {selectedMeeting && selectedMeetingTarget ? (
          <MeetingEntry
            key={`${meetingTargetKey(selectedMeetingTarget)}:${String(selectedMeetingRevision)}`}
            activeClientBoundary={activeClientBoundary}
            target={selectedMeetingTarget}
            clientName={clientName}
            workspaceRoot={resolveWorkspaceRoot()}
            workspaceService={workspaceService as WorkspaceService | null}
            onBack={() => { setSelectedMeetingTargetKey(null); }}
            onChanged={handleMeetingChanged}
            showBackButton={false}
            {...(crmNavigation ? { crmNavigation } : {})}
            {...(selectedMeetingInitialSeekMs !== undefined ? { initialSeekMs: selectedMeetingInitialSeekMs } : {})}
          />
        ) : (
          <div style={{ display: 'flex', minHeight: 0, flex: 1, flexDirection: 'column', justifyContent: 'center', padding: 'var(--kp-gutter)' }}>
            {showEmpty && (
              <EmptyState
                icon={Mic}
                title={t('meetings.tab.empty-title')}
                body={t('meetings.tab.empty-body')}
                actions={(
                  <Button
                    data-testid="client-meetings-empty-record"
                    size="sm"
                    variant="primary"
                    iconLeft={Mic}
                    onClick={handleRecordClick}
                    disabled={recording}
                  >
                    {t('meetings.tab.empty-cta')}
                  </Button>
                )}
                data-testid="client-meetings-empty"
              />
            )}
          </div>
        )}
      </RailShell>
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
        noticeCard={
          noticeCardOffer
            ? {
                offer: { platform: noticeCardOffer.platform, meetingTitle: noticeCardOffer.meetingTitle },
                checked: noticeCardChecked,
                onToggle: setNoticeCardChecked,
                ...(noticeCardOffer.platform === 'zoom'
                  ? { zoomNativeRecord: { checked: noticeCardZoomAttest, onToggle: setNoticeCardZoomAttest } }
                  : {}),
              }
            : {
                // No calendar offer: the small manual paste-a-link affordance so
                // a non-calendar Teams/Zoom call can still get the Notice Card.
                checked: false,
                onToggle: setNoticeCardChecked,
                manualUrl: noticeCardManualUrl,
                onManualUrlChange: setNoticeCardManualUrl,
              }
        }
        onConfirm={handleConsentConfirm}
      />
    </div>
  );
}

export default ClientMeetingsTab;
