/**
 * The screen-level CRM record boundary.  It intentionally has no localStorage
 * fallback: a running desktop app reads and writes the SQLCipher CRM core.
 */
import { invoke, isTauri } from '@tauri-apps/api/core';
import { crmSetWorkspace } from '@/platform/utils/wealthbox-commands';

export type LiveCrmRecord = {
  id: string;
  kind: string;
  matterId?: string;
  createdAt?: string;
  updatedAt?: string;
  [key: string]: unknown;
};

type CompletedMeetingCrmDeliveryMarker = {
  readonly key: string;
  readonly field: string;
  readonly value: string | number | boolean | null;
};

const COMPLETED_MEETING_CRM_DELIVERIES = 'completedMeetingCrmDeliveries' as const;

function completedMeetingCrmDeliveries(record: LiveCrmRecord): readonly CompletedMeetingCrmDeliveryMarker[] {
  const value = record[COMPLETED_MEETING_CRM_DELIVERIES];
  return Array.isArray(value) ? value.filter((entry): entry is CompletedMeetingCrmDeliveryMarker =>
    Boolean(entry && typeof entry === 'object' && typeof (entry as any).key === 'string' &&
      typeof (entry as any).field === 'string' &&
      (typeof (entry as any).value === 'string' || typeof (entry as any).value === 'number' ||
        typeof (entry as any).value === 'boolean' || (entry as any).value === null)))
    : [];
}

/** Local-only, reloaded, idempotent one-field delivery for an approved meeting proposal. */
export async function saveApprovedMeetingCrmFieldRebased(input: {
  readonly workspaceRoot: string | null | undefined;
  readonly householdRef: string;
  readonly matterId: string;
  readonly deliveryKey: string;
  readonly field: string;
  readonly value: string | number | boolean | null;
  readonly canPersist: () => boolean;
}): Promise<{ readonly record: LiveCrmRecord; readonly deduped: boolean }> {
  if (!isTauri()) throw new Error('CRM records can only be saved in the desktop app.');
  if (!input.workspaceRoot) throw new Error('Open a workspace before saving CRM data.');
  return inCrmWorkspace(input.workspaceRoot, async () => {
    const records = await invoke<LiveCrmRecord[]>('crm_live_list');
    const household = records.find((record) => record.id === input.householdRef &&
      record.kind === 'household' && record.matterId === input.matterId);
    if (!household) throw Object.assign(new Error('The selected household is no longer available locally.'), { retryable: false });
    const rawMarkers = household[COMPLETED_MEETING_CRM_DELIVERIES];
    if (Array.isArray(rawMarkers) && rawMarkers.some((marker) =>
      marker && typeof marker === 'object' && (marker as any).key === input.deliveryKey &&
      !completedMeetingCrmDeliveries(household).includes(marker as CompletedMeetingCrmDeliveryMarker)))
      throw Object.assign(new Error('The local CRM delivery marker is malformed.'), { retryable: false });
    const prior = completedMeetingCrmDeliveries(household).find((marker) => marker.key === input.deliveryKey);
    if (prior) {
      if (prior.field === input.field && sameRecordValue(prior.value, input.value)) return { record: household, deduped: true };
      throw Object.assign(new Error('This local CRM delivery key conflicts with different content.'), { retryable: false });
    }
    if (!input.canPersist()) throw new Error('The workspace changed while CRM data was being updated. Try again.');
    const desired = {
      ...household,
      [input.field]: input.value,
      [COMPLETED_MEETING_CRM_DELIVERIES]: [...completedMeetingCrmDeliveries(household), { key: input.deliveryKey, field: input.field, value: input.value }],
    } as LiveCrmRecord;
    if (!input.canPersist()) throw new Error('The workspace changed while CRM data was being updated. Try again.');
    return { record: await invoke<LiveCrmRecord>('crm_live_upsert', { record: desired }), deduped: false };
  });
}

function sameRecordValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Rebase one screen's intended field changes onto the latest encrypted row.
 * Fields this screen did not change are preserved from `current`; if another
 * screen changed the SAME field, refuse rather than silently pick a winner.
 */
