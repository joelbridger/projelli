/**
 * A normal-use visibility preference for meeting-derived material.
 *
 * This policy helps the app consistently hide an advisor's restricted meeting
 * material from ordinary coworkers. It is not an authorization boundary,
 * encryption boundary, or confidentiality guarantee. Every consumer still has
 * to apply the returned decision at its own read boundary.
 */

export type MeetingVisibilityPolicy =
  | {
      readonly id: string;
      readonly mode: 'inherit-household';
    }
  | {
      readonly id: string;
      readonly mode: 'explicit-review';
      readonly includedMemberIds: readonly string[];
      readonly excludedMemberIds: readonly string[];
    };

export type MeetingVisibilitySubjectKind =
  | 'meeting-note'
  | 'meeting-artifact'
  | 'task'
  | 'activity'
  | 'proposal'
  | 'file-reference';

export interface MeetingVisibilitySubjectRef {
  readonly kind: MeetingVisibilitySubjectKind;
  readonly id: string;
}

interface MeetingVisibilitySubjectBase extends MeetingVisibilitySubjectRef {
  /** Existing record owner identity; never inferred from a role or team. */
  readonly ownerRef?: string;
  /** Existing durable policy identity; no parallel policy store is introduced. */
  readonly visibilityPolicyId?: string;
}

/**
 * An old record that never participated in meeting visibility. Consumers must
 * choose this variant deliberately; it keeps genuine legacy unrestricted data
 * usable without turning malformed restricted data into unrestricted data.
 */
export interface LegacyUnrestrictedMeetingVisibilitySubject extends MeetingVisibilitySubjectBase {
  readonly lineage: 'legacy-unrestricted';
}

/** A canonical meeting note, which is the root of an inheritance chain. */
export interface RootMeetingVisibilitySubject extends MeetingVisibilitySubjectBase {
  readonly kind: 'meeting-note';
  readonly lineage: 'root';
  readonly ownerRef: string;
}

/**
 * Meeting-derived material. Adapters build this relation from the identities
 * they already own: meetingId, source/context refs, target refs, or file refs.
 */
export interface DerivedMeetingVisibilitySubject extends MeetingVisibilitySubjectBase {
  readonly kind: Exclude<MeetingVisibilitySubjectKind, 'meeting-note'>;
  readonly lineage: 'derived';
  readonly parentRef: MeetingVisibilitySubjectRef;
}

export type MeetingVisibilitySubject =
  | LegacyUnrestrictedMeetingVisibilitySubject
  | RootMeetingVisibilitySubject
  | DerivedMeetingVisibilitySubject;

export type MeetingVisibilityDecision =
  | {
      readonly visible: true;
      readonly reason:
        | 'legacy-unrestricted'
        | 'household-inherited'
        | 'owner'
        | 'included';
      readonly policyId?: string;
      readonly ownerRef?: string;
    }
  | {
      readonly visible: false;
      readonly reason:
        | 'malformed-subject'
        | 'malformed-policy'
        | 'unknown-policy'
        | 'missing-parent'
        | 'parent-mismatch'
        | 'parent-unavailable'
        | 'cycle'
        | 'conflicting-lineage'
        | 'missing-policy'
        | 'missing-owner'
        | 'no-viewer'
        | 'excluded'
        | 'not-included';
      readonly policyId?: string;
      readonly ownerRef?: string;
    };

export interface ResolveMeetingVisibilityInput {
  readonly subject: MeetingVisibilitySubject;
  readonly viewerId: string | null | undefined;
  /** Raw persisted values are accepted so malformed policy data can fail shut. */
  readonly policies: readonly unknown[];
  /**
   * Resolves one exact parent identity from an already-loaded authoritative
   * snapshot. It must not guess by title, date, display name, or folder name.
   */
  readonly resolveParent: (
    ref: MeetingVisibilitySubjectRef
  ) => MeetingVisibilitySubject | null | undefined;
}

const SUBJECT_KINDS = new Set<MeetingVisibilitySubjectKind>([
  'meeting-note',
  'meeting-artifact',
  'task',
  'activity',
  'proposal',
  'file-reference',
]);

const MAX_LINEAGE_DEPTH = 64;
const owns = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function exactId(value: unknown, label: string): string {
  if (
    typeof value !== 'string' ||
    value.length === 0 ||
    value !== value.trim()
  ) {
    throw new Error(`${label} must be a stable non-empty ID.`);
  }
  return value;
}

function exactIds(value: unknown, label: string): readonly string[] {
  if (!Array.isArray(value))
    throw new Error(`${label} must be a list of stable IDs.`);
  const result = value.map((entry) => exactId(entry, label));
  if (new Set(result).size !== result.length)
    throw new Error(`${label} must not contain duplicate IDs.`);
  return result;
}

