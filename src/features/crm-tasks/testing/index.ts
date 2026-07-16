import { renderHook, waitFor } from '@testing-library/react';
import {
  useTaskRecordStore,
  type CreateTaskRecordInput,
  type TaskRecord,
} from '@/features/crm-tasks';

/**
 * Test-only paved path for proving that a task survives canonical persistence.
 *
 * The writer is discarded before a fresh reader mounts. The returned value is
 * therefore the snapshot loaded through `crm_live_list`, never the create/save
 * response or a clone of it.
 */
export async function roundTripTaskRecord(
  input: CreateTaskRecordInput,
): Promise<TaskRecord> {
  const writer = renderHook(() => useTaskRecordStore());
  const created = await (async () => {
    try {
      return await writer.result.current.create(input);
    } finally {
      writer.unmount();
    }
  })();

  const reader = renderHook(() => useTaskRecordStore());
  try {
    let reloaded: TaskRecord | undefined;
    await waitFor(async () => {
      reloaded = await reader.result.current.get(created.id);
      if (!reloaded) throw new Error('The saved task has not reloaded yet.');
    });
    if (!reloaded) throw new Error('The saved task did not reload.');
    return reloaded;
  } finally {
    reader.unmount();
  }
}
