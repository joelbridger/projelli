import { invoke, isTauri } from '@tauri-apps/api/core';

/** A dark native-only doorway for a single approved meeting Task artifact. */
export interface LocalMeetingTaskReceipt {
  artifactId: string;
  proposalRevision: string;
  deliveryKey: string;
  taskId: string;
  status: 'created' | 'replayed';
}

export async function createLocalMeetingTask(input: {
  readonly artifactId: string;
  readonly proposalRevision: string;
}): Promise<LocalMeetingTaskReceipt> {
  if (!isTauri()) {
    throw new Error('Local meeting Tasks are available only in the desktop app.');
  }
  return invoke<LocalMeetingTaskReceipt>('crm_local_meeting_task_create', {
    request: {
      artifactId: input.artifactId,
      proposalRevision: input.proposalRevision,
    },
  });
}
