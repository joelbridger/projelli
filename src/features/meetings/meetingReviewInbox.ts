import {
  EXACT_MEETING_REVIEW_SCHEMA_VERSION,
  type ExactMeetingCrmProposalPayload,
  type ExactMeetingTaskProposalPayload,
} from '@/platform/meetingNotesReview/notesReviewDelivery';
import type { NotesReviewCrmFieldChange } from '@/ui/notesReview';
import {
  MEETING_FOLLOW_UP_SCHEMA_VERSION,
  type MeetingFollowUpRecap,
} from './followUp/meetingFollowUpStore';
import {
  projectMeetingSurface,
  type ClientBoundary,
  type FirmMeetingDirectoryReader,
  type MeetingArtifactReviewArchiveScope,
  type MeetingArtifactReviewArchiveTransition,
  type MeetingArtifactReviewArchiveTransitionResult,
  type MeetingArtifactRequirement,
  type MeetingOwnerProjection,
  type MeetingProjection,
  type MeetingSurfaceFacts,
  type ReviewNeededMeetingArtifact,
  type ReviewNeededMeetingArtifactReader,
  type SealedMeetingClientBoundary,
} from './foundation/contract';

export const MEETING_REVIEW_INBOX_REQUIREMENTS = Object.freeze([
  {
    kind: 'action-update-proposal',
    minimumSchemaVersion: EXACT_MEETING_REVIEW_SCHEMA_VERSION,
  },
  {
    kind: 'follow-up-draft',
    minimumSchemaVersion: MEETING_FOLLOW_UP_SCHEMA_VERSION,
  },
  { kind: 'diarization', minimumSchemaVersion: 1 },
] as const satisfies readonly MeetingArtifactRequirement[]);

export type MeetingReviewInboxItemKind =
  | 'task-proposal'
  | 'crm-update-proposal'
  | 'follow-up-draft'
  | 'speaker-confirmation'
  | 'unmatched-attendee';

export type MeetingReviewInboxView = 'need-attention' | 'all' | 'archived';

export interface MeetingReviewInboxFilter {
  readonly view: MeetingReviewInboxView;
  readonly type: MeetingReviewInboxItemKind | 'all';
  readonly owner:
    | { readonly kind: 'all' }
    | { readonly kind: 'owner'; readonly ownerRef: string }
    | { readonly kind: 'unassigned' };
}

export const DEFAULT_MEETING_REVIEW_INBOX_FILTER: MeetingReviewInboxFilter =
  Object.freeze({
    view: 'need-attention',
    type: 'all',
    owner: Object.freeze({ kind: 'all' }),
  });

export interface MeetingReviewInboxOwner {
  readonly ref: string | null;
  readonly label?: string;
  readonly source: 'proposal' | 'meeting';
}

interface MeetingReviewInboxItemBase {
  readonly id: string;
  readonly artifactId: string;
  readonly meetingId: string;
  readonly client: ClientBoundary;
  readonly meetingLabel: string;
  readonly clientLabel: string;
  readonly owner: MeetingReviewInboxOwner;
  readonly reviewState: 'needs-review';
  readonly archiveState: 'active' | 'archived';
  /** An explicit producer fact, never inferred wording or priority. */
  readonly urgency: 'urgent' | 'not-marked-urgent';
  readonly producedAt: string;
}

export interface MeetingReviewTaskItem extends MeetingReviewInboxItemBase {
  readonly kind: 'task-proposal';
  readonly proposal: ExactMeetingTaskProposalPayload;
}

export interface MeetingReviewCrmUpdateItem extends MeetingReviewInboxItemBase {
  readonly kind: 'crm-update-proposal';
  readonly proposal: ExactMeetingCrmProposalPayload;
}

export interface MeetingReviewFollowUpDraftItem extends MeetingReviewInboxItemBase {
  readonly kind: 'follow-up-draft';
  readonly draft: Pick<
    MeetingFollowUpRecap,
    'to' | 'subject' | 'body' | 'state'
  >;
}

