import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import { DEFAULT_CAPACITY_TRIAGE_PREFERENCE } from './triage';
import type {
  CapacityTriageAssignee,
  CapacityTriageDuePressure,
  CapacityTriagePreference,
  CapacityTriagePreferenceOperation,
  CapacityTriagePriority,
} from './contract';

const RECORD_ID = 'task-capacity-triage:preference:v1';
const RECORD_KIND = 'task_capacity_triage_preference';

function isAssignee(value: unknown): value is CapacityTriageAssignee {
  return (
    value === 'all' ||
    value === 'unassigned' ||
    (typeof value === 'string' &&
      value.startsWith('user:') &&
      value.length > 'user:'.length)
  );
}

function isDuePressure(value: unknown): value is CapacityTriageDuePressure {
  return (
    value === 'all' ||
    value === 'due_now' ||
    value === 'scheduled' ||
    value === 'unscheduled'
  );
}

function isPriority(value: unknown): value is CapacityTriagePriority {
  return (
    value === 'all' || value === 'high' || value === 'normal' || value === 'low'
  );
}

function isPreference(value: unknown): value is CapacityTriagePreference {
  if (!value || typeof value !== 'object') return false;
  const candidate = value as Record<string, unknown>;
  return (
    isAssignee(candidate['assignee']) &&
    isDuePressure(candidate['duePressure']) &&
    isPriority(candidate['priority']) &&
    Array.isArray(candidate['tagIds']) &&
    candidate['tagIds'].every(
      (id) => typeof id === 'string' && id.trim().length > 0
    ) &&
    new Set(candidate['tagIds']).size === candidate['tagIds'].length
  );
}

function clonePreference(
  value: CapacityTriagePreference
): CapacityTriagePreference {
  return { ...value, tagIds: [...value.tagIds] };
}

function readPreference(
  records: readonly LiveCrmRecord[]
): CapacityTriagePreference {
  const record = records.find(
    (candidate) => candidate.id === RECORD_ID && candidate.kind === RECORD_KIND
  );
  return record?.['version'] === 1 && isPreference(record['preference'])
    ? clonePreference(record['preference'])
    : clonePreference(DEFAULT_CAPACITY_TRIAGE_PREFERENCE);
}

/** Reads and writes the one feature-owned preference via encrypted CRM data. */
export function useCapacityTriagePreference(): CapacityTriagePreferenceOperation {
  const live = useLiveCrmRecords();
  const preference = readPreference(live.records);
  const save = async (value: CapacityTriagePreference): Promise<void> => {
    if (!isPreference(value)) {
      throw new Error('[capacity-triage] preference failed feature validation');
    }
    const previous = live.records.find(
      (record) => record.id === RECORD_ID && record.kind === RECORD_KIND
    );
    const now = new Date().toISOString();
    await live.save({
      id: RECORD_ID,
      kind: RECORD_KIND,
      matterId: live.sharedMatterId ?? 'firm_home',
      createdAt:
        typeof previous?.createdAt === 'string' ? previous.createdAt : now,
      updatedAt: now,
      version: 1,
      preference: clonePreference(value),
    });
    await live.reload();
  };

  return {
    preference,
    error: live.error,
    save,
    reload: live.reload,
  };
}
