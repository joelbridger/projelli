import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  loadLiveCrmRecords,
  type LiveCrmRecord,
} from '@/platform/crm/liveRecords';
import type { Matter } from '@/platform/types/matter';

export type MeetingRef = string;
export type MeetingArtifactRef = string;
export type NoticeEvidenceRef = string;
export type MeetingState =
  | 'draft'
  | 'scheduled'
  | 'in-progress'
  | 'completed'
  | 'cancelled';
export type MeetingArtifactKind =
  | 'agenda'
  | 'pre-meeting-brief'
  | 'structured-notes'
  | 'summary'
  | 'transcript'
  | 'diarization'
  | 'notice-evidence'
  | 'action-update-proposal'
  | 'follow-up-draft'
  | 'keyword-match'
  | 'talk-time-result'
  | 'client-signal';

const MEETING_ARTIFACT_KINDS: readonly MeetingArtifactKind[] = [
  'agenda',
  'pre-meeting-brief',
  'structured-notes',
  'summary',
  'transcript',
  'diarization',
  'notice-evidence',
  'action-update-proposal',
  'follow-up-draft',
  'keyword-match',
  'talk-time-result',
  'client-signal',
];

/** Deliberately small: a display name is never authorization. */
export interface ClientBoundary {
  readonly householdRef: string;
  readonly matterId: string;
  readonly displayName?: string;
}

/**
 * A durable, explicit bridge to a folder-created meeting.  `meetingDir` is
 * always a normalized path relative to the open workspace.  It is never an
 * identity or an authorization grant: the canonical matter and household are
 * still the only authority for every reader.
 */
export interface LegacyMeetingLink {
  readonly meetingDir: string;
  readonly linkedAt: string;
}

export interface LegacyMeetingLinkInput {
  readonly meetingDir: string;
}

export interface MeetingProjection {
  readonly id: MeetingRef;
  readonly workspaceId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly typeId: string;
  readonly ownerRef: string;
  readonly scheduledStartUtc: string;
  readonly scheduledEndUtc: string;
  readonly timezone: string;
  readonly state: MeetingState;
  readonly references: readonly string[];
  readonly visibilityPolicyId?: string;
  readonly legacyLink?: LegacyMeetingLink;
}

export interface MeetingRecord extends MeetingProjection {
  readonly kind: 'meeting';
  readonly createdAt: string;
  readonly updatedAt: string;
}

export interface CreateMeetingDraft {
  readonly workspaceId: string;
  readonly householdRef: string;
  readonly matterId: string;
  readonly typeId: string;
  readonly ownerRef: string;
  readonly scheduledStartUtc: string;
  readonly scheduledEndUtc: string;
  readonly timezone: string;
  readonly references?: readonly string[];
  readonly visibilityPolicyId?: string;
}

/** Patches intentionally cannot replace the stable context or artifact ledger. */
export interface MeetingPatch {
  readonly typeId?: string;
  readonly ownerRef?: string;
  readonly scheduledStartUtc?: string;
  readonly scheduledEndUtc?: string;
  readonly timezone?: string;
  readonly references?: readonly string[];
  readonly visibilityPolicyId?: string | null;
}

export interface MeetingLifecycleTransition {
  readonly from: MeetingState;
  readonly to: MeetingState;
  readonly at: string;
}

export interface MeetingStore {
  readonly list: readonly MeetingProjection[];
  readonly error: string | null;
  get(id: MeetingRef): Promise<MeetingRecord | undefined>;
  createDraft(draft: CreateMeetingDraft): Promise<MeetingRecord>;
  update(id: MeetingRef, patch: MeetingPatch): Promise<MeetingRecord>;
  transition(
    id: MeetingRef,
    transition: MeetingLifecycleTransition
  ): Promise<MeetingRecord>;
  /** One-time bridge to a legacy folder, after the complete anchor check. */
  linkLegacy(
    id: MeetingRef,
    input: LegacyMeetingLinkInput,
    context: LegacyMeetingLinkValidationContext
  ): Promise<MeetingRecord>;
}

/** The minimal filesystem surface needed to prove a legacy folder is local. */
export interface LegacyMeetingWorkspace {
  getRootPath(): string | null;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  isSymlink?(path: string): Promise<boolean>;
  resolveSymlink?(path: string): Promise<string>;
}

/**
 * The caller must name both the live workspace identity and its root.  A
 * non-empty workspaceId alone is deliberately not accepted as proof that this
 * link belongs to the workspace currently open on this device.
 */
export interface LegacyMeetingLinkValidationContext {
  readonly workspaceId: string;
  readonly workspaceRoot: string;
  readonly workspace: LegacyMeetingWorkspace;
  readonly matters: readonly Matter[];
}

/** A resolved target for the legacy detail host. No host may infer this from a path. */
export interface MeetingOpenTarget {
  readonly kind: 'linked-legacy-meeting';
  readonly meeting: MeetingProjection;
  readonly client: ClientBoundary;
  readonly legacyLink: LegacyMeetingLink;
  /** Absolute local folder path, checked immediately before opening. */
  readonly meetingDir: string;
}

export interface MeetingPopulationService {
  createNew(draft: CreateMeetingDraft): Promise<MeetingRecord>;
  createAndLink(
    draft: CreateMeetingDraft,
    legacy: LegacyMeetingLinkInput
  ): Promise<MeetingRecord>;
  linkLegacy(
    meetingId: MeetingRef,
    legacy: LegacyMeetingLinkInput
  ): Promise<MeetingRecord>;
  openTarget(meetingId: MeetingRef): Promise<MeetingOpenTarget>;
}

export interface FirmMeetingDirectoryAuthorization {
  /** A caller-owned permission check; false or a throwing check fails closed. */
  isAuthorized(): boolean;
  /** The exact canonical matters this caller may enumerate. */
  allowedMatterIds(): readonly string[];
}

export interface FirmMeetingDirectoryReader {
  list(): Promise<readonly MeetingProjection[]>;
  get(id: MeetingRef): Promise<MeetingProjection | undefined>;
}

export interface MeetingArtifactInput {
  readonly meetingId: MeetingRef;
  readonly kind: MeetingArtifactKind;
  readonly schemaVersion: number;
  readonly producedAt: string;
  readonly approvedAt?: string;
  readonly sourceRefs: readonly string[];
  readonly provenance:
    | 'local-entry'
    | 'local-processing'
    | 'attached-statement';
  readonly payload: Readonly<Record<string, unknown>>;
}

export interface MeetingArtifact extends MeetingArtifactInput {
  readonly id: MeetingArtifactRef;
  readonly kind: MeetingArtifactKind;
  readonly householdRef: string;
  readonly matterId: string;
  readonly state: 'produced' | 'approved';
  readonly createdAt: string;
}

export interface MeetingArtifactTransition {
  readonly from: 'produced' | 'approved';
  readonly to: 'approved';
  readonly at: string;
}

export interface MeetingArtifactReader {
  listForMeeting(
    meeting: MeetingRef,
    kinds?: readonly MeetingArtifactKind[]
  ): readonly MeetingArtifact[];
  get(id: MeetingArtifactRef): MeetingArtifact | null;
}

export interface MeetingArtifactRequirement {
  readonly kind: MeetingArtifactKind;
  readonly minimumSchemaVersion: number;
}

export interface ApprovedMeetingArtifactReader {
  readonly client: ClientBoundary;
  readonly kinds: readonly MeetingArtifactKind[];
  listApproved(
    meeting: MeetingRef,
    kinds?: readonly MeetingArtifactKind[]
  ): readonly MeetingArtifact[];
  get(id: MeetingArtifactRef): MeetingArtifact | null;
}

