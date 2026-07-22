import {
  resolveMeetingVisibility,
  type MeetingVisibilitySubject,
  type MeetingVisibilitySubjectKind,
  type MeetingVisibilitySubjectRef,
} from '@/platform/meeting-visibility';
import type { LiveCrmRecord } from './liveRecords';
import {
  MEETING_VISIBILITY_LEGACY_VALUE,
  MEETING_VISIBILITY_LINEAGE_FIELD,
} from './meetingVisibilityMigration';

const PREFERENCES_KIND = 'meeting_foundation_preferences';

const owns = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function exactId(value: unknown): string | null {
  return typeof value === 'string' && value.length > 0 && value === value.trim()
    ? value
    : null;
}

function legacySubject(record: LiveCrmRecord): MeetingVisibilitySubject {
  return {
    id: record.id,
    kind: visibilityKind(record),
    lineage: 'legacy-unrestricted',
    ...(exactId(record['ownerRef'])
      ? { ownerRef: record['ownerRef'] as string }
      : {}),
  };
}

function visibilityKind(record: LiveCrmRecord): MeetingVisibilitySubjectKind {
  if (record.kind === 'meeting') return 'meeting-note';
  if (record.kind.startsWith('meeting_artifact')) return 'meeting-artifact';
  if (record.kind === 'task') return 'task';
  if (record.kind === 'proposalRecord') return 'proposal';
  if (record.kind.startsWith('activity')) return 'activity';
  return 'file-reference';
}

function normalizedRef(value: unknown): MeetingVisibilitySubjectRef | null {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const candidate = value as Record<string, unknown>;
  const id = exactId(candidate['id']);
  const kind = candidate['kind'];
  if (!id || typeof kind !== 'string') return null;
  if (kind === 'meeting' || kind === 'meeting-note') {
    return { kind: 'meeting-note', id };
  }
  if (kind === 'meeting_artifact' || kind === 'meeting-artifact') {
    return { kind: 'meeting-artifact', id };
  }
  return null;
}

function exactParentRefs(
  record: LiveCrmRecord
): readonly MeetingVisibilitySubjectRef[] {
  const refs: MeetingVisibilitySubjectRef[] = [];
  const add = (ref: MeetingVisibilitySubjectRef | null) => {
    if (
      ref &&
      !refs.some((item) => item.kind === ref.kind && item.id === ref.id)
    ) {
      refs.push(ref);
    }
  };

  if (record.kind === 'meeting_artifact') {
    const meetingId = exactId(record['meetingId']);
    if (meetingId) add({ kind: 'meeting-note', id: meetingId });
  } else if (
    record.kind === 'meeting_artifact_transition' ||
    record.kind === 'meeting_artifact_review_archive_transition'
  ) {
    const artifactId = exactId(record['artifactId']);
    if (artifactId) add({ kind: 'meeting-artifact', id: artifactId });
  } else if (record.kind !== 'meeting') {
    const meetingId = exactId(record['meetingId']);
    const artifactId = exactId(record['meetingArtifactId']);
    if (meetingId) add({ kind: 'meeting-note', id: meetingId });
    if (artifactId) add({ kind: 'meeting-artifact', id: artifactId });
    for (const key of ['contextRefs', 'links'] as const) {
      const values = record[key];
      if (Array.isArray(values))
        values.forEach((value) => {
          add(normalizedRef(value));
        });
    }
  }
  return refs;
}

function hasMeetingLineageMarker(record: LiveCrmRecord): boolean {
  if (record.kind.startsWith('meeting_artifact')) return true;
  if (
    owns(record, 'meetingId') ||
    owns(record, 'meetingArtifactId') ||
    owns(record, 'artifactId') ||
    owns(record, 'parentRef') ||
    owns(record, 'visibilityPolicyId')
  ) return true;
  return ['contextRefs', 'links'].some((key) => {
    const values = record[key];
    return Array.isArray(values) && values.some((value) => {
      if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
      const kind = (value as Record<string, unknown>)['kind'];
      return kind === 'meeting' || kind === 'meeting-note' ||
        kind === 'meeting_artifact' || kind === 'meeting-artifact';
    });
  });
}

export function isMeetingVisibilityControlRecord(
  record: Pick<LiveCrmRecord, 'kind'>
): boolean {
  return record.kind === PREFERENCES_KIND;
}

type LineageState = 'legacy' | 'restricted' | 'unresolved';

/**
 * Decides whether an exact parent chain reaches a policy-bearing meeting.
 * Missing, ambiguous, malformed, or cyclic ancestry is unresolved so the
 * shared resolver can fail it closed rather than silently treating it as old.
 */
