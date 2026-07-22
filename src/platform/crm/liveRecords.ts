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