export interface MeetingArtifactStore {
  readerFor(
    meetings: MeetingStore,
    client: ClientBoundary,
    requirements: readonly MeetingArtifactRequirement[]
  ): MeetingArtifactReader;
  append(input: MeetingArtifactInput): Promise<MeetingArtifact>;
  approve(
    id: MeetingArtifactRef,
    transition: MeetingArtifactTransition
  ): Promise<MeetingArtifact>;
}

export interface NoticeEvidenceInput {
  readonly meetingId: MeetingRef;
  readonly state: 'shown' | 'confirmed' | 'statement-attached';
  readonly timestamp: string;
  readonly displayText: string;
  readonly provenance: 'local-entry' | 'attached-statement';
}

export interface NoticeEvidenceProjection {
  readonly id: NoticeEvidenceRef;
  readonly meetingId: MeetingRef;
  readonly state: NoticeEvidenceInput['state'];
  readonly timestamp: string;
  readonly provenance: NoticeEvidenceInput['provenance'];
  readonly displayText: string;
}

export interface NoticeEvidenceReadModel {
  listForMeeting(meeting: MeetingRef): readonly NoticeEvidenceProjection[];
  get(id: NoticeEvidenceRef): NoticeEvidenceProjection | null;
}

export interface CitedMeetingInsight {
  readonly descriptorId: string;
  readonly meetingId: MeetingRef;
  readonly householdRef: string;
  readonly summary: string;
  readonly sourceArtifactIds: readonly MeetingArtifactRef[];
}

export interface MeetingListProjection {
  readonly meetings: readonly MeetingProjection[];
  readonly scope: 'firm' | 'household' | 'owner';
}

export interface MeetingIntelligenceSettingsProjection {
  readonly keywordTrackingEnabled: boolean;
  readonly clientSignalsEnabled: boolean;
  readonly displayPreference: 'compact' | 'comfortable';
}
export interface MeetingVisibilityPolicy {
  readonly id: string;
  readonly mode: 'inherit-household' | 'explicit-review';
}
export interface MeetingTypeDefinition {
  readonly id: string;
  readonly label: string;
}
export interface MeetingTemplateProjection {
  readonly id: string;
  readonly label: string;
  readonly artifactKinds: readonly MeetingArtifactKind[];
}
export interface MeetingOwnerProjection {
  readonly id: string;
  readonly label: string;
}
export interface MeetingTypeStore {
  readonly types: readonly MeetingTypeDefinition[];
  readonly error: string | null;
  get(): Promise<readonly MeetingTypeDefinition[]>;
  save(
    types: readonly MeetingTypeDefinition[]
  ): Promise<readonly MeetingTypeDefinition[]>;
}
export interface MeetingTemplateStore {
  readonly templates: readonly MeetingTemplateProjection[];
  readonly error: string | null;
  get(): Promise<readonly MeetingTemplateProjection[]>;
  save(
    templates: readonly MeetingTemplateProjection[]
  ): Promise<readonly MeetingTemplateProjection[]>;
}
export interface MeetingIntelligenceSettingsStore {
  readonly settings: MeetingIntelligenceSettingsProjection;
  readonly error: string | null;
  get(): Promise<MeetingIntelligenceSettingsProjection>;
  save(
    settings: MeetingIntelligenceSettingsProjection
  ): Promise<MeetingIntelligenceSettingsProjection>;
}
export interface MeetingFoundationPreferences {
  readonly visibilityPolicies: readonly MeetingVisibilityPolicy[];
  readonly owners: readonly MeetingOwnerProjection[];
  readonly deferredDescriptors: readonly MeetingDeferredDescriptor[];
}
export interface MeetingFoundationPreferencesStore {
  readonly preferences: MeetingFoundationPreferences;
  readonly error: string | null;
  get(): Promise<MeetingFoundationPreferences>;
  save(
    value: MeetingFoundationPreferences
  ): Promise<MeetingFoundationPreferences>;
}
/** Read-only Part A descriptors. They never run, send, export, or clean up. */
export interface MeetingDeferredDescriptor {
  readonly id: string;
  readonly kind:
    | 'retention-policy'
    | 'attestation-export'
    | 'automation-rule'
    | 'notetaker-display-preference';
  readonly label: string;
}
export interface MeetingSourceAdapter {
  listApprovedForClient(
    client: ClientBoundary
  ): Promise<readonly CitedMeetingInsight[]>;
}
// Settings and CRM-clients own their composition contracts. This package does
// not publish local lookalikes for owner seams that are not exported from the
// owners' public indexes. The manifest records those dependents as blocked.

type LivePort = Pick<
  ReturnType<typeof useLiveCrmRecords>,
  'records' | 'workspaceRoot' | 'error' | 'save'
> & {
  readonly sharedMatterId?: string | null;
  readonly sharedLocalMatterId?: string | null;
  reloadRecords(): Promise<readonly LiveCrmRecord[] | undefined>;
};

/**
 * The port required to build a CLIENT-SCOPED store (`createMeetingStore`,
 * `createMeetingArtifactStore`). `getActiveMatterId` is MANDATORY — a store
 * cannot be constructed without live client isolation, so the isolation-less
 * shape is a compile error, not a silent leak.
 *
 * `getActiveMatterId` MUST resolve the LIVE active client at call time (it is
 * re-read at every operation), e.g. `() => useMatterStore.getState().activeMatterId`.
 * Passing a value captured once (a snapshot) reintroduces the stale-client leak.
 * A resolver returning `null`/`undefined` (no active client) FAILS CLOSED:
 * nothing is listed, read in full, mutated, appended, approved, or read through
 * a client-bound artifact reader. `matterId` is the durable per-client scope key
 * (one matter is one client engagement).
 */
export type ClientScopedLivePort = LivePort & {
  readonly getActiveMatterId: () => string | null | undefined;
};

interface ClientScope {
  /** True when a specific record's matter may be listed / read / mutated now. */
  owns(matterId: unknown): boolean;
  /** Throw a fail-closed error when the record is not the active client's. */
  assertOwns(matterId: unknown, subject: string): void;
}

function clientScope(port: ClientScopedLivePort): ClientScope {
  const scope: ClientScope = {
    owns(matterId) {
      // Resolve the active client at CALL time, never construction time, so the
      // same held store fails closed the instant the active client changes.
      const current = port.getActiveMatterId();
      // No active client (null/undefined) → fail closed. There is no unscoped
      // escape hatch: a store without a live client resolver cannot be built.
      if (current === null || current === undefined) return false;
      return typeof matterId === 'string' && matterId === current;
    },
    assertOwns(matterId, subject) {
      if (!scope.owns(matterId))
        throw new Error(
          `${subject} belongs to a different client than the active one.`
        );
    },
  };
  return scope;
}