export function rebaseLiveCrmRecord(
  desired: LiveCrmRecord,
  base: LiveCrmRecord | undefined,
  current: LiveCrmRecord | undefined
): LiveCrmRecord {
  if (!base) {
    if (current)
      throw new Error(
        'This CRM record was created elsewhere. Reload and try again.'
      );
    return desired;
  }
  if (!current)
    throw new Error(
      'This CRM record was removed elsewhere. Reload and try again.'
    );
  if (
    desired.id !== base.id ||
    current.id !== base.id ||
    desired.kind !== base.kind ||
    current.kind !== base.kind
  ) {
    throw new Error('This CRM record changed identity. Reload and try again.');
  }

  const rebased: LiveCrmRecord = { ...current };
  const keys = new Set([...Object.keys(base), ...Object.keys(desired)]);
  for (const key of keys) {
    // Creation identity belongs to the canonical row. Older singleton records
    // may not have had this field yet; two stale screens must not race to
    // replace the first canonical creation timestamp they observe.
    if (key === 'createdAt') continue;
    const baseValue = base[key];
    const desiredValue = desired[key];
    if (sameRecordValue(desiredValue, baseValue)) continue;
    const currentValue = current[key];
    if (
      key !== 'updatedAt' &&
      !sameRecordValue(currentValue, baseValue) &&
      !sameRecordValue(currentValue, desiredValue)
    ) {
      throw new Error(
        `The ${key} setting changed elsewhere. Reload and try again.`
      );
    }
    if (Object.prototype.hasOwnProperty.call(desired, key)) {
      rebased[key] = desiredValue;
    } else {
      Reflect.deleteProperty(rebased, key);
    }
  }
  return rebased;
}

// The Rust CRM commands retain the active workspace between calls. Keep the
// select-workspace + read/write pair together, so an older screen load cannot
// point the backend at one workspace while a newer load reads from another.
let workspaceOperation: Promise<void> = Promise.resolve();

function inCrmWorkspace<T>(
  workspaceRoot: string,
  operation: () => Promise<T>
): Promise<T> {
  const task = workspaceOperation
    .catch(() => undefined)
    .then(async () => {
      await crmSetWorkspace(workspaceRoot);
      return operation();
    });
  workspaceOperation = task.then(
    () => undefined,
    () => undefined
  );
  return task;
}

/**
 * Lowest-level encrypted collection read. Visibility migration consumes it
 * internally; only the meeting-preferences controller receives a raw snapshot.
 * User-facing stores, lists, search, Ask, and citations use the filtered CRM
 * boundary and must never expose this result directly.
 */
export async function loadLiveCrmRecords(
  workspaceRoot: string | null | undefined
): Promise<readonly LiveCrmRecord[]> {
  if (!isTauri() || !workspaceRoot) return [];
  return inCrmWorkspace(workspaceRoot, () =>
    invoke<LiveCrmRecord[]>('crm_live_list')
  );
}

export async function saveLiveCrmRecord(
  workspaceRoot: string | null | undefined,
  record: LiveCrmRecord
): Promise<LiveCrmRecord> {
  if (!isTauri())
    throw new Error('CRM records can only be saved in the desktop app.');
  if (!workspaceRoot)
    throw new Error('Open a workspace before saving CRM data.');
  return inCrmWorkspace(workspaceRoot, () =>
    invoke<LiveCrmRecord>('crm_live_upsert', { record })
  );
}

/**
 * Atomic load/rebase/upsert under the CRM workspace queue. The final authority
 * callback runs after the canonical read and immediately before invoke starts;
 * there is no awaited gap in which a workspace switch can retarget the write.
 */
export async function saveLiveCrmRecordRebased(
  workspaceRoot: string | null | undefined,
  desired: LiveCrmRecord,
  base: LiveCrmRecord | undefined,
  canPersist: () => boolean
): Promise<LiveCrmRecord> {
  if (!isTauri())
    throw new Error('CRM records can only be saved in the desktop app.');
  if (!workspaceRoot)
    throw new Error('Open a workspace before saving CRM data.');
  return inCrmWorkspace(workspaceRoot, async () => {
    const records = await invoke<LiveCrmRecord[]>('crm_live_list');
    if (!canPersist()) {
      throw new Error(
        'The workspace changed while CRM data was being updated. Try again.'
      );
    }
    const current = records.find((record) => record.id === desired.id);
    const rebased = rebaseLiveCrmRecord(desired, base, current);
    if (!canPersist()) {
      throw new Error(
        'The workspace changed while CRM data was being updated. Try again.'
      );
    }
    return invoke<LiveCrmRecord>('crm_live_upsert', { record: rebased });
  });
}