/** Validate and normalize one persisted meeting visibility policy. */
export function validateMeetingVisibilityPolicy(
  value: unknown
): MeetingVisibilityPolicy {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Meeting visibility policy is invalid.');
  const policy = value as Record<string, unknown>;
  const id = exactId(policy['id'], 'Visibility policy ID');

  if (policy['mode'] === 'inherit-household') {
    if (
      owns(policy, 'includedMemberIds') ||
      owns(policy, 'excludedMemberIds')
    ) {
      throw new Error(
        'Household visibility policy must not contain member exceptions.'
      );
    }
    return { id, mode: 'inherit-household' };
  }

  if (policy['mode'] !== 'explicit-review')
    throw new Error('Meeting visibility policy is invalid.');

  const includedMemberIds = exactIds(
    policy['includedMemberIds'],
    'Included visibility members'
  );
  const excludedMemberIds = exactIds(
    policy['excludedMemberIds'],
    'Excluded visibility members'
  );
  const excluded = new Set(excludedMemberIds);
  if (includedMemberIds.some((memberId) => excluded.has(memberId)))
    throw new Error(
      'A visibility member cannot be both included and excluded.'
    );

  return {
    id,
    mode: 'explicit-review',
    includedMemberIds,
    excludedMemberIds,
  };
}

type ParsedSubject = {
  readonly id: string;
  readonly kind: MeetingVisibilitySubjectKind;
  readonly lineage: MeetingVisibilitySubject['lineage'];
  readonly ownerRef?: string;
  readonly visibilityPolicyId?: string;
  readonly parentRef?: MeetingVisibilitySubjectRef;
};

function parseOptionalId(
  record: Record<string, unknown>,
  key: string,
  label: string
): string | undefined {
  if (!owns(record, key)) return undefined;
  return exactId(record[key], label);
}

function parseRef(value: unknown): MeetingVisibilitySubjectRef {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Meeting visibility parent is invalid.');
  const ref = value as Record<string, unknown>;
  const kind = ref['kind'];
  if (
    typeof kind !== 'string' ||
    !SUBJECT_KINDS.has(kind as MeetingVisibilitySubjectKind)
  )
    throw new Error('Meeting visibility parent kind is invalid.');
  return {
    kind: kind as MeetingVisibilitySubjectKind,
    id: exactId(ref['id'], 'Meeting visibility parent ID'),
  };
}

function parseSubject(value: unknown): ParsedSubject {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new Error('Meeting visibility subject is invalid.');
  const record = value as Record<string, unknown>;
  const kind = record['kind'];
  if (
    typeof kind !== 'string' ||
    !SUBJECT_KINDS.has(kind as MeetingVisibilitySubjectKind)
  )
    throw new Error('Meeting visibility subject kind is invalid.');

  const ownerRef = parseOptionalId(
    record,
    'ownerRef',
    'Meeting visibility owner'
  );
  const visibilityPolicyId = parseOptionalId(
    record,
    'visibilityPolicyId',
    'Meeting visibility policy ID'
  );
  const base = {
    kind: kind as MeetingVisibilitySubjectKind,
    id: exactId(record['id'], 'Meeting visibility subject ID'),
    ...(ownerRef ? { ownerRef } : {}),
    ...(visibilityPolicyId ? { visibilityPolicyId } : {}),
  };

  if (record['lineage'] === 'legacy-unrestricted') {
    if (owns(record, 'visibilityPolicyId') || owns(record, 'parentRef'))
      throw new Error(
        'Legacy unrestricted visibility cannot claim a policy or parent.'
      );
    return { ...base, lineage: 'legacy-unrestricted' };
  }

  if (record['lineage'] === 'root') {
    if (kind !== 'meeting-note' || owns(record, 'parentRef') || !base.ownerRef)
      throw new Error('Meeting visibility root is invalid.');
    return { ...base, kind: 'meeting-note', lineage: 'root' };
  }

  if (record['lineage'] === 'derived') {
    if (kind === 'meeting-note' || !owns(record, 'parentRef'))
      throw new Error('Derived meeting visibility subject is invalid.');
    return {
      ...base,
      kind: kind as Exclude<MeetingVisibilitySubjectKind, 'meeting-note'>,
      lineage: 'derived',
      parentRef: parseRef(record['parentRef']),
    };
  }

  throw new Error('Meeting visibility lineage is invalid.');
}