export interface MeetingReviewSpeakerItem extends MeetingReviewInboxItemBase {
  readonly kind: 'speaker-confirmation' | 'unmatched-attendee';
  /** Producer-supplied factual label; the inbox does not invent grouping copy. */
  readonly reviewLabel: string;
}

export type MeetingReviewInboxItem =
  | MeetingReviewTaskItem
  | MeetingReviewCrmUpdateItem
  | MeetingReviewFollowUpDraftItem
  | MeetingReviewSpeakerItem;

export type MeetingReviewInboxResult =
  | {
      readonly kind: 'loading';
      readonly retry: 'not-available';
    }
  | {
      readonly kind: 'refused';
      readonly reason:
        | 'authority-refused'
        | 'selection-blocked'
        | 'invalid-client-pair';
      readonly message: string;
      readonly retry: 'not-available';
    }
  | {
      readonly kind: 'error';
      readonly message: string;
      readonly retry: 'available';
    }
  | {
      readonly kind: 'ready-empty';
      readonly items: readonly [];
      readonly badgeMeetingCount: number;
      readonly emptyCopy: string;
      readonly filter: MeetingReviewInboxFilter;
      readonly retry: 'not-available';
    }
  | {
      readonly kind: 'ready-populated';
      readonly items: readonly MeetingReviewInboxItem[];
      readonly badgeMeetingCount: number;
      readonly filter: MeetingReviewInboxFilter;
      readonly retry: 'not-available';
    };

export const MEETING_REVIEW_INBOX_LOADING: MeetingReviewInboxResult =
  Object.freeze({ kind: 'loading', retry: 'not-available' });

const sealedMeetingReviewInboxReadyResults = new WeakSet();

/** A ready result is trusted only when this module projected and sealed it. */
export function verifyMeetingReviewInboxReadyResult(
  result: MeetingReviewInboxResult
): boolean {
  return (
    (result.kind === 'ready-empty' || result.kind === 'ready-populated') &&
    sealedMeetingReviewInboxReadyResults.has(result)
  );
}

export interface MeetingReviewInboxReader {
  /** Authorized whole-firm projection. The firm grant was consumed by G2. */
  read(filter?: MeetingReviewInboxFilter): Promise<MeetingReviewInboxResult>;
  /** Selected-client projection. The complete sealed pair is mandatory. */
  readForClient(
    client: SealedMeetingClientBoundary,
    filter?: MeetingReviewInboxFilter
  ): Promise<MeetingReviewInboxResult>;
  transitionArchive(
    id: string,
    scope: MeetingArtifactReviewArchiveScope,
    transition: MeetingArtifactReviewArchiveTransition
  ): Promise<MeetingArtifactReviewArchiveTransitionResult>;
}

export interface MeetingReviewInboxSource {
  readonly directory: FirmMeetingDirectoryReader;
  readonly reviews: ReviewNeededMeetingArtifactReader;
  /** Fresh label/status facts are read again on every retry. */
  readonly getMeetingFacts: () => readonly MeetingSurfaceFacts[];
  readonly getOwners?: () => readonly MeetingOwnerProjection[];
  readonly now?: () => string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function requiredText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function optionalText(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function nullableText(value: unknown): string | null | undefined {
  return value === null ? null : (optionalText(value) ?? undefined);
}

function nullableDate(value: unknown): string | null | undefined {
  if (value === null) return null;
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value))
    return undefined;
  return value;
}

function crmValueMatchesType(
  value: unknown,
  type: NotesReviewCrmFieldChange['valueType']
): boolean {
  if (value === null) return true;
  if (type === 'number')
    return typeof value === 'number' && Number.isFinite(value);
  if (type === 'boolean') return typeof value === 'boolean';
  return typeof value === 'string';
}

