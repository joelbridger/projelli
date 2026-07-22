import type { LiveCrmRecord } from './liveRecords';

export const MEETING_VISIBILITY_MIGRATION_VERSION = 1;
export const MEETING_VISIBILITY_MIGRATION_FIELD =
  'meetingVisibilityMigrationVersion';
export const MEETING_VISIBILITY_LINEAGE_FIELD = 'meetingVisibilityLineage';
export const MEETING_VISIBILITY_LEGACY_VALUE = 'legacy-unrestricted';

type SaveRecord = (record: LiveCrmRecord) => Promise<LiveCrmRecord>;

const owns = (value: object, key: string): boolean =>
  Object.prototype.hasOwnProperty.call(value, key);

function replaceRecord(
  records: readonly LiveCrmRecord[],
  saved: LiveCrmRecord
): readonly LiveCrmRecord[] {
  return records.some((record) => record.id === saved.id)
    ? records.map((record) => (record.id === saved.id ? saved : record))
    : [...records, saved];
}

/**
 * One-time canonical-CRM migration for meetings created before visibility.
 *
 * Each meeting is saved before the version sentinel. A crash therefore leaves
 * either an already-labelled meeting (safe to skip on retry) or an unlabelled
 * meeting (still hidden by the reader). The sentinel is the final write.
 */
export async function migrateCanonicalMeetingVisibility(
  input: readonly LiveCrmRecord[],
  save: SaveRecord,
  migratedAt: () => string = () => new Date().toISOString()
): Promise<readonly LiveCrmRecord[]> {
  const preferences = input.filter(
    (record) => record.kind === 'meeting_foundation_preferences'
  );
  if (preferences.length > 1) {
    throw new Error(
      'Meeting visibility migration found more than one preferences record.'
    );
  }
  const preference = preferences[0];
  if (
    preference?.[MEETING_VISIBILITY_MIGRATION_FIELD] ===
    MEETING_VISIBILITY_MIGRATION_VERSION
  ) {
    return input;
  }

  const meetings = input.filter((record) => record.kind === 'meeting');
  // An untouched workspace has nothing to classify. Its first canonical
  // meeting writer adds an explicit visibility state, and the next reload will
  // create the sentinel. Avoid an unrelated write merely for opening CRM.
  if (!preference && meetings.length === 0) return input;

  let records = input;
  for (const meeting of meetings) {
    if (
      owns(meeting, 'visibilityPolicyId') ||
      owns(meeting, MEETING_VISIBILITY_LINEAGE_FIELD)
    ) {
      continue;
    }
    const saved = await save({
      ...meeting,
      updatedAt: migratedAt(),
      [MEETING_VISIBILITY_LINEAGE_FIELD]: MEETING_VISIBILITY_LEGACY_VALUE,
    });
    records = replaceRecord(records, saved);
  }

  const currentPreference = records.find(
    (record) => record.kind === 'meeting_foundation_preferences'
  );
  const sentinelAt = migratedAt();
  const sentinel = await save({
    ...(currentPreference ?? {}),
    id: currentPreference?.id ?? 'meeting-foundation-preferences',
    kind: 'meeting_foundation_preferences',
    matterId: currentPreference?.matterId ?? 'firm_home',
    createdAt: currentPreference?.createdAt ?? sentinelAt,
    updatedAt: sentinelAt,
    visibilityPolicies: Array.isArray(currentPreference?.['visibilityPolicies'])
      ? currentPreference['visibilityPolicies']
      : [],
    owners: Array.isArray(currentPreference?.['owners'])
      ? currentPreference['owners']
      : [],
    deferredDescriptors: Array.isArray(
      currentPreference?.['deferredDescriptors']
    )
      ? currentPreference['deferredDescriptors']
      : [],
    [MEETING_VISIBILITY_MIGRATION_FIELD]:
      MEETING_VISIBILITY_MIGRATION_VERSION,
  });
  return replaceRecord(records, sentinel);
}
