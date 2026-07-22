import {
  loadVisibleCrmRecordsForViewer,
  useLiveCrmRecords,
} from '@/platform/crm/useLiveCrmRecords';
import { getMatters } from '@/platform/matter/matterStore';
import {
  issueSharedClientSelection,
  readSelectionOperationDecision,
  resolveCanonicalHouseholdClassification,
  useSelectionOperationDecision,
  type SealedClientBoundary,
} from '@/platform/client-context';
import { getActiveWorkspaceService } from '@/platform/fs/activeWorkspaceService';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useFirmStore } from '@/platform/firm/firmStore';
import {
  MEETING_VISIBILITY_LEGACY_VALUE,
  MEETING_VISIBILITY_LINEAGE_FIELD,
} from '@/platform/crm/meetingVisibilityMigration';
import type { Matter } from '@/platform/types/matter';
import {
  validateMeetingVisibilityPolicy,
  type MeetingVisibilityPolicy,
} from '@/platform/meeting-visibility';

export { validateMeetingVisibilityPolicy };
export type { MeetingVisibilityPolicy };

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

const MEETINGS_SELECTION_REQUEST = {
  operationClass: 'client-scoped',
  allowAllMatters: false,
  requireFollowerAgreement: true,
} as const;

const MEETINGS_FIRM_READ_SELECTION_REQUEST = {
  operationClass: 'matter-scoped',
  allowAllMatters: true,
  requireFollowerAgreement: true,
} as const;

function readAuthoritativeMeetingSelection() {
  return readSelectionOperationDecision(MEETINGS_SELECTION_REQUEST);
}

/** Runtime provenance for pairs minted from the live selection authority. */
const liveMeetingClientBoundaries = new WeakSet();

function isCompleteTrimmedString(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value === value.trim()
  );
}

/**
 * Runtime counterpart to the erased TypeScript brand. Shape alone is never
 * authority: the exact object must have been minted from the live selection.
 */
export function verifyLiveMeetingClientBoundary(
  value: SealedMeetingClientBoundary | null | undefined
): value is SealedMeetingClientBoundary {
  if (!value || typeof value !== 'object') return false;
  return (
    liveMeetingClientBoundaries.has(value) &&
    isCompleteTrimmedString(value.householdRef) &&
    isCompleteTrimmedString(value.matterId)
  );
}

function boundaryFromSelection(
  selection: ReturnType<typeof readAuthoritativeMeetingSelection>
): SealedMeetingClientBoundary | null {
  if (selection.kind !== 'matter' || !selection.client) return null;
  const boundary = Object.freeze({
    householdRef: selection.client.householdId,
    matterId: selection.matter.id,
    displayName: selection.client.displayName,
  }) as SealedMeetingClientBoundary;
  if (
    !isCompleteTrimmedString(boundary.householdRef) ||
    !isCompleteTrimmedString(boundary.matterId)
  ) {
    return null;
  }
  liveMeetingClientBoundaries.add(boundary);
  return boundary;
}

/** Read the live, authority-proven household + matter pair. */
export function readActiveMeetingClientBoundary(): SealedMeetingClientBoundary | null {
  const selection = readAuthoritativeMeetingSelection();
  return boundaryFromSelection(selection);
}

function readAuthoritativeMeetingSelectionError(): string | null {
  const selection = readAuthoritativeMeetingSelection();
  return selection.kind === 'refused' ? selection.message : null;
}

function readAuthoritativeFirmMeetingSelectionError(): string | null {
  const selection = readSelectionOperationDecision(
    MEETINGS_FIRM_READ_SELECTION_REQUEST
  );
  return selection.kind === 'refused' ? selection.message : null;
}

/** Deliberately small: a display name is never authorization. */
export interface ClientBoundary {
  readonly householdRef: string;
  readonly matterId: string;
  readonly displayName?: string;
}

declare const sealedMeetingClientBoundaryBrand: unique symbol;

/**
 * The selected-client store capability. Both fields are required as one typed
 * value, so `{ matterId }` and optional-pair call shapes fail typechecking. The
 * production resolver above derives and freezes both values from live authority.
 */
export interface SealedMeetingClientBoundary extends Readonly<ClientBoundary> {
  /** Compile-time seal: ordinary household/matter objects are not store authority. */
  readonly [sealedMeetingClientBoundaryBrand]: true;
}

