import {
  useCallback,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { useTranslation } from 'react-i18next';
import { CalendarDays, ChevronLeft, Mic, Plus } from 'lucide-react';
import { CalendarGridSurface } from '@/features/calendar-grid';
import {
  readSelectionOperationDecision,
  useSelectionPresentation,
} from '@/platform/client-context';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useFlag } from '@/platform/flags';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useFirm } from '@/platform/hooks/useFirm';
import { buildResolvedProviderForGlance } from '@/platform/matter/matterAtAGlance';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { TranscriptFile } from '@/platform/types/meeting';
import {
  createMeetingReviewInboxReader,
  DEFAULT_MEETING_REVIEW_INBOX_FILTER,
  MEETING_REVIEW_INBOX_LOADING,
  MEETING_REVIEW_INBOX_REQUIREMENTS,
  type MeetingReviewInboxFilter,
  type MeetingReviewInboxResult,
} from '../meetingReviewInbox';
import {
  createFirmMeetingDirectoryReader,
  createMeetingArtifactStore,
  createMeetingPopulationService,
  grantFirmMeetingDirectoryAccess,
  projectMeetingList,
  readActiveMeetingClientBoundary,
  useActiveMeetingClientBoundary,
  type MeetingOpenTarget,
  type MeetingProjection,
  type SealedMeetingClientBoundary,
} from '../foundation/contract';
import { resolveMatterFolder } from '../meetingStore';
import { AutoJoinMeetingsPanel } from '../AutoJoinMeetingsPanel';
import { ClientMeetingsTab } from '../ClientMeetingsTab';
import { MeetingEntry } from '../MeetingEntry';
import { meetingEntryHostIdentity } from '../meetingEntryHostIdentity';
import { MeetingTemplatePanel } from '../MeetingTemplatePanel';
import { createPreparedMeetingTemplateFillProvider } from '../meetingTemplateAi';
import {
  useMeetingListComposition,
  useMeetingListToolComposition,
  type MeetingListContext,
  type MeetingListToolContext,
} from './contracts';
import {
  registerMeetingsNavigationHost,
  resolveMeetingsSurfaceNavigation,
  type MeetingsNavigationNotice,
  type MeetingsNavigationRuntime,
} from './navigation';
import type { MeetingsSurfaceRuntime } from './appSurface';
import './meetingsShell.css';

type ShellView = string;

interface DirectoryLoadState {
  readonly key: string;
  readonly status: 'loading' | 'ready' | 'error';
  readonly records: readonly MeetingProjection[];
}

interface ReviewLoadState {
  readonly key: string;
  readonly result: MeetingReviewInboxResult;
}

const REVIEW_CLIENT_REQUIRED: MeetingReviewInboxResult = Object.freeze({
  kind: 'refused',
  reason: 'invalid-client-pair',
  message: 'Choose one client to review meeting actions.',
  retry: 'not-available',
});

const CLIENT_MEETING_SELECTION_REQUEST = {
  operationClass: 'matter-scoped',
  allowAllMatters: false,
  requireFollowerAgreement: true,
} as const;

const FIRM_MEETING_SELECTION_REQUEST = {
  operationClass: 'matter-scoped',
  allowAllMatters: true,
  requireFollowerAgreement: true,
} as const;

const LOCAL_PRACTICE_TEMPLATE_OWNER = 'local-practice';

function currentMeetingSelectionError(): string | null {
  const decision = readSelectionOperationDecision(
    CLIENT_MEETING_SELECTION_REQUEST
  );
  return decision.kind === 'refused' ? decision.message : null;
}

function currentFirmMeetingSelectionError(): string | null {
  const decision = readSelectionOperationDecision(
    FIRM_MEETING_SELECTION_REQUEST
  );
  return decision.kind === 'refused' ? decision.message : null;
}

