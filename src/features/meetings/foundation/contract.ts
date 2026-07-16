import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import {
  loadLiveCrmRecords,
  type LiveCrmRecord,
} from '@/platform/crm/liveRecords';

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

/** Deliberately small: a display name is never authorization. */
export interface ClientBoundary {
  readonly householdRef: string;
  readonly matterId: string;
  readonly displayName?: string;
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
  readonly state: 'produced' | 'approved';
  readonly createdAt: string;
}

export interface MeetingArtifactReader {
  listForMeeting(
    meeting: MeetingRef,
    kinds?: readonly MeetingArtifactKind[]
  ): readonly MeetingArtifact[];
  get(id: MeetingArtifactRef): MeetingArtifact | null;
}

export interface ApprovedMeetingArtifactReader {
  listApproved(
    meeting: MeetingRef,
    kinds: readonly MeetingArtifactKind[]
  ): readonly MeetingArtifact[];
}

export interface MeetingArtifactStore extends MeetingArtifactReader {
  append(input: MeetingArtifactInput): Promise<MeetingArtifact>;
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

export interface MeetingInsightDescriptor {
  readonly id: string;
  readonly order: number;
  readonly version: number;
  readonly artifactPrerequisites: readonly {
    kind: MeetingArtifactKind;
    minimumSchemaVersion: number;
  }[];
  readonly isAvailable: (context: MeetingInsightContext) => boolean;
  readonly renderMeeting: (context: MeetingInsightContext) => unknown;
  readonly renderClientSummary: (context: MeetingInsightContext) => unknown;
}

export interface MeetingInsightContext {
  readonly meeting: MeetingProjection;
  readonly approvedArtifacts: ApprovedMeetingArtifactReader;
  readonly settings: MeetingIntelligenceSettingsProjection;
}

export interface CitedMeetingInsight {
  readonly descriptorId: string;
  readonly meetingId: MeetingRef;
  readonly householdRef: string;
  readonly summary: string;
  readonly sourceArtifactIds: readonly MeetingArtifactRef[];
}

export interface MeetingPanelContext {
  readonly meeting: MeetingProjection;
  readonly client: ClientBoundary;
  readonly artifacts: MeetingArtifactReader;
}
export interface MeetingPanelDescriptor {
  readonly id: string;
  readonly order: number;
  readonly isAvailable: (context: MeetingPanelContext) => boolean;
  readonly render: (context: MeetingPanelContext) => unknown;
}
export interface MeetingHeaderActionContext {
  readonly meeting: MeetingProjection;
  readonly transition: MeetingLifecycleTransition;
  readonly notice: NoticeEvidenceReadModel;
}
export interface MeetingHeaderActionDescriptor {
  readonly id: string;
  readonly order: number;
  readonly isAvailable: (context: MeetingHeaderActionContext) => boolean;
  readonly render: (context: MeetingHeaderActionContext) => unknown;
}
export interface MeetingListProjection {
  readonly meetings: readonly MeetingProjection[];
  readonly scope: 'firm' | 'household' | 'owner';
}
export interface MeetingListContext {
  readonly client: ClientBoundary | null;
  readonly list: MeetingListProjection;
  readonly openMeeting: (ref: MeetingRef) => Promise<void>;
}
export interface MeetingListDescriptor {
  readonly id: string;
  readonly order: number;
  readonly isAvailable: (context: MeetingListContext) => boolean;
  readonly render: (context: MeetingListContext) => unknown;
}
export interface MeetingListToolContext {
  readonly list: MeetingListProjection;
  readonly currentMemberId?: string;
  readonly setOwnerFilter: (ownerId: string | null) => void;
}
export interface MeetingListToolDescriptor {
  readonly id: string;
  readonly order: number;
  readonly isAvailable: (context: MeetingListToolContext) => boolean;
  readonly render: (context: MeetingListToolContext) => unknown;
}
export interface MeetingArtifactContext {
  readonly meeting: MeetingProjection;
  readonly append: (artifact: MeetingArtifactInput) => Promise<MeetingArtifact>;
  readonly read: MeetingArtifactReader;
}
export interface MeetingArtifactDescriptor {
  readonly id: string;
  readonly order: number;
  readonly isAvailable: (context: MeetingArtifactContext) => boolean;
  readonly render: (context: MeetingArtifactContext) => unknown;
}
export interface NoticeEvidenceProviderContext {
  readonly meeting: MeetingProjection;
  readonly appendNoticeEvidence: (
    input: NoticeEvidenceInput
  ) => Promise<MeetingArtifact>;
}
export interface NoticeEvidenceProviderDescriptor {
  readonly id: string;
  readonly order: number;
  readonly isAvailable: (context: NoticeEvidenceProviderContext) => boolean;
  readonly provide: (context: NoticeEvidenceProviderContext) => unknown;
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
export interface MeetingIntelligenceSettingsModule {
  readonly id: 'meeting-intelligence-settings';
  readonly order: number;
  readonly isAvailable: () => boolean;
  readonly settings: () => MeetingIntelligenceSettingsProjection;
}
/** A contribution value only. The Settings registry remains owned by Settings. */
export const meetingIntelligenceSettingsModule: MeetingIntelligenceSettingsModule =
  {
    id: 'meeting-intelligence-settings',
    order: 3200,
    isAvailable: () => true,
    settings: () => ({
      keywordTrackingEnabled: false,
      clientSignalsEnabled: false,
      displayPreference: 'comfortable',
    }),
  };
export interface MeetingSignalsHouseholdSection {
  readonly id: 'meeting-signals';
  readonly order: number;
  readonly isAvailable: (client: ClientBoundary) => boolean;
  readonly render: (client: ClientBoundary) => unknown;
}
/** A contribution value only. The household-section registry remains CRM-clients owned. */
export const meetingSignalsHouseholdSection: MeetingSignalsHouseholdSection = {
  id: 'meeting-signals',
  order: 3200,
  isAvailable: () => true,
  render: () => null,
};

type LivePort = Pick<
  ReturnType<typeof useLiveCrmRecords>,
  'records' | 'workspaceRoot' | 'error' | 'save'
> & {
  reloadRecords(): Promise<readonly LiveCrmRecord[] | undefined>;
};

const now = () => new Date().toISOString();
const recordId = (prefix: string) => `${prefix}-${crypto.randomUUID()}`;
const nonEmpty = (value: unknown, name: string): string => {
  if (typeof value !== 'string' || !value.trim())
    throw new Error(`${name} is required.`);
  return value.trim();
};
const timestamp = (value: unknown, name: string): string => {
  const parsed = nonEmpty(value, name);
  if (!Number.isFinite(Date.parse(parsed)))
    throw new Error(`${name} must be an ISO timestamp.`);
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

export function validateMeetingDraft(
  input: CreateMeetingDraft
): CreateMeetingDraft & { readonly references: readonly string[] } {
  const start = nonEmpty(input.scheduledStartUtc, 'Meeting start');
  const end = nonEmpty(input.scheduledEndUtc, 'Meeting end');
  if (!Number.isFinite(Date.parse(start)) || !Number.isFinite(Date.parse(end)))
    throw new Error('Meeting times must be ISO timestamps.');
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
  return {
    id: nonEmpty(record.id, 'Meeting ID'),
    kind: 'meeting',
    ...draft,
    state: state as MeetingState,
    createdAt: nonEmpty(record.createdAt, 'Created timestamp'),
    updatedAt: nonEmpty(record.updatedAt, 'Updated timestamp'),
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
async function saveAndReload(
  port: LivePort,
  record: LiveCrmRecord
): Promise<LiveCrmRecord> {
  await port.save(record);
  const fresh = await port.reloadRecords();
  const saved = fresh?.find((candidate) => candidate.id === record.id);
  if (!saved)
    throw new Error(
      'The saved meeting was missing after its canonical reload.'
    );
  return saved;
}

export function createMeetingStore(port: LivePort): MeetingStore {
  const raw = port.records.filter((record) => record.kind === 'meeting');
  const list = meetingRecords(raw).sort((left, right) =>
    left.scheduledStartUtc.localeCompare(right.scheduledStartUtc)
  );
  const getRaw = (id: string) => raw.find((record) => record.id === id);
  return {
    list,
    error: port.error,
    get: (id) =>
      Promise.resolve().then(() => {
        requireAvailable(port);
        const record = getRaw(id);
        return record ? projectMeetingRecord(record) : undefined;
      }),
    createDraft: async (input) => {
      requireAvailable(port);
      const draft = validateMeetingDraft(input);
      const savedAt = now();
      const record: LiveCrmRecord = {
        id: recordId('meeting'),
        kind: 'meeting',
        matterId: draft.matterId,
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
      return projectMeetingRecord(await saveAndReload(port, record));
    },
    update: async (id, patch) => {
      requireAvailable(port);
      const rawRecord = getRaw(id);
      if (!rawRecord) throw new Error('That meeting no longer exists.');
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
        references: patch.references ?? current.references,
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
      return projectMeetingRecord(await saveAndReload(port, next));
    },
    transition: async (id, transition) => {
      requireAvailable(port);
      const rawRecord = getRaw(id);
      if (!rawRecord) throw new Error('That meeting no longer exists.');
      const current = projectMeetingRecord(rawRecord);
      const valid = validateMeetingLifecycleTransition({
        ...transition,
        from: current.state,
      });
      return projectMeetingRecord(
        await saveAndReload(port, {
          ...rawRecord,
          state: valid.to,
          updatedAt: valid.at,
        })
      );
    },
  };
}

function projectArtifact(record: LiveCrmRecord): MeetingArtifact {
  if (record.kind !== 'meeting_artifact')
    throw new Error('That record is not a meeting artifact.');
  const kind = nonEmpty(
    record['artifactKind'],
    'Artifact kind'
  ) as MeetingArtifactKind;
  const allowed: readonly MeetingArtifactKind[] = [
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
  if (!allowed.includes(kind))
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
  const approvedAt =
    typeof record['approvedAt'] === 'string' ? record['approvedAt'] : undefined;
  return {
    id: nonEmpty(record.id, 'Artifact ID'),
    meetingId: nonEmpty(record['meetingId'], 'Meeting ID'),
    kind,
    schemaVersion,
    state: approvedAt ? 'approved' : 'produced',
    producedAt: timestamp(record['producedAt'], 'Produced timestamp'),
    ...(approvedAt
      ? { approvedAt: timestamp(approvedAt, 'Approval timestamp') }
      : {}),
    sourceRefs: strings(record['sourceRefs'], 'Artifact source references'),
    provenance: provenance as MeetingArtifact['provenance'],
    payload: (record['payload'] && typeof record['payload'] === 'object'
      ? record['payload']
      : {}) as Record<string, unknown>,
    createdAt: nonEmpty(record.createdAt, 'Created timestamp'),
  };
}

export function createMeetingArtifactStore(
  port: LivePort
): MeetingArtifactStore {
  const artifacts = port.records
    .filter((record) => record.kind === 'meeting_artifact')
    .flatMap((record) => {
      try {
        return [projectArtifact(record)];
      } catch {
        return [];
      }
    });
  const reader: MeetingArtifactReader = {
    listForMeeting: (meeting, kinds) =>
      artifacts.filter(
        (artifact) =>
          artifact.meetingId === meeting &&
          (!kinds || kinds.includes(artifact.kind))
      ),
    get: (id) => artifacts.find((artifact) => artifact.id === id) ?? null,
  };
  return {
    ...reader,
    append: async (input) => {
      requireAvailable(port);
      if (!Number.isInteger(input.schemaVersion) || input.schemaVersion < 1)
        throw new Error('Artifact schema version must be a positive integer.');
      if (
        ![
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
        ].includes(input.kind)
      )
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
      const savedAt = now();
      const parent = port.records.find(
        (candidate) =>
          candidate.id === input.meetingId && candidate.kind === 'meeting'
      );
      if (!parent)
        throw new Error('Artifacts must belong to an existing meeting.');
      const record: LiveCrmRecord = {
        id: recordId('meeting-artifact'),
        kind: 'meeting_artifact',
        matterId: parent.matterId as string,
        createdAt: savedAt,
        updatedAt: savedAt,
        meetingId: nonEmpty(input.meetingId, 'Meeting ID'),
        artifactKind: input.kind,
        schemaVersion: input.schemaVersion,
        producedAt,
        ...(approvedAt ? { approvedAt } : {}),
        sourceRefs: strings(input.sourceRefs, 'Artifact source references'),
        provenance: input.provenance,
        payload: input.payload,
      };
      return projectArtifact(await saveAndReload(port, record));
    },
  };
}

export function approvedMeetingArtifacts(
  reader: MeetingArtifactReader
): ApprovedMeetingArtifactReader {
  return {
    listApproved: (meeting, kinds) =>
      reader
        .listForMeeting(meeting, kinds)
        .filter((artifact) => artifact.state === 'approved'),
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

function registry<T extends { readonly id: string; readonly order: number }>(
  name: string,
  descriptors: readonly T[],
  available: (descriptor: T) => boolean
): readonly T[] {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim() || ids.has(descriptor.id))
      throw new Error(`[${name}] descriptor IDs must be unique.`);
    if (!Number.isFinite(descriptor.order))
      throw new Error(`[${name}] descriptor order must be finite.`);
    ids.add(descriptor.id);
    if (!available(descriptor))
      throw new Error(`[${name}] descriptor is malformed: ${descriptor.id}`);
  }
  return [...descriptors].sort((left, right) => left.order - right.order);
}
const isFunction = (value: unknown): value is (...args: never[]) => unknown =>
  typeof value === 'function';
export function composeMeetingPanelRegistry(
  descriptors: readonly MeetingPanelDescriptor[]
) {
  return registry(
    'meetingPanelRegistry',
    descriptors,
    (d) => isFunction(d.isAvailable) && isFunction(d.render)
  );
}
export function composeMeetingHeaderActionRegistry(
  descriptors: readonly MeetingHeaderActionDescriptor[]
) {
  return registry(
    'meetingHeaderActionRegistry',
    descriptors,
    (d) => isFunction(d.isAvailable) && isFunction(d.render)
  );
}
export function composeMeetingInsightRegistry(
  descriptors: readonly MeetingInsightDescriptor[]
) {
  return registry(
    'meetingInsightRegistry',
    descriptors,
    (d) =>
      Number.isInteger(d.version) &&
      d.version > 0 &&
      Array.isArray(d.artifactPrerequisites) &&
      isFunction(d.isAvailable) &&
      isFunction(d.renderMeeting) &&
      isFunction(d.renderClientSummary)
  );
}
export function composeMeetingListRegistry(
  descriptors: readonly MeetingListDescriptor[]
) {
  return registry(
    'meetingListRegistry',
    descriptors,
    (d) => isFunction(d.isAvailable) && isFunction(d.render)
  );
}
export function composeMeetingListToolRegistry(
  descriptors: readonly MeetingListToolDescriptor[]
) {
  return registry(
    'meetingListToolRegistry',
    descriptors,
    (d) => isFunction(d.isAvailable) && isFunction(d.render)
  );
}
export function composeMeetingArtifactRegistry(
  descriptors: readonly MeetingArtifactDescriptor[]
) {
  return registry(
    'meetingArtifactRegistry',
    descriptors,
    (d) => isFunction(d.isAvailable) && isFunction(d.render)
  );
}
export function composeNoticeEvidenceProviderRegistry(
  descriptors: readonly NoticeEvidenceProviderDescriptor[]
) {
  return registry(
    'noticeEvidenceProviderRegistry',
    descriptors,
    (d) => isFunction(d.isAvailable) && isFunction(d.provide)
  );
}
export const meetingPanelRegistry = composeMeetingPanelRegistry([]);
export const meetingHeaderActionRegistry = composeMeetingHeaderActionRegistry(
  []
);
export const meetingInsightRegistry = composeMeetingInsightRegistry([]);
export const meetingListRegistry = composeMeetingListRegistry([]);
export const meetingListToolRegistry = composeMeetingListToolRegistry([]);
export const meetingArtifactRegistry = composeMeetingArtifactRegistry([]);
export const noticeEvidenceProviderRegistry =
  composeNoticeEvidenceProviderRegistry([]);
export function availableMeetingPanels(
  context: MeetingPanelContext,
  descriptors = meetingPanelRegistry
) {
  return descriptors.filter((descriptor) => descriptor.isAvailable(context));
}
export function availableMeetingHeaderActions(
  context: MeetingHeaderActionContext,
  descriptors = meetingHeaderActionRegistry
) {
  return descriptors.filter((descriptor) => descriptor.isAvailable(context));
}
export function availableMeetingInsights(
  context: MeetingInsightContext,
  descriptors = meetingInsightRegistry
) {
  return descriptors.filter((descriptor) => descriptor.isAvailable(context));
}
export function availableMeetingLists(
  context: MeetingListContext,
  descriptors = meetingListRegistry
) {
  return descriptors.filter((descriptor) => descriptor.isAvailable(context));
}
export function availableMeetingListTools(
  context: MeetingListToolContext,
  descriptors = meetingListToolRegistry
) {
  return descriptors.filter((descriptor) => descriptor.isAvailable(context));
}
export function availableMeetingArtifactContributions(
  context: MeetingArtifactContext,
  descriptors = meetingArtifactRegistry
) {
  return descriptors.filter((descriptor) => descriptor.isAvailable(context));
}
export function availableNoticeEvidenceProviders(
  context: NoticeEvidenceProviderContext,
  descriptors = noticeEvidenceProviderRegistry
) {
  return descriptors.filter((descriptor) => descriptor.isAvailable(context));
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
  householdRef: string
): readonly MeetingProjection[] {
  return store.list.filter((meeting) => meeting.householdRef === householdRef);
}
export function listPrepForHousehold(
  store: MeetingStore,
  householdRef: string
): readonly MeetingProjection[] {
  return listForHousehold(store, householdRef).filter(
    (meeting) => meeting.state === 'draft' || meeting.state === 'scheduled'
  );
}
export function createMeetingSourceAdapter(
  store: MeetingStore,
  artifacts: ApprovedMeetingArtifactReader
): MeetingSourceAdapter {
  return {
    listApprovedForClient: (client) =>
      Promise.resolve().then(() =>
        store.list
          .filter(
            (meeting) =>
              meeting.householdRef === client.householdRef &&
              meeting.matterId === client.matterId
          )
          .flatMap((meeting) =>
            artifacts
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
      ),
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
    return {
      id,
      label: nonEmpty(entry.label, 'Meeting template label'),
      artifactKinds: [...entry.artifactKinds],
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

function singletonRecord(
  port: LivePort,
  kind: string
): LiveCrmRecord | undefined {
  return port.records.find((record) => record.kind === kind);
}
async function saveSingletonRecord(
  port: LivePort,
  kind: string,
  values: Readonly<Record<string, unknown>>
): Promise<LiveCrmRecord> {
  requireAvailable(port);
  const current = singletonRecord(port, kind);
  const savedAt = now();
  return saveAndReload(port, {
    ...(current ?? {}),
    id: current?.id ?? recordId(kind),
    kind,
    matterId: current?.matterId ?? 'firm_home',
    createdAt: current?.createdAt ?? savedAt,
    updatedAt: savedAt,
    ...values,
  });
}
export function createMeetingTypeStore(port: LivePort): MeetingTypeStore {
  const current = singletonRecord(port, 'meeting_type_catalogue');
  const types =
    current && Array.isArray(current['types'])
      ? validateMeetingTypeCatalogue(
          current['types'] as MeetingTypeDefinition[]
        )
      : [];
  return {
    types,
    error: port.error,
    get: () =>
      Promise.resolve().then(() => {
        requireAvailable(port);
        return types;
      }),
    save: (next) =>
      Promise.resolve().then(async () => {
        const validated = validateMeetingTypeCatalogue(next);
        const saved = await saveSingletonRecord(
          port,
          'meeting_type_catalogue',
          { types: validated }
        );
        return validateMeetingTypeCatalogue(
          saved['types'] as MeetingTypeDefinition[]
        );
      }),
  };
}
export function createMeetingTemplateStore(
  port: LivePort
): MeetingTemplateStore {
  const current = singletonRecord(port, 'meeting_template_catalogue');
  const templates =
    current && Array.isArray(current['templates'])
      ? validateMeetingTemplateCatalogue(
          current['templates'] as MeetingTemplateProjection[]
        )
      : [];
  return {
    templates,
    error: port.error,
    get: () =>
      Promise.resolve().then(() => {
        requireAvailable(port);
        return templates;
      }),
    save: (next) =>
      Promise.resolve().then(async () => {
        const validated = validateMeetingTemplateCatalogue(next);
        const saved = await saveSingletonRecord(
          port,
          'meeting_template_catalogue',
          { templates: validated }
        );
        return validateMeetingTemplateCatalogue(
          saved['templates'] as MeetingTemplateProjection[]
        );
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
  const current = singletonRecord(port, 'meeting_intelligence_settings');
  const settings = current
    ? validateMeetingIntelligenceSettings({
        keywordTrackingEnabled: current['keywordTrackingEnabled'] === true,
        clientSignalsEnabled: current['clientSignalsEnabled'] === true,
        displayPreference:
          current['displayPreference'] === 'compact'
            ? 'compact'
            : 'comfortable',
      })
    : defaultMeetingIntelligenceSettings;
  return {
    settings,
    error: port.error,
    get: () =>
      Promise.resolve().then(() => {
        requireAvailable(port);
        return settings;
      }),
    save: (next) =>
      Promise.resolve().then(async () => {
        const validated = validateMeetingIntelligenceSettings(next);
        const saved = await saveSingletonRecord(
          port,
          'meeting_intelligence_settings',
          validated as unknown as Readonly<Record<string, unknown>>
        );
        return validateMeetingIntelligenceSettings({
          keywordTrackingEnabled: saved['keywordTrackingEnabled'] === true,
          clientSignalsEnabled: saved['clientSignalsEnabled'] === true,
          displayPreference:
            saved['displayPreference'] === 'compact'
              ? 'compact'
              : 'comfortable',
        });
      }),
  };
}

/** Reactive adapter over the canonical encrypted live-record route. */
export function useMeetingFoundationStore(): MeetingStore {
  const live = useLiveCrmRecords();
  return createMeetingStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}
export function useMeetingArtifactStore(): MeetingArtifactStore {
  const live = useLiveCrmRecords();
  return createMeetingArtifactStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: () => loadLiveCrmRecords(live.workspaceRoot),
  });
}