function crmField(value: unknown): NotesReviewCrmFieldChange | null {
  const candidate = record(value);
  if (!candidate || !Object.prototype.hasOwnProperty.call(candidate, 'before'))
    return null;
  const field = requiredText(candidate['field']);
  const label = requiredText(candidate['label']);
  const valueType = candidate['valueType'];
  if (
    !field ||
    !label ||
    (valueType !== 'text' &&
      valueType !== 'number' &&
      valueType !== 'date' &&
      valueType !== 'boolean') ||
    !crmValueMatchesType(candidate['before'], valueType) ||
    !crmValueMatchesType(candidate['proposed'], valueType)
  )
    return null;
  return {
    field,
    label,
    valueType,
    before: candidate['before'] as NotesReviewCrmFieldChange['before'],
    proposed: candidate['proposed'] as NotesReviewCrmFieldChange['proposed'],
  };
}

function actionProposal(
  artifact: ReviewNeededMeetingArtifact
): ExactMeetingTaskProposalPayload | ExactMeetingCrmProposalPayload | null {
  const candidate = record(artifact.payload['proposal']);
  if (!candidate) return null;
  const id = requiredText(candidate['id']);
  const title = requiredText(candidate['title']);
  const detail = requiredText(candidate['detail']);
  const transcriptRef = requiredText(candidate['transcriptRef']);
  const sourceLabel = optionalText(candidate['sourceLabel']);
  if (!id || !title || !detail || !transcriptRef) return null;
  const common = {
    id,
    title,
    detail,
    transcriptRef,
    ...(sourceLabel ? { sourceLabel } : {}),
  };
  if (candidate['kind'] === 'task') {
    const ownerRef = nullableText(candidate['ownerRef']);
    const dueDate = nullableDate(candidate['dueDate']);
    if (ownerRef === undefined || dueDate === undefined) return null;
    return { ...common, kind: 'task', ownerRef, dueDate };
  }
  if (candidate['kind'] === 'crm-update') {
    const entityRef = requiredText(candidate['entityRef']);
    const fields = Array.isArray(candidate['fields'])
      ? candidate['fields'].map(crmField)
      : [];
    if (!entityRef || fields.length === 0 || fields.some((field) => !field))
      return null;
    return {
      ...common,
      kind: 'crm-update',
      entityRef,
      fields: fields as NotesReviewCrmFieldChange[],
    };
  }
  return null;
}

function ownerFor(
  meeting: MeetingProjection,
  proposalOwner: string | null | undefined,
  owners: ReadonlyMap<string, string>
): MeetingReviewInboxOwner {
  const fromProposal = proposalOwner !== undefined;
  const ref = fromProposal ? proposalOwner : meeting.ownerRef;
  const label = ref ? owners.get(ref) : undefined;
  return {
    ref,
    ...(label ? { label } : {}),
    source: fromProposal ? 'proposal' : 'meeting',
  };
}

function commonItem(
  artifact: ReviewNeededMeetingArtifact,
  row: Extract<
    ReturnType<typeof projectMeetingSurface>,
    { kind: 'ready' }
  >['upcoming'][number],
  owner: MeetingReviewInboxOwner
): MeetingReviewInboxItemBase {
  return {
    id: artifact.id,
    artifactId: artifact.id,
    meetingId: artifact.meetingId,
    client: row.clientLink,
    meetingLabel: row.title,
    clientLabel: row.clientLink.displayName ?? row.clientLink.householdRef,
    owner,
    reviewState: 'needs-review',
    archiveState: artifact.reviewArchiveState,
    urgency:
      artifact.payload['urgent'] === true ? 'urgent' : 'not-marked-urgent',
    producedAt: artifact.producedAt,
  };
}

