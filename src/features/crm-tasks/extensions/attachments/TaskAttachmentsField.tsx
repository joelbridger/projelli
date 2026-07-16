import { useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { FileText, Paperclip, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  WorkspaceDocumentRefError,
  addWorkspaceDocumentRef,
  listWorkspaceDocumentRefs,
  removeWorkspaceDocumentRef,
  resolveWorkspaceDocumentRef,
} from '@/features/crm-documents';
import { useFirmTagStore, type FirmTag } from '@/features/crm-tags';
import { useTaskRecordStore } from '@/features/crm-tasks';
import type { TaskFieldContext } from '@/features/crm-tasks/taskExtensionRegistry';
import { useFlag } from '@/platform/flags';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import type { FileNode } from '@/platform/types/workspace';
import type { Matter } from '@/platform/types/matter';
import { Button, Card } from '@/ui/kp';
import {
  attachWorkspaceDocumentToTask,
  detachWorkspaceDocumentFromTask,
} from './persistence';

type TaskAttachmentsFieldProps = Pick<
  TaskFieldContext,
  'task' | 'updateTask' | 'setPersistenceBusy' | 'households'
>;

function filesIn(tree: readonly FileNode[]): FileNode[] {
  return tree.flatMap((node) =>
    node.type === 'file' ? [node] : filesIn(node.children ?? [])
  );
}

const TASK_STORE_HYDRATION_RETRY_DELAYS_MS = [
  100, 250, 500, 1_000, 2_000, 4_000,
] as const;

function resolvedTags(
  ids: readonly string[],
  catalog: readonly FirmTag[]
): readonly FirmTag[] {
  const byId = new Map(catalog.map((tag) => [tag.id, tag]));
  return ids.flatMap((id) => {
    const tag = byId.get(id);
    return tag ? [tag] : [];
  });
}

function mappedMatterId(
  householdId: string | undefined,
  households: TaskAttachmentsFieldProps['households'],
  matters: readonly Matter[]
): string | null {
  if (!householdId) return null;
  const household = households.find(
    (candidate) => candidate.id === householdId
  );
  const runtimeMatterId =
    household &&
    typeof (household as Record<string, unknown>)['matterId'] === 'string'
      ? String((household as Record<string, unknown>)['matterId'])
      : '';
  if (
    runtimeMatterId &&
    matters.some((matter) => matter.id === runtimeMatterId)
  ) {
    return runtimeMatterId;
  }
  if (matters.some((matter) => matter.id === householdId)) return householdId;
  return null;
}

/**
 * The dark-path guard intentionally reads only its flag. File, task, matter,
 * and tag hooks are confined to the enabled child, so OFF leaves no gap or
 * data-load side effect in Task detail.
 */
export function TaskAttachmentsField(props: TaskAttachmentsFieldProps) {
  const enabled = useFlag('task-attachments');
  if (!enabled) return null;
  return <EnabledTaskAttachmentsField {...props} />;
}

function EnabledTaskAttachmentsField({
  task,
  updateTask,
  setPersistenceBusy,
  households,
}: TaskAttachmentsFieldProps) {
  const { t } = useTranslation();
  const taskRef = useRef(task);
  taskRef.current = task;
  const taskStore = useTaskRecordStore();
  const taskStoreRef = useRef(taskStore);
  taskStoreRef.current = taskStore;
  const tagStore = useFirmTagStore();
  const tagStoreRef = useRef(tagStore);
  tagStoreRef.current = tagStore;
  const tagCatalogKey = JSON.stringify(tagStore.catalog);
  const workspaceRoot = useWorkspaceStore((state) => state.rootPath);
  const tree = useWorkspaceStore((state) => state.fileTree);
  const matters = useMatterStore((state) => state.matters);
  const [fileId, setFileId] = useState('');
  const [catalog, setCatalog] = useState(tagStore.catalog.tags);
  const [attachments, setAttachments] = useState(() =>
    listWorkspaceDocumentRefs(task.documentRefs)
  );
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [taskAvailability, setTaskAvailability] = useState<
    'loading' | 'ready' | 'missing'
  >('loading');
  const attachmentHouseholdIdRef = useRef(
    listWorkspaceDocumentRefs(task.documentRefs).length
      ? task.householdId
      : undefined
  );
  const tags = resolvedTags(task.tagIds, catalog);
  const targetMatterId = mappedMatterId(task.householdId, households, matters);
  const availableFiles = useMemo(() => {
    if (!workspaceRoot || !targetMatterId) return [];
    return filesIn(tree).filter((file) => {
      try {
        resolveWorkspaceDocumentRef({
          path: file.path,
          workspaceRoot,
          fileTree: [file],
          matters,
          targetMatterId,
        });
        return true;
      } catch {
        return false;
      }
    });
  }, [matters, targetMatterId, tree, workspaceRoot]);

  useEffect(() => {
    setAttachments(listWorkspaceDocumentRefs(task.documentRefs));
  }, [task.documentRefs]);

  useEffect(() => {
    let active = true;
    let retry: number | undefined;
    let retryIndex = 0;
    setTaskAvailability('loading');
    const check = async () => {
      try {
        const stored = await taskStoreRef.current.get(task.id);
        if (!active) return;
        if (stored) {
          setTaskAvailability('ready');
          return;
        }
      } catch {
        if (!active) return;
      }
      setTaskAvailability('missing');
      const delay = TASK_STORE_HYDRATION_RETRY_DELAYS_MS[retryIndex];
      if (delay === undefined) return;
      retryIndex += 1;
      retry = window.setTimeout(() => {
        void check().catch(() => {
          if (active) setTaskAvailability('missing');
        });
      }, delay);
    };
    void check().catch(() => {
      if (active) setTaskAvailability('missing');
    });
    return () => {
      active = false;
      if (retry !== undefined) window.clearTimeout(retry);
    };
  }, [task.id]);

  useLayoutEffect(() => {
    if (!attachments.length) {
      attachmentHouseholdIdRef.current = task.householdId;
      return;
    }
    const attachmentHouseholdId = attachmentHouseholdIdRef.current;
    if (!attachmentHouseholdId || task.householdId === attachmentHouseholdId) {
      return;
    }
    const household = households.find(
      (candidate) => candidate.id === attachmentHouseholdId
    );
    setMessage(t('task-attachments.errors.remove-before-client-change'));
    updateTask({
      ...task,
      householdId: attachmentHouseholdId,
      householdLabel: household?.name,
      contextRefs: [attachmentHouseholdId],
      documentRefs: attachments,
    });
  }, [attachments, households, t, task, updateTask]);

  useEffect(() => {
    let active = true;
    const currentTagStore = tagStoreRef.current;
    void currentTagStore
      .list()
      .then((next) => {
        if (active) setCatalog(next.tags);
      })
      .catch(() => {
        if (active) setCatalog(currentTagStore.catalog.tags);
      });
    return () => {
      active = false;
    };
  }, [tagCatalogKey]);

  const updateLatestDraftDocuments = (
    nextAttachments: ReturnType<typeof listWorkspaceDocumentRefs>,
    householdId: string
  ) => {
    const latest = taskRef.current;
    const household = households.find(
      (candidate) => candidate.id === householdId
    );
    updateTask({
      ...latest,
      householdId,
      householdLabel: household?.name,
      contextRefs: [householdId],
      documentRefs: nextAttachments,
    });
  };

  const add = async () => {
    const file = availableFiles.find((candidate) => candidate.path === fileId);
    if (!file) {
      setMessage(t('task-attachments.errors.choose-file'));
      return;
    }
    if (taskAvailability !== 'ready' || !task.householdId || !targetMatterId) {
      setMessage(t('task-attachments.errors.save-task-first'));
      return;
    }
    const targetHouseholdId = task.householdId;
    const previousAttachments = attachments;
    let pendingAttachments: ReturnType<typeof listWorkspaceDocumentRefs>;
    try {
      const pendingRef = resolveWorkspaceDocumentRef({
        path: file.path,
        workspaceRoot: workspaceRoot ?? '',
        fileTree: tree,
        matters,
        targetMatterId,
        existing: previousAttachments,
      });
      pendingAttachments = listWorkspaceDocumentRefs(
        addWorkspaceDocumentRef(previousAttachments, pendingRef)
      );
    } catch (error: unknown) {
      setMessage(
        error instanceof WorkspaceDocumentRefError && error.code === 'duplicate'
          ? t('task-attachments.errors.duplicate')
          : t('task-attachments.errors.invalid-document')
      );
      return;
    }
    attachmentHouseholdIdRef.current = targetHouseholdId;
    setAttachments(pendingAttachments);
    updateLatestDraftDocuments(pendingAttachments, targetHouseholdId);
    setPersistenceBusy?.(true);
    setSaving(true);
    try {
      const updated = await attachWorkspaceDocumentToTask(taskStore, {
        taskId: task.id,
        targetHouseholdId,
        targetMatterId,
        path: file.path,
        workspaceRoot: workspaceRoot ?? '',
        fileTree: tree,
        matters,
      });
      const nextAttachments = listWorkspaceDocumentRefs(updated.contextRefs);
      attachmentHouseholdIdRef.current = targetHouseholdId;
      setAttachments(nextAttachments);
      updateLatestDraftDocuments(nextAttachments, targetHouseholdId);
      setFileId('');
      setMessage(t('task-attachments.status.added', { name: file.name }));
    } catch (error: unknown) {
      setAttachments(previousAttachments);
      updateLatestDraftDocuments(previousAttachments, targetHouseholdId);
      setMessage(
        error instanceof WorkspaceDocumentRefError && error.code === 'duplicate'
          ? t('task-attachments.errors.duplicate')
          : error instanceof WorkspaceDocumentRefError
            ? t('task-attachments.errors.invalid-document')
            : t('task-attachments.errors.save')
      );
    } finally {
      setPersistenceBusy?.(false);
      setSaving(false);
    }
  };

  const remove = async (id: string) => {
    if (!task.householdId || !targetMatterId) {
      setMessage(t('task-attachments.errors.save-task-first'));
      return;
    }
    const targetHouseholdId = task.householdId;
    const previousAttachments = attachments;
    const pendingAttachments = listWorkspaceDocumentRefs(
      removeWorkspaceDocumentRef(previousAttachments, id)
    );
    setAttachments(pendingAttachments);
    updateLatestDraftDocuments(pendingAttachments, targetHouseholdId);
    setPersistenceBusy?.(true);
    setSaving(true);
    try {
      const updated = await detachWorkspaceDocumentFromTask(
        taskStore,
        task.id,
        id,
        {
          targetHouseholdId,
          targetMatterId,
        }
      );
      const nextAttachments = listWorkspaceDocumentRefs(updated.contextRefs);
      setAttachments(nextAttachments);
      if (nextAttachments.length) {
        updateLatestDraftDocuments(nextAttachments, targetHouseholdId);
      } else {
        const latest = taskRef.current;
        updateTask({ ...latest, documentRefs: nextAttachments });
      }
      setMessage(t('task-attachments.status.removed'));
    } catch {
      setAttachments(previousAttachments);
      updateLatestDraftDocuments(previousAttachments, targetHouseholdId);
      setMessage(t('task-attachments.errors.save'));
    } finally {
      setPersistenceBusy?.(false);
      setSaving(false);
    }
  };

  return (
    <Card
      variant="raised"
      data-testid="crm-task-attachments"
      style={{ display: 'grid', gap: 10 }}
    >
      <div>
        <strong>{t('task-attachments.title')}</strong>
        <p style={{ margin: '4px 0 0', color: 'var(--kp-text-faint)' }}>
          {t('task-attachments.helper')}
        </p>
      </div>
      {tags.length ? (
        <div
          data-testid="crm-task-attachment-tags"
          aria-label={t('task-attachments.tag-context')}
          style={{ display: 'flex', flexWrap: 'wrap', gap: 6 }}
        >
          {tags.map((tag) => (
            <span
              key={tag.id}
              data-testid={`crm-task-attachment-tag-${tag.id}`}
              style={{
                display: 'inline-flex',
                gap: 5,
                alignItems: 'center',
                padding: '2px 7px',
                border: '1px solid var(--kp-border)',
                borderRadius: 'var(--radius-pill)',
              }}
            >
              <span
                aria-hidden="true"
                style={{
                  width: 8,
                  height: 8,
                  borderRadius: '50%',
                  background: tag.color,
                }}
              />
              {tag.name}
              {tag.status === 'retired'
                ? ` (${t('task-attachments.retired')})`
                : ''}
            </span>
          ))}
        </div>
      ) : null}
      <label>
        {t('task-attachments.file-label')}
        <select
          data-testid="crm-task-attachment-file"
          value={fileId}
          disabled={saving || taskAvailability !== 'ready' || !targetMatterId}
          onChange={(event) => {
            setFileId(event.target.value);
          }}
          style={{ display: 'block', marginTop: 4, width: '100%' }}
        >
          <option value="">{t('task-attachments.choose-file')}</option>
          {availableFiles.map((file) => (
            <option key={file.path} value={file.path}>
              {file.name}
            </option>
          ))}
        </select>
      </label>
      <Button
        size="sm"
        iconLeft={Paperclip}
        data-testid="crm-task-attachment-add"
        disabled={saving || taskAvailability !== 'ready' || !targetMatterId}
        onClick={() => {
          void add().catch(() => {
            setMessage(t('task-attachments.errors.save'));
          });
        }}
      >
        {t('task-attachments.add')}
      </Button>
      {taskAvailability === 'missing' ? (
        <p data-testid="crm-task-attachments-save-first" style={{ margin: 0 }}>
          {t('task-attachments.errors.save-task-first')}
        </p>
      ) : null}
      {attachments.length ? (
        <ul
          data-testid="crm-task-attachment-list"
          style={{
            display: 'grid',
            gap: 6,
            listStyle: 'none',
            margin: 0,
            padding: 0,
          }}
        >
          {attachments.map((attachment) => (
            <li
              key={attachment.id}
              data-testid={`crm-task-attachment-${attachment.id}`}
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'space-between',
                gap: 8,
                borderTop: '1px solid var(--kp-border)',
                paddingTop: 6,
              }}
            >
              <span
                style={{ display: 'inline-flex', alignItems: 'center', gap: 6 }}
              >
                <FileText size={16} aria-hidden="true" />
                {attachment.label}
              </span>
              <Button
                size="sm"
                variant="secondary"
                iconLeft={X}
                data-testid={`crm-task-attachment-remove-${attachment.id}`}
                disabled={
                  saving || taskAvailability !== 'ready' || !targetMatterId
                }
                onClick={() => {
                  void remove(attachment.id).catch(() => {
                    setMessage(t('task-attachments.errors.save'));
                  });
                }}
              >
                {t('task-attachments.remove')}
              </Button>
            </li>
          ))}
        </ul>
      ) : (
        <p data-testid="crm-task-attachments-empty" style={{ margin: 0 }}>
          {t('task-attachments.empty')}
        </p>
      )}
      {message ? <p role="status">{message}</p> : null}
    </Card>
  );
}