/** The production linked-detail composition reached only with a sealed target. */
export function MeetingsDetailHost({
  target,
  runtime,
  onBack,
}: {
  target: MeetingOpenTarget;
  runtime: Pick<MeetingsSurfaceRuntime, 'workspace'>;
  onBack: () => void;
}) {
  const activeClientBoundary = useActiveMeetingClientBoundary();
  const identity = activeClientBoundary
    ? meetingEntryHostIdentity({ activeClientBoundary, target })
    : null;
  if (!identity) return null;
  return (
    <section className="meetings-shell-detail" data-testid="meetings-linked-detail">
      <MeetingEntry
        activeClientBoundary={identity.clientBoundary}
        target={identity.target}
        clientName={
          identity.clientBoundary.displayName ??
          identity.clientBoundary.householdRef
        }
        workspaceRoot={runtime.workspace.rootPath ?? ''}
        workspaceService={runtime.workspace.serviceRef.current}
        onBack={onBack}
      />
    </section>
  );
}

function TemplateManagement({
  target,
  activeClientBoundary,
  runtime,
}: {
  target: MeetingOpenTarget | null;
  activeClientBoundary: SealedMeetingClientBoundary | null;
  runtime: Pick<MeetingsSurfaceRuntime, 'workspace'>;
}) {
  const { t } = useTranslation();
  const firm = useFirm();
  const [transcript, setTranscript] = useState<TranscriptFile | null>(null);
  const [loading, setLoading] = useState(target !== null);
  const workspace = runtime.workspace.serviceRef.current;

  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      setTranscript(null);
      setLoading(target !== null);
    });
    if (!target || !workspace) return () => { current = false; };
    void workspace
      .readFile(`${target.meetingDir}/transcript.json`)
      .then((raw) => {
        if (current) setTranscript(JSON.parse(raw) as TranscriptFile);
      })
      .catch(() => {
        if (current) setTranscript(null);
      })
      .finally(() => {
        if (current) setLoading(false);
      });
    return () => { current = false; };
  }, [target, workspace]);

  if (!workspace) {
    return (
      <div className="meetings-shell-empty" data-testid="meetings-templates-unavailable">
        {t('meetings.shell.templates.no-transcript')}
      </div>
    );
  }
  const fill =
    target && transcript && activeClientBoundary
      ? {
          activeClientBoundary,
          target,
          transcript,
          clientName:
            activeClientBoundary.displayName ??
            activeClientBoundary.householdRef,
          getProvider: async () => {
            const resolved = await buildResolvedProviderForGlance();
            return createPreparedMeetingTemplateFillProvider({
              matterId: activeClientBoundary.matterId,
              resolved,
            });
          },
        }
      : undefined;
  return (
    <>
      {loading ? (
        <div className="meetings-shell-local-state" data-testid="meetings-templates-loading">
          {t('meetings.shell.loading.templates')}
        </div>
      ) : target && !transcript ? (
        <div className="meetings-shell-empty" data-testid="meetings-templates-unavailable">
          {t('meetings.shell.templates.no-transcript')}
        </div>
      ) : null}
      <MeetingTemplatePanel
        workspace={workspace}
        firmId={firm.org?.org_id ?? LOCAL_PRACTICE_TEMPLATE_OWNER}
        canManageTemplates={firm.role === 'admin' || !firm.org}
        {...(fill ? { fill } : {})}
      />
    </>
  );
}

function AutomationsManagement() {
  const { t } = useTranslation();
  return (
    <section data-testid="meetings-automations-management">
      <p className="meetings-shell-section-copy">
        {t('meetings.shell.automations.description')}
      </p>
      <AutoJoinMeetingsPanel />
    </section>
  );
}

export interface MeetingsWorkspaceRuntime
  extends MeetingsNavigationRuntime {
  readonly workspace: MeetingsSurfaceRuntime['workspace'];
}

