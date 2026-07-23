import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  HENDRICKS_REVIEW,
  isExactHendricksAccountlessMeeting,
  isExactHendricksReviewProposal,
} from '@/platform/samples/hendricksReviewSpec';
import {
  resolveMeetingVisibility,
  type DerivedMeetingVisibilitySubject,
  type LegacyUnrestrictedMeetingVisibilitySubject,
  type MeetingVisibilitySubject,
  type MeetingVisibilitySubjectKind,
  type MeetingVisibilitySubjectRef,
  type RootMeetingVisibilitySubject,
} from './visibilityPolicy';

export const MEETING_VISIBILITY_FIELD = 'meetingVisibility' as const;

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() === value && value.length > 0
    ? value
    : undefined;
}

/** A canonical meeting is the only root. It never guesses from display text. */
export function meetingVisibilityRoot(
  record: LiveCrmRecord
): RootMeetingVisibilitySubject | null {
  if (record.kind !== 'meeting') return null;
  const ownerRef = text(record['ownerRef']);
  if (!ownerRef) return null;
  const visibilityPolicyId = text(record['visibilityPolicyId']);
  return {
    kind: 'meeting-note',
    id: record.id,
    lineage: 'root',
    ownerRef,
    ...(visibilityPolicyId ? { visibilityPolicyId } : {}),
  };
}

/**
 * Read the exact persisted lineage. Ordinary pre-visibility CRM records are
 * deliberately projected as legacy unrestricted only when they have no
 * meeting-origin marker. A meeting-origin record with missing lineage fails
 * closed instead of becoming an unrestricted legacy record.
 */
export function meetingVisibilitySubject(
  record: LiveCrmRecord,
  kind: Exclude<MeetingVisibilitySubjectKind, 'meeting-note'>
): MeetingVisibilitySubject | null {
  const stored = record[MEETING_VISIBILITY_FIELD];
  if (stored && typeof stored === 'object' && !Array.isArray(stored)) {
    const subject = stored as Partial<MeetingVisibilitySubject>;
    return subject.kind === kind && subject.id === record.id
      ? (stored as MeetingVisibilitySubject)
      : null;
  }
  // Artifacts are intrinsically meeting-derived. Older rows are repaired by
  // the exact-parent migration; until then they fail closed.
  if (record.kind === 'meeting_artifact') return null;
  const origin =
    record['source'] && typeof record['source'] === 'object'
      ? (record['source'] as { origin?: unknown }).origin
      : undefined;
  const verb = text(record['verb']);
  if (origin === 'meeting' || verb?.startsWith('meeting.')) return null;
  return { kind, id: record.id, lineage: 'legacy-unrestricted' };
}

export function meetingVisibilityParentForRecord(
  record: LiveCrmRecord
): MeetingVisibilitySubject | null {
  const root = meetingVisibilityRoot(record);
  if (root) return root;
  const kinds: Record<string, Exclude<MeetingVisibilitySubjectKind, 'meeting-note'>> = {
    meeting_artifact: 'meeting-artifact',
    task: 'task',
    activityEvent: 'activity',
    proposalRecord: 'proposal',
    crm_workflow_instance: 'workflow',
  };
  const kind = kinds[record.kind];
  return kind ? meetingVisibilitySubject(record, kind) : null;
}

export function derivedMeetingVisibility(
  kind: Exclude<MeetingVisibilitySubjectKind, 'meeting-note'>,
  id: string,
  parent: MeetingVisibilitySubject
): DerivedMeetingVisibilitySubject | LegacyUnrestrictedMeetingVisibilitySubject {
  if (parent.lineage === 'legacy-unrestricted')
    return { kind, id, lineage: 'legacy-unrestricted' };
  return {
    kind,
    id,
    lineage: 'derived',
    parentRef: { kind: parent.kind, id: parent.id },
    ...(parent.ownerRef ? { ownerRef: parent.ownerRef } : {}),
    ...(parent.visibilityPolicyId
      ? { visibilityPolicyId: parent.visibilityPolicyId }
      : {}),
  };
}

