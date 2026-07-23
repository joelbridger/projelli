import { invoke, isTauri } from '@tauri-apps/api/core';

/**
 * Dark native-only doorway for one already-approved meeting Task proposal.
 * The caller may identify only the encrypted artifact and its approved
 * revision; it never supplies a client, Task fields, or delivery identity.
 */
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
  if (!isTauri())
    throw new Error('Local meeting Tasks are available only in the desktop app.');
  return invoke<LocalMeetingTaskReceipt>('crm_local_meeting_task_create', {
    request: {
      artifactId: input.artifactId,
      proposalRevision: input.proposalRevision,
    },
  });
}
