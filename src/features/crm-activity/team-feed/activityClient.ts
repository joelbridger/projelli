import { invoke, isTauri } from '@tauri-apps/api/core';
import { emitAuditEntry } from '@/features/audit';
import { isEnabled } from '@/platform/flags';
import { LIVE_CRM_RECORDS_CHANGED } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { crmSetWorkspace } from '@/platform/utils/wealthbox-commands';
import type {
  TeamActivityComment,
  TeamActivityPost,
  TeamActivityReaction,
} from './contracts';
import type { TeamActivityAuditEvent, TeamActivityStore } from './feed';

let activityWorkspaceOperation: Promise<void> = Promise.resolve();

async function inActivityWorkspace<T>(
  workspaceRoot: string | null | undefined,
  operation: () => Promise<T>
): Promise<T> {
  if (!workspaceRoot) throw new Error('Open a workspace before using team activity.');
  const task = activityWorkspaceOperation.then(async () => {
    await crmSetWorkspace(workspaceRoot);
    return operation();
  });
  activityWorkspaceOperation = task.then(() => undefined, () => undefined);
  return task;
}

async function auditActivityRequest(event: TeamActivityAuditEvent): Promise<void> {
  await emitAuditEntry({
    action: 'user_action',
    description: `Team activity ${event.operation} requested`,
    model: undefined,
    inputs: {},
    outputs: {},
    userDecision: 'auto',
    // No post body, comment body, emoji, member id, or display label belongs
    // in durable audit metadata.
    metadata: {
      activityId: event.activityId,
      operation: event.operation,
      mentionCount: event.mentionCount,
      state: event.state,
    },
  });
}

function requireMutationRuntime(): void {
  if (!isEnabled('team-activity-feed')) {
    throw new Error('Team activity is not enabled.');
  }
  if (!isTauri()) {
    throw new Error('Team activity can only be changed in the desktop app.');
  }
}

export function createNativeTeamActivityStore({
  workspaceRoot,
  publishSavedRecord,
}: {
  workspaceRoot: string | null | undefined;
  publishSavedRecord: (record: LiveCrmRecord) => LiveCrmRecord;
}): TeamActivityStore {
  const persist = async <T extends LiveCrmRecord>(operation: () => Promise<T>): Promise<T> => {
    requireMutationRuntime();
    const saved = await inActivityWorkspace(workspaceRoot, operation);
    publishSavedRecord(saved);
    return saved;
  };

  return {
    async load(matterId) {
      if (!isTauri() || !workspaceRoot) return [];
      return inActivityWorkspace(workspaceRoot, () =>
        invoke<LiveCrmRecord[]>('crm_activity_list', { matterId })
      );
    },
    createPost: (input) => persist(() =>
      invoke<TeamActivityPost>('crm_activity_create_post', { input })
    ),
    addComment: (input) => persist(() =>
      invoke<TeamActivityComment>('crm_activity_add_comment', { input })
    ),
    setReaction: (input) => persist(() =>
      invoke<TeamActivityReaction>('crm_activity_set_reaction', { input })
    ),
    subscribe(listener) {
      const onChange = () => { listener(); };
      window.addEventListener(LIVE_CRM_RECORDS_CHANGED, onChange);
      return () => { window.removeEventListener(LIVE_CRM_RECORDS_CHANGED, onChange); };
    },
    audit: auditActivityRequest,
  };
}
