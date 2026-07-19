/* eslint-disable react-refresh/only-export-components -- public registries intentionally pair contracts with small base renderers. */
import {
  useSyncExternalStore,
  type ReactNode,
} from 'react';
import { useTranslation } from 'react-i18next';
import {
  DEFAULT_MEETING_REVIEW_INBOX_FILTER,
  MEETING_REVIEW_INBOX_LOADING,
  type MeetingReviewInboxFilter,
  type MeetingReviewInboxItemKind,
  type MeetingReviewInboxResult,
  type MeetingReviewInboxView,
} from '../meetingReviewInbox';
import type {
  ClientBoundary,
  MeetingArtifact,
  MeetingArtifactInput,
  MeetingArtifactReader,
  MeetingProjection,
  MeetingRef,
  NoticeEvidenceInput,
} from '../foundation/contract';

interface BaseDescriptor<Context> {
  readonly id: string;
  readonly order: number;
  readonly labelKey: string;
  readonly isAvailable?: (context: Context) => boolean;
}

interface LiveRegistry<Descriptor extends BaseDescriptor<Context>, Context> {
  readonly base: readonly Descriptor[];
  registered: Descriptor[];
  readonly listeners: Set<() => void>;
  version: number;
  readonly name: string;
}

function validateDescriptor<Context>(
  registry: string,
  descriptor: BaseDescriptor<Context>,
  ids: Set<string>
): void {
  if (!descriptor.id.trim() || ids.has(descriptor.id)) {
    throw new Error(`[${registry}] duplicate or missing id: ${descriptor.id}`);
  }
  if (!Number.isFinite(descriptor.order)) {
    throw new Error(`[${registry}] order must be finite: ${descriptor.id}`);
  }
  if (!descriptor.labelKey.includes('.')) {
    throw new Error(`[${registry}] labelKey must be namespaced: ${descriptor.id}`);
  }
  ids.add(descriptor.id);
}

function createLiveRegistry<
  Descriptor extends BaseDescriptor<Context>,
  Context,
>(name: string, base: readonly Descriptor[]): LiveRegistry<Descriptor, Context> {
  return { name, base, registered: [], listeners: new Set(), version: 0 };
}

function compose<Descriptor extends BaseDescriptor<Context>, Context>(
  registry: LiveRegistry<Descriptor, Context>,
  context: Context
): readonly Descriptor[] {
  const descriptors = [...registry.base, ...registry.registered];
  const ids = new Set<string>();
  descriptors.forEach((descriptor) => {
    validateDescriptor(registry.name, descriptor, ids);
    if (typeof (descriptor as { render?: unknown }).render !== 'function') {
      throw new Error(`[${registry.name}] render is required: ${descriptor.id}`);
    }
  });
  return descriptors
    .filter((descriptor) => descriptor.isAvailable?.(context) ?? true)
    .sort((left, right) => left.order - right.order);
}

function register<Descriptor extends BaseDescriptor<Context>, Context>(
  registry: LiveRegistry<Descriptor, Context>,
  descriptor: Descriptor,
  validationContext: Context
): () => void {
  const previous = registry.registered;
  registry.registered = [...previous, descriptor];
  try {
    compose(registry, validationContext);
  } catch (error) {
    registry.registered = previous;
    throw error;
  }
  registry.version += 1;
  registry.listeners.forEach((listener) => { listener(); });
  let active = true;
  return () => {
    if (!active) return;
    active = false;
    registry.registered = registry.registered.filter(
      (candidate) => candidate !== descriptor
    );
    registry.version += 1;
    registry.listeners.forEach((listener) => { listener(); });
  };
}

function subscribe<Descriptor extends BaseDescriptor<Context>, Context>(
  registry: LiveRegistry<Descriptor, Context>,
  listener: () => void
): () => void {
  registry.listeners.add(listener);
  return () => registry.listeners.delete(listener);
}

function useRegistryVersion<Descriptor extends BaseDescriptor<Context>, Context>(
  registry: LiveRegistry<Descriptor, Context>
): number {
  return useSyncExternalStore(
    (listener) => subscribe(registry, listener),
    () => registry.version,
    () => registry.version
  );
}

