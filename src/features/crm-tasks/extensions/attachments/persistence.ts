import {
  WorkspaceDocumentRefError,
  addWorkspaceDocumentRef,
  listWorkspaceDocumentRefs,
  removeWorkspaceDocumentRef,
  resolveWorkspaceDocumentRef,
  type ResolveWorkspaceDocumentRefInput,
} from '@/features/crm-documents';
import type { TaskRecord, TaskRecordStore } from '@/features/crm-tasks';

type AttachWorkspaceDocumentInput = Omit<
  ResolveWorkspaceDocumentRefInput,
  'existing' | 'targetMatterId'
> & {
  taskId: string;
  targetHouseholdId: string;
  targetMatterId: string;
};

interface TaskDocumentScope {
  targetHouseholdId: string;
  targetMatterId: string;
}

async function currentTask(
  store: TaskRecordStore,
  taskId: string
): Promise<TaskRecord> {
  const task = await store.get(taskId);
  if (!task) throw new Error('That task no longer exists.');
  return task;
}

function validatedHouseholdRef(
  task: TaskRecord,
  scope: TaskDocumentScope,
  inputMatters?: ResolveWorkspaceDocumentRefInput['matters']
) {
  const savedMatterId =
    task.householdRef?.matterId?.trim() || task.householdRef?.id.trim();
  if (
    !task.householdRef ||
    task.householdRef.id !== scope.targetHouseholdId ||
    !scope.targetMatterId.trim() ||
    savedMatterId !== scope.targetMatterId ||
    (inputMatters &&
      !inputMatters.some((matter) => matter.id === scope.targetMatterId))
  ) {
    throw new WorkspaceDocumentRefError(
      'wrong_matter',
      'Save the task client before changing its documents.'
    );
  }
  return task.householdRef;
}

/**
 * Resolves one current workspace file through crm-documents, then updates only
 * the task's document view. The canonical task store retains all other fields
 * and all non-document relations when it merges the patch.
 */
export async function attachWorkspaceDocumentToTask(
  store: TaskRecordStore,
  input: AttachWorkspaceDocumentInput
): Promise<TaskRecord> {
  const task = await currentTask(store, input.taskId);
  const householdRef = validatedHouseholdRef(task, input, input.matters);
  const ref = resolveWorkspaceDocumentRef({
    path: input.path,
    workspaceRoot: input.workspaceRoot,
    fileTree: input.fileTree,
    matters: input.matters,
    targetMatterId: input.targetMatterId,
    existing: task.contextRefs,
  });
  const contextRefs = listWorkspaceDocumentRefs(
    addWorkspaceDocumentRef(task.contextRefs, ref)
  );
  return store.update(task.id, { householdRef, contextRefs });
}

/** Removes only the named pointer. The workspace file is never opened or changed. */
export async function detachWorkspaceDocumentFromTask(
  store: TaskRecordStore,
  taskId: string,
  documentId: string,
  scope: TaskDocumentScope
): Promise<TaskRecord> {
  const task = await currentTask(store, taskId);
  const householdRef = validatedHouseholdRef(task, scope);
  const contextRefs = listWorkspaceDocumentRefs(
    removeWorkspaceDocumentRef(task.contextRefs, documentId)
  );
  return store.update(task.id, { householdRef, contextRefs });
}