/** Reactive companion to {@link readActiveMeetingClientBoundary}. */
export function useActiveMeetingClientBoundary(): SealedMeetingClientBoundary | null {
  const selection = useSelectionOperationDecision(MEETINGS_SELECTION_REQUEST);
  return boundaryFromSelection(selection);
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

/** Un-forgeable brand key: a feature cannot manufacture status truth. */
declare const legacyMeetingLinkStatusBrand: unique symbol;
/** Only this reader mints values that may be trusted as link status. */
const sealedLegacyMeetingLinkStatuses = new WeakSet();

/**
 * The small, read-only answer for one visible legacy meeting row. `meetingRef`
 * is a routing reference only; it is not a meeting record, open target, or
 * permission grant.
 */
export type LegacyMeetingLinkStatus =
  | ({
      readonly kind: 'linked';
      readonly meetingRef: MeetingRef;
    } & {
      readonly [legacyMeetingLinkStatusBrand]: true;
    })
  | ({ readonly kind: 'folder-only' } & {
      readonly [legacyMeetingLinkStatusBrand]: true;
    });

/**
 * Surface-blind navigation authority for one firm-wide meeting reference.
 *
 * The four dispositions are deliberately compile-distinct. `folder-only`
 * means the canonical meeting is known but has no durable legacy-folder link.
 * `unavailable` means the meeting is known but its current link or client
 * authority cannot be used. `unknown` is an authority refusal, not an empty or
 * unavailable state; callers must surface that refusal and must not route.
 * Only `linked` carries a born-sealed value accepted by the sanctioned client
 * selection doorway.
 */
export type MeetingNavigationResolution =
  | {
      readonly kind: 'linked';
      readonly clientBoundary: SealedClientBoundary;
    }
  | { readonly kind: 'folder-only' }
  | { readonly kind: 'unavailable' }
  | { readonly kind: 'unknown'; readonly disposition: 'refuse' };

export interface LegacyMeetingLinkStatusReader {
  /** Read one status from authoritative canonical link keys. */
  read(legacy: LegacyMeetingLinkInput): Promise<LegacyMeetingLinkStatus>;
  /** Read one authoritative snapshot for a visible list, never one reload per row. */
  readMany(
    legacy: readonly LegacyMeetingLinkInput[]
  ): Promise<ReadonlyMap<string, LegacyMeetingLinkStatus>>;
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
}

/** Internal extension so existing MeetingStore test doubles stay source-compatible. */
interface LinkableMeetingStore extends MeetingStore {
  /**
   * One-time bridge to a legacy folder, after the complete anchor check. The
   * matter set and workspace filesystem are DERIVED from trusted platform
   * sources inside the store, never supplied by the caller.
   */
  linkLegacy(
    id: MeetingRef,
    input: LegacyMeetingLinkInput
  ): Promise<MeetingRecord>;
}

/**
 * The minimal filesystem surface needed to prove a legacy folder is local.
 * This is NEVER accepted from a feature consumer: it is derived, at call time,
 * from the trusted active `WorkspaceService` (which satisfies this shape). The
 * interface exists only so the derivation is typed.
 */
export interface LegacyMeetingWorkspace {
  getRootPath(): string | null;
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  isSymlink?(path: string): Promise<boolean>;
  resolveSymlink?(path: string): Promise<string>;
}

/**
 * The trusted authority a link/open decision is resolved against. It is DERIVED
 * inside this module from the platform matter store and the active workspace
 * service — never handed in by a caller. A feature consumer therefore cannot
 * present its own matter set, its own filesystem, or its own workspace identity
 * to vouch for a link. `matters` and `workspace` are owner-controlled truth.
 */
interface MeetingLinkAuthority {
  readonly workspaceRoot: string;
  readonly workspace: LegacyMeetingWorkspace;
  readonly matters: readonly Matter[];
}

/** Trusted active workspace derivation shared by link and status reads. */
function deriveActiveMeetingWorkspace(): Pick<
  MeetingLinkAuthority,
  'workspaceRoot' | 'workspace'
> {
  const workspace = getActiveWorkspaceService();
  if (!workspace)
    throw new Error(
      'A legacy meeting link requires an open workspace on this device.'
    );
  const workspaceRoot = workspace.getRootPath();
  if (!workspaceRoot)
    throw new Error(
      'A legacy meeting link requires an open workspace on this device.'
    );
  return {
    workspaceRoot: normalizedAbsolutePath(workspaceRoot, 'Open workspace root'),
    workspace,
  };
}

/**
 * Derive the trusted authority for a link/open decision. Fails closed (throws)
 * when no workspace is open, because containment cannot be proven without the
 * real workspace root and filesystem.
 */
function deriveMeetingLinkAuthority(): MeetingLinkAuthority {
  const { workspace, workspaceRoot } = deriveActiveMeetingWorkspace();
  return {
    workspaceRoot,
    workspace,
    matters: getMatters(),
  };
}

/**
 * A resolved target for the legacy detail host. It is UN-FORGEABLE: the brand
 * key cannot be produced by a consumer, and every genuine target is registered
 * in a module-private seal (see `resolveMeetingOpenTarget` /
 * `verifyMeetingOpenTarget`). A host that receives one of these has proof the
 * canonical projection + client boundary were resolved by the trusted path, so
 * it must NOT reconstruct identity from a folder path.
 */
/** Un-forgeable brand key: a consumer cannot produce this unique symbol. */
declare const meetingOpenTargetBrand: unique symbol;
/** Only the trusted resolution path adds a target here; forgeries are absent. */
const sealedOpenTargets = new WeakSet();

export interface MeetingOpenTarget {
  readonly kind: 'linked-legacy-meeting';
  readonly meeting: MeetingProjection;
  readonly client: SealedMeetingClientBoundary;
  readonly legacyLink: LegacyMeetingLink;
  /** Absolute local folder path, checked immediately before opening. */
  readonly meetingDir: string;
  /** Un-forgeable brand: only the trusted resolver can set this. */
  readonly [meetingOpenTargetBrand]: true;
}

/**
 * Recursively freeze an authority object and every object it reaches, so a
 * caller who legitimately holds it CANNOT tamper it after the trusted resolver
 * produced it. Provenance (the module-private seal) proves the object was minted
 * by the trusted path; the deep freeze proves it has not been mutated since.
 * Together they make a sealed authority object both UN-FORGEABLE and
 * UN-TAMPERABLE. (Modules run in strict mode, so a write to a frozen field
 * throws at the point of tampering rather than being silently dropped.)
 */
function deepFreezeAuthority<T>(value: T): T {
  if (value !== null && typeof value === 'object' && !Object.isFrozen(value)) {
    Object.freeze(value);
    for (const key of Object.getOwnPropertyNames(value)) {
      deepFreezeAuthority((value as Record<string, unknown>)[key]);
    }
  }
  return value;
}

function sealMeetingOpenTarget(
  target: Omit<MeetingOpenTarget, typeof meetingOpenTargetBrand>
): MeetingOpenTarget {
  // Freeze BEFORE registering the seal: a target is un-tamperable from the first
  // instant it is provable-genuine, so there is no window where a held target is
  // both sealed and mutable.
  const sealed = deepFreezeAuthority(target) as MeetingOpenTarget;
  sealedOpenTargets.add(sealed);
  return sealed;
}

/**
 * The ONLY trusted proof a `MeetingOpenTarget` is genuine. A hand-constructed
 * structural object (even one cast to the branded type) is not in the seal, so
 * this returns false and the host must refuse to treat it as authority.
 */
export function verifyMeetingOpenTarget(
  target: MeetingOpenTarget | null | undefined
): boolean {
  return !!target && sealedOpenTargets.has(target);
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

/**
 * An owner-issued, un-forgeable capability to enumerate the firm meeting
 * directory. Its allowed-matter set is DERIVED from the trusted matter store by
 * `grantFirmMeetingDirectoryAccess`; a consumer cannot hand-construct an
 * always-true authorization. The brand key is un-producible and every genuine
 * grant is registered in a module-private seal.
 */
/** Un-forgeable brand key for a firm directory grant. */
declare const firmGrantBrand: unique symbol;
const sealedFirmGrants = new WeakSet();

export interface FirmMeetingDirectoryGrant {
  /** The exact canonical matters this grant permits, derived from owner truth. */
  readonly allowedMatterIds: readonly string[];
  /** Un-forgeable brand: only the trusted mint can set this. */
  readonly [firmGrantBrand]: true;
}

declare const firmDirectoryReadyBrand: unique symbol;
const sealedFirmDirectoryReadyResults = new WeakSet();

export type FirmMeetingDirectoryReadResult =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly meetings: readonly MeetingProjection[];
      readonly [firmDirectoryReadyBrand]: true;
    }
  | {
      readonly kind: 'refused';
      readonly reason: 'authority-refused' | 'selection-blocked';
      readonly message: string;
    }
  | {
      readonly kind: 'error';
      readonly message: string;
    };

export type FirmMeetingDirectoryLookupResult =
  | Exclude<FirmMeetingDirectoryReadResult, { readonly kind: 'ready' }>
  | {
      readonly kind: 'ready';
      readonly meeting: MeetingProjection | null;
      readonly [firmDirectoryReadyBrand]: true;
    };

export const FIRM_MEETING_DIRECTORY_LOADING: FirmMeetingDirectoryReadResult =
  Object.freeze({ kind: 'loading' });

export interface FirmMeetingDirectoryReader {
  list(): Promise<FirmMeetingDirectoryReadResult>;
  get(id: MeetingRef): Promise<FirmMeetingDirectoryLookupResult>;
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

export type ReviewNeededMeetingArtifactsReadResult =
  | {
      readonly kind: 'ready';
      readonly artifacts: readonly ReviewNeededMeetingArtifact[];
    }
  | {
      readonly kind: 'refused';
      readonly reason:
        | 'authority-refused'
        | 'selection-blocked'
        | 'records-unavailable';
      readonly message: string;
    };

export type MeetingArtifactReviewArchiveState = 'active' | 'archived';

/**
 * A produced, unapproved artifact plus its independent Actions-inbox state.
 * Archiving does not approve or mutate the produced artifact; it only removes
 * the item from attention until an advisor restores it.
 */
export interface ReviewNeededMeetingArtifact extends MeetingArtifact {
  readonly reviewArchiveState: MeetingArtifactReviewArchiveState;
  readonly reviewArchiveChangedAt?: string;
}

export type MeetingArtifactReviewArchiveTransition =
  | {
      readonly from: 'active';
      readonly to: 'archived';
      readonly at: string;
    }
  | {
      readonly from: 'archived';
      readonly to: 'active';
      readonly at: string;
    };

/** Firm mode is explicit; selected mode additionally requires the sealed pair. */
export type MeetingArtifactReviewArchiveScope =
  | { readonly kind: 'whole-firm' }
  | {
      readonly kind: 'selected-client';
      readonly client: SealedMeetingClientBoundary;
    };

export type MeetingArtifactReviewArchiveTransitionResult =
  | {
      readonly kind: 'ready';
      readonly artifact: ReviewNeededMeetingArtifact;
    }
  | {
      readonly kind: 'refused';
      readonly reason:
        | 'authority-refused'
        | 'selection-blocked'
        | 'client-mismatch'
        | 'stale-transition';
      readonly message: string;
    }
  | { readonly kind: 'error'; readonly message: string };

/**
 * A sealed, firm-bounded view of produced artifacts that still need review.
 * Listing is read-only. The one mutation is an explicit, reversible archive
 * transition that never approves or changes the produced artifact. A
 * successful read may truthfully contain zero artifacts; refusal is separate
 * and must be surfaced rather than rendered as emptiness.
 */
export interface ReviewNeededMeetingArtifactReader {
  readonly kinds: readonly MeetingArtifactKind[];
  list(): Promise<ReviewNeededMeetingArtifactsReadResult>;
  transitionArchive(
    id: MeetingArtifactRef,
    scope: MeetingArtifactReviewArchiveScope,
    transition: MeetingArtifactReviewArchiveTransition
  ): Promise<MeetingArtifactReviewArchiveTransitionResult>;
}

export interface MeetingArtifactStore {
  readerFor(
    meetings: MeetingStore,
    client: SealedMeetingClientBoundary,
    requirements: readonly MeetingArtifactRequirement[]
  ): MeetingArtifactReader;
  append(input: MeetingArtifactInput): Promise<MeetingArtifact>;
  approve(
    id: MeetingArtifactRef,
    transition: MeetingArtifactTransition
  ): Promise<MeetingArtifact>;
}

/** The canonical artifact store plus its sealed, firm-wide read-only doorway. */
export interface FirmReadableMeetingArtifactStore extends MeetingArtifactStore {
  reviewNeededForFirm(
    grant: FirmMeetingDirectoryGrant,
    requirements: readonly MeetingArtifactRequirement[]
  ): ReviewNeededMeetingArtifactReader;
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
  /** Legacy selected-client helper only; firm rows use MeetingSurfaceProjectionResult. */
  readonly scope: 'household' | 'owner';
}

export interface MeetingIntelligenceSettingsProjection {
  readonly keywordTrackingEnabled: boolean;
  readonly clientSignalsEnabled: boolean;
  readonly displayPreference: 'compact' | 'comfortable';
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
export interface MeetingKeywordCatalogueStore {
  readonly terms: readonly string[];
  readonly error: string | null;
  get(): Promise<readonly string[]>;
  save(terms: readonly string[]): Promise<readonly string[]>;
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
    client: SealedMeetingClientBoundary
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
  /** Optional only for generic ports; firm readers refuse when it is absent. */
  readonly getFirmSelectionError?: () => string | null;
  reloadRecords(): Promise<readonly LiveCrmRecord[] | undefined>;
};

/**
 * The port required to build a CLIENT-SCOPED store (`createMeetingStore`,
 * `createMeetingArtifactStore`). `getActiveClientBoundary` is MANDATORY and
 * returns one branded household + matter pair. A matter-only or optional-pair
 * store shape is a compile error, not a silent leak.
 *
 * `getActiveClientBoundary` MUST resolve the LIVE authoritative selection at call
 * time (it is re-read at every operation). The production adapter uses the
 * four-arm selection reader and treats follower disagreement only as refusal.
 * Passing a value captured once (a snapshot) reintroduces the stale-client leak.
 * A resolver returning `null` (no active client) FAILS CLOSED:
 * nothing is listed, read in full, mutated, appended, approved, or read through
 * a client-bound artifact reader. Both household and matter are checked; one
 * field alone is never ownership proof.
 */
export type ClientScopedLivePort = LivePort & {
  readonly getActiveClientBoundary: () =>
    | SealedMeetingClientBoundary
    | null;
  /** Production supplies the exact surfaced four-arm refusal. Test ports may omit it. */
  readonly getSelectionError?: () => string | null;
  /**
   * Production's firm-read tri-state. Unlike the client reader, explicit
   * all-matters is valid; blocked/unresolved still refuses and is surfaced.
   */
  readonly getFirmSelectionError?: () => string | null;
};

interface ClientScope {
  /** Read and validate the complete live pair, or fail closed. */
  current(): SealedMeetingClientBoundary | null;
  /** Require one complete pair while preserving the authority reader's refusal. */
  requireCurrent(subject: string): SealedMeetingClientBoundary;
  /** True only when both record fields equal the complete live pair. */
  owns(boundary: ClientBoundary): boolean;
  /** Throw when the record pair is not the active client's. */
  assertOwns(boundary: ClientBoundary, subject: string): SealedMeetingClientBoundary;
  /** Recheck a captured pair after asynchronous work. */
  assertStable(
    expected: SealedMeetingClientBoundary,
    subject: string
  ): SealedMeetingClientBoundary;
}

function sameClientBoundary(
  left: ClientBoundary | null | undefined,
  right: ClientBoundary | null | undefined
): boolean {
  return !!left && !!right &&
    left.householdRef === right.householdRef &&
    left.matterId === right.matterId;
}

function clientScope(port: ClientScopedLivePort): ClientScope {
  const scope: ClientScope = {
    current() {
      // Resolve the active client at CALL time, never construction time, so the
      // same held store fails closed the instant the active client changes.
      const current = port.getActiveClientBoundary();
      // No active client (null, or an invalid runtime value) → fail closed. There is no unscoped
      // escape hatch: a store without a live client resolver cannot be built.
      if (!verifyLiveMeetingClientBoundary(current)) return null;
      return current;
    },
    requireCurrent(subject) {
      const selectionError = port.getSelectionError?.();
      if (selectionError) throw new Error(selectionError);
      const current = scope.current();
      if (!current)
        throw new Error(
          `${subject} belongs to a different client than the active one.`
        );
      return current;
    },
    owns(boundary) {
      return sameClientBoundary(scope.current(), boundary);
    },
    assertOwns(boundary, subject) {
      const selectionError = port.getSelectionError?.();
      if (selectionError) throw new Error(selectionError);
      const current = scope.current();
      if (!sameClientBoundary(current, boundary))
        throw new Error(
          `${subject} belongs to a different client than the active one.`
        );
      return current as SealedMeetingClientBoundary;
    },
    assertStable(expected, subject) {
      const selectionError = port.getSelectionError?.();
      if (selectionError) throw new Error(selectionError);
      const current = scope.current();
      if (!sameClientBoundary(current, expected))
        throw new Error(`${subject} client changed while data reloaded.`);
      return current as SealedMeetingClientBoundary;
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
  if (typeof raw['meetingDir'] !== 'string')
    throw new Error('Legacy meeting link folder is invalid.');
  return {
    meetingDir: normalizedPath(raw['meetingDir'], 'Legacy meeting folder'),
    linkedAt: timestamp(raw['linkedAt'], 'Legacy meeting link timestamp'),
  };
}

/**
 * Resolve the EXACTLY-ONE local matter that owns a household, from the trusted
 * matter store. This is the same authority `clientBoundary.ts` uses: only the
 * saved `Matter.crmHouseholdKeys` link is accepted, and a missing OR ambiguous
 * mapping (zero or 2+ matters carry the key) fails closed by returning null. A
 * caller cannot narrow this — the candidate set is the whole trusted store.
 */
function resolveExactlyOneMatterForHousehold(
  householdRef: string,
  matters: readonly Matter[]
): Matter | null {
  const candidates = matters.filter((candidate) =>
    (candidate.crmHouseholdKeys ?? []).includes(householdRef)
  );
  return candidates.length === 1 ? (candidates[0] ?? null) : null;
}

const FOLDER_ONLY_MEETING_NAVIGATION = Object.freeze({
  kind: 'folder-only',
} as const);
const UNAVAILABLE_MEETING_NAVIGATION = Object.freeze({
  kind: 'unavailable',
} as const);
const UNKNOWN_MEETING_NAVIGATION_REFUSAL = Object.freeze({
  kind: 'unknown',
  disposition: 'refuse',
} as const);

function assertNeverHouseholdClassification(value: never): never {
  throw new Error(`Unreachable household classification arm: ${String(value)}`);
}

/**
 * Resolve fresh firm-wide navigation authority for one meeting reference.
 *
 * This reads the app-standard canonical collection once per call, then asks
 * the activated client classifier to re-derive the household/matter pair from
 * current data. No result, seal, classifier arm, or authority decision is
 * persisted. The resolver exposes no meeting payload and performs no client
 * selection; a linked result must still be awaited through
 * `requestSharedClientSelection` before a client-scoped meeting store is used.
 */
export async function resolveMeetingNavigation(
  ref: MeetingRef
): Promise<MeetingNavigationResolution> {
  const meetingRef = typeof ref === 'string' ? ref.trim() : '';
  if (!meetingRef) return UNKNOWN_MEETING_NAVIGATION_REFUSAL;

  let workspaceRoot: string;
  try {
    ({ workspaceRoot } = deriveActiveMeetingWorkspace());
  } catch {
    return UNAVAILABLE_MEETING_NAVIGATION;
  }

  let records: readonly LiveCrmRecord[];
  try {
    const viewerAtStart = useFirmStore.getState().session?.userId ?? null;
    records = await loadVisibleCrmRecordsForViewer(workspaceRoot, viewerAtStart);
    const viewerAfterLoad = useFirmStore.getState().session?.userId ?? null;
    if (viewerAfterLoad !== viewerAtStart) return UNKNOWN_MEETING_NAVIGATION_REFUSAL;
  } catch {
    return UNAVAILABLE_MEETING_NAVIGATION;
  }

  const matches = records.filter(
    (record) => record.kind === 'meeting' && record.id === meetingRef
  );
  if (matches.length !== 1) return UNKNOWN_MEETING_NAVIGATION_REFUSAL;
  const meeting = matches[0];
  if (!meeting) return UNKNOWN_MEETING_NAVIGATION_REFUSAL;

  if (meeting['legacyMeetingLink'] === undefined) {
    return FOLDER_ONLY_MEETING_NAVIGATION;
  }
  try {
    if (!projectLegacyLink(meeting['legacyMeetingLink'])) {
      return UNAVAILABLE_MEETING_NAVIGATION;
    }
  } catch {
    return UNAVAILABLE_MEETING_NAVIGATION;
  }

  const householdRef =
    typeof meeting['householdRef'] === 'string'
      ? meeting['householdRef'].trim()
      : '';
  const matterId =
    typeof meeting.matterId === 'string' ? meeting.matterId.trim() : '';
  if (!householdRef || !matterId) return UNKNOWN_MEETING_NAVIGATION_REFUSAL;

  const classification = resolveCanonicalHouseholdClassification({
    provider: 'wealthbox',
    householdId: householdRef,
  });
  switch (classification.kind) {
    case 'exactly-one-live': {
      if (classification.liveMatterIds[0] !== matterId) {
        return UNKNOWN_MEETING_NAVIGATION_REFUSAL;
      }
      if (!classification.client) return UNAVAILABLE_MEETING_NAVIGATION;
      try {
        return Object.freeze({
          kind: 'linked',
          clientBoundary: issueSharedClientSelection(classification.client),
        });
      } catch {
        return UNAVAILABLE_MEETING_NAVIGATION;
      }
    }
    case 'zero-live':
    case 'ambiguous-live':
    case 'archived-only':
    case 'invalid-household':
      return UNAVAILABLE_MEETING_NAVIGATION;
    default:
      return assertNeverHouseholdClassification(classification.kind);
  }
}

/**
 * Walk EVERY path segment from the workspace root down to the target, resolving
 * a symlink at any ancestor to its real path, and prove the real resolved path
 * never escapes the open workspace. Returns the fully-resolved absolute path.
 * A single un-resolvable symlink (no resolver support) fails closed.
 */
async function resolveContainedRealPath(
  workspace: LegacyMeetingWorkspace,
  workspaceRoot: string,
  relativeDir: string
): Promise<string> {
  const segments = relativeDir.split('/');
  let realAbsolute = workspaceRoot;
  let relativeSoFar = '';
  for (const segment of segments) {
    relativeSoFar = relativeSoFar ? `${relativeSoFar}/${segment}` : segment;
    realAbsolute = `${realAbsolute}/${segment}`;
    // An ancestor (or the final segment) that is a symlink is resolved to its
    // real target; a workspace that cannot report/resolve symlinks cannot prove
    // containment, so we fail closed rather than trust the raw join.
    if (workspace.isSymlink && (await workspace.isSymlink(relativeSoFar))) {
      if (!workspace.resolveSymlink)
        throw new Error(
          'Legacy meeting link cannot resolve its folder safely.'
        );
      realAbsolute = normalizedAbsolutePath(
        await workspace.resolveSymlink(relativeSoFar),
        'Resolved legacy meeting folder'
      );
    }
    if (!isInsidePath(realAbsolute, workspaceRoot))
      throw new Error(
        'Legacy meeting folder resolves outside the open workspace.'
      );
  }
  return realAbsolute;
}

/**
 * Validates the only supported legacy-to-canonical anchor against the DERIVED
 * trusted authority (matter store + active workspace filesystem). This
 * deliberately has no title, date, calendar-event, or caller-supplied
 * household/matter/workspace fallback: the matter is resolved exactly-one from
 * the household, the workspace root and filesystem come from the open
 * workspace, and the record is the trusted canonical projection.
 */
async function validateLegacyMeetingLinkWithin(
  meeting: MeetingProjection,
  input: LegacyMeetingLinkInput,
  authority: MeetingLinkAuthority
): Promise<{ readonly link: LegacyMeetingLink; readonly resolvedDir: string }> {
  const { workspaceRoot, workspace, matters } = authority;
  // Anchor: the household resolves to EXACTLY ONE matter in the trusted store,
  // and that matter must be the record's own matter. Zero/multiple → fail.
  const matter = resolveExactlyOneMatterForHousehold(
    meeting.householdRef,
    matters
  );
  if (!matter)
    throw new Error(
      'Legacy meeting link requires exactly one matching household matter.'
    );
  if (matter.id !== meeting.matterId)
    throw new Error(
      'Legacy meeting link resolves to a different matter than the record.'
    );

  const meetingDir = normalizedPath(input.meetingDir, 'Legacy meeting folder');
  const resolvedDir = await resolveContainedRealPath(
    workspace,
    workspaceRoot,
    meetingDir
  );

  const mappedRoots = matter.folderPaths.map((folder) =>
    normalizedAbsolutePath(folder, 'Matter folder root')
  );
  if (!mappedRoots.some((root) => isInsidePath(resolvedDir, root)))
    throw new Error(
      'Legacy meeting folder is outside its mapped matter folder.'
    );
  if (!(await workspace.exists(meetingDir)))
    throw new Error('Legacy meeting folder is unavailable on this device.');

  let parsed: unknown;
  try {
    parsed = JSON.parse(await workspace.readFile(`${meetingDir}/meeting.json`));
  } catch {
    throw new Error('Legacy meeting metadata is unavailable.');
  }
  if (
    !parsed ||
    typeof parsed !== 'object' ||
    (parsed as Record<string, unknown>)['matterId'] !== meeting.matterId
  )
    throw new Error('Legacy meeting metadata belongs to a different matter.');
  return { link: { meetingDir, linkedAt: now() }, resolvedDir };
}

/**
 * Public link validation. The authority is DERIVED from the trusted platform
 * matter store and the open workspace — a consumer cannot present its own.
 */
export async function validateLegacyMeetingLink(
  meeting: MeetingProjection,
  input: LegacyMeetingLinkInput
): Promise<LegacyMeetingLink> {
  const authority = deriveMeetingLinkAuthority();
  return (await validateLegacyMeetingLinkWithin(meeting, input, authority))
    .link;
}

/**
 * Resolve an un-forgeable open target for a canonical meeting, BY ID, from the
 * trusted store. The canonical record, its matter, and the workspace are all
 * derived from owner-controlled sources: nothing identity-bearing is accepted
 * from the caller. A relayed canonical record can outlive its local folder, so
 * the link is re-validated here (existence + containment) at open time.
 */
export async function resolveMeetingOpenTarget(
  store: MeetingStore,
  meetingId: MeetingRef,
  getActiveClientBoundary: () =>
    | SealedMeetingClientBoundary
    | null
): Promise<MeetingOpenTarget> {
  const expected = getActiveClientBoundary();
  if (!expected)
    throw new Error('A confirmed client is required to open a meeting.');
  const meeting = await store.get(nonEmpty(meetingId, 'Meeting ID'));
  if (!meeting)
    throw new Error('That meeting is unavailable to the active client.');
  if (!sameClientBoundary(meeting, expected))
    throw new Error('That meeting belongs to a different client.');
  if (!meeting.legacyLink)
    throw new Error('This canonical meeting has no linked legacy detail.');
  const authority = deriveMeetingLinkAuthority();
  const { resolvedDir } = await validateLegacyMeetingLinkWithin(
    meeting,
    { meetingDir: meeting.legacyLink.meetingDir },
    authority
  );
  if (!sameClientBoundary(getActiveClientBoundary(), expected))
    throw new Error('Active client changed while the meeting opened.');
  return sealMeetingOpenTarget({
    kind: 'linked-legacy-meeting',
    meeting,
    client: expected,
    legacyLink: meeting.legacyLink,
    meetingDir: resolvedDir,
  });
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
    ...(input.visibilityPolicyId !== undefined
      ? {
          visibilityPolicyId: nonEmpty(
            input.visibilityPolicyId,
            'Meeting visibility policy'
          ),
        }
      : {}),
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

function sealLegacyMeetingLinkStatus(
  status:
    | { readonly kind: 'linked'; readonly meetingRef: MeetingRef }
    | { readonly kind: 'folder-only' }
): LegacyMeetingLinkStatus {
  // As with MeetingOpenTarget, freeze before sealing so a value is never both
  // trusted and mutable. The WeakSet is the provenance proof; the unique symbol
  // is only the compile-time shape that prevents accidental structural use.
  const sealed = deepFreezeAuthority(status) as LegacyMeetingLinkStatus;
  sealedLegacyMeetingLinkStatuses.add(sealed);
  return sealed;
}

/**
 * The only proof that a legacy-row status was minted from the authoritative
 * live-record snapshot. Structural objects and casts are deliberately useless.
 */
export function verifyLegacyMeetingLinkStatus(
  value: LegacyMeetingLinkStatus | null | undefined
): boolean {
  return !!value && sealedLegacyMeetingLinkStatuses.has(value);
}

function activeBoundaryForLegacyLinkStatus(
  port: ClientScopedLivePort
): SealedMeetingClientBoundary {
  const boundary = port.getActiveClientBoundary();
  if (!verifyLiveMeetingClientBoundary(boundary))
    throw new Error('Active client is required.');
  return boundary;
}

/**
 * Read a bounded legacy-link status projection. This does not create a meeting
 * store or project a canonical meeting: it inspects only durable canonical-link
 * keys in one fresh live-record snapshot, then rechecks the live client before
 * returning a sealed routing result.
 */
export function createLegacyMeetingLinkStatusReader(
  port: ClientScopedLivePort
): LegacyMeetingLinkStatusReader {
  const readMany = async (
    legacyRows: readonly LegacyMeetingLinkInput[]
  ): Promise<ReadonlyMap<string, LegacyMeetingLinkStatus>> => {
    // Validate every visible-row locator before doing I/O. A row locator is
    // only a workspace-relative locator; it never supplies identity or status.
    const requested = new Set(
      legacyRows.map((legacy) =>
        normalizedPath(legacy.meetingDir, 'Legacy meeting folder')
      )
    );
    const activeBoundary = activeBoundaryForLegacyLinkStatus(port);
    requireAvailable(port);
    // This is intentionally the trusted workspace derivation, not port data or
    // a caller-provided root. Status needs no folder contents, only proof that
    // there is a real normalized active workspace for the relative locator.
    deriveActiveMeetingWorkspace();

    const fresh = await port.reloadRecords();
    if (!fresh)
      throw new Error(
        'Meeting link status is unavailable until CRM records reload.'
      );
    requireAvailable(port);
    if (
      !sameClientBoundary(
        activeBoundaryForLegacyLinkStatus(port),
        activeBoundary
      )
    )
      throw new Error(
        'Active client changed while meeting link status reloaded.'
      );

    const matches = new Map<string, MeetingRef[]>();
    for (const record of fresh) {
      if (record.kind !== 'meeting') continue;
      const rawLink = record['legacyMeetingLink'];
      if (rawLink === undefined) continue;

      if (
        record.matterId !== activeBoundary.matterId ||
        record['householdRef'] !== activeBoundary.householdRef
      ) {
        // Do not inspect another client's canonical data wholesale. We only
        // look for a raw exact-path collision, then reject it rather than
        // presenting a possibly-dangerous folder-only action.
        const rawDir =
          rawLink && typeof rawLink === 'object'
            ? (rawLink as Record<string, unknown>)['meetingDir']
            : undefined;
        if (typeof rawDir !== 'string') continue;
        let meetingDir: string;
        try {
          meetingDir = normalizedPath(rawDir, 'Legacy meeting folder');
        } catch (error) {
          // A malformed non-active record is not a competing exact locator and
          // must not expose any part of the other client's data.
          void error;
          continue;
        }
        if (!requested.has(meetingDir)) continue;
        // Once it competes for this visible locator, malformed durable data is
        // unavailable truth too — never a reason to expose a link action.
        projectLegacyLink(rawLink);
        throw new Error(
          'A matching canonical meeting belongs to a different client.'
        );
      }

      // Active-client link keys are the entire bounded projection. A malformed
      // persisted link makes this authoritative snapshot unavailable.
      const link = projectLegacyLink(rawLink);
      if (!link) continue;
      if (!requested.has(link.meetingDir)) continue;

      const meetingRef = nonEmpty(record.id, 'Meeting ID');
      const existing = matches.get(link.meetingDir) ?? [];
      existing.push(meetingRef);
      matches.set(link.meetingDir, existing);
    }

    const statuses = new Map<string, LegacyMeetingLinkStatus>();
    for (const meetingDir of requested) {
      const matchingRefs = matches.get(meetingDir) ?? [];
      if (matchingRefs.length > 1)
        throw new Error(
          'More than one canonical meeting has this legacy link.'
        );
      statuses.set(
        meetingDir,
        matchingRefs.length === 1
          ? sealLegacyMeetingLinkStatus({
              kind: 'linked',
              meetingRef: matchingRefs[0] as MeetingRef,
            })
          : sealLegacyMeetingLinkStatus({ kind: 'folder-only' })
      );
    }
    return statuses;
  };

  return {
    read: async (legacy) => {
      const meetingDir = normalizedPath(
        legacy.meetingDir,
        'Legacy meeting folder'
      );
      const statuses = await readMany([legacy]);
      const status = statuses.get(meetingDir);
      if (!status) throw new Error('Meeting link status was unavailable.');
      return status;
    },
    readMany,
  };
}

function requireAvailable(port: LivePort) {
  if (!port.workspaceRoot)
    throw new Error('Open a workspace before using meetings.');
  if (port.error)
    throw new Error(
      'Meeting records are unavailable until CRM records reload.'
    );
}

/**
 * Serialize legacy-link critical sections so a first-link's read → validate →
 * save → verify runs atomically with respect to every OTHER linker in this
 * process. The CRM core is one local SQLCipher database owned by a single app
 * process, and `crm_live_upsert` is an unconditional last-writer-wins write, so
 * the ONLY way two links interleave is cooperative async scheduling within this
 * one event loop. Draining the critical section through this module-level chain
 * closes that TOCTOU: a competing link cannot slip between the no-link read and
 * the save — the second linker observes the first's committed link and takes the
 * idempotent/refuse branch instead of silently overwriting it.
 *
 * (A cross-PROCESS race — two app instances on the same workspace — would need a
 * conditional/compare-and-swap write the store does not expose; that is not the
 * realistic single-writer model here and is tracked separately as hardening. The
 * post-write re-read guard below still runs as defense-in-depth for it.)
 */
let linkSerialization: Promise<unknown> = Promise.resolve();
function serializeLink<T>(critical: () => Promise<T>): Promise<T> {
  const run = linkSerialization.then(critical, critical);
  // Keep the chain alive regardless of this link's outcome, so one failed link
  // never poisons or blocks the next.
  linkSerialization = run.then(
    () => undefined,
    () => undefined
  );
  return run;
}

function recordClientBoundary(record: LiveCrmRecord): ClientBoundary {
  return {
    householdRef:
      typeof record['householdRef'] === 'string' ? record['householdRef'] : '',
    matterId: typeof record.matterId === 'string' ? record.matterId : '',
  };
}

function canonicalMeetingVisibilityRecord(
  record: LiveCrmRecord
): LiveCrmRecord {
  const policyId =
    typeof record['visibilityPolicyId'] === 'string' &&
    record['visibilityPolicyId'].trim() === record['visibilityPolicyId'] &&
    record['visibilityPolicyId'].length > 0
      ? record['visibilityPolicyId']
      : null;
  if (policyId) {
    const {
      [MEETING_VISIBILITY_LINEAGE_FIELD]: _oldLineage,
      ...withoutLineage
    } = record;
    return { ...withoutLineage, visibilityPolicyId: policyId };
  }
  const { visibilityPolicyId: _oldPolicy, ...withoutPolicy } = record;
  return {
    ...withoutPolicy,
    [MEETING_VISIBILITY_LINEAGE_FIELD]: MEETING_VISIBILITY_LEGACY_VALUE,
  };
}

function hasCanonicalMeetingVisibility(record: LiveCrmRecord): boolean {
  const hasPolicy =
    typeof record['visibilityPolicyId'] === 'string' &&
    record['visibilityPolicyId'].trim() === record['visibilityPolicyId'] &&
    record['visibilityPolicyId'].length > 0;
  const hasLegacy =
    record[MEETING_VISIBILITY_LINEAGE_FIELD] ===
    MEETING_VISIBILITY_LEGACY_VALUE;
  return hasPolicy !== hasLegacy;
}

export function createMeetingStore(port: ClientScopedLivePort): MeetingStore {
  const scope = clientScope(port);
  let raw = port.records.filter((record) => record.kind === 'meeting');
  const currentList = () =>
    meetingRecords(raw)
      // Fail-closed list: only the active client's meetings are visible, so a
      // held store shows nothing from a prior client after a switch (or none).
      .filter((meeting) => scope.owns(meeting))
      .sort((left, right) =>
        left.scheduledStartUtc.localeCompare(right.scheduledStartUtc)
      );
  const getRaw = (id: string) => raw.find((record) => record.id === id);
  const persist = async (
    record: LiveCrmRecord,
    expected: SealedMeetingClientBoundary
  ) => {
    const canonical = canonicalMeetingVisibilityRecord(record);
    scope.assertStable(expected, 'Meeting');
    scope.assertOwns(recordClientBoundary(canonical), 'Meeting');
    await port.save(canonical);
    scope.assertStable(expected, 'Meeting');
    const fresh = await port.reloadRecords();
    scope.assertStable(expected, 'Meeting');
    raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
    const saved = getRaw(canonical.id);
    if (!saved)
      throw new Error(
        'The saved meeting was missing after its canonical reload.'
      );
    scope.assertOwns(recordClientBoundary(saved), 'Meeting');
    if (!hasCanonicalMeetingVisibility(saved)) {
      throw new Error(
        'The saved meeting did not preserve one canonical visibility state.'
      );
    }
    return saved;
  };
  const store: LinkableMeetingStore = {
    get list() {
      return currentList();
    },
    get error() {
      return port.getSelectionError?.() ?? port.error;
    },
    get: (id) =>
      Promise.resolve().then(async () => {
        const expected = scope.current();
        if (!expected) return undefined;
        requireAvailable(port);
        const fresh = await port.reloadRecords();
        scope.assertStable(expected, 'Meeting');
        raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
        const record = getRaw(id);
        // Fail-closed read: a record from another (or no) active client is not
        // readable in full here, even with a valid id captured before a switch.
        if (!record || !scope.owns(recordClientBoundary(record))) return undefined;
        return projectMeetingRecord(record);
      }),
    createDraft: async (input) => {
      const draft = validateMeetingDraft(input);
      const expected = scope.assertOwns(draft, 'Meeting');
      requireAvailable(port);
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
          : {
              [MEETING_VISIBILITY_LINEAGE_FIELD]:
                MEETING_VISIBILITY_LEGACY_VALUE,
            }),
      };
      return projectMeetingRecord(await persist(record, expected));
    },
    update: async (id, patch) => {
      const expected = scope.requireCurrent('Meeting');
      requireAvailable(port);
      const fresh = await port.reloadRecords();
      scope.assertStable(expected, 'Meeting');
      raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
      const rawRecord = getRaw(id);
      if (!rawRecord) throw new Error('That meeting no longer exists.');
      scope.assertOwns(recordClientBoundary(rawRecord), 'Meeting');
      const current = projectMeetingRecord(rawRecord);
      const draftInput = {
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
        visibilityPolicyId:
          patch.visibilityPolicyId ?? current.visibilityPolicyId,
      } as CreateMeetingDraft;
      if (patch.visibilityPolicyId === null) {
        delete (draftInput as { visibilityPolicyId?: string | null })
          .visibilityPolicyId;
      }
      const draft = validateMeetingDraft(draftInput);
      let next: LiveCrmRecord = {
        ...rawRecord,
        updatedAt: now(),
        typeId: draft.typeId,
        ownerRef: draft.ownerRef,
        scheduledStartUtc: draft.scheduledStartUtc,
        scheduledEndUtc: draft.scheduledEndUtc,
        timezone: draft.timezone,
        references: draft.references,
      };
      if (patch.visibilityPolicyId === null) {
        const { visibilityPolicyId: _oldPolicy, ...withoutPolicy } = next;
        next = {
          ...withoutPolicy,
          [MEETING_VISIBILITY_LINEAGE_FIELD]:
            MEETING_VISIBILITY_LEGACY_VALUE,
        };
      } else if (draft.visibilityPolicyId) {
        const {
          [MEETING_VISIBILITY_LINEAGE_FIELD]: _oldLineage,
          ...withoutLineage
        } = next;
        next = {
          ...withoutLineage,
          visibilityPolicyId: draft.visibilityPolicyId,
        };
      }
      return projectMeetingRecord(await persist(next, expected));
    },
    transition: async (id, transition) => {
      const expected = scope.requireCurrent('Meeting');
      requireAvailable(port);
      const fresh = await port.reloadRecords();
      scope.assertStable(expected, 'Meeting');
      raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
      const rawRecord = getRaw(id);
      if (!rawRecord) throw new Error('That meeting no longer exists.');
      scope.assertOwns(recordClientBoundary(rawRecord), 'Meeting');
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
        await persist(
          {
            ...rawRecord,
            state: valid.to,
            updatedAt: valid.at,
          },
          expected
        )
      );
    },
    linkLegacy: (id, input) =>
      // The whole read → validate → save → verify runs inside the process-wide
      // link mutex, so a competing linker cannot interleave between the no-link
      // read and the save. This is what makes first-linking atomic against the
      // last-writer-wins port (see `serializeLink`).
      serializeLink(async () => {
        const expected = scope.requireCurrent('Meeting');
        requireAvailable(port);
        const fresh = await port.reloadRecords();
        scope.assertStable(expected, 'Meeting');
        raw = (fresh ?? []).filter((candidate) => candidate.kind === 'meeting');
        const rawRecord = getRaw(id);
        if (!rawRecord) throw new Error('That meeting no longer exists.');
        scope.assertOwns(recordClientBoundary(rawRecord), 'Meeting');
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
          await validateLegacyMeetingLink(current, input);
          scope.assertStable(expected, 'Meeting');
          return current;
        }
        const link = await validateLegacyMeetingLink(current, input);
        scope.assertStable(expected, 'Meeting');
        const saved = await persist(
          {
            ...rawRecord,
            updatedAt: now(),
            legacyMeetingLink: link,
          },
          expected
        );
        // Concurrent-first-link guard (defense-in-depth beyond the mutex): the
        // port is last-writer-wins, so re-read the just-persisted record and
        // refuse if the durable link is not the one we wrote — a competing link
        // must fail rather than be silently overwritten.
        const persistedLink = projectMeetingRecord(saved).legacyLink;
        if (!persistedLink || persistedLink.meetingDir !== requestedDir)
          throw new Error(
            'A concurrent legacy link won; refusing to overwrite it.'
          );
        return projectMeetingRecord(saved);
      }),
  };
  return store;
}

/**
 * The forward population path.  New meetings are canonical first; attaching a
 * legacy folder is optional and always goes through the anchor validation.
 */
export function createMeetingPopulationService(
  port: ClientScopedLivePort
): MeetingPopulationService {
  const store = createMeetingStore(port) as LinkableMeetingStore;
  return {
    createNew: (draft) => store.createDraft(draft),
    createAndLink: async (draft, legacy) => {
      const created = await store.createDraft(draft);
      return store.linkLegacy(created.id, legacy);
    },
    linkLegacy: (meetingId, legacy) => store.linkLegacy(meetingId, legacy),
    openTarget: (meetingId) =>
      resolveMeetingOpenTarget(
        store,
        meetingId,
        port.getActiveClientBoundary
      ),
  };
}

/**
 * Mint an owner-issued grant to read the firm meeting directory. The allowed
 * matter set is DERIVED from the trusted matter store — it is NOT asserted by
 * the caller — and optionally narrowed to a requested subset that must still be
 * a subset of the owner-truth matters. A consumer cannot forge an always-true
 * authorization: `createFirmMeetingDirectoryReader` only honours a grant minted
 * here (see the module-private seal). Returns null (fail closed) when nothing is
 * authorized (e.g. no matters, or the requested subset is not owner truth).
 */
export function grantFirmMeetingDirectoryAccess(
  requestedMatterIds?: readonly string[]
): FirmMeetingDirectoryGrant | null {
  const ownerMatterIds = new Set(
    getMatters()
      .filter((matter) => !matter.archived)
      .map((matter) => matter.id)
      .filter((id): id is string => typeof id === 'string' && !!id.trim())
  );
  if (ownerMatterIds.size === 0) return null;
  let allowed: string[];
  if (requestedMatterIds === undefined) {
    allowed = [...ownerMatterIds];
  } else {
    // A requested narrowing is honoured only where it is a genuine subset of
    // owner truth; any id outside the trusted matter store is dropped, never
    // trusted, so a caller cannot widen access by naming matters it invented.
    allowed = [...new Set(requestedMatterIds)].filter((id) =>
      ownerMatterIds.has(id)
    );
    if (allowed.length === 0) return null;
  }
  // Freeze the grant AND its allowed-matter array at mint, so a holder cannot
  // widen it after issue (e.g. push a victim matter into `allowedMatterIds`).
  // Seal (provenance) + freeze (immutability) together mean the reader honours
  // exactly the matters owner-truth permitted, unchangeable after minting.
  const grant = deepFreezeAuthority({
    allowedMatterIds: allowed,
  }) as unknown as FirmMeetingDirectoryGrant;
  sealedFirmGrants.add(grant);
  return grant;
}

function permittedFirmMatterIds(
  grant: FirmMeetingDirectoryGrant
): ReadonlySet<string> | null {
  if (!sealedFirmGrants.has(grant)) return null;
  const ids: unknown = grant.allowedMatterIds;
  if (
    !Array.isArray(ids) ||
    ids.some((id) => typeof id !== 'string' || !id.trim())
  )
    return null;
  const currentOwnerMatterIds = new Set(
    getMatters()
      .filter((matter) => !matter.archived)
      .map((matter) => matter.id)
      .filter((id): id is string => typeof id === 'string' && !!id.trim())
  );
  return new Set(
    ids
      .filter((id): id is string => typeof id === 'string')
      .filter((id) => currentOwnerMatterIds.has(id))
  );
}

/**
 * An explicit cross-client reader. It reads ONLY through an owner-issued,
 * un-forgeable {@link FirmMeetingDirectoryGrant} (minted by
 * `grantFirmMeetingDirectoryAccess`). A hand-constructed grant object is not in
 * the seal, so it is refused and the reader returns nothing.
 */
export function createFirmMeetingDirectoryReader(
  port: LivePort,
  grant: FirmMeetingDirectoryGrant
): FirmMeetingDirectoryReader {
  // A grant is bounded, not a permanent snapshot of ownership. Intersect it
  // with current owner truth before AND after every reload.
  const permitted = () => permittedFirmMatterIds(grant);
  const refused = (
    reason: 'authority-refused' | 'selection-blocked',
    message: string
  ): FirmMeetingDirectoryReadResult => ({ kind: 'refused', reason, message });
  const error = (message: string): FirmMeetingDirectoryReadResult => ({
    kind: 'error',
    message,
  });
  const ready = (
    meetings: readonly MeetingProjection[]
  ): FirmMeetingDirectoryReadResult => {
    const result = deepFreezeAuthority({
      kind: 'ready',
      meetings,
    }) as Extract<FirmMeetingDirectoryReadResult, { kind: 'ready' }>;
    sealedFirmDirectoryReadyResults.add(result);
    return result;
  };
  const read = async (): Promise<FirmMeetingDirectoryReadResult> => {
    if (!port.getFirmSelectionError)
      return refused(
        'selection-blocked',
        'The firm meeting selection is unavailable.'
      );
    const selectionError = port.getFirmSelectionError();
    if (selectionError)
      return refused('selection-blocked', selectionError);
    if (!port.workspaceRoot || port.error)
      return error('Meeting records are unavailable until they reload.');
    const allowed = permitted();
    if (!allowed || allowed.size === 0)
      return refused(
        'authority-refused',
        'Firm meeting directory access was not authorized.'
      );
    let records: readonly LiveCrmRecord[];
    try {
      const reloaded = await port.reloadRecords();
      if (!reloaded)
        return error('Meeting records are unavailable until they reload.');
      records = reloaded;
    } catch {
      return error('Meeting records are unavailable until they reload.');
    }
    // Check BOTH gates after the asynchronous reload. A selection change or a
    // permission revoke while the read is in flight must not leak loaded rows.
    const freshSelectionError = port.getFirmSelectionError();
    if (freshSelectionError)
      return refused('selection-blocked', freshSelectionError);
    const stillAllowed = permitted();
    if (!stillAllowed || stillAllowed.size === 0)
      return refused(
        'authority-refused',
        'Firm meeting directory access was not authorized.'
      );
    return ready(
      meetingRecords(records)
        .filter((meeting) => stillAllowed.has(meeting.matterId))
        .sort((left, right) =>
          left.scheduledStartUtc.localeCompare(right.scheduledStartUtc)
        )
    );
  };
  return {
    list: read,
    get: async (id) => {
      const result = await read();
      if (result.kind !== 'ready') return result;
      const lookup = deepFreezeAuthority({
        kind: 'ready',
        meeting: result.meetings.find((meeting) => meeting.id === id) ?? null,
      }) as Extract<FirmMeetingDirectoryLookupResult, { kind: 'ready' }>;
      sealedFirmDirectoryReadyResults.add(lookup);
      return lookup;
    },
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

function validateMeetingArtifactReviewArchiveTransition(
  transition: MeetingArtifactReviewArchiveTransition
): MeetingArtifactReviewArchiveTransition {
  const runtime = transition as {
    readonly from: unknown;
    readonly to: unknown;
    readonly at: unknown;
  };
  const legal =
    (runtime.from === 'active' && runtime.to === 'archived') ||
    (runtime.from === 'archived' && runtime.to === 'active');
  if (!legal)
    throw new Error('That meeting review archive transition is not allowed.');
  return {
    from: runtime.from,
    to: runtime.to,
    at: timestamp(runtime.at, 'Review archive timestamp'),
  } as MeetingArtifactReviewArchiveTransition;
}

function projectReviewNeededArtifact(
  artifact: MeetingArtifact,
  records: readonly LiveCrmRecord[]
): ReviewNeededMeetingArtifact {
  let reviewArchiveState: MeetingArtifactReviewArchiveState = 'active';
  let reviewArchiveChangedAt: string | undefined;
  const transitions = records
    .filter(
      (candidate) =>
        candidate.kind === 'meeting_artifact_review_archive_transition' &&
        candidate['artifactId'] === artifact.id &&
        candidate.matterId === artifact.matterId &&
        candidate['householdRef'] === artifact.householdRef
    )
    .sort(
      (left, right) =>
        String(left['transitionAt']).localeCompare(
          String(right['transitionAt'])
        ) || left.id.localeCompare(right.id)
    );
  try {
    for (const record of transitions) {
      const transition = validateMeetingArtifactReviewArchiveTransition({
        from: record['fromState'] as MeetingArtifactReviewArchiveState,
        to: record['toState'] as MeetingArtifactReviewArchiveState,
        at: record['transitionAt'] as string,
      } as MeetingArtifactReviewArchiveTransition);
      if (transition.from !== reviewArchiveState)
        throw new Error('Meeting review archive history is inconsistent.');
      if (
        Date.parse(transition.at) < Date.parse(artifact.producedAt) ||
        (reviewArchiveChangedAt && transition.at <= reviewArchiveChangedAt)
      )
        throw new Error('Meeting review archive history is out of order.');
      reviewArchiveState = transition.to;
      reviewArchiveChangedAt = transition.at;
    }
  } catch {
    throw new Error('Meeting review archive history is invalid.');
  }
  return {
    ...artifact,
    reviewArchiveState,
    ...(reviewArchiveChangedAt ? { reviewArchiveChangedAt } : {}),
  };
}

export function createMeetingArtifactStore(
  port: ClientScopedLivePort
): FirmReadableMeetingArtifactStore {
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
  const persist = async (
    record: LiveCrmRecord,
    expected: SealedMeetingClientBoundary
  ) => {
    scope.assertStable(expected, 'Meeting artifact');
    scope.assertOwns(recordClientBoundary(record), 'Meeting artifact');
    await port.save(record);
    scope.assertStable(expected, 'Meeting artifact');
    const fresh = await port.reloadRecords();
    scope.assertStable(expected, 'Meeting artifact');
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
    scope.assertOwns(recordClientBoundary(saved), 'Meeting artifact');
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
      if (!scope.owns(client)) return emptyReader;
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
          if (!scope.owns(client)) return [];
          if (!ownsMeeting(meeting)) return [];
          const kinds = requestedKinds ?? [...minimumVersion.keys()];
          if (kinds.some((kind) => !minimumVersion.has(kind))) return [];
          return reader.listForMeeting(meeting, kinds).filter(allowedArtifact);
        },
        get: (id) => {
          if (!scope.owns(client)) return null;
          const artifact = reader.get(id);
          return artifact && allowedArtifact(artifact) ? artifact : null;
        },
      };
    },
    reviewNeededForFirm: (grant, requirements) => {
      const minimumVersion = artifactMinimumVersions(requirements);
      const kinds = [...minimumVersion.keys()];
      const permitted = () => permittedFirmMatterIds(grant);
      type ReviewRefusal = Extract<
        ReviewNeededMeetingArtifactsReadResult,
        { readonly kind: 'refused' }
      >;
      const refused = (
        reason: ReviewRefusal['reason'],
        message: string
      ): ReviewRefusal => ({
        kind: 'refused',
        reason,
        message,
      });
      const transitionRefused = (
        reason: Extract<
          MeetingArtifactReviewArchiveTransitionResult,
          { kind: 'refused' }
        >['reason'],
        message: string
      ): MeetingArtifactReviewArchiveTransitionResult => ({
        kind: 'refused',
        reason,
        message,
      });

      const projectFresh = (
        fresh: readonly LiveCrmRecord[],
        stillAllowed: ReadonlySet<string>
      ): readonly ReviewNeededMeetingArtifact[] => {
        const meetingsById = new Map<string, MeetingProjection[]>();
        for (const meeting of meetingRecords(fresh)) {
          const matches = meetingsById.get(meeting.id) ?? [];
          matches.push(meeting);
          meetingsById.set(meeting.id, matches);
        }
        return fresh
          .filter((record) => record.kind === 'meeting_artifact')
          .flatMap((record) => {
            try {
              return [projectArtifact(record, fresh)];
            } catch {
              return [];
            }
          })
          .filter((artifact) => {
            const parents = meetingsById.get(artifact.meetingId) ?? [];
            const parent = parents.length === 1 ? parents[0] : undefined;
            return (
              artifact.state === 'produced' &&
              minimumVersion.has(artifact.kind) &&
              artifact.schemaVersion >=
                (minimumVersion.get(artifact.kind) ?? Infinity) &&
              stillAllowed.has(artifact.matterId) &&
              parent?.matterId === artifact.matterId &&
              parent.householdRef === artifact.householdRef
            );
          })
          .map((artifact) => projectReviewNeededArtifact(artifact, fresh));
      };

      const reloadAuthorized = async (): Promise<
        | {
            readonly kind: 'ready';
            readonly fresh: readonly LiveCrmRecord[];
            readonly allowed: ReadonlySet<string>;
          }
        | Exclude<
            ReviewNeededMeetingArtifactsReadResult,
            { readonly kind: 'ready' }
          >
      > => {
        if (!port.getFirmSelectionError)
          return refused(
            'selection-blocked',
            'The firm meeting selection is unavailable.'
          );
        const selectionError = port.getFirmSelectionError();
        if (selectionError) return refused('selection-blocked', selectionError);
        if (!port.workspaceRoot || port.error)
          return refused(
            'records-unavailable',
            'Meeting artifacts are unavailable until records reload.'
          );
        const allowed = permitted();
        if (!allowed || allowed.size === 0)
          return refused(
            'authority-refused',
            'Firm meeting artifact access was not authorized.'
          );
        let fresh: readonly LiveCrmRecord[];
        try {
          const reloaded = await port.reloadRecords();
          if (!reloaded)
            return refused(
              'records-unavailable',
              'Meeting artifacts are unavailable until records reload.'
            );
          fresh = reloaded;
        } catch {
          return refused(
            'records-unavailable',
            'Meeting artifacts are unavailable until records reload.'
          );
        }
        const freshSelectionError = port.getFirmSelectionError();
        if (freshSelectionError)
          return refused('selection-blocked', freshSelectionError);
        const stillAllowed = permitted();
        if (!stillAllowed || stillAllowed.size === 0)
          return refused(
            'authority-refused',
            'Firm meeting artifact access was not authorized.'
          );
        return { kind: 'ready', fresh, allowed: stillAllowed };
      };

      return {
        kinds,
        list: async () => {
          const authorized = await reloadAuthorized();
          if (authorized.kind !== 'ready') return authorized;
          return {
            kind: 'ready',
            artifacts: projectFresh(authorized.fresh, authorized.allowed),
          };
        },
        transitionArchive: async (id, archiveScope, transition) => {
          let valid: MeetingArtifactReviewArchiveTransition;
          try {
            valid = validateMeetingArtifactReviewArchiveTransition(transition);
          } catch {
            return transitionRefused(
              'stale-transition',
              'That review item changed. Reload it before trying again.'
            );
          }
          const authorized = await reloadAuthorized();
          if (authorized.kind !== 'ready') {
            return authorized.reason === 'records-unavailable'
              ? {
                  kind: 'error',
                  message: 'Meeting review records could not be reloaded.',
                }
              : transitionRefused(authorized.reason, authorized.message);
          }
          let candidates: readonly ReviewNeededMeetingArtifact[];
          try {
            candidates = projectFresh(
              authorized.fresh,
              authorized.allowed
            ).filter((artifact) => artifact.id === id);
          } catch {
            return {
              kind: 'error',
              message: 'Meeting review history could not be loaded.',
            };
          }
          const current = candidates.length === 1 ? candidates[0] : undefined;
          if (!current)
            return transitionRefused(
              'authority-refused',
              'That review item is unavailable.'
            );
          if (
            archiveScope.kind === 'selected-client' &&
            !sameClientBoundary(current, archiveScope.client)
          )
            return transitionRefused(
              'client-mismatch',
              'That review item belongs to a different client.'
            );
          if (current.reviewArchiveState !== valid.from)
            return transitionRefused(
              'stale-transition',
              'That review item changed. Reload it before trying again.'
            );
          if (
            Date.parse(valid.at) < Date.parse(current.producedAt) ||
            (current.reviewArchiveChangedAt &&
              valid.at <= current.reviewArchiveChangedAt)
          )
            return transitionRefused(
              'stale-transition',
              'That review item changed. Reload it before trying again.'
            );
          const base = authorized.fresh.find(
            (record) =>
              record.kind === 'meeting_artifact' && record.id === current.id
          );
          try {
            await port.save({
              id: recordId('meeting-artifact-review-archive-transition'),
              kind: 'meeting_artifact_review_archive_transition',
              matterId: current.matterId,
              householdRef: current.householdRef,
              ...(typeof base?.['relayMatterId'] === 'string'
                ? { relayMatterId: base['relayMatterId'] }
                : {}),
              createdAt: valid.at,
              updatedAt: valid.at,
              artifactId: current.id,
              fromState: valid.from,
              toState: valid.to,
              transitionAt: valid.at,
            });
          } catch {
            return {
              kind: 'error',
              message: 'That review item could not be updated.',
            };
          }
          const reloaded = await reloadAuthorized();
          if (reloaded.kind !== 'ready') {
            return reloaded.reason === 'records-unavailable'
              ? {
                  kind: 'error',
                  message: 'Meeting review records could not be reloaded.',
                }
              : transitionRefused(reloaded.reason, reloaded.message);
          }
          let saved: readonly ReviewNeededMeetingArtifact[];
          try {
            saved = projectFresh(reloaded.fresh, reloaded.allowed).filter(
              (artifact) => artifact.id === id
            );
          } catch {
            return {
              kind: 'error',
              message: 'Meeting review history could not be loaded.',
            };
          }
          const result = saved.length === 1 ? saved[0] : undefined;
          if (
            !result ||
            result.reviewArchiveState !== valid.to ||
            (archiveScope.kind === 'selected-client' &&
              !sameClientBoundary(result, archiveScope.client))
          )
            return transitionRefused(
              'stale-transition',
              'That review item changed while it was being updated.'
            );
          return { kind: 'ready', artifact: result };
        },
      };
    },
    append: async (input) => {
      const expected = scope.requireCurrent('Meeting');
      requireAvailable(port);
      const freshRecords = await port.reloadRecords();
      scope.assertStable(expected, 'Meeting artifact');
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
      scope.assertOwns(recordClientBoundary(parent), 'Meeting');
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
      const saved = projectArtifact(await persist(record, expected), raw);
      return approvedAt
        ? approveArtifact(
            saved,
            {
              from: 'produced',
              to: 'approved',
              at: approvedAt,
            },
            expected
          )
        : saved;
    },
    approve: async (id, transition) => {
      const expected = scope.requireCurrent('Artifact');
      requireAvailable(port);
      const fresh = await port.reloadRecords();
      scope.assertStable(expected, 'Meeting artifact');
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
      scope.assertOwns(recordClientBoundary(current), 'Artifact');
      const projected = projectArtifact(current, raw);
      const valid = validateMeetingArtifactTransition(transition);
      if (valid.from !== projected.state)
        throw new Error(
          `This artifact is ${projected.state}, not ${valid.from}; refusing a stale approval.`
        );
      return approveArtifact(projected, valid, expected);
    },
  };

  async function approveArtifact(
    artifact: MeetingArtifact,
    transition: MeetingArtifactTransition,
    expected: SealedMeetingClientBoundary
  ): Promise<MeetingArtifact> {
    const valid = validateMeetingArtifactTransition(transition);
    if (Date.parse(valid.at) < Date.parse(artifact.producedAt))
      throw new Error('Artifact approval cannot predate production.');
    const base = raw.find(
      (candidate) =>
        candidate.kind === 'meeting_artifact' && candidate.id === artifact.id
    );
    if (!base) throw new Error('The artifact disappeared before approval.');
    await persist(
      {
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
      },
      expected
    );
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
  client: SealedMeetingClientBoundary,
  requirements: readonly MeetingArtifactRequirement[]
): MeetingArtifactReader {
  return store.readerFor(meetings, client, requirements);
}

export function approvedMeetingArtifactsForClient(
  meetings: MeetingStore,
  store: MeetingArtifactStore,
  client: SealedMeetingClientBoundary,
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

declare const directClientMeetingTargetBrand: unique symbol;
const sealedDirectClientMeetingTargets = new WeakSet();

export interface DirectClientMeetingDescriptor {
  readonly dir: string;
  readonly folderName: string;
  readonly startMs?: number;
}

export interface DirectClientMeetingTarget {
  readonly kind: 'direct-client-meeting';
  readonly client: SealedMeetingClientBoundary;
  readonly meetingDir: string;
  readonly folderName: string;
  readonly startMs?: number;
  readonly [directClientMeetingTargetBrand]: true;
}

export interface PairBoundDirectClientMeeting<
  Row extends DirectClientMeetingDescriptor
> {
  readonly meeting: Row;
  readonly target: DirectClientMeetingTarget;
}

export type DirectClientMeetingsReadResult<
  Row extends DirectClientMeetingDescriptor
> =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'ready';
      readonly meetings: readonly PairBoundDirectClientMeeting<Row>[];
    }
  | { readonly kind: 'refused'; readonly message: string }
  | { readonly kind: 'error'; readonly message: string };

export interface DirectClientMeetingsAdapter<
  Row extends DirectClientMeetingDescriptor
> {
  list(): Promise<DirectClientMeetingsReadResult<Row>>;
  resolveTarget(
    result: DirectClientMeetingsReadResult<Row>,
    request: DirectClientMeetingDescriptor | null | undefined
  ): DirectClientMeetingTarget | null;
}

function normalizedDirectoryIdentity(path: string): string {
  return normalizedAbsolutePath(path, 'Client meeting folder').replace(/\/$/, '');
}

function validatedMeetingDirectoryIdentity(
  meetingDir: string,
  authorizedFolder: string
): string | null {
  try {
    const absolute = normalizedDirectoryIdentity(meetingDir);
    return isInsidePath(absolute, authorizedFolder) ? absolute : null;
  } catch {
    // WorkspaceService list results are workspace-relative on desktop. Prove
    // the relative ancestor is exactly the suffix of the sanctioned absolute
    // client folder; a similar display name or arbitrary folder is insufficient.
    let relative: string;
    try {
      relative = normalizedPath(meetingDir, 'Client meeting folder');
    } catch {
      return null;
    }
    const marker = '/Meetings/';
    const markerIndex = `/${relative}`.indexOf(marker);
    if (markerIndex <= 0) return null;
    const clientRelative = relative.slice(0, markerIndex - 1);
    const normalizedAuthorized = authorizedFolder.replace(/\\/g, '/');
    return normalizedAuthorized.endsWith(`/${clientRelative}`) ? relative : null;
  }
}

const NO_DIRECT_CLIENT_FOLDER = 'meeting-client-has-no-folder' as const;

function authorizedDirectClientFolder(
  client: SealedMeetingClientBoundary,
  requestedFolder: string
): string | null {
  const candidates = getMatters().filter(
    (matter) =>
      !matter.archived &&
      matter.id === client.matterId &&
      (matter.crmHouseholdKeys ?? []).some(
        (householdRef) => householdRef.trim() === client.householdRef
      )
  );
  if (candidates.length !== 1) return null;
  if (!requestedFolder.trim())
    return candidates[0]?.folderPaths.length === 0
      ? NO_DIRECT_CLIENT_FOLDER
      : null;
  let requested: string;
  try {
    requested = normalizedDirectoryIdentity(requestedFolder);
  } catch {
    return null;
  }
  const authorized = candidates[0]?.folderPaths.flatMap((folder) => {
    try {
      return [normalizedDirectoryIdentity(folder)];
    } catch {
      return [];
    }
  }) ?? [];
  return authorized.includes(requested) ? requested : null;
}

/**
 * The one direct-client filesystem doorway. It proves the exact live pair and
 * sanctioned matter folder before scanning, then proves both again after the
 * asynchronous scan before returning any row or target.
 */
export function createDirectClientMeetingsAdapter<
  Row extends DirectClientMeetingDescriptor
>(input: {
  readonly client: SealedMeetingClientBoundary;
  readonly getActiveClientBoundary: () =>
    | SealedMeetingClientBoundary
    | null;
  readonly matterFolder: string;
  readonly scan: (authorizedMatterFolder: string) => Promise<{
    readonly meetings: readonly Row[];
    readonly scanFailed: boolean;
  }>;
}): DirectClientMeetingsAdapter<Row> {
  const stillAuthorized = (): string | null => {
    const active = input.getActiveClientBoundary();
    if (
      !verifyLiveMeetingClientBoundary(input.client) ||
      !verifyLiveMeetingClientBoundary(active)
    ) return null;
    if (!sameClientBoundary(active, input.client)) return null;
    return authorizedDirectClientFolder(input.client, input.matterFolder);
  };
  const list = async (): Promise<DirectClientMeetingsReadResult<Row>> => {
    const folderBefore = stillAuthorized();
    if (!folderBefore)
      return {
        kind: 'refused',
        message: 'This client meeting folder is not authorized.',
      };
    let scanned: { readonly meetings: readonly Row[]; readonly scanFailed: boolean };
    try {
      scanned =
        folderBefore === NO_DIRECT_CLIENT_FOLDER
          ? { meetings: [], scanFailed: false }
          : await input.scan(folderBefore);
    } catch {
      return { kind: 'error', message: 'Client meetings could not be loaded.' };
    }
    const folderAfter = stillAuthorized();
    if (!folderAfter || folderAfter !== folderBefore)
      return {
        kind: 'refused',
        message: 'The selected client changed while meetings loaded.',
      };
    if (scanned.scanFailed)
      return { kind: 'error', message: 'Client meetings could not be loaded.' };
    const bounded: PairBoundDirectClientMeeting<Row>[] = [];
    for (const meeting of scanned.meetings) {
      if (folderAfter === NO_DIRECT_CLIENT_FOLDER)
        return { kind: 'error', message: 'A client meeting folder was invalid.' };
      const meetingDir = validatedMeetingDirectoryIdentity(
        meeting.dir,
        folderAfter
      );
      if (!meetingDir)
        return { kind: 'error', message: 'A client meeting folder was invalid.' };
      const target = deepFreezeAuthority({
        kind: 'direct-client-meeting',
        client: input.client,
        meetingDir,
        folderName: meeting.folderName,
        ...(meeting.startMs !== undefined ? { startMs: meeting.startMs } : {}),
      }) as DirectClientMeetingTarget;
      sealedDirectClientMeetingTargets.add(target);
      bounded.push({ meeting, target });
    }
    return { kind: 'ready', meetings: bounded };
  };
  return {
    list,
    resolveTarget: (result, request) => {
      if (!request || result.kind !== 'ready' || !stillAuthorized()) return null;
      const folder = stillAuthorized();
      if (!folder || folder === NO_DIRECT_CLIENT_FOLDER) return null;
      const requestedDir = validatedMeetingDirectoryIdentity(request.dir, folder);
      if (!requestedDir) return null;
      const match = result.meetings.find(
        (candidate) => candidate.target.meetingDir === requestedDir
      );
      return match &&
        sealedDirectClientMeetingTargets.has(match.target) &&
        sameClientBoundary(match.target.client, input.client)
        ? match.target
        : null;
    },
  };
}

export function verifyDirectClientMeetingTarget(
  target: DirectClientMeetingTarget | null | undefined,
  active: SealedMeetingClientBoundary | null | undefined
): boolean {
  return !!target &&
    sealedDirectClientMeetingTargets.has(target) &&
    sameClientBoundary(target.client, active);
}

export type MeetingPlatform =
  | 'zoom'
  | 'teams'
  | 'google-meet'
  | 'phone'
  | 'in-person'
  | 'other'
  | 'unknown';
export type MeetingBriefStatus =
  | 'not-available'
  | 'processing'
  | 'needs-review'
  | 'available';
export type MeetingRecordingStatus =
  | 'not-recorded'
  | 'recording'
  | 'processing'
  | 'available'
  | 'unavailable';
export type PastMeetingStatusFilter =
  | 'needs-review'
  | 'processing'
  | 'complete';
export type MeetingProcessingStatus = PastMeetingStatusFilter | 'unknown';

/**
 * Facts may join a row only when the canonical meeting id AND sealed client
 * pair agree. Every readiness/status value is explicit owner truth; the
 * projector never upgrades a row to "available" merely because it exists.
 */
export interface MeetingSurfaceFacts {
  readonly meetingId: MeetingRef;
  readonly householdRef: string;
  readonly matterId: string;
  readonly title?: string;
  /** Display-only client label; the household + matter pair remains authority. */
  readonly clientLabel?: string;
  readonly platform?: MeetingPlatform;
  readonly joinUrl?: string;
  readonly participants?: readonly {
    readonly name?: string;
    readonly email?: string;
  }[];
  readonly briefStatus?: MeetingBriefStatus;
  readonly recordingStatus?: MeetingRecordingStatus;
  readonly processingStatus?: MeetingProcessingStatus;
  readonly artifacts?: readonly MeetingArtifact[];
}

export interface MeetingSurfaceRow {
  readonly id: MeetingRef;
  readonly clientLink: ClientBoundary;
  readonly title: string;
  readonly typeId: string;
  readonly platform: MeetingPlatform;
  readonly scheduledStartUtc: string;
  readonly scheduledEndUtc: string;
  readonly timezone: string;
  readonly relativeContext:
    | { readonly kind: 'starts-in'; readonly minutes: number }
    | { readonly kind: 'in-progress'; readonly minutesRemaining: number }
    | { readonly kind: 'ended-ago'; readonly minutes: number };
  readonly participantCue: {
    readonly count: number;
    readonly names: readonly string[];
  };
  readonly briefStatus: MeetingBriefStatus;
  readonly joinReadiness: 'available' | 'unavailable';
  readonly recordingStatus: MeetingRecordingStatus;
  readonly processingStatus: MeetingProcessingStatus;
  readonly outputs: {
    readonly transcript: boolean;
    readonly summary: boolean;
    readonly tasks: boolean;
    readonly followUp: boolean;
  };
}

export interface MeetingPastFilters {
  readonly statuses: readonly PastMeetingStatusFilter[];
  readonly typeIds: readonly string[];
}

export type MeetingSurfaceProjectionResult =
  | { readonly kind: 'loading' }
  | {
      readonly kind: 'refused';
      readonly message: string;
    }
  | { readonly kind: 'error'; readonly message: string }
  | {
      readonly kind: 'ready';
      readonly upcoming: readonly MeetingSurfaceRow[];
      readonly past: readonly MeetingSurfaceRow[];
      readonly pastFilters: MeetingPastFilters;
      readonly emptyCopy: {
        readonly upcoming: string;
        readonly past: string;
      };
    };

export type MeetingSurfaceProjectionSource =
  | {
      readonly kind: 'selected-client';
      readonly client: SealedMeetingClientBoundary;
      readonly meetings: readonly MeetingProjection[];
    }
  | {
      readonly kind: 'whole-firm';
      readonly directory: FirmMeetingDirectoryReadResult;
    };

const PAST_MEETING_STATUS_FILTERS = Object.freeze([
  'needs-review',
  'processing',
  'complete',
] as const);

function meetingRelativeContext(
  meeting: MeetingProjection,
  nowMs: number
): MeetingSurfaceRow['relativeContext'] {
  const start = Date.parse(meeting.scheduledStartUtc);
  const end = Date.parse(meeting.scheduledEndUtc);
  if (nowMs < start)
    return { kind: 'starts-in', minutes: Math.max(0, Math.ceil((start - nowMs) / 60_000)) };
  if (nowMs < end)
    return {
      kind: 'in-progress',
      minutesRemaining: Math.max(0, Math.ceil((end - nowMs) / 60_000)),
    };
  return { kind: 'ended-ago', minutes: Math.max(0, Math.floor((nowMs - end) / 60_000)) };
}

/**
 * The only list-row join. Selected mode accepts one required sealed pair;
 * whole-firm mode accepts only a ready result minted by the firm reader.
 */
export function projectMeetingSurface(
  source: MeetingSurfaceProjectionSource,
  facts: readonly MeetingSurfaceFacts[],
  nowUtc: string
): MeetingSurfaceProjectionResult {
  const nowMs = Date.parse(timestamp(nowUtc, 'Projection time'));
  if (source.kind === 'whole-firm') {
    if (source.directory.kind === 'loading') return { kind: 'loading' };
    if (source.directory.kind === 'error') return source.directory;
    if (source.directory.kind === 'refused')
      return { kind: 'refused', message: source.directory.message };
    if (!sealedFirmDirectoryReadyResults.has(source.directory))
      return {
        kind: 'refused',
        message: 'Firm meeting directory access was not authorized.',
      };
  }

  let meetings: readonly MeetingProjection[];
  if (source.kind === 'selected-client') {
    meetings = source.meetings.filter((meeting) =>
      sameClientBoundary(meeting, source.client)
    );
  } else {
    if (source.directory.kind !== 'ready')
      return { kind: 'error', message: 'Meeting directory state was invalid.' };
    meetings = source.directory.meetings;
  }
  const rows = meetings.map((meeting): MeetingSurfaceRow => {
    const matchingFacts = facts.filter(
      (candidate) =>
        candidate.meetingId === meeting.id &&
        candidate.householdRef === meeting.householdRef &&
        candidate.matterId === meeting.matterId
    );
    // Duplicate or mismatched facts are not trusted. The row remains truthful
    // with conservative unavailable/default states instead of choosing one.
    const joined = matchingFacts.length === 1 ? matchingFacts[0] : undefined;
    const artifacts = (joined?.artifacts ?? []).filter(
      (artifact) =>
        artifact.meetingId === meeting.id &&
        artifact.householdRef === meeting.householdRef &&
        artifact.matterId === meeting.matterId
    );
    const has = (kind: MeetingArtifactKind) =>
      artifacts.some((artifact) => artifact.kind === kind);
    const participantNames = (joined?.participants ?? [])
      .map((participant) => participant.name?.trim() ?? '')
      .filter((name) => !!name);
    const clientDisplayName = (
      source.kind === 'selected-client'
        ? source.client.displayName
        : joined?.clientLabel
    )?.trim();
    return {
      id: meeting.id,
      clientLink: {
        householdRef: meeting.householdRef,
        matterId: meeting.matterId,
        ...(clientDisplayName ? { displayName: clientDisplayName } : {}),
      },
      title: joined?.title?.trim() || meeting.typeId,
      typeId: meeting.typeId,
      platform: joined?.platform ?? 'unknown',
      scheduledStartUtc: meeting.scheduledStartUtc,
      scheduledEndUtc: meeting.scheduledEndUtc,
      timezone: meeting.timezone,
      relativeContext: meetingRelativeContext(meeting, nowMs),
      participantCue: {
        count: joined?.participants?.length ?? 0,
        names: participantNames,
      },
      briefStatus: joined?.briefStatus ?? 'not-available',
      joinReadiness:
        joined?.joinUrl?.trim() && joined.platform && joined.platform !== 'unknown'
          ? 'available'
          : 'unavailable',
      recordingStatus: joined?.recordingStatus ?? 'unavailable',
      processingStatus: joined?.processingStatus ?? 'unknown',
      outputs: {
        transcript: has('transcript'),
        summary: has('summary'),
        tasks: has('action-update-proposal'),
        followUp: has('follow-up-draft'),
      },
    };
  });
  const sorted = [...rows].sort((left, right) =>
    left.scheduledStartUtc.localeCompare(right.scheduledStartUtc)
  );
  const upcoming = sorted.filter(
    (row) => Date.parse(row.scheduledEndUtc) >= nowMs
  );
  const past = sorted.filter((row) => Date.parse(row.scheduledEndUtc) < nowMs);
  const selectedName =
    source.kind === 'selected-client'
      ? source.client.displayName?.trim() || source.client.householdRef
      : null;
  return {
    kind: 'ready',
    upcoming,
    past,
    pastFilters: {
      statuses: PAST_MEETING_STATUS_FILTERS,
      typeIds: [...new Set(past.map((row) => row.typeId))].sort(),
    },
    emptyCopy: selectedName
      ? {
          upcoming: `No upcoming meetings for ${selectedName}. This view is filtered to ${selectedName}.`,
          past: `No past meetings for ${selectedName}. This view is filtered to ${selectedName}.`,
        }
      : {
          upcoming: 'No upcoming meetings.',
          past: 'No past meetings yet.',
        },
  };
}

export function projectMeetingList(
  records: readonly MeetingProjection[],
  selection:
    | {
        readonly kind: 'client';
        readonly client: SealedMeetingClientBoundary;
      }
    | {
        readonly kind: 'owner';
        readonly client: SealedMeetingClientBoundary;
        readonly ownerId: string;
      }
): MeetingListProjection {
  const selected = records.filter(
    (meeting) =>
      sameClientBoundary(meeting, selection.client) &&
      (selection.kind !== 'owner' || meeting.ownerRef === selection.ownerId)
  );
  return {
    scope: selection.kind === 'owner' ? 'owner' : 'household',
    meetings: [...selected].sort((left, right) =>
      left.scheduledStartUtc.localeCompare(right.scheduledStartUtc)
    ),
  };
}
export function listForHousehold(
  store: MeetingStore,
  client: SealedMeetingClientBoundary
): readonly MeetingProjection[] {
  return store.list.filter(
    (meeting) =>
      meeting.householdRef === client.householdRef &&
      meeting.matterId === client.matterId
  );
}
export function listPrepForHousehold(
  store: MeetingStore,
  client: SealedMeetingClientBoundary
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
export function validateMeetingKeywordCatalogue(
  value: readonly string[]
): readonly string[] {
  if (value.length > 200)
    throw new Error('Meeting keyword catalogue may contain at most 200 terms.');
  const normalized = new Set<string>();
  return value.map((entry) => {
    if (typeof entry !== 'string')
      throw new Error('Meeting keyword term must be a string.');
    const term = entry.trim();
    if (!term) throw new Error('Meeting keyword term must not be empty.');
    if (term.length > 80)
      throw new Error('Meeting keyword term must be at most 80 characters.');
    const key = term.toLocaleLowerCase();
    if (normalized.has(key))
      throw new Error('Meeting keyword terms must be unique.');
    normalized.add(key);
    return term;
  });
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
export function createMeetingKeywordCatalogueStore(
  port: LivePort
): MeetingKeywordCatalogueStore {
  const record = singletonController(port, 'meeting_keyword_catalogue');
  let terms =
    record.current() && Array.isArray(record.current()?.['terms'])
      ? validateMeetingKeywordCatalogue(record.current()?.['terms'] as string[])
      : [];
  return {
    get terms() {
      return terms;
    },
    get error() {
      return port.error;
    },
    get: async () => {
      const fresh = await record.reload();
      terms =
        fresh && Array.isArray(fresh['terms'])
          ? validateMeetingKeywordCatalogue(fresh['terms'] as string[])
          : [];
      return terms;
    },
    save: (next) =>
      Promise.resolve().then(async () => {
        const validated = validateMeetingKeywordCatalogue(next);
        const saved = await record.save({ terms: validated });
        terms = validateMeetingKeywordCatalogue(saved['terms'] as string[]);
        return terms;
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
      // This controller alone uses the raw reload doorway. Refresh before the
      // first save so a just-created migration sentinel cannot race this mount
      // into creating a second preferences singleton.
      await record.reload();
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
  // Subscribe to the active pair so a client switch re-renders and
  // re-projects the UI — but do NOT capture that value into the store. The
  // resolver reads the LIVE active matter from the store's source at every
  // operation, so a store held across an async client switch (e.g. click
  // Approve, switch client, the await resolves) fails closed on the now-stale
  // client instead of acting on the snapshot captured when it was grabbed.
  useSelectionOperationDecision(MEETINGS_SELECTION_REQUEST);
  return createMeetingStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    sharedMatterId: live.sharedMatterId,
    sharedLocalMatterId: live.sharedLocalMatterId,
    getActiveClientBoundary: readActiveMeetingClientBoundary,
    getSelectionError: readAuthoritativeMeetingSelectionError,
    reloadRecords: live.reloadRecords,
  });
}
export function useMeetingArtifactStore(): FirmReadableMeetingArtifactStore {
  const live = useLiveCrmRecords();
  useSelectionOperationDecision(MEETINGS_SELECTION_REQUEST);
  return createMeetingArtifactStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    getActiveClientBoundary: readActiveMeetingClientBoundary,
    getSelectionError: readAuthoritativeMeetingSelectionError,
    getFirmSelectionError: readAuthoritativeFirmMeetingSelectionError,
    reloadRecords: live.reloadRecords,
  });
}
export function useMeetingTypeStore(): MeetingTypeStore {
  const live = useLiveCrmRecords();
  return createMeetingTypeStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: live.reloadRecords,
  });
}
export function useMeetingTemplateStore(): MeetingTemplateStore {
  const live = useLiveCrmRecords();
  return createMeetingTemplateStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: live.reloadRecords,
  });
}
export function useMeetingKeywordCatalogueStore(): MeetingKeywordCatalogueStore {
  const live = useLiveCrmRecords();
  // The keyword insight already renders this store's error channel. Feed the
  // authoritative meeting-selection refusal through that existing channel so
  // a blocked reader cannot be mistaken for a genuine "no tracked topics"
  // result. This stays inside the foundation adapter; no Meetings surface or
  // presentation contract changes are needed.
  const selection = useSelectionOperationDecision(MEETINGS_SELECTION_REQUEST);
  const selectionError =
    selection.kind === 'refused' ? selection.message : null;
  return createMeetingKeywordCatalogueStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: selectionError ?? live.error,
    save: live.save,
    reloadRecords: live.reloadRecords,
  });
}
export function useMeetingIntelligenceSettingsStore(): MeetingIntelligenceSettingsStore {
  const live = useLiveCrmRecords();
  return createMeetingIntelligenceSettingsStore({
    records: live.records,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords: live.reloadRecords,
  });
}
export function useMeetingFoundationPreferencesStore(): MeetingFoundationPreferencesStore {
  const live = useLiveCrmRecords();
  return createMeetingFoundationPreferencesStore({
    records: live.unfilteredRecordsForInternalMeetingPreferences,
    workspaceRoot: live.workspaceRoot,
    error: live.error,
    save: live.save,
    reloadRecords:
      live.reloadUnfilteredRecordsForInternalMeetingPreferences,
  });
}