function reviewItem(
  artifact: ReviewNeededMeetingArtifact,
  meeting: MeetingProjection,
  row: Extract<
    ReturnType<typeof projectMeetingSurface>,
    { kind: 'ready' }
  >['upcoming'][number],
  owners: ReadonlyMap<string, string>
): MeetingReviewInboxItem | null {
  if (artifact.kind === 'action-update-proposal') {
    const proposal = actionProposal(artifact);
    if (!proposal) return null;
    const owner = ownerFor(
      meeting,
      proposal.kind === 'task' ? proposal.ownerRef : undefined,
      owners
    );
    const common = commonItem(artifact, row, owner);
    return proposal.kind === 'task'
      ? { ...common, kind: 'task-proposal', proposal }
      : { ...common, kind: 'crm-update-proposal', proposal };
  }
  if (artifact.kind === 'follow-up-draft') {
    const to = artifact.payload['to'];
    const subject = artifact.payload['subject'];
    const body = artifact.payload['body'];
    const recapKey = requiredText(artifact.payload['recapKey']);
    if (
      typeof to !== 'string' ||
      typeof subject !== 'string' ||
      typeof body !== 'string' ||
      !recapKey ||
      artifact.payload['deliveryState'] !== 'edited'
    )
      return null;
    return {
      ...commonItem(artifact, row, ownerFor(meeting, undefined, owners)),
      kind: 'follow-up-draft',
      draft: { to, subject, body, state: 'edited' },
    };
  }
  if (artifact.kind === 'diarization') {
    const kind = artifact.payload['reviewKind'];
    const reviewLabel = requiredText(artifact.payload['reviewLabel']);
    if (
      artifact.payload['reviewRequired'] !== true ||
      (kind !== 'speaker-confirmation' && kind !== 'unmatched-attendee') ||
      !reviewLabel
    )
      return null;
    const payloadOwner =
      optionalText(artifact.payload['ownerRef']) ?? undefined;
    return {
      ...commonItem(artifact, row, ownerFor(meeting, payloadOwner, owners)),
      kind,
      reviewLabel,
    };
  }
  return null;
}

function filterAndSort(
  items: readonly MeetingReviewInboxItem[],
  filter: MeetingReviewInboxFilter
): readonly MeetingReviewInboxItem[] {
  return items
    .filter((item) => {
      if (filter.view === 'need-attention' && item.archiveState !== 'active')
        return false;
      if (filter.view === 'archived' && item.archiveState !== 'archived')
        return false;
      return (
        (filter.type === 'all' || item.kind === filter.type) &&
        (filter.owner.kind === 'all' ||
          (filter.owner.kind === 'unassigned'
            ? item.owner.ref === null
            : item.owner.ref === filter.owner.ownerRef))
      );
    })
    .sort(
      (left, right) =>
        Number(right.urgency === 'urgent') -
          Number(left.urgency === 'urgent') ||
        right.producedAt.localeCompare(left.producedAt) ||
        right.id.localeCompare(left.id)
    );
}

function validFilter(
  filter: MeetingReviewInboxFilter | undefined
): MeetingReviewInboxFilter {
  if (!filter) return DEFAULT_MEETING_REVIEW_INBOX_FILTER;
  const kinds: readonly (MeetingReviewInboxItemKind | 'all')[] = [
    'all',
    'task-proposal',
    'crm-update-proposal',
    'follow-up-draft',
    'speaker-confirmation',
    'unmatched-attendee',
  ];
  if (
    !['need-attention', 'all', 'archived'].includes(filter.view) ||
    !kinds.includes(filter.type) ||
    (filter.owner.kind === 'owner' && !filter.owner.ownerRef.trim())
  )
    return DEFAULT_MEETING_REVIEW_INBOX_FILTER;
  return Object.freeze({ ...filter });
}

function deepFreeze<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value))
      deepFreeze((value as Record<string, unknown>)[key]);
  }
  return value;
}

function sealReadyResult<T extends object>(value: T): T {
  const sealed = deepFreeze(value);
  sealedMeetingReviewInboxReadyResults.add(sealed);
  return sealed;
}

/**
 * Builds the only Actions projection. It consumes G2's authorized result and
 * the sealed firm directory; selected mode then applies the exact client pair
 * before filters, badge derivation, archive visibility, or empty copy.
 */
