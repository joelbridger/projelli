import { DEFAULT_CAPACITY_TRIAGE_PREFERENCE } from './triage';
import type {
  CapacityTriageAssignee,
  CapacityTriageDuePressure,
  CapacityTriagePreference,
  CapacityTriagePriority,
} from './contract';

export type CapacityTriagePreferenceStorage = Pick<
  Storage,
  'getItem' | 'setItem' | 'removeItem'
>;

export interface CapacityTriagePreferenceStore {
  load(): CapacityTriagePreference;
  save(value: CapacityTriagePreference): void;
  clear(): void;
}

const STORAGE_KEY = 'lantern:crm:tasks:capacity-triage:preferences:v1';

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

/** One versioned browser-preference slot, owned solely by this feature. */
export function createCapacityTriagePreferenceStore(
  storage: CapacityTriagePreferenceStorage | undefined = typeof localStorage ===
  'undefined'
    ? undefined
    : localStorage
): CapacityTriagePreferenceStore {
  return {
    load: () => {
      try {
        const raw = storage?.getItem(STORAGE_KEY);
        if (!raw) return clonePreference(DEFAULT_CAPACITY_TRIAGE_PREFERENCE);
        const parsed: unknown = JSON.parse(raw);
        if (!parsed || typeof parsed !== 'object') {
          return clonePreference(DEFAULT_CAPACITY_TRIAGE_PREFERENCE);
        }
        const envelope = parsed as { version?: unknown; value?: unknown };
        return envelope.version === 1 && isPreference(envelope.value)
          ? clonePreference(envelope.value)
          : clonePreference(DEFAULT_CAPACITY_TRIAGE_PREFERENCE);
      } catch {
        return clonePreference(DEFAULT_CAPACITY_TRIAGE_PREFERENCE);
      }
    },
    save: (value) => {
      if (!isPreference(value)) {
        throw new Error(
          '[capacity-triage] preference failed feature validation'
        );
      }
      storage?.setItem(STORAGE_KEY, JSON.stringify({ version: 1, value }));
    },
    clear: () => {
      storage?.removeItem(STORAGE_KEY);
    },
  };
}

export const capacityTriagePreferences = createCapacityTriagePreferenceStore();