export interface MeetingListContext {
  readonly client: ClientBoundary | null;
  readonly meetings: readonly MeetingProjection[];
  readonly reviewResult: MeetingReviewInboxResult;
  readonly reviewFilter: MeetingReviewInboxFilter;
  readonly currentMemberId: string | null;
  readonly now: number;
  openMeeting: (ref: MeetingRef) => Promise<void>;
  setReviewFilter: (filter: MeetingReviewInboxFilter) => void;
  retryReview: () => void;
}

export interface MeetingListDescriptor
  extends BaseDescriptor<MeetingListContext> {
  readonly kind: 'primary' | 'manage';
  readonly render: (context: MeetingListContext) => ReactNode;
}

function meetingDate(value: string): string {
  return new Intl.DateTimeFormat(undefined, {
    dateStyle: 'medium',
    timeStyle: 'short',
  }).format(new Date(value));
}

function MeetingsRows({
  context,
  period,
}: {
  context: MeetingListContext;
  period: 'upcoming' | 'past';
}) {
  const { t } = useTranslation();
  const rows = context.meetings.filter((meeting) =>
    period === 'upcoming'
      ? Date.parse(meeting.scheduledEndUtc) >= context.now
      : Date.parse(meeting.scheduledEndUtc) < context.now
  );
  if (rows.length === 0) {
    return (
      <div className="meetings-shell-empty" data-testid={`meetings-${period}-empty`}>
        {t(
          period === 'upcoming'
            ? 'meetings.shell.empty.upcoming'
            : 'meetings.shell.empty.past'
        )}
      </div>
    );
  }
  return (
    <div className="meetings-shell-table-wrap" data-testid={`meetings-${period}-rows`}>
      <table className="meetings-shell-table">
        <thead>
          <tr>
            <th>{t('meetings.shell.columns.meeting')}</th>
            <th>{t('meetings.shell.columns.when')}</th>
            <th>{t('meetings.shell.columns.client')}</th>
            <th>{t('meetings.shell.columns.status')}</th>
            <th aria-label={t('meetings.shell.columns.open')} />
          </tr>
        </thead>
        <tbody>
          {rows.map((meeting) => {
            const linked = meeting.legacyLink !== undefined;
            return (
              <tr key={meeting.id} data-testid={`meetings-row-${meeting.id}`}>
                <td>
                  <strong>{meeting.typeId}</strong>
                  <small>{meeting.state}</small>
                </td>
                <td>{meetingDate(meeting.scheduledStartUtc)}</td>
                <td>{meeting.householdRef}</td>
                <td>
                  <span className={`meetings-shell-status ${linked ? 'is-linked' : ''}`}>
                    {t(
                      linked
                        ? 'meetings.shell.link.linked'
                        : 'meetings.shell.link.folder-only'
                    )}
                  </span>
                </td>
                <td>
                  {linked ? (
                    <button
                      type="button"
                      className="kp-btn kp-btn--secondary kp-btn--sm"
                      data-testid={`meetings-open-${meeting.id}`}
                      onClick={() => {
                        void context.openMeeting(meeting.id).catch((error: unknown) => {
                          console.error('[Meetings] Could not open meeting row.', error);
                        });
                      }}
                    >
                      {t('meetings.shell.actions.open')}
                    </button>
                  ) : null}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ActionsView({ context }: { context: MeetingListContext }) {
  const { t } = useTranslation();
  const readyResult =
    context.reviewResult.kind === 'ready-empty' ||
    context.reviewResult.kind === 'ready-populated'
      ? context.reviewResult
      : null;
  const filter = readyResult?.filter ?? context.reviewFilter;
  const setView = (view: MeetingReviewInboxView) => {
    context.setReviewFilter({ ...filter, view });
  };
  const setType = (type: MeetingReviewInboxItemKind | 'all') => {
    context.setReviewFilter({ ...filter, type });
  };
  const setOwner = (value: 'all' | 'mine' | 'unassigned') => {
    context.setReviewFilter({
      ...filter,
      owner:
        value === 'unassigned'
          ? { kind: 'unassigned' }
          : value === 'mine' && context.currentMemberId
            ? { kind: 'owner', ownerRef: context.currentMemberId }
            : { kind: 'all' },
    });
  };
  const ownerValue =
    filter.owner.kind === 'unassigned'
      ? 'unassigned'
      : filter.owner.kind === 'owner' &&
          filter.owner.ownerRef === context.currentMemberId
        ? 'mine'
        : 'all';
  const filters = (
    <div className="meetings-shell-toolbar" data-testid="meetings-actions-filters">
      <label>
        <span>{t('meetings.shell.filters.view')}</span>
        <select
          data-testid="meetings-actions-view-filter"
          value={filter.view}
          onChange={(event) => { setView(event.target.value as MeetingReviewInboxView); }}
        >
          <option value="need-attention">{t('meetings.shell.filters.need-attention')}</option>
          <option value="all">{t('meetings.shell.filters.all')}</option>
          <option value="archived">{t('meetings.shell.filters.archived')}</option>
        </select>
      </label>
      <label>
        <span>{t('meetings.shell.filters.type')}</span>
        <select
          data-testid="meetings-actions-type-filter"
          value={filter.type}
          onChange={(event) => { setType(event.target.value as MeetingReviewInboxItemKind | 'all'); }}
        >
          <option value="all">{t('meetings.shell.filters.all-types')}</option>
          <option value="task-proposal">{t('meetings.shell.filters.tasks')}</option>
          <option value="crm-update-proposal">{t('meetings.shell.filters.crm-updates')}</option>
          <option value="follow-up-draft">{t('meetings.shell.filters.follow-ups')}</option>
          <option value="speaker-confirmation">{t('meetings.shell.filters.speaker-confirmations')}</option>
          <option value="unmatched-attendee">{t('meetings.shell.filters.unmatched-attendees')}</option>
        </select>
      </label>
      <label>
        <span>{t('meetings.shell.filters.owner')}</span>
        <select
          data-testid="meetings-actions-owner-filter"
          value={ownerValue}
          onChange={(event) => { setOwner(event.target.value as 'all' | 'mine' | 'unassigned'); }}
        >
          <option value="all">{t('meetings.shell.filters.all-owners')}</option>
          {context.currentMemberId ? (
            <option value="mine">{t('meetings.shell.filters.mine')}</option>
          ) : null}
          <option value="unassigned">{t('meetings.shell.filters.unassigned')}</option>
        </select>
      </label>
    </div>
  );

  if (context.reviewResult.kind === 'loading') {
    return (
      <>
        {filters}
        <div className="meetings-shell-local-state" data-testid="meetings-actions-loading">
          {t('meetings.shell.loading.actions')}
        </div>
      </>
    );
  }
  if (
    context.reviewResult.kind === 'refused' ||
    context.reviewResult.kind === 'error'
  ) {
    return (
      <>
        {filters}
        <div className="meetings-shell-error" role="alert" data-testid="meetings-actions-error">
          <span>{context.reviewResult.message}</span>
          {context.reviewResult.retry === 'available' ? (
            <button
              type="button"
              className="kp-btn kp-btn--secondary kp-btn--sm"
              data-testid="meetings-actions-retry"
              onClick={context.retryReview}
            >
              {t('meetings.shell.actions.retry')}
            </button>
          ) : null}
        </div>
      </>
    );
  }
  if (context.reviewResult.kind === 'ready-empty') {
    return (
      <>
        {filters}
        <div className="meetings-shell-empty" data-testid="meetings-actions-empty">
          {context.reviewResult.emptyCopy}
        </div>
      </>
    );
  }
  const itemLabels: Record<MeetingReviewInboxItemKind, string> = {
    'task-proposal': 'meetings.shell.filters.tasks',
    'crm-update-proposal': 'meetings.shell.filters.crm-updates',
    'follow-up-draft': 'meetings.shell.artifact.follow-up-draft',
    'speaker-confirmation': 'meetings.shell.filters.speaker-confirmations',
    'unmatched-attendee': 'meetings.shell.filters.unmatched-attendees',
  };
  return (
    <>
      {filters}
      <div className="meetings-shell-table-wrap" data-testid="meetings-actions-rows">
        <table className="meetings-shell-table">
        <thead>
          <tr>
            <th>{t('meetings.shell.columns.action')}</th>
            <th>{t('meetings.shell.columns.meeting')}</th>
            <th>{t('meetings.shell.columns.client')}</th>
            <th>{t('meetings.shell.columns.status')}</th>
            <th aria-label={t('meetings.shell.columns.review')} />
          </tr>
        </thead>
        <tbody>
          {context.reviewResult.items.map((item) => (
            <tr key={item.id} data-testid={`meetings-action-${item.id}`}>
              <td><strong>{t(itemLabels[item.kind])}</strong></td>
              <td>{item.meetingLabel}</td>
              <td>{item.clientLabel}</td>
              <td><span className="meetings-shell-status is-review">{t('meetings.shell.status.needs-review')}</span></td>
              <td>
                <button
                  type="button"
                  className="kp-btn kp-btn--primary kp-btn--sm"
                  data-testid={`meetings-review-${item.id}`}
                  onClick={() => {
                    void context.openMeeting(item.meetingId).catch((error: unknown) => {
                      console.error('[Meetings] Could not open review item.', error);
                    });
                  }}
                >
                  {t('meetings.shell.actions.review')}
                </button>
              </td>
            </tr>
          ))}
        </tbody>
        </table>
      </div>
    </>
  );
}

const baseMeetingListDescriptors: readonly MeetingListDescriptor[] = [
  {
    id: 'upcoming',
    kind: 'primary',
    order: 10,
    labelKey: 'meetings.shell.views.upcoming',
    render: (context) => <MeetingsRows context={context} period="upcoming" />,
  },
  {
    id: 'past',
    kind: 'primary',
    order: 20,
    labelKey: 'meetings.shell.views.past',
    render: (context) => <MeetingsRows context={context} period="past" />,
  },
  {
    id: 'actions',
    kind: 'primary',
    order: 30,
    labelKey: 'meetings.shell.views.actions',
    render: (context) => <ActionsView context={context} />,
  },
  {
    id: 'templates',
    kind: 'manage',
    order: 40,
    labelKey: 'meetings.shell.views.templates',
    render: () => null,
  },
  {
    id: 'automations',
    kind: 'manage',
    order: 50,
    labelKey: 'meetings.shell.views.automations',
    render: () => null,
  },
];

const emptyListContext: MeetingListContext = {
  client: null,
  meetings: [],
  reviewResult: MEETING_REVIEW_INBOX_LOADING,
  reviewFilter: DEFAULT_MEETING_REVIEW_INBOX_FILTER,
  currentMemberId: null,
  now: 0,
  openMeeting: () => Promise.resolve(),
  setReviewFilter: () => undefined,
  retryReview: () => undefined,
};

const listStore = createLiveRegistry<MeetingListDescriptor, MeetingListContext>(
  'meetingListRegistry',
  baseMeetingListDescriptors
);

export const meetingListRegistry = baseMeetingListDescriptors;

export function registerMeetingListDescriptor(
  descriptor: MeetingListDescriptor
): () => void {
  return register(listStore, descriptor, emptyListContext);
}

export function subscribeMeetingListRegistry(listener: () => void): () => void {
  return subscribe(listStore, listener);
}

export function getMeetingListComposition(
  context: MeetingListContext = emptyListContext
): readonly MeetingListDescriptor[] {
  return compose(listStore, context);
}

export function useMeetingListComposition(
  context: MeetingListContext
): readonly MeetingListDescriptor[] {
  useRegistryVersion(listStore);
  return getMeetingListComposition(context);
}

export interface MeetingListToolContext {
  readonly currentMemberId: string | null;
  readonly ownerFilter: string | null;
  setOwnerFilter: (ownerId: string | null) => void;
}

export interface MeetingListToolDescriptor
  extends BaseDescriptor<MeetingListToolContext> {
  readonly render: (context: MeetingListToolContext) => ReactNode;
}

function MyMeetingsTool({ context }: { context: MeetingListToolContext }) {
  const { t } = useTranslation();
  return (
    <div className="meetings-shell-filter-group" role="group" aria-label={t('meetings.shell.tools.owner')}>
      <button
        type="button"
        className={context.ownerFilter === null ? 'is-active' : ''}
        data-testid="meetings-owner-all"
        onClick={() => { context.setOwnerFilter(null); }}
      >
        {t('meetings.shell.tools.all')}
      </button>
      <button
        type="button"
        className={context.ownerFilter !== null ? 'is-active' : ''}
        data-testid="meetings-owner-mine"
        disabled={!context.currentMemberId}
        onClick={() => {
          if (context.currentMemberId) context.setOwnerFilter(context.currentMemberId);
        }}
      >
        {t('meetings.shell.tools.mine')}
      </button>
    </div>
  );
}

const baseMeetingListTools: readonly MeetingListToolDescriptor[] = [
  {
    id: 'my-meetings',
    order: 10,
    labelKey: 'meetings.shell.tools.mine',
    render: (context) => <MyMeetingsTool context={context} />,
  },
];

const emptyToolContext: MeetingListToolContext = {
  currentMemberId: null,
  ownerFilter: null,
  setOwnerFilter: () => undefined,
};
const toolStore = createLiveRegistry<
  MeetingListToolDescriptor,
  MeetingListToolContext
>('meetingListToolRegistry', baseMeetingListTools);

export const meetingListToolRegistry = baseMeetingListTools;

export function registerMeetingListToolDescriptor(
  descriptor: MeetingListToolDescriptor
): () => void {
  return register(toolStore, descriptor, emptyToolContext);
}

export function subscribeMeetingListToolRegistry(
  listener: () => void
): () => void {
  return subscribe(toolStore, listener);
}

export function getMeetingListToolComposition(
  context: MeetingListToolContext = emptyToolContext
): readonly MeetingListToolDescriptor[] {
  return compose(toolStore, context);
}

export function useMeetingListToolComposition(
  context: MeetingListToolContext
): readonly MeetingListToolDescriptor[] {
  useRegistryVersion(toolStore);
  return getMeetingListToolComposition(context);
}

export interface MeetingArtifactContext {
  readonly meeting: MeetingProjection;
  readonly read: MeetingArtifactReader;
  append: (artifact: MeetingArtifactInput) => Promise<MeetingArtifact>;
}

export interface MeetingArtifactDescriptor
  extends BaseDescriptor<MeetingArtifactContext> {
  readonly render: (context: MeetingArtifactContext) => ReactNode;
}

const emptyArtifactContext = {} as MeetingArtifactContext;
const artifactStore = createLiveRegistry<
  MeetingArtifactDescriptor,
  MeetingArtifactContext
>('meetingArtifactRegistry', []);

export const meetingArtifactRegistry: readonly MeetingArtifactDescriptor[] = [];

export function registerMeetingArtifactDescriptor(
  descriptor: MeetingArtifactDescriptor
): () => void {
  return register(artifactStore, descriptor, emptyArtifactContext);
}

export function subscribeMeetingArtifactRegistry(
  listener: () => void
): () => void {
  return subscribe(artifactStore, listener);
}

export function getMeetingArtifactComposition(
  context: MeetingArtifactContext = emptyArtifactContext
): readonly MeetingArtifactDescriptor[] {
  return compose(artifactStore, context);
}

export function useMeetingArtifactRegistryVersion(): number {
  return useRegistryVersion(artifactStore);
}

export function hasMeetingArtifactContributions(): boolean {
  return artifactStore.registered.length > 0;
}

export interface NoticeEvidenceProviderContext {
  readonly meeting: MeetingProjection;
  appendNoticeEvidence: (input: NoticeEvidenceInput) => Promise<MeetingArtifact>;
}

export interface NoticeEvidenceProviderDescriptor
  extends BaseDescriptor<NoticeEvidenceProviderContext> {
  readonly render: (context: NoticeEvidenceProviderContext) => ReactNode;
}

const emptyNoticeContext = {} as NoticeEvidenceProviderContext;
const noticeStore = createLiveRegistry<
  NoticeEvidenceProviderDescriptor,
  NoticeEvidenceProviderContext
>('noticeEvidenceProviderRegistry', []);

export const noticeEvidenceProviderRegistry: readonly NoticeEvidenceProviderDescriptor[] = [];

export function registerNoticeEvidenceProviderDescriptor(
  descriptor: NoticeEvidenceProviderDescriptor
): () => void {
  return register(noticeStore, descriptor, emptyNoticeContext);
}

export function subscribeNoticeEvidenceProviderRegistry(
  listener: () => void
): () => void {
  return subscribe(noticeStore, listener);
}

export function getNoticeEvidenceProviderComposition(
  context: NoticeEvidenceProviderContext = emptyNoticeContext
): readonly NoticeEvidenceProviderDescriptor[] {
  return compose(noticeStore, context);
}

export function useNoticeEvidenceProviderRegistryVersion(): number {
  return useRegistryVersion(noticeStore);
}

export function hasNoticeEvidenceProviderContributions(): boolean {
  return noticeStore.registered.length > 0;
}