export function createMeetingReviewInboxReader(
  source: MeetingReviewInboxSource
): MeetingReviewInboxReader {
  const now = source.now ?? (() => new Date().toISOString());

  const read = async (
    client: SealedMeetingClientBoundary | null,
    requestedFilter?: MeetingReviewInboxFilter
  ): Promise<MeetingReviewInboxResult> => {
    const filter = validFilter(requestedFilter);
    try {
      const [directory, reviews] = await Promise.all([
        source.directory.list(),
        source.reviews.list(),
      ]);
      if (directory.kind === 'error')
        return {
          kind: 'error',
          message: 'Meeting review records could not be loaded.',
          retry: 'available',
        };
      if (directory.kind === 'refused')
        return {
          kind: 'refused',
          reason: directory.reason,
          message: directory.message,
          retry: 'not-available',
        };
      if (directory.kind === 'loading') return MEETING_REVIEW_INBOX_LOADING;
      if (reviews.kind === 'refused') {
        if (reviews.reason === 'records-unavailable')
          return {
            kind: 'error',
            message: 'Meeting review records could not be loaded.',
            retry: 'available',
          };
        return {
          kind: 'refused',
          reason: reviews.reason,
          message: reviews.message,
          retry: 'not-available',
        };
      }
      const surface = projectMeetingSurface(
        { kind: 'whole-firm', directory },
        source.getMeetingFacts(),
        now()
      );
      if (surface.kind === 'refused')
        return {
          kind: 'refused',
          reason: 'authority-refused',
          message: surface.message,
          retry: 'not-available',
        };
      if (surface.kind !== 'ready')
        return {
          kind: 'error',
          message: 'Meeting review labels could not be loaded.',
          retry: 'available',
        };
      const rows = [...surface.upcoming, ...surface.past];
      const owners = new Map(
        (source.getOwners?.() ?? []).map((owner) => [owner.id, owner.label])
      );
      const allItems = reviews.artifacts.flatMap((artifact) => {
        if (
          client &&
          (artifact.householdRef !== client.householdRef ||
            artifact.matterId !== client.matterId)
        )
          return [];
        const meetings = directory.meetings.filter(
          (meeting) =>
            meeting.id === artifact.meetingId &&
            meeting.householdRef === artifact.householdRef &&
            meeting.matterId === artifact.matterId
        );
        const matchingRows = rows.filter(
          (row) =>
            row.id === artifact.meetingId &&
            row.clientLink.householdRef === artifact.householdRef &&
            row.clientLink.matterId === artifact.matterId
        );
        const meeting = meetings.length === 1 ? meetings[0] : undefined;
        const row = matchingRows.length === 1 ? matchingRows[0] : undefined;
        if (!meeting || !row) return [];
        const item = reviewItem(artifact, meeting, row, owners);
        return item ? [item] : [];
      });
      const badgeMeetingCount = new Set(
        allItems
          .filter((item) => item.archiveState === 'active')
          .map((item) => item.meetingId)
      ).size;
      const items = filterAndSort(allItems, filter);
      if (items.length === 0) {
        const selectedName =
          client?.displayName?.trim() || client?.householdRef || null;
        return sealReadyResult({
          kind: 'ready-empty',
          items: [] as const,
          badgeMeetingCount,
          emptyCopy: selectedName
            ? `Nothing waiting on you for ${selectedName}. This view is filtered to ${selectedName}.`
            : 'Nothing waiting on you.',
          filter,
          retry: 'not-available',
        });
      }
      return sealReadyResult({
        kind: 'ready-populated',
        items,
        badgeMeetingCount,
        filter,
        retry: 'not-available',
      });
    } catch {
      return {
        kind: 'error',
        message: 'Meeting review records could not be loaded.',
        retry: 'available',
      };
    }
  };

  return {
    read: (filter) => read(null, filter),
    readForClient: (client, filter) => {
      if (
        // eslint-disable-next-line @typescript-eslint/no-unnecessary-condition -- runtime cast/bridge guard: the type says `client` is a non-null sealed pair, but a caller can cast undefined/partial past the type at runtime (the F9 fail-open class). Fail closed here rather than leak the whole-firm inbox.
        !client ||
        typeof client.householdRef !== 'string' ||
        client.householdRef.trim().length === 0 ||
        typeof client.matterId !== 'string' ||
        client.matterId.trim().length === 0
      )
        return Promise.resolve({
          kind: 'refused',
          reason: 'invalid-client-pair',
          message: 'A complete client selection is required.',
          retry: 'not-available',
        });
      return read(client, filter);
    },
    transitionArchive: (id, scope, transition) =>
      source.reviews.transitionArchive(id, scope, transition),
  };
}