const now = () => new Date().toISOString();
const recordId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const nonEmpty = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} is required.`);
  return value.trim();
};
const timestamp = (value: unknown, name: string): string => {
  const parsed = nonEmpty(value, name);
  const match =
    /^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})(?:\.(\d{3}))?Z$/.exec(
      parsed
    );
  if (!match) throw new Error(`${name} must be an ISO timestamp.`);
  const [, year, month, day, hour, minute, second, millis = '000'] = match;
  const date = new Date(
    Date.UTC(
      Number(year),
      Number(month) - 1,
      Number(day),
      Number(hour),
      Number(minute),
      Number(second),
      Number(millis)
    )
  );
  if (
    date.getUTCFullYear() !== Number(year) ||
    date.getUTCMonth() + 1 !== Number(month) ||
    date.getUTCDate() !== Number(day) ||
    date.getUTCHours() !== Number(hour) ||
    date.getUTCMinutes() !== Number(minute) ||
    date.getUTCSeconds() !== Number(second) ||
    date.getUTCMilliseconds() !== Number(millis)
  )
    throw new Error(`${name} must be a real ISO timestamp.`);
  return parsed;
};
const strings = (value: unknown, name: string): readonly string[] => {
  if (!Array.isArray(value))
    throw new Error(`${name} must contain stable IDs.`);
  const clean = value.map((item) => {
    if (typeof item !== 'string' || !item.trim())
      throw new Error(`${name} must contain stable IDs.`);
    return item.trim();
  });
  return [...new Set(clean)];
};

function normalizedPath(value: string, name: string): string {
  const raw = nonEmpty(value, name).replace(/\\/g, '/');
  if (raw.startsWith('/') || /^[A-Za-z]:\//.test(raw))
    throw new Error(`${name} must be workspace-relative.`);
  const parts = raw.split('/');
  if (
    parts.some((part) => !part || part === '.' || part === '..') ||
    raw !== parts.join('/')
  )
    throw new Error(`${name} must be normalized and traversal-free.`);
  return raw;
}

function normalizedAbsolutePath(value: string, name: string): string {
  const raw = nonEmpty(value, name).replace(/\\/g, '/').replace(/\/+$/, '');
  if (!raw.startsWith('/') && !/^[A-Za-z]:\//.test(raw))
    throw new Error(`${name} must be absolute.`);
  if (raw.split('/').some((part) => part === '.' || part === '..'))
    throw new Error(`${name} must be normalized.`);
  return raw;
}

function isInsidePath(child: string, parent: string): boolean {
  return child === parent || child.startsWith(`${parent}/`);
}

function projectLegacyLink(value: unknown): LegacyMeetingLink | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object')
    throw new Error('Legacy meeting link is invalid.');
  const raw = value as Record<string, unknown>;
  return {
    meetingDir: normalizedPath(
      String(raw['meetingDir'] ?? ''),
      'Legacy meeting folder'
    ),
    linkedAt: timestamp(raw['linkedAt'], 'Legacy meeting link timestamp'),
  };
}

/**
 * Validates the only supported legacy-to-canonical anchor.  This deliberately
 * has no title, date, calendar-event, or caller-supplied household fallback.
 */
export async function validateLegacyMeetingLink(
  meeting: MeetingProjection,
  input: LegacyMeetingLinkInput,
  context: LegacyMeetingLinkValidationContext
): Promise<LegacyMeetingLink> {
  if (nonEmpty(context.workspaceId, 'Link workspace') !== meeting.workspaceId)
    throw new Error('Legacy meeting link belongs to a different workspace.');
  const workspaceRoot = normalizedAbsolutePath(
    context.workspaceRoot,
    'Open workspace root'
  );
  const liveRoot = context.workspace.getRootPath();
  if (
    !liveRoot ||
    normalizedAbsolutePath(liveRoot, 'Live workspace root') !== workspaceRoot
  )
    throw new Error(
      'Legacy meeting link requires the named workspace to be open.'
    );
  const meetingDir = normalizedPath(input.meetingDir, 'Legacy meeting folder');
  let resolvedDir = `${workspaceRoot}/${meetingDir}`;
  if (
    context.workspace.isSymlink &&
    (await context.workspace.isSymlink(meetingDir))
  ) {
    if (!context.workspace.resolveSymlink)
      throw new Error('Legacy meeting link cannot resolve its folder safely.');
    resolvedDir = normalizedAbsolutePath(
      await context.workspace.resolveSymlink(meetingDir),
      'Resolved legacy meeting folder'
    );
  }
  if (!isInsidePath(resolvedDir, workspaceRoot))
    throw new Error(
      'Legacy meeting folder resolves outside the open workspace.'
    );
  if (!(await context.workspace.exists(meetingDir)))
    throw new Error('Legacy meeting folder is unavailable on this device.');

  const matter = context.matters.find(
    (candidate) => candidate.id === meeting.matterId
  );
  if (!matter)
    throw new Error('Legacy meeting link has no mapped canonical matter.');
  const mappedRoots = matter.folderPaths.map((folder) =>
    normalizedAbsolutePath(folder, 'Matter folder root')
  );
  if (!mappedRoots.some((root) => isInsidePath(resolvedDir, root)))
    throw new Error(
      'Legacy meeting folder is outside its mapped matter folder.'
    );
  const households = [...new Set(matter.crmHouseholdKeys ?? [])];
  if (households.length !== 1 || households[0] !== meeting.householdRef)
    throw new Error(
      'Legacy meeting link requires exactly one matching household.'
    );

  let parsed: unknown;
  try {
    parsed = JSON.parse(
      await context.workspace.readFile(`${meetingDir}/meeting.json`)
    );
  } catch {
    throw new Error('Legacy meeting metadata is unavailable.');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Record<string, unknown>)['matterId'] !== meeting.matterId
  )
    throw new Error('Legacy meeting metadata belongs to a different matter.');
  return { meetingDir, linkedAt: now() };
}

/** Resolve a link again at open time: a relayed canonical record can outlive its local folder. */
export async function resolveMeetingOpenTarget(
  meeting: MeetingProjection,
  context: LegacyMeetingLinkValidationContext
): Promise<MeetingOpenTarget> {
  if (!meeting.legacyLink)
    throw new Error('This canonical meeting has no linked legacy detail.');
  const verified = await validateLegacyMeetingLink(
    meeting,
    { meetingDir: meeting.legacyLink.meetingDir },
    context
  );
  return {
    kind: 'linked-legacy-meeting',
    meeting,
    client: { householdRef: meeting.householdRef, matterId: meeting.matterId },
    legacyLink: { ...meeting.legacyLink, linkedAt: verified.linkedAt },
    meetingDir: `${normalizedAbsolutePath(context.workspaceRoot, 'Open workspace root')}/${verified.meetingDir}`,
  };
}

export function validateMeetingDraft(
  input: CreateMeetingDraft
): CreateMeetingDraft & { readonly references: readonly string[] } {
  const start = timestamp(input.scheduledStartUtc, 'Meeting start');
  const end = timestamp(input.scheduledEndUtc, 'Meeting end');
  if (Date.parse(end) <= Date.parse(start))
    throw new Error('Meeting end must be after its start.');
  return {
    ...input,
    workspaceId: nonEmpty(input.workspaceId, 'Workspace'),
    householdRef: nonEmpty(input.householdRef, 'Household'),
    matterId: nonEmpty(input.matterId, 'Matter'),
    typeId: nonEmpty(input.typeId, 'Meeting type'),
    ownerRef: nonEmpty(input.ownerRef, 'Owner'),
    scheduledStartUtc: start,
    scheduledEndUtc: end,
    timezone: nonEmpty(input.timezone, 'Timezone'),
    references: input.references
      ? strings(input.references, 'Meeting references')
      : [],
  };
}

export function validateMeetingLifecycleTransition(
  transition: MeetingLifecycleTransition
): MeetingLifecycleTransition {
  const legal: Record<MeetingState, readonly MeetingState[]> = {
    draft: ['scheduled', 'cancelled'],
    scheduled: ['in-progress', 'cancelled'],
    'in-progress': ['completed', 'cancelled'],
    completed: [],
    cancelled: [],
  };
  if (!legal[transition.from].includes(transition.to))
    throw new Error(
      `Illegal meeting transition: ${transition.from} to ${transition.to}.`
    );
  return {
    ...transition,
    at: timestamp(transition.at, 'Transition timestamp'),
  };
}

export function projectMeetingRecord(record: LiveCrmRecord): MeetingRecord {
  if (record.kind !== 'meeting')
    throw new Error('That record is not a meeting.');
  const draft = validateMeetingDraft({
    workspaceId: nonEmpty(record['workspaceId'], 'Workspace'),
    householdRef: nonEmpty(record['householdRef'], 'Household'),
    matterId: nonEmpty(record.matterId, 'Matter'),
    typeId: nonEmpty(record['typeId'], 'Meeting type'),
    ownerRef: nonEmpty(record['ownerRef'], 'Owner'),
    scheduledStartUtc: nonEmpty(record['scheduledStartUtc'], 'Meeting start'),
    scheduledEndUtc: nonEmpty(record['scheduledEndUtc'], 'Meeting end'),
    timezone: nonEmpty(record['timezone'], 'Timezone'),
    references: Array.isArray(record['references'])
      ? (record['references'] as string[])
      : [],
    ...(typeof record['visibilityPolicyId'] === 'string'
      ? { visibilityPolicyId: record['visibilityPolicyId'] }
      : {}),
  });
  const state = record['state'];
  if (
    !['draft', 'scheduled', 'in-progress', 'completed', 'cancelled'].includes(
      state as string
    )
  )
    throw new Error('Meeting state is invalid.');
  const legacyLink = projectLegacyLink(record['legacyMeetingLink']);
  return {
    id: nonEmpty(record.id, 'Meeting ID'),
    kind: 'meeting',
    ...draft,
    state: state as MeetingState,
    createdAt: nonEmpty(record.createdAt, 'Created timestamp'),
    updatedAt: nonEmpty(record.updatedAt, 'Updated timestamp'),
    ...(legacyLink ? { legacyLink } : {}),
  };
}

function meetingRecords(records: readonly LiveCrmRecord[]) {
  return records
    .filter((record) => record.kind === 'meeting')
    .flatMap((record) => {
      try {
        return [projectMeetingRecord(record)];
      } catch {
        return [];
      }
    });
}
function requireAvailable(port: LivePort) {
  if (!port.workspaceRoot)
    throw new Error('Open a workspace before using meetings.');
  if (port.error)
    throw new Error(
      'Meeting records are unavailable until CRM records reload.'
    );
}
export function createMeetingStore(port: ClientScopedLivePort): MeetingStore {
  const scope = clientScope(port);
  let raw = port.records.filter((record) => record.kind === 'meeting');
  const currentList = () =>
    meetingRecords(raw)
      // Fail-closed list: only the active client's meetings are visible, so a
      // held store shows nothing from a prior client after a switch (or none).
      .filter((meeting) => scope.owns(meeting.matterId))
      .sort((left, right) =>
        left.scheduledStartUtc.localeCompare(right.scheduledStartUtc)
      );
  const getRaw = (id: string) => raw.find((record) => record.id === id);
  const persist = async (record: LiveCrmRecord) => {
    await port.save(record);
    const fresh = await port.reloadRecords();
    raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
    const saved = getRaw(record.id);
    if (!saved)
      throw new Error(
        'The saved meeting was missing after its canonical reload.'
      );
    return saved;
  };
  const store: MeetingStore = {
    get list() {
      return currentList();
    },
    get error() {
      return port.error;
    },
    get: (id) =>
      Promise.resolve().then(async () => {
        requireAvailable(port);
        const fresh = await port.reloadRecords();
        raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
        const record = getRaw(id);
        // Fail-closed read: a record from another (or no) active client is not
        // readable in full here, even with a valid id captured before a switch.
        if (!record || !scope.owns(record.matterId)) return undefined;
        return projectMeetingRecord(record);
      }),
    createDraft: async (input) => {
      requireAvailable(port);
      const draft = validateMeetingDraft(input);
      scope.assertOwns(draft.matterId, 'Meeting');
      if (port.sharedMatterId && port.sharedLocalMatterId !== draft.matterId)
        throw new Error(
          'Meeting matter must match the active shared client before relay.'
        );
      const savedAt = now();
      const record: LiveCrmRecord = {
        id: recordId('meeting'),
        kind: 'meeting',
        matterId: draft.matterId,
        ...(port.sharedMatterId ? { relayMatterId: port.sharedMatterId } : {}),
        createdAt: savedAt,
        updatedAt: savedAt,
        workspaceId: draft.workspaceId,
        householdRef: draft.householdRef,
        typeId: draft.typeId,
        ownerRef: draft.ownerRef,
        scheduledStartUtc: draft.scheduledStartUtc,
        scheduledEndUtc: draft.scheduledEndUtc,
        timezone: draft.timezone,
        state: 'draft',
        references: draft.references,
        ...(draft.visibilityPolicyId
          ? { visibilityPolicyId: draft.visibilityPolicyId }
          : {}),
      };
      return projectMeetingRecord(await persist(record));
    },
    update: async (id, patch) => {
      requireAvailable(port);
      const fresh = await port.reloadRecords();
      raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
      const rawRecord = getRaw(id);
      if (!rawRecord) throw new Error('That meeting no longer exists.');
      scope.assertOwns(rawRecord.matterId, 'Meeting');
      const current = projectMeetingRecord(rawRecord);
      const draft = validateMeetingDraft({
        ...current,
        ...patch,
        workspaceId: current.workspaceId,
        householdRef: current.householdRef,
        matterId: current.matterId,
        typeId: patch.typeId ?? current.typeId,
        ownerRef: patch.ownerRef ?? current.ownerRef,
        scheduledStartUtc: patch.scheduledStartUtc ?? current.scheduledStartUtc,
        scheduledEndUtc: patch.scheduledEndUtc ?? current.scheduledEndUtc,
        timezone: patch.timezone ?? current.timezone,
        references: patch.references
          ? strings(
              [...current.references, ...patch.references],
              'Meeting references'
            )
          : current.references,
        ...(patch.visibilityPolicyId === null
          ? {}
          : {
              visibilityPolicyId:
                patch.visibilityPolicyId ?? current.visibilityPolicyId,
            }),
      } as CreateMeetingDraft);
      const next: LiveCrmRecord = {
        ...rawRecord,
        updatedAt: now(),
        typeId: draft.typeId,
        ownerRef: draft.ownerRef,
        scheduledStartUtc: draft.scheduledStartUtc,
        scheduledEndUtc: draft.scheduledEndUtc,
        timezone: draft.timezone,
        references: draft.references,
      };
      if (patch.visibilityPolicyId === null) delete next['visibilityPolicyId'];
      else if (draft.visibilityPolicyId)
        next['visibilityPolicyId'] = draft.visibilityPolicyId;
      return projectMeetingRecord(await persist(next));
    },
    transition: async (id, transition) => {
      requireAvailable(port);
      const fresh = await port.reloadRecords();
      raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
      const rawRecord = getRaw(id);
      if (!rawRecord) throw new Error('That meeting no longer exists.');
      scope.assertOwns(rawRecord.matterId, 'Meeting');
      const current = projectMeetingRecord(rawRecord);
      // Fail-closed precondition: the caller's stated `from` must match the
      // record's real current state. A stale caller (acting on a state this
      // meeting has since left) is refused, never silently coerced to the
      // stored state — that coercion accepted lies like cancelled -> scheduled.
      const valid = validateMeetingLifecycleTransition(transition);
      if (valid.from !== current.state)
        throw new Error(
          `This meeting is ${current.state}, not ${valid.from}; refusing a stale transition.`
        );
      return projectMeetingRecord(
        await persist({
          ...rawRecord,
          state: valid.to,
          updatedAt: valid.at,
        })
      );
    },
    linkLegacy: async (id, input, context) => {
      requireAvailable(port);
      const fresh = await port.reloadRecords();
      raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
      const rawRecord = getRaw(id);
      if (!rawRecord) throw new Error('That meeting no longer exists.');
      scope.assertOwns(rawRecord.matterId, 'Meeting');
      const current = projectMeetingRecord(rawRecord);
      const existing = current.legacyLink;
      const requestedDir = normalizedPath(
        input.meetingDir,
        'Legacy meeting folder'
      );
      if (existing) {
        if (existing.meetingDir !== requestedDir)
          throw new Error(
            'A canonical meeting cannot replace its legacy link.'
          );
        // Idempotency is still a real check: a moved/deleted or cross-device
        // folder must not be reported as linked merely because an old record
        // happened to contain the same string.
        await validateLegacyMeetingLink(current, input, context);
        return current;
      }
      const link = await validateLegacyMeetingLink(current, input, context);
      return projectMeetingRecord(
        await persist({
          ...rawRecord,
          updatedAt: now(),
          legacyMeetingLink: link,
        })
      );
    },
  };
  return store;
}

/**
 * The forward population path.  New meetings are canonical first; attaching a
 * legacy folder is optional and always goes through the anchor validation.
 */
export function createMeetingPopulationService(
  port: ClientScopedLivePort,
  context: LegacyMeetingLinkValidationContext
): MeetingPopulationService {
  const store = createMeetingStore(port);
  return {
    createNew: (draft) => store.createDraft(draft),
    createAndLink: async (draft, legacy) => {
      const created = await store.createDraft(draft);
      return store.linkLegacy(created.id, legacy, context);
    },
    linkLegacy: (meetingId, legacy) =>
      store.linkLegacy(meetingId, legacy, context),
    openTarget: async (meetingId) => {
      const meeting = await store.get(meetingId);
      if (!meeting)
        throw new Error('That meeting is unavailable to the active client.');
      return resolveMeetingOpenTarget(meeting, context);
    },
  };
}

/**
 * An explicit cross-client reader.  It has no active-client fallback: callers
 * must present an authorization decision and an exact allowed-matter set on
 * every read, otherwise it returns no records.
 */
export function createFirmMeetingDirectoryReader(
  port: LivePort,
  authorization: FirmMeetingDirectoryAuthorization
): FirmMeetingDirectoryReader {
  const permitted = () => {
    try {
      if (!authorization.isAuthorized()) return null;
      const ids = authorization.allowedMatterIds();
      if (
        !Array.isArray(ids) ||
        ids.some((id) => typeof id !== 'string' || !id.trim())
      )
        return null;
      return new Set(ids);
    } catch {
      return null;
    }
  };
  const read = async () => {
    if (!port.workspaceRoot || port.error)
      return [] as readonly MeetingProjection[];
    const allowed = permitted();
    if (!allowed || allowed.size === 0)
      return [] as readonly MeetingProjection[];
    let records: readonly LiveCrmRecord[];
    try {
      records = (await port.reloadRecords()) ?? [];
    } catch {
      return [] as readonly MeetingProjection[];
    }
    // Check authorization after the asynchronous reload as well. A permission
    // revoke while the read is in flight must not leak the loaded result.
    const stillAllowed = permitted();
    if (!stillAllowed || stillAllowed.size === 0)
      return [] as readonly MeetingProjection[];
    return meetingRecords(records)
      .filter((meeting) => stillAllowed.has(meeting.matterId))
      .sort((left, right) =>
        left.scheduledStartUtc.localeCompare(right.scheduledStartUtc)
      );
  };
  return {
    list: read,
    get: async (id) => (await read()).find((meeting) => meeting.id === id),
  };
}

function projectArtifact(
  record: LiveCrmRecord,
  transitionRecords: readonly LiveCrmRecord[] = []
): MeetingArtifact {
  if (record.kind !== 'meeting_artifact')
    throw new Error('That record is not a meeting artifact.');
  const kind = nonEmpty(
    record['artifactKind'],
    'Artifact kind'
  ) as MeetingArtifactKind;
  if (!MEETING_ARTIFACT_KINDS.includes(kind))
    throw new Error('Meeting artifact kind is invalid.');
  const schemaVersion = Number(record['schemaVersion']);
  if (!Number.isInteger(schemaVersion) || schemaVersion < 1)
    throw new Error('Artifact schema version is invalid.');
  const provenance = record['provenance'];
  if (
    !['local-entry', 'local-processing', 'attached-statement'].includes(
      provenance as string
    )
  )
    throw new Error('Artifact provenance is invalid.');
  const state = record['artifactState'];
  if (state !== 'produced') throw new Error('Artifact state is invalid.');
  const producedAt = timestamp(record['producedAt'], 'Produced timestamp');
  const approval = transitionRecords
    .filter(
      (candidate) =>
        candidate.kind === 'meeting_artifact_transition' &&
        candidate['artifactId'] === record.id &&
        candidate.matterId === record.matterId &&
        candidate['householdRef'] === record['householdRef']
    )
    .sort((left, right) =>
      String(left['transitionAt']).localeCompare(String(right['transitionAt']))
    )
    .at(-1);
  const safeApprovedAt = approval
    ? validateMeetingArtifactTransition({
        from: approval['fromState'] as MeetingArtifactTransition['from'],
        to: approval['toState'] as MeetingArtifactTransition['to'],
        at: approval['transitionAt'] as string,
      }).at
    : undefined;
  if (safeApprovedAt && Date.parse(safeApprovedAt) < Date.parse(producedAt))
    throw new Error('Artifact approval cannot predate production.');
  return {
    id: nonEmpty(record.id, 'Artifact ID'),
    meetingId: nonEmpty(record['meetingId'], 'Meeting ID'),
    householdRef: nonEmpty(record['householdRef'], 'Household'),
    matterId: nonEmpty(record.matterId, 'Matter'),
    kind,
    schemaVersion,
    state: safeApprovedAt ? 'approved' : 'produced',
    producedAt,
    ...(safeApprovedAt ? { approvedAt: safeApprovedAt } : {}),
    sourceRefs: strings(record['sourceRefs'], 'Artifact source references'),
    provenance: provenance as MeetingArtifact['provenance'],
    payload: (record['payload'] && typeof record['payload'] === 'object'
      ? record['payload']
      : {}) as Record<string, unknown>,
    createdAt: nonEmpty(record.createdAt, 'Created timestamp'),
  };
}

export function createMeetingArtifactStore(
  port: ClientScopedLivePort
): MeetingArtifactStore {
  const scope = clientScope(port);
  let raw = port.records.filter(
    (record) =>
      record.kind === 'meeting_artifact' ||
      record.kind === 'meeting_artifact_transition'
  );
  const artifacts = () =>
    raw
      .filter((record) => record.kind === 'meeting_artifact')
      .flatMap((record) => {
        try {
          return [projectArtifact(record, raw)];
        } catch {
          return [];
        }
      });
  const persist = async (record: LiveCrmRecord) => {
    await port.save(record);
    const fresh = await port.reloadRecords();
    raw = (fresh ?? []).filter(
      (candidate) =>
        candidate.kind === 'meeting_artifact' ||
        candidate.kind === 'meeting_artifact_transition'
    );
    const saved = raw.find((candidate) => candidate.id === record.id);
    if (!saved)
      throw new Error(
        'The saved meeting artifact was missing after its canonical reload.'
      );
    return saved;
  };
  const reader: MeetingArtifactReader = {
    listForMeeting: (meeting, kinds) =>
      artifacts().filter(
        (artifact) =>
          artifact.meetingId === meeting &&
          (!kinds || kinds.includes(artifact.kind))
      ),
    get: (id) => artifacts().find((artifact) => artifact.id === id) ?? null,
  };
  const emptyReader: MeetingArtifactReader = {
    listForMeeting: () => [],
    get: () => null,
  };
  return {
    readerFor: (meetings, client, requirements) => {
      const minimumVersion = artifactMinimumVersions(requirements);
      // Fail-closed read: the requested client must be the active one. A reader
      // built for client A while B (or none) is active returns nothing, so a
      // stale-A boundary cannot pull A's artifacts after a switch.
      if (!scope.owns(client.matterId)) return emptyReader;
      const ownsMeeting = (meetingId: MeetingRef) =>
        meetings.list.some(
          (meeting) =>
            meeting.id === meetingId &&
            meeting.householdRef === client.householdRef &&
            meeting.matterId === client.matterId
        );
      const allowedArtifact = (artifact: MeetingArtifact) =>
        ownsMeeting(artifact.meetingId) &&
        artifact.householdRef === client.householdRef &&
        artifact.matterId === client.matterId &&
        artifact.schemaVersion >=
          (minimumVersion.get(artifact.kind) ?? Infinity);
      return {
        listForMeeting: (meeting, requestedKinds) => {
          if (!ownsMeeting(meeting)) return [];
          const kinds = requestedKinds ?? [...minimumVersion.keys()];
          if (kinds.some((kind) => !minimumVersion.has(kind))) return [];
          return reader.listForMeeting(meeting, kinds).filter(allowedArtifact);
        },
        get: (id) => {
          const artifact = reader.get(id);
          return artifact && allowedArtifact(artifact) ? artifact : null;
        },
      };
    },
    append: async (input) => {
      requireAvailable(port);
      const freshRecords = await port.reloadRecords();
      raw = (freshRecords ?? []).filter(
        (candidate) =>
          candidate.kind === 'meeting_artifact' ||
          candidate.kind === 'meeting_artifact_transition'
      );
      if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1)
        throw new Error('Artifact schema version must be a positive integer.');
      if (!MEETING_ARTIFACT_KINDS.includes(input.kind))
        throw new Error('Meeting artifact kind is invalid.');
      if (
        !['local-entry', 'local-processing', 'attached-statement'].includes(
          input.provenance
        )
      )
        throw new Error('Artifact provenance is invalid.');
      const producedAt = timestamp(input.producedAt, 'Produced timestamp');
      const approvedAt = input.approvedAt
        ? timestamp(input.approvedAt, 'Approval timestamp')
        : undefined;
      if (approvedAt && Date.parse(approvedAt) < Date.parse(producedAt))
        throw new Error('Artifact approval cannot predate production.');
      const savedAt = now();
      const parent = freshRecords?.find(
        (candidate) =>
          candidate.id === input.meetingId && candidate.kind === 'meeting'
      );
      if (!parent)
        throw new Error('Artifacts must belong to an existing meeting.');
      // Fail-closed write: an artifact can only be appended to a meeting owned
      // by the active client, so B cannot append onto A's meeting after a switch.
      scope.assertOwns(parent.matterId, 'Meeting');
      const record: LiveCrmRecord = {
        id: recordId('meeting-artifact'),
        kind: 'meeting_artifact',
        matterId: parent.matterId as string,
        householdRef: nonEmpty(parent['householdRef'], 'Household'),
        ...(typeof parent['relayMatterId'] === 'string'
          ? { relayMatterId: parent['relayMatterId'] }
          : {}),
        createdAt: savedAt,
        updatedAt: savedAt,
        meetingId: nonEmpty(input.meetingId, 'Meeting ID'),
        artifactKind: input.kind,
        schemaVersion: input.schemaVersion,
        producedAt,
        artifactState: 'produced',
        sourceRefs: strings(input.sourceRefs, 'Artifact source references'),
        provenance: input.provenance,
        payload: input.payload,
      };
      const saved = projectArtifact(await persist(record), raw);
      return approvedAt
        ? approveArtifact(saved, {
            from: 'produced',
            to: 'approved',
            at: approvedAt,
          })
        : saved;
    },
    approve: async (id, transition) => {
      requireAvailable(port);
      const fresh = await port.reloadRecords();
      raw = (fresh ?? []).filter(
        (candidate) =>
          candidate.kind === 'meeting_artifact' ||
          candidate.kind === 'meeting_artifact_transition'
      );
      const current = raw.find((record) => record.id === id);
      if (!current) throw new Error('That meeting artifact no longer exists.');
      // Fail-closed: only the active client may approve, and the caller's stated
      // `from` must match the stored state. This is the real transition contract
      // — an approved -> approved (or stale produced -> approved) claim against a
      // mismatched state is refused, never coerced to the stored state.
      scope.assertOwns(current.matterId, 'Artifact');
      const projected = projectArtifact(current, raw);
      const valid = validateMeetingArtifactTransition(transition);
      if (valid.from !== projected.state)
        throw new Error(
          `This artifact is ${projected.state}, not ${valid.from}; refusing a stale approval.`
        );
      return approveArtifact(projected, valid);
    },
  };

  async function approveArtifact(
    artifact: MeetingArtifact,
    transition: MeetingArtifactTransition
  ): Promise<MeetingArtifact> {
    const valid = validateMeetingArtifactTransition(transition);
    if (Date.parse(valid.at) < Date.parse(artifact.producedAt))
      throw new Error('Artifact approval cannot predate production.');
    const base = raw.find(
      (candidate) =>
        candidate.kind === 'meeting_artifact' && candidate.id === artifact.id
    );
    if (!base) throw new Error('The artifact disappeared before approval.');
    await persist({
      id: recordId('meeting-artifact-transition'),
      kind: 'meeting_artifact_transition',
      matterId: artifact.matterId,
      householdRef: artifact.householdRef,
      ...(typeof base['relayMatterId'] === 'string'
        ? { relayMatterId: base['relayMatterId'] }
        : {}),
      createdAt: valid.at,
      updatedAt: valid.at,
      artifactId: artifact.id,
      fromState: valid.from,
      toState: valid.to,
      transitionAt: valid.at,
    });
    const reloadedBase = raw.find(
      (candidate) =>
        candidate.kind === 'meeting_artifact' && candidate.id === artifact.id
    );
    if (!reloadedBase)
      throw new Error('The approved artifact disappeared after reload.');
    return projectArtifact(reloadedBase, raw);
  }
}

export function validateMeetingArtifactTransition(
  transition: MeetingArtifactTransition
): MeetingArtifactTransition {
  const runtime = transition as { from: unknown; to: unknown; at: unknown };
  if (runtime.from !== 'produced' || runtime.to !== 'approved')
    throw new Error(
      `Illegal meeting artifact transition: ${transition.from} to ${transition.to}.`
    );
  return { ...transition, at: timestamp(transition.at, 'Approval timestamp') };
}

function artifactMinimumVersions(
  requirements: readonly MeetingArtifactRequirement[]
): ReadonlyMap<MeetingArtifactKind, number> {
  return new Map(
    requirements.map((item) => {
      if (
        !Number.isInteger(item.minimumSchemaVersion) ||
        item.minimumSchemaVersion < 1
      )
        throw new Error('Artifact minimum schema version must be positive.');
      return [item.kind, item.minimumSchemaVersion] as const;
    })
  );
}

export function meetingArtifactsForClient(
  meetings: MeetingStore,
  store: MeetingArtifactStore,
  client: ClientBoundary,
  requirements: readonly MeetingArtifactRequirement[]
): MeetingArtifactReader {
  return store.readerFor(meetings, client, requirements);
}

export function approvedMeetingArtifactsForClient(
  meetings: MeetingStore,
  store: MeetingArtifactStore,
  client: ClientBoundary,
  requirements: readonly MeetingArtifactRequirement[]
): ApprovedMeetingArtifactReader {
  const kinds = [...new Set(requirements.map((item) => item.kind))];
  const scoped = meetingArtifactsForClient(
    meetings,
    store,
    client,
    requirements
  );
  const permitsKind = (kind: MeetingArtifactKind) => kinds.includes(kind);
  return {
    client,
    kinds,
    listApproved: (meeting, requestedKinds = kinds) => {
      if (requestedKinds.some((kind) => !permitsKind(kind))) return [];
      return scoped
        .listForMeeting(meeting, requestedKinds)
        .filter((artifact) => artifact.state === 'approved');
    },
    get: (id) => {
      const artifact = scoped.get(id);
      return artifact && artifact.state === 'approved' ? artifact : null;
    },
  };
}
export function createNoticeEvidenceReadModel(
  reader: MeetingArtifactReader
): NoticeEvidenceReadModel {
  const project = (
    artifact: MeetingArtifact
  ): NoticeEvidenceProjection | null => {
    if (artifact.kind !== 'notice-evidence') return null;
    const payload = artifact.payload;
    const state = payload['state'];
    const displayText = payload['displayText'];
    if (
      !['shown', 'confirmed', 'statement-attached'].includes(state as string) ||
      typeof displayText !== 'string'
    )
      return null;
    return {
      id: artifact.id,
      meetingId: artifact.meetingId,
      state: state as NoticeEvidenceInput['state'],
      timestamp: artifact.producedAt,
      provenance:
        artifact.provenance === 'attached-statement'
          ? 'attached-statement'
          : 'local-entry',
      displayText,
    };
  };
  return {
    listForMeeting: (meeting) =>
      reader
        .listForMeeting(meeting, ['notice-evidence'])
        .flatMap((artifact) => {
          const value = project(artifact);
          return value ? [value] : [];
        }),
    get: (id) => {
      const artifact = reader.get(id);
      return artifact ? project(artifact) : null;
    },
  };
}
export async function appendNoticeEvidence(
  store: MeetingArtifactStore,
  input: NoticeEvidenceInput
): Promise<MeetingArtifact> {
  return store.append({
    meetingId: input.meetingId,
    kind: 'notice-evidence',
    schemaVersion: 1,
    producedAt: input.timestamp,
    sourceRefs: [],
    provenance: input.provenance,
    payload: { state: input.state, displayText: input.displayText },
  });
}

export function projectMeetingList(
  records: readonly MeetingProjection[],
  scope: MeetingListProjection['scope'],
  client?: ClientBoundary | null,
  ownerId?: string | null
): MeetingListProjection {
  const selected = records.filter(
    (meeting) =>
      (!client ||
        (meeting.householdRef === client.householdRef &&
          meeting.matterId === client.matterId)) &&
      (!ownerId || meeting.ownerRef === ownerId)
  );
  return {
    scope,
    meetings: [...selected].sort((left, right) =>
      left.scheduledStartUtc.localeCompare(right.scheduledStartUtc)
    ),
  };
}
export function listForHousehold(
  store: MeetingStore,
  client: ClientBoundary
): readonly MeetingProjection[] {
  return store.list.filter(
    (meeting) =>
      meeting.householdRef === client.householdRef &&
      meeting.matterId === client.matterId
  );
}
export function listPrepForHousehold(
  store: MeetingStore,
  client: ClientBoundary
): readonly MeetingProjection[] {
  return listForHousehold(store, client).filter(
    (meeting) => meeting.state === 'draft' || meeting.state === 'scheduled'
  );
}
export function createMeetingSourceAdapter(
  store: MeetingStore,
  artifacts: MeetingArtifactStore
): MeetingSourceAdapter {
  return {
    listApprovedForClient: (client) => {
      const approved = approvedMeetingArtifactsForClient(
        store,
        artifacts,
        client,
        [
          { kind: 'structured-notes', minimumSchemaVersion: 1 },
          { kind: 'summary', minimumSchemaVersion: 1 },
          { kind: 'transcript', minimumSchemaVersion: 1 },
        ]
      );
      return Promise.resolve().then(() =>
        listForHousehold(store, client).flatMap((meeting) =>
          approved
            .listApproved(meeting.id, [
              'structured-notes',
              'summary',
              'transcript',
            ])
            .map((artifact) => ({
              descriptorId: 'approved-meeting-artifact',
              meetingId: meeting.id,
              householdRef: meeting.householdRef,
              summary:
                typeof artifact.payload['summary'] === 'string'
                  ? artifact.payload['summary']
                  : '',
              sourceArtifactIds: [artifact.id],
            }))
        )
      );
    },
  };
}

export function validateMeetingIntelligenceSettings(
  value: MeetingIntelligenceSettingsProjection
): MeetingIntelligenceSettingsProjection {
  if (
    typeof value.keywordTrackingEnabled !== 'boolean' ||
    typeof value.clientSignalsEnabled !== 'boolean' ||
    !['compact', 'comfortable'].includes(value.displayPreference)
  )
    throw new Error('Meeting intelligence settings are invalid.');
  return value;
}
export function validateMeetingTypeCatalogue(
  value: readonly MeetingTypeDefinition[]
): readonly MeetingTypeDefinition[] {
  const ids = new Set<string>();
  return value.map((entry) => {
    const id = nonEmpty(entry.id, 'Meeting type ID');
    if (ids.has(id)) throw new Error('Meeting type IDs must be unique.');
    ids.add(id);
    return { id, label: nonEmpty(entry.label, 'Meeting type label') };
  });
}
export function validateMeetingTemplateCatalogue(
  value: readonly MeetingTemplateProjection[]
): readonly MeetingTemplateProjection[] {
  const ids = new Set<string>();
  return value.map((entry) => {
    const id = nonEmpty(entry.id, 'Meeting template ID');
    if (ids.has(id)) throw new Error('Meeting template IDs must be unique.');
    ids.add(id);
    const artifactKinds = strings(
      entry.artifactKinds,
      'Meeting template artifact kinds'
    ) as readonly MeetingArtifactKind[];
    if (artifactKinds.some((kind) => !MEETING_ARTIFACT_KINDS.includes(kind)))
      throw new Error('Meeting template artifact kind is invalid.');
    return {
      id,
      label: nonEmpty(entry.label, 'Meeting template label'),
      artifactKinds,
    };
  });
}
export function validateMeetingVisibilityPolicy(
  value: MeetingVisibilityPolicy
): MeetingVisibilityPolicy {
  if (!['inherit-household', 'explicit-review'].includes(value.mode))
    throw new Error('Meeting visibility policy is invalid.');
  return { id: nonEmpty(value.id, 'Visibility policy ID'), mode: value.mode };
}
export function validateMeetingDeferredDescriptor(
  value: MeetingDeferredDescriptor
): MeetingDeferredDescriptor {
  const kind = value.kind;
  if (
    ![
      'retention-policy',
      'attestation-export',
      'automation-rule',
      'notetaker-display-preference',
    ].includes(kind)
  )
    throw new Error('Meeting deferred descriptor is invalid.');
  return {
    id: nonEmpty(value.id, 'Deferred descriptor ID'),
    kind,
    label: nonEmpty(value.label, 'Deferred descriptor label'),
  };
}

export function validateMeetingFoundationPreferences(
  value: MeetingFoundationPreferences
): MeetingFoundationPreferences {
  const ownerIds = new Set<string>();
  const owners = value.owners.map((owner) => {
    const id = nonEmpty(owner.id, 'Meeting owner ID');
    if (ownerIds.has(id)) throw new Error('Meeting owner IDs must be unique.');
    ownerIds.add(id);
    return { id, label: nonEmpty(owner.label, 'Meeting owner label') };
  });
  const policyIds = new Set<string>();
  const visibilityPolicies = value.visibilityPolicies.map((policy) => {
    const validated = validateMeetingVisibilityPolicy(policy);
    if (policyIds.has(validated.id))
      throw new Error('Meeting visibility policy IDs must be unique.');
    policyIds.add(validated.id);
    return validated;
  });
  const descriptorIds = new Set<string>();
  const deferredDescriptors = value.deferredDescriptors.map((descriptor) => {
    const validated = validateMeetingDeferredDescriptor(descriptor);
    if (descriptorIds.has(validated.id))
      throw new Error('Meeting deferred descriptor IDs must be unique.');
    descriptorIds.add(validated.id);
    return validated;
  });
  return { visibilityPolicies, owners, deferredDescriptors };
}

function singletonController(port: LivePort, kind: string) {
  let current = port.records.find((record) => record.kind === kind);
  const reload = async () => {
    requireAvailable(port);
    const fresh = await port.reloadRecords();
    current = fresh?.find((record) => record.kind === kind);
    return current;
  };
  const save = async (values: Readonly<Record<string, unknown>>) => {
    requireAvailable(port);
    const savedAt = now();
    await port.save({
      ...(current ?? {}),
      id: current?.id ?? recordId(kind),
      kind,
      matterId: current?.matterId ?? 'firm_home',
      createdAt: current?.createdAt ?? savedAt,
      updatedAt: savedAt,
      ...values,
    });
    const saved = await reload();
    if (!saved)
      throw new Error(`The saved ${kind} record was missing after reload.`);
    return saved;
  };
  return { current: () => current, reload, save };
}
export function createMeetingTypeStore(port: LivePort): MeetingTypeStore {
  const record = singletonController(port, 'meeting_type_catalogue');
  let types =
    record.current() && Array.isArray(record.current()?.['types'])
      ? validateMeetingTypeCatalogue(
          record.current()?.['types'] as MeetingTypeDefinition[]
        )
      : [];
  return {
    get types() {
      return types;
    },
    get error() {
      return port.error;
    },
    get: async () => {
      const fresh = await record.reload();
      types =
        fresh && Array.isArray(fresh['types'])
          ? validateMeetingTypeCatalogue(
              fresh['types'] as MeetingTypeDefinition[]
            )
          : [];
      return types;
    },
    save: (next) =>
      Promise.resolve().then(async () => {
        const validated = validateMeetingTypeCatalogue(next);
        const saved = await record.save({ types: validated });
        types = validateMeetingTypeCatalogue(
          saved['types'] as MeetingTypeDefinition[]
        );
        return types;
      }),
  };
}
export function createMeetingTemplateStore(
  port: LivePort
): MeetingTemplateStore {
  const record = singletonController(port, 'meeting_template_catalogue');
  let templates =
    record.current() && Array.isArray(record.current()?.['templates'])
      ? validateMeetingTemplateCatalogue(
          record.current()?.['templates'] as MeetingTemplateProjection[]
        )
      : [];
  return {
    get templates() {
      return templates;
    },
    get error() {
      return port.error;
    },
    get: async () => {
      const fresh = await record.reload();
      templates =
        fresh && Array.isArray(fresh['templates'])
          ? validateMeetingTemplateCatalogue(
              fresh['templates'] as MeetingTemplateProjection[]
            )
          : [];
      return templates;
    },
    save: (next) =>
      Promise.resolve().then(async () => {
        const validated = validateMeetingTemplateCatalogue(next);
        const saved = await record.save({ templates: validated });
        templates = validateMeetingTemplateCatalogue(
          saved['templates'] as MeetingTemplateProjection[]
        );
        return templates;
      }),
  };
}
const defaultMeetingIntelligenceSettings: MeetingIntelligenceSettingsProjection =
  {
    keywordTrackingEnabled: false,
    clientSignalsEnabled: false,
    displayPreference: 'comfortable',
  };
export function createMeetingIntelligenceSettingsStore(
  port: LivePort
): MeetingIntelligenceSettingsStore {
  const record = singletonController(port, 'meeting_intelligence_settings');
  const projectSettings = (current: LiveCrmRecord | undefined) =>
    current
      ? validateMeetingIntelligenceSettings({
          keywordTrackingEnabled: current['keywordTrackingEnabled'],
          clientSignalsEnabled: current['clientSignalsEnabled'],
          displayPreference: current['displayPreference'],
        } as MeetingIntelligenceSettingsProjection)
      : defaultMeetingIntelligenceSettings;
  let settings = projectSettings(record.current());
  return {
    get settings() {
      return settings;
    },
    get error() {
      return port.error;
    },
    get: async () => {
      settings = projectSettings(await record.reload());
      return settings;
    },
    save: (next) =>
      Promise.resolve().then(async () => {
        const validated = validateMeetingIntelligenceSettings(next);
        const saved = await record.save(
          validated as unknown as Readonly<Record<string, unknown>>
        );
        settings = projectSettings(saved);
        return settings;
      }),
  };
}

const defaultMeetingFoundationPreferences: MeetingFoundationPreferences = {
  visibilityPolicies: [],
  owners: [],
  deferredDescriptors: [],
};

export function createMeetingFoundationPreferencesStore(
  port: LivePort
): MeetingFoundationPreferencesStore {
  const record = singletonController(port, 'meeting_foundation_preferences');
  const project = (current: LiveCrmRecord | undefined) =>
    current
      ? validateMeetingFoundationPreferences({
          visibilityPolicies: Array.isArray(current['visibilityPolicies'])
            ? (current['visibilityPolicies'] as MeetingVisibilityPolicy[])
            : [],
          owners: Array.isArray(current['owners'])
            ? (current['owners'] as MeetingOwnerProjection[])
            : [],
          deferredDescriptors: Array.isArray(current['deferredDescriptors'])
            ? (current['deferredDescriptors'] as MeetingDeferredDescriptor[])
            : [],
        })
      : defaultMeetingFoundationPreferences;
  let preferences = project(record.current());
  return {
    get preferences() {
      return preferences;
    },
    get error() {
      return port.error;
    },
    get: async () => {
      preferences = project(await record.reload());
      return preferences;
    },
    save: async (value) => {
      const validated = validateMeetingFoundationPreferences(value);
      preferences = project(
        await record.save({
          visibilityPolicies: validated.visibilityPolicies,
          owners: validated.owners,
          deferredDescriptors: validated.deferredDescriptors,
        })
      );
      return preferences;
    },
  };
}

/** Reactive adapter over the canonical encrypted live-record route. */
export function useMeetingFoundationStore(): MeetingStore {
  const live = useLiveCrmRecords();
  // Subscribe to the active matter so a client switch re-renders and
  // re-projects the UI — but do NOT capture that value into the store. The
  // resolver reads the LIVE active matter from the store's source at every
  // operation, so a store held across an async client switch (e.g. click
  // Approve, switch client, the await resolves) fails closed on the now-stale
  // client instead of acting on the snapshot captured when it was grabbed.
  useMatterStore((state) => state.activeMatterId);
  return createMeetingStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    sharedMatterId: live.sharedMatterId,
    sharedLocalMatterId: live.sharedLocalMatterId,
    getActiveMatterId: () => useMatterStore.getState().activeMatterId,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}
export function useMeetingArtifactStore(): MeetingArtifactStore {
  const live = useLiveCrmRecords();
  useMatterStore((state) => state.activeMatterId);
  return createMeetingArtifactStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    getActiveMatterId: () => useMatterStore.getState().activeMatterId,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}
export function useMeetingTypeStore(): MeetingTypeStore {
  const live = useLiveCrmRecords();
  return createMeetingTypeStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}
export function useMeetingTemplateStore(): MeetingTemplateStore {
  const live = useLiveCrmRecords();
  return createMeetingTemplateStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}
export function useMeetingIntelligenceSettingsStore(): MeetingIntelligenceSettingsStore {
  const live = useLiveCrmRecords();
  return createMeetingIntelligenceSettingsStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}
export function useMeetingFoundationPreferencesStore(): MeetingFoundationPreferencesStore {
  const live = useLiveCrmRecords();
  return createMeetingFoundationPreferencesStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}