function policies(records: readonly LiveCrmRecord[]): readonly unknown[] {
  const preferences = records.filter(
    (record) => record.kind === 'meeting_foundation_preferences'
  );
  if (preferences.length !== 1) return [];
  const values = preferences[0]?.['visibilityPolicies'];
  return Array.isArray(values) ? values : [];
}

function resolveExactParent(
  ref: MeetingVisibilitySubjectRef,
  records: readonly LiveCrmRecord[]
): MeetingVisibilitySubject | null {
  if (ref.kind === 'meeting-note') {
    const roots = records
      .filter((record) => record.kind === 'meeting' && record.id === ref.id)
      .flatMap((record) => {
        const root = meetingVisibilityRoot(record);
        return root ? [root] : [];
      });
    return roots.length === 1 ? (roots[0] ?? null) : null;
  }
  const matches = records.flatMap((record) => {
    const stored = record[MEETING_VISIBILITY_FIELD];
    if (!stored || typeof stored !== 'object' || Array.isArray(stored)) return [];
    const subject = stored as Partial<MeetingVisibilitySubject>;
    return subject.kind === ref.kind && subject.id === ref.id
      ? [stored as MeetingVisibilitySubject]
      : [];
  });
  return matches.length === 1 ? (matches[0] ?? null) : null;
}

/** Accountless access is a single demo exception, never a general fallback. */
function isExactAccountlessHendricksLineage(
  record: LiveCrmRecord,
  subject: MeetingVisibilitySubject,
  records: readonly LiveCrmRecord[]
): boolean {
  if (subject.lineage !== 'accountless-unrestricted') return true;
  const artifact = record.kind === 'meeting_artifact' ? record :
    records.find((candidate) => candidate.kind === 'meeting_artifact' &&
      candidate.id === (records.find((delivery) => delivery.kind === 'meeting_artifact_delivery' &&
        delivery['deliveryKey'] === record['meetingDeliveryKey'])?.['artifactId']));
  if (!artifact || artifact['meetingVisibility'] === undefined ||
    (artifact['meetingVisibility'] as Partial<MeetingVisibilitySubject>).lineage !== 'accountless-unrestricted' ||
    !isExactHendricksReviewProposal((artifact['payload'] as Record<string, unknown> | undefined)?.['proposal'])) return false;
  const meeting = records.find((candidate) => candidate.kind === 'meeting' && candidate.id === artifact['meetingId']);
  if (!meeting || !isExactHendricksAccountlessMeeting(meeting, {
    matterId: String(artifact.matterId ?? ''), workspaceId: String(meeting['workspaceId'] ?? ''),
  })) return false;
  if (record.kind === 'task')
    return record.id === `task-${record['meetingDeliveryKey']}` &&
      (record['householdRef'] as { id?: unknown } | undefined)?.id === HENDRICKS_REVIEW.householdRef;
  return record.kind === 'meeting_artifact';
}

/** Resolve before projecting a title, body, rationale, or summary. */
export function canReadMeetingDerivedRecord(
  record: LiveCrmRecord,
  kind: Exclude<MeetingVisibilitySubjectKind, 'meeting-note'>,
  records: readonly LiveCrmRecord[],
  viewerId: string | null | undefined
): boolean {
  const subject = meetingVisibilitySubject(record, kind);
  if (!subject) return false;
  if (!isExactAccountlessHendricksLineage(record, subject, records)) return false;
  return canReadMeetingVisibilitySubject(subject, records, viewerId);
}

/** Resolve a known root or derived subject against the exact hidden snapshot. */
export function canReadMeetingVisibilitySubject(
  subject: MeetingVisibilitySubject,
  records: readonly LiveCrmRecord[],
  viewerId: string | null | undefined
): boolean {
  return resolveMeetingVisibility({
    subject,
    viewerId,
    policies: policies(records),
    resolveParent: (ref) => resolveExactParent(ref, records),
  }).visible;
}

export function explicitLegacyMeetingVisibility(
  kind: Exclude<MeetingVisibilitySubjectKind, 'meeting-note'>,
  id: string
): LegacyUnrestrictedMeetingVisibilitySubject {
  return { kind, id, lineage: 'legacy-unrestricted' };
}