function policyMap(policies: readonly unknown[]): {
  readonly valid: ReadonlyMap<string, MeetingVisibilityPolicy>;
  readonly malformedIds: ReadonlySet<string>;
} {
  const valid = new Map<string, MeetingVisibilityPolicy>();
  const malformedIds = new Set<string>();
  for (const value of policies) {
    let candidateId: string | null = null;
    if (value && typeof value === 'object' && !Array.isArray(value)) {
      const rawId = (value as Record<string, unknown>)['id'];
      if (typeof rawId === 'string' && rawId.length > 0) candidateId = rawId;
    }
    try {
      const policy = validateMeetingVisibilityPolicy(value);
      if (valid.has(policy.id) || malformedIds.has(policy.id)) {
        valid.delete(policy.id);
        malformedIds.add(policy.id);
      } else {
        valid.set(policy.id, policy);
      }
    } catch {
      if (candidateId) {
        valid.delete(candidateId);
        malformedIds.add(candidateId);
      }
    }
  }
  return { valid, malformedIds };
}

function hidden(
  reason: Extract<MeetingVisibilityDecision, { visible: false }>['reason'],
  policyId?: string,
  ownerRef?: string
): MeetingVisibilityDecision {
  return {
    visible: false,
    reason,
    ...(policyId ? { policyId } : {}),
    ...(ownerRef ? { ownerRef } : {}),
  };
}

/**
 * Resolve one subject's effective owner and policy through its exact parent
 * chain, then decide visibility for the current viewer. Any malformed or
 * ambiguous restricted lineage fails closed. Genuine legacy unrestricted
 * subjects remain visible.
 */
export function resolveMeetingVisibility(
  input: ResolveMeetingVisibilityInput
): MeetingVisibilityDecision {
  const policies = policyMap(input.policies);
  let current: ParsedSubject;
  try {
    current = parseSubject(input.subject);
  } catch {
    return hidden('malformed-subject');
  }

  let ownerRef: string | undefined;
  let policyId: string | undefined;
  const visited = new Set<string>();

  for (let depth = 0; depth < MAX_LINEAGE_DEPTH; depth += 1) {
    const key = `${current.kind}\u0000${current.id}`;
    if (visited.has(key)) return hidden('cycle', policyId, ownerRef);
    visited.add(key);

    if (current.ownerRef) {
      if (ownerRef && ownerRef !== current.ownerRef)
        return hidden('conflicting-lineage', policyId, ownerRef);
      ownerRef = current.ownerRef;
    }
    if (current.visibilityPolicyId) {
      if (policyId && policyId !== current.visibilityPolicyId)
        return hidden('conflicting-lineage', policyId, ownerRef);
      policyId = current.visibilityPolicyId;
    }

    if (current.lineage !== 'derived') break;
    const parentRef = current.parentRef;
    if (!parentRef) return hidden('missing-parent', policyId, ownerRef);

    let parent: MeetingVisibilitySubject | null | undefined;
    try {
      parent = input.resolveParent(parentRef);
    } catch {
      return hidden('parent-unavailable', policyId, ownerRef);
    }
    if (!parent) return hidden('missing-parent', policyId, ownerRef);

    let parsedParent: ParsedSubject;
    try {
      parsedParent = parseSubject(parent);
    } catch {
      return hidden('malformed-subject', policyId, ownerRef);
    }
    if (
      parsedParent.id !== parentRef.id ||
      parsedParent.kind !== parentRef.kind
    )
      return hidden('parent-mismatch', policyId, ownerRef);
    current = parsedParent;
  }

  if (current.lineage === 'derived') return hidden('cycle', policyId, ownerRef);

  if (!policyId && current.lineage === 'legacy-unrestricted') {
    return {
      visible: true,
      reason: 'legacy-unrestricted',
      ...(ownerRef ? { ownerRef } : {}),
    };
  }
  if (!policyId) return hidden('missing-policy', undefined, ownerRef);
  if (policies.malformedIds.has(policyId))
    return hidden('malformed-policy', policyId, ownerRef);
  const policy = policies.valid.get(policyId);
  if (!policy) return hidden('unknown-policy', policyId, ownerRef);

  const viewerId =
    typeof input.viewerId === 'string' &&
    input.viewerId.trim() === input.viewerId
      ? input.viewerId
      : '';
  if (!viewerId) return hidden('no-viewer', policyId, ownerRef);
  if (policy.mode === 'inherit-household') {
    return {
      visible: true,
      reason: 'household-inherited',
      policyId,
      ...(ownerRef ? { ownerRef } : {}),
    };
  }
  if (!ownerRef) return hidden('missing-owner', policyId);
  if (viewerId === ownerRef)
    return { visible: true, reason: 'owner', policyId, ownerRef };
  if (policy.excludedMemberIds.includes(viewerId))
    return hidden('excluded', policyId, ownerRef);
  if (policy.includedMemberIds.includes(viewerId))
    return { visible: true, reason: 'included', policyId, ownerRef };
  return hidden('not-included', policyId, ownerRef);
}

/** Convenience helper for read boundaries that need only the boolean answer. */
export function canViewMeetingVisibilitySubject(
  input: ResolveMeetingVisibilityInput
): boolean {
  return resolveMeetingVisibility(input).visible;
}