export function MeetingsWorkspace({ runtime }: { runtime: MeetingsWorkspaceRuntime }) {
  const { t } = useTranslation();
  const live = useLiveCrmRecords();
  const selection = useSelectionPresentation();
  const activeClientBoundary = useActiveMeetingClientBoundary();
  const matters = useMatterStore((state) => state.matters);
  const currentMemberId = useFirmStore((state) => state.session?.userId ?? null);
  const calendarEnabled = useFlag('calendar-grid');
  const [view, setView] = useState<ShellView>('upcoming');
  const [ownerFilter, setOwnerFilter] = useState<string | null>(null);
  const [reviewFilter, setReviewFilter] = useState<MeetingReviewInboxFilter>(
    DEFAULT_MEETING_REVIEW_INBOX_FILTER
  );
  const [reviewRetry, setReviewRetry] = useState(0);
  const [detailTarget, setDetailTarget] = useState<MeetingOpenTarget | null>(null);
  const [templateTarget, setTemplateTarget] = useState<MeetingOpenTarget | null>(null);
  const [navigationNotice, setNavigationNotice] = useState<
    'folder-only' | 'refused' | 'open-failed' | null
  >(null);
  const [now] = useState(() => Date.now());
  const activeClientBoundaryRef = useRef(activeClientBoundary);
  useEffect(() => {
    activeClientBoundaryRef.current = activeClientBoundary;
  }, [activeClientBoundary]);

  const matterKey = matters.map((matter) => matter.id).sort().join('\u0000');
  const grant = useMemo(() => {
    if (!matterKey) return null;
    return grantFirmMeetingDirectoryAccess();
  }, [matterKey]);
  const recordRevision = live.records
    .map((record) => `${record.id}:${record.updatedAt ?? ''}`)
    .sort()
    .join('\u0000');
  const selectionKey = `${selection.scope.kind}:${selection.matterId ?? ''}:${selection.followerStatus}`;
  const activeClientBoundaryKey = activeClientBoundary
    ? `${activeClientBoundary.householdRef}\u0000${activeClientBoundary.matterId}`
    : 'no-active-client';
  const directoryKey = `${selectionKey}:${recordRevision}:${grant ? 'granted' : 'refused'}`;
  const reviewKey = `${directoryKey}:${JSON.stringify(reviewFilter)}:${String(reviewRetry)}`;
  const [directoryState, setDirectoryState] = useState<DirectoryLoadState>({
    key: directoryKey,
    status: 'loading',
    records: [],
  });
  const [reviewState, setReviewState] = useState<ReviewLoadState>({
    key: reviewKey,
    result: MEETING_REVIEW_INBOX_LOADING,
  });
  const activeDirectoryState = directoryState.key === directoryKey
    ? directoryState
    : { key: directoryKey, status: 'loading' as const, records: [] };
  const activeReviewState = reviewState.key === reviewKey
    ? reviewState
    : { key: reviewKey, result: MEETING_REVIEW_INBOX_LOADING };
  const records = activeDirectoryState.records;
  const loading = activeDirectoryState.status === 'loading';
  const loadError = activeDirectoryState.status === 'error';
  const reviewResult = activeReviewState.result;
  const port = useMemo(
    () => ({
      records: live.records,
      workspaceRoot: live.workspaceRoot,
      error: live.error,
      save: live.save,
      reloadRecords: live.reloadRecords,
      getActiveClientBoundary: readActiveMeetingClientBoundary,
      getSelectionError: currentMeetingSelectionError,
      getFirmSelectionError: currentFirmMeetingSelectionError,
    }),
    [live.error, live.records, live.reloadRecords, live.save, live.workspaceRoot]
  );
  const portRef = useRef(port);
  useEffect(() => {
    portRef.current = port;
  }, [port]);

  useEffect(() => {
    let current = true;
    if (selection.blocked || !grant) {
      queueMicrotask(() => {
        if (!current) return;
        setDirectoryState({ key: directoryKey, status: 'ready', records: [] });
      });
      return () => { current = false; };
    }
    void createFirmMeetingDirectoryReader(portRef.current, grant)
      .list()
      .then((next) => {
        if (!current) return;
        if (next.kind === 'ready') {
          setDirectoryState({
            key: directoryKey,
            status: 'ready',
            records: next.meetings,
          });
          return;
        }
        setDirectoryState({
          key: directoryKey,
          status: next.kind === 'loading' ? 'loading' : 'error',
          records: [],
        });
      })
      .catch(() => {
        if (!current) return;
        setDirectoryState({ key: directoryKey, status: 'error', records: [] });
      });
    return () => { current = false; };
  }, [directoryKey, grant, selection.blocked]);

  useEffect(() => {
    let current = true;
    const boundary = activeClientBoundaryRef.current;
    if (selection.blocked || !grant || !boundary) {
      queueMicrotask(() => {
        if (!current) return;
        setReviewState({
          key: reviewKey,
          result: REVIEW_CLIENT_REQUIRED,
        });
      });
      return () => { current = false; };
    }
    const directory = createFirmMeetingDirectoryReader(portRef.current, grant);
    const reviews = createMeetingArtifactStore(portRef.current).reviewNeededForFirm(
      grant,
      MEETING_REVIEW_INBOX_REQUIREMENTS
    );
    const reader = createMeetingReviewInboxReader({
      directory,
      reviews,
      getActiveClientBoundary: readActiveMeetingClientBoundary,
      getMeetingFacts: () => [],
    });
    void reader
      .readForClient(boundary, reviewFilter)
      .then((next) => {
        if (!current) return;
        setReviewState({ key: reviewKey, result: next });
      })
      .catch(() => {
        if (!current) return;
        setReviewState({
          key: reviewKey,
          result: {
            kind: 'error',
            message: 'Meeting review records could not be loaded.',
            retry: 'available',
          },
        });
      });
    return () => { current = false; };
  }, [
    activeClientBoundaryKey,
    grant,
    reviewFilter,
    reviewKey,
    selection.blocked,
  ]);

  const scopedMeetings = useMemo(
    () => activeClientBoundary
      ? projectMeetingList(
          records,
          ownerFilter
            ? {
                kind: 'owner',
                client: activeClientBoundary,
                ownerId: ownerFilter,
              }
            : { kind: 'client', client: activeClientBoundary }
        ).meetings
      : [],
    [activeClientBoundary, ownerFilter, records]
  );
  const reviewMeetingCount =
    reviewResult.kind === 'ready-empty' || reviewResult.kind === 'ready-populated'
      ? reviewResult.badgeMeetingCount
      : 0;

  const safeDetailTarget =
    detailTarget &&
    activeClientBoundary &&
    detailTarget.client.matterId === activeClientBoundary.matterId &&
    detailTarget.client.householdRef === activeClientBoundary.householdRef
      ? detailTarget
      : null;
  const safeTemplateTarget =
    templateTarget &&
    activeClientBoundary &&
    templateTarget.client.matterId === activeClientBoundary.matterId &&
    templateTarget.client.householdRef === activeClientBoundary.householdRef
      ? templateTarget
      : null;

  const openSelectedMeeting = useCallback(async (meetingRef: string) => {
    try {
      const service = createMeetingPopulationService(portRef.current);
      const target = await service.openTarget(meetingRef);
      const boundary = readActiveMeetingClientBoundary();
      if (
        !boundary ||
        target.client.matterId !== boundary.matterId ||
        target.client.householdRef !== boundary.householdRef
      ) {
        setNavigationNotice('open-failed');
        return;
      }
      setDetailTarget(target);
      setTemplateTarget(target);
      setNavigationNotice(null);
    } catch {
      setDetailTarget(null);
      setNavigationNotice('open-failed');
    }
  }, []);

  useEffect(() => {
    return registerMeetingsNavigationHost((notice: MeetingsNavigationNotice) => {
      if (notice.kind === 'open') {
        void openSelectedMeeting(notice.meetingRef).catch(() => {
          setNavigationNotice('open-failed');
        });
        return;
      }
      setDetailTarget(null);
      setNavigationNotice(notice.kind);
    });
  }, [openSelectedMeeting]);

  useEffect(() => {
    let current = true;
    queueMicrotask(() => {
      if (!current) return;
      if (detailTarget && !safeDetailTarget) setDetailTarget(null);
      if (templateTarget && !safeTemplateTarget) setTemplateTarget(null);
    });
    return () => { current = false; };
  }, [detailTarget, safeDetailTarget, safeTemplateTarget, templateTarget]);

  const openMeeting = useCallback(
    async (meetingRef: string) => {
      try {
        await resolveMeetingsSurfaceNavigation(meetingRef, runtime);
      } catch {
        setNavigationNotice('open-failed');
      }
    },
    [runtime]
  );
  const listContext: MeetingListContext = {
    client: activeClientBoundary,
    meetings: scopedMeetings,
    reviewResult,
    reviewFilter,
    currentMemberId,
    now,
    openMeeting,
    setReviewFilter,
    retryReview: () => { setReviewRetry((value) => value + 1); },
  };
  const listDescriptors = useMeetingListComposition(listContext);
  const toolContext: MeetingListToolContext = {
    currentMemberId,
    ownerFilter,
    setOwnerFilter,
  };
  const toolDescriptors = useMeetingListToolComposition(toolContext);
  const primaryViews = listDescriptors.filter((descriptor) => descriptor.kind === 'primary');
  const manageViews = listDescriptors.filter((descriptor) => descriptor.kind === 'manage');
  const selectedDescriptor = listDescriptors.find((descriptor) => descriptor.id === view);
  const currentMatter = selection.matterId
    ? matters.find((matter) => matter.id === selection.matterId) ?? null
    : null;
  const newMeetingFolder = (() => {
    if (!currentMatter) return null;
    try {
      return resolveMatterFolder(currentMatter.id);
    } catch {
      return null;
    }
  })();

  if (safeDetailTarget) {
    return (
      <MeetingsDetailHost
        target={safeDetailTarget}
        runtime={runtime}
        onBack={() => { setDetailTarget(null); }}
      />
    );
  }

  return (
    <section className="meetings-shell" data-testid="meetings-shell-v2">
      <aside className="meetings-shell-subnav" aria-label={t('meetings.shell.navigation')}>
        <h1>{t('meetings.shell.title')}</h1>
        <button
          type="button"
          className="kp-btn kp-btn--primary kp-btn--sm meetings-shell-new"
          data-testid="meetings-new-meeting"
          disabled={!newMeetingFolder || !runtime.workspace.serviceRef.current}
          title={!newMeetingFolder ? t('meetings.shell.new-meeting.choose-client') : undefined}
          onClick={() => { setView('new-meeting'); }}
        >
          <Plus aria-hidden="true" />
          {t('meetings.shell.actions.new-meeting')}
        </button>
        <nav>
          {primaryViews.map((descriptor) => (
            <button
              type="button"
              key={descriptor.id}
              className={view === descriptor.id ? 'is-active' : ''}
              data-testid={`meetings-view-${descriptor.id}`}
              onClick={() => { setView(descriptor.id); }}
            >
              <span>{t(descriptor.labelKey)}</span>
              {descriptor.id === 'actions' && reviewMeetingCount > 0 ? (
                <span className="meetings-shell-count" data-testid="meetings-actions-badge">
                  {reviewMeetingCount}
                </span>
              ) : null}
            </button>
          ))}
          <div className="meetings-shell-group-label">
            {t('meetings.shell.manage.label')}
          </div>
          {manageViews.map((descriptor) => (
            <button
              type="button"
              key={descriptor.id}
              className={view === descriptor.id ? 'is-active' : ''}
              data-testid={`meetings-view-${descriptor.id}`}
              onClick={() => { setView(descriptor.id); }}
            >
              <span>{t(descriptor.labelKey)}</span>
            </button>
          ))}
        </nav>
      </aside>
      <main className="meetings-shell-main">
        <header className="meetings-shell-header">
          <div>
            <h2>
              {view === 'calendar'
                ? t('meetings.shell.views.calendar')
                : view === 'new-meeting'
                  ? t('meetings.shell.actions.new-meeting')
                  : selectedDescriptor
                    ? t(selectedDescriptor.labelKey)
                    : t('meetings.shell.title')}
            </h2>
            <p>
              {activeClientBoundary
                ? t('meetings.shell.scope.client', { client: activeClientBoundary.displayName ?? activeClientBoundary.householdRef })
                : t('meetings.shell.scope.firm')}
            </p>
          </div>
          <div className="meetings-shell-header-actions">
            {view === 'calendar' ? (
              <button
                type="button"
                className="kp-btn kp-btn--secondary kp-btn--sm"
                data-testid="meetings-calendar-back"
                onClick={() => { setView('upcoming'); }}
              >
                <ChevronLeft aria-hidden="true" />
                {t('meetings.shell.views.upcoming')}
              </button>
            ) : view === 'upcoming' && calendarEnabled ? (
              <button
                type="button"
                className="kp-btn kp-btn--secondary kp-btn--sm"
                data-testid="meetings-open-calendar"
                onClick={() => { setView('calendar'); }}
              >
                <CalendarDays aria-hidden="true" />
                {t('meetings.shell.views.calendar')}
              </button>
            ) : null}
            {(view === 'upcoming' || view === 'calendar') ? (
              <button
                type="button"
                className="kp-btn kp-btn--primary kp-btn--sm"
                data-testid="meetings-header-new-meeting"
                disabled={!newMeetingFolder || !runtime.workspace.serviceRef.current}
                title={!newMeetingFolder ? t('meetings.shell.new-meeting.choose-client') : undefined}
                onClick={() => { setView('new-meeting'); }}
              >
                <Plus aria-hidden="true" />
                {t('meetings.shell.actions.new-meeting')}
              </button>
            ) : null}
          </div>
        </header>

        {selection.blocked ? (
          <div className="meetings-shell-error" role="alert" data-testid="meetings-selection-blocked">
            {t('meetings.shell.errors.selection-blocked')}
          </div>
        ) : null}
        {navigationNotice ? (
          <div className="meetings-shell-notice" role="status" data-testid={`meetings-navigation-${navigationNotice}`}>
            {t({
              'folder-only': 'meetings.shell.navigation-result.folder-only',
              refused: 'meetings.shell.navigation-result.refused',
              'open-failed': 'meetings.shell.navigation-result.open-failed',
            }[navigationNotice])}
          </div>
        ) : null}
        {!selection.blocked && loadError ? (
          <div className="meetings-shell-error" role="alert" data-testid="meetings-load-error">
            <span>{t('meetings.shell.errors.load')}</span>
            <button
              type="button"
              className="kp-btn kp-btn--secondary kp-btn--sm"
              data-testid="meetings-retry"
              onClick={() => {
                void live.reload().catch(() => {
                  setDirectoryState({
                    key: directoryKey,
                    status: 'error',
                    records: [],
                  });
                });
              }}
            >
              {t('meetings.shell.actions.retry')}
            </button>
          </div>
        ) : null}
        {!selection.blocked && loading ? (
          <div className="meetings-shell-local-state" data-testid="meetings-loading">
            {t('meetings.shell.loading.meetings')}
          </div>
        ) : null}

        {!selection.blocked && !loading && !loadError && view === 'calendar' ? (
          <CalendarGridSurface
            {...(runtime.workspace.openSelector
              ? { onOpenWorkspace: runtime.workspace.openSelector }
              : {})}
          />
        ) : null}

        {!selection.blocked && !loading && !loadError && view === 'new-meeting' ? (
          currentMatter && newMeetingFolder && activeClientBoundary ? (
            <div className="meetings-shell-client-recorder" data-testid="meetings-new-meeting-host">
              <ClientMeetingsTab
                clientBoundary={activeClientBoundary}
                getActiveClientBoundary={readActiveMeetingClientBoundary}
                matterFolder={newMeetingFolder}
                workspaceService={runtime.workspace.serviceRef.current}
              />
            </div>
          ) : (
            <div className="meetings-shell-empty" data-testid="meetings-new-meeting-needs-client">
              <Mic aria-hidden="true" />
              {t('meetings.shell.new-meeting.choose-client')}
            </div>
          )
        ) : null}

        {!selection.blocked && !loading && !loadError && selectedDescriptor ? (
          <>
            {selectedDescriptor.kind === 'primary' ? (
              <div className="meetings-shell-toolbar" data-testid="meeting-list-tool-host">
                {toolDescriptors.map((descriptor) => (
                  <span key={descriptor.id} data-meeting-list-tool={descriptor.id}>
                    {descriptor.render(toolContext)}
                  </span>
                ))}
              </div>
            ) : null}
            <div data-testid="meeting-list-view-host" data-meeting-list-view={selectedDescriptor.id}>
              {selectedDescriptor.id === 'templates' ? (
                <TemplateManagement
                  key={safeTemplateTarget?.meeting.id ?? 'no-template-target'}
                  target={safeTemplateTarget}
                  activeClientBoundary={activeClientBoundary}
                  runtime={runtime}
                />
              ) : selectedDescriptor.id === 'automations' ? (
                <AutomationsManagement />
              ) : (
                selectedDescriptor.render(listContext)
              )}
            </div>
          </>
        ) : null}
      </main>
    </section>
  );
}