function lineageState(
  record: LiveCrmRecord,
  recordsByRef: ReadonlyMap<string, LiveCrmRecord>,
  visiting: ReadonlySet<string> = new Set()
): LineageState {
  const key = `${visibilityKind(record)}\u0000${record.id}`;
  if (visiting.has(key)) return 'unresolved';
  if (record.kind === 'meeting') {
    const hasPolicy = owns(record, 'visibilityPolicyId');
    const hasLineage = owns(record, MEETING_VISIBILITY_LINEAGE_FIELD);
    if (hasPolicy && hasLineage) return 'unresolved';
    if (hasPolicy) return 'restricted';
    return hasLineage &&
      record[MEETING_VISIBILITY_LINEAGE_FIELD] ===
        MEETING_VISIBILITY_LEGACY_VALUE
      ? 'legacy'
      : 'unresolved';
  }

  const refs = exactParentRefs(record);
  if (refs.length === 0) {
    return hasMeetingLineageMarker(record) ? 'unresolved' : 'legacy';
  }
  if (refs.length !== 1) return 'unresolved';
  const [parentRef] = refs;
  if (!parentRef) return 'unresolved';
  const parent = recordsByRef.get(refKey(parentRef));
  if (!parent) return 'unresolved';
  const next = new Set(visiting);
  next.add(key);
  return lineageState(parent, recordsByRef, next);
}

function refKey(ref: MeetingVisibilitySubjectRef): string {
  return `${ref.kind}\u0000${ref.id}`;
}

function recordsByVisibilityRef(
  records: readonly LiveCrmRecord[]
): ReadonlyMap<string, LiveCrmRecord> {
  const result = new Map<string, LiveCrmRecord>();
  const ambiguous = new Set<string>();
  for (const record of records) {
    const key = refKey({ kind: visibilityKind(record), id: record.id });
    if (result.has(key)) {
      ambiguous.add(key);
      result.delete(key);
    } else if (!ambiguous.has(key)) {
      result.set(key, record);
    }
  }
  return result;
}

function subjectForRecord(
  record: LiveCrmRecord,
  recordsByRef: ReadonlyMap<string, LiveCrmRecord>
): MeetingVisibilitySubject {
  const state = lineageState(record, recordsByRef);
  if (state === 'legacy') return legacySubject(record);

  if (record.kind === 'meeting') {
    return {
      id: record.id,
      kind: 'meeting-note',
      lineage: 'root',
      ownerRef: record['ownerRef'] as string,
      visibilityPolicyId: record['visibilityPolicyId'] as string,
    };
  }

  const parents = exactParentRefs(record);
  return {
    id: record.id,
    kind: visibilityKind(record) as Exclude<
      MeetingVisibilitySubjectKind,
      'meeting-note'
    >,
    lineage: 'derived',
    // An intentionally invalid placeholder is passed only when ancestry is
    // malformed or ambiguous. The shared resolver validates it and hides it.
    parentRef: parents.length === 1 && parents[0]
      ? parents[0]
      : ({ kind: 'meeting-note', id: '' } as MeetingVisibilitySubjectRef),
    ...(owns(record, 'ownerRef')
      ? { ownerRef: record['ownerRef'] as string }
      : {}),
    ...(owns(record, 'visibilityPolicyId')
      ? { visibilityPolicyId: record['visibilityPolicyId'] as string }
      : {}),
  };
}

function visibilityPolicies(
  records: readonly LiveCrmRecord[]
): readonly unknown[] {
  const preferences = records.filter(
    (record) => record.kind === PREFERENCES_KIND
  );
  if (preferences.length !== 1) return [];
  const policies = preferences[0]?.['visibilityPolicies'];
  return Array.isArray(policies) ? policies : [];
}

/** Apply the accepted meeting visibility rule at the CRM read boundary. */
export function filterLiveCrmRecordsByMeetingVisibility(
  records: readonly LiveCrmRecord[],
  viewerId: string | null | undefined
): readonly LiveCrmRecord[] {
  const byRef = recordsByVisibilityRef(records);
  const policies = visibilityPolicies(records);
  return records.filter((record) => {
    if (isMeetingVisibilityControlRecord(record)) return false;
    const subject = subjectForRecord(record, byRef);
    return resolveMeetingVisibility({
      subject,
      viewerId,
      policies,
      resolveParent: (ref) => {
        const parent = byRef.get(refKey(ref));
        return parent ? subjectForRecord(parent, byRef) : null;
      },
    }).visible;
  });
}

export function visibleLiveCrmRecordIds(
  records: readonly LiveCrmRecord[],
  viewerId: string | null | undefined
): readonly string[] {
  return filterLiveCrmRecordsByMeetingVisibility(records, viewerId).map(
    (record) => record.id
  );
}
