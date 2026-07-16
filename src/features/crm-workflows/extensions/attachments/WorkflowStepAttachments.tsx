import { useEffect, useMemo, useState } from 'react';
import { Link2, Paperclip, X } from 'lucide-react';
import { useTranslation } from 'react-i18next';
import {
  resolveWorkspaceDocumentRef,
  type WorkspaceDocumentRef,
} from '@/features/crm-documents';
import { useFirmTagStore } from '@/features/crm-tags';
import type { WorkflowStepExtensionContext } from '@/features/crm-workflows';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { useFlag } from '@/platform/flags';
import { useMatters } from '@/platform/matter/matterStore';
import type { FileNode } from '@/platform/types/workspace';
import { Badge, Button, Card } from '@/ui/kp';
import {
  addWorkflowStepAttachmentRef,
  listWorkflowStepAttachmentRefs,
  removeWorkflowStepAttachmentRef,
} from './contract';

function filesIn(tree: readonly FileNode[]): FileNode[] {
  return tree.flatMap((node) => node.type === 'file' ? [node] : filesIn(node.children ?? []));
}

function sameAttachments(
  left: readonly WorkspaceDocumentRef[],
  right: readonly WorkspaceDocumentRef[],
): boolean {
  return left.length === right.length && left.every((reference, index) => {
    const candidate = right[index];
    if (!candidate) return false;
    return reference.id === candidate.id &&
      reference.label === candidate.label &&
      reference.matterId === candidate.matterId;
  });
}

function WorkflowStepAttachmentsEnabled({ context }: { context: WorkflowStepExtensionContext }) {
  const { t } = useTranslation();
  const rootPath = useWorkspaceStore((state) => state.rootPath);
  const fileTree = useWorkspaceStore((state) => state.fileTree);
  const matters = useMatters();
  const tagStore = useFirmTagStore();
  const [pendingAttachments, setPendingAttachments] = useState<readonly WorkspaceDocumentRef[] | null>(null);
  const [selectedPath, setSelectedPath] = useState('');
  const [saving, setSaving] = useState(false);
  const [catalogReady, setCatalogReady] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void tagStore.list().then(() => {
      if (active) setCatalogReady(true);
    }).catch(() => {
      if (active) setCatalogReady(true);
    });
    return () => {
      active = false;
    };
  }, [tagStore]);

  const step = context.instance.snapshot.steps[context.stepId];
  const savedAttachments = listWorkflowStepAttachmentRefs(context);
  const refreshComplete = pendingAttachments !== null && sameAttachments(savedAttachments, pendingAttachments);
  const attachments = refreshComplete || pendingAttachments === null
    ? savedAttachments
    : pendingAttachments;
  const busy = saving && !refreshComplete;
  const targetMatterId = context.instance.matterId?.trim() || context.instance.householdId;
  const availableFiles = useMemo(
    () => rootPath ? filesIn(fileTree) : [],
    [fileTree, rootPath],
  );
  const tags = useMemo(() => {
    const byId = new Map(tagStore.catalog.tags.map((tag) => [tag.id, tag]));
    return (step?.tagIds ?? []).map((id) => ({ id, tag: byId.get(id) }));
  }, [step?.tagIds, tagStore.catalog.tags]);

  const add = async () => {
    if (!rootPath || !selectedPath || busy) return;
    setSaving(true);
    setError(null);
    try {
      const reference = resolveWorkspaceDocumentRef({
        path: selectedPath,
        workspaceRoot: rootPath,
        fileTree,
        matters,
        targetMatterId,
        existing: attachments,
      });
      setPendingAttachments(await addWorkflowStepAttachmentRef(context, reference));
      setSelectedPath('');
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('workflowStepAttachments.saveFailed'));
      setSaving(false);
    }
  };

  const remove = async (documentPath: string) => {
    if (busy) return;
    setSaving(true);
    setError(null);
    try {
      setPendingAttachments(await removeWorkflowStepAttachmentRef(context, documentPath));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : t('workflowStepAttachments.saveFailed'));
      setSaving(false);
    }
  };

  return (
    <Card data-testid={`workflow-step-attachments-${context.instance.id}-${context.stepId}`} variant="raised">
      <div style={{ alignItems: 'center', display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <div>
          <strong>{t('workflowStepAttachments.heading')}</strong>
          <p style={{ margin: '4px 0 0' }}>{t('workflowStepAttachments.copy')}</p>
        </div>
        <Paperclip aria-hidden="true" size={18} />
      </div>
      {catalogReady && tags.length > 0 ? (
        <div aria-label={t('workflowStepAttachments.tags')} data-testid="workflow-step-attachment-tags" style={{ display: 'flex', flexWrap: 'wrap', gap: 6, marginTop: 10 }}>
          {tags.map(({ id, tag }) => (
            <Badge key={id} variant={tag?.status === 'retired' ? 'warning' : 'neutral'}>
              {tag ? `${tag.name}${tag.status === 'retired' ? ` · ${t('workflowStepAttachments.retired')}` : ''}` : t('workflowStepAttachments.unavailableTag', { id })}
            </Badge>
          ))}
        </div>
      ) : null}
      <div style={{ display: 'flex', flexWrap: 'wrap', gap: 8, marginTop: 12 }}>
        <label>
          {t('workflowStepAttachments.document')}
          <select data-testid="workflow-step-attachment-picker" disabled={!rootPath || busy} onChange={(event) => { setSelectedPath(event.target.value); }} value={selectedPath}>
            <option value="">{t('workflowStepAttachments.chooseDocument')}</option>
            {availableFiles.map((file) => <option key={file.path} value={file.path}>{file.name}</option>)}
          </select>
        </label>
        <Button data-testid="workflow-step-attachment-add" disabled={!selectedPath || busy} iconLeft={Link2} onClick={() => {
          void add().catch((reason: unknown) => {
            setError(reason instanceof Error ? reason.message : t('workflowStepAttachments.saveFailed'));
          });
        }} size="sm">
          {t('workflowStepAttachments.add')}
        </Button>
      </div>
      {!rootPath ? <p data-testid="workflow-step-attachment-workspace-needed">{t('workflowStepAttachments.workspaceNeeded')}</p> : null}
      {rootPath && availableFiles.length === 0 ? <p data-testid="workflow-step-attachment-no-files">{t('workflowStepAttachments.noFiles')}</p> : null}
      {attachments.length === 0 ? <p data-testid="workflow-step-attachment-empty">{t('workflowStepAttachments.empty')}</p> : (
        <ul data-testid="workflow-step-attachment-list">
          {attachments.map((attachment) => (
            <li key={attachment.id}>
              <span>{attachment.label}</span>
              <Button aria-label={t('workflowStepAttachments.removeFor', { name: attachment.label })} data-testid={`workflow-step-attachment-remove-${attachment.id}`} disabled={busy} iconLeft={X} onClick={() => {
                void remove(attachment.id).catch((reason: unknown) => {
                  setError(reason instanceof Error ? reason.message : t('workflowStepAttachments.saveFailed'));
                });
              }} size="sm" variant="secondary">
                {t('workflowStepAttachments.remove')}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {error ? <p data-testid="workflow-step-attachment-error" role="alert">{error}</p> : null}
    </Card>
  );
}

/** Flag guard stays outside every workspace, workflow, and tag read. */
export function WorkflowStepAttachments({ context }: { context: WorkflowStepExtensionContext }) {
  const enabled = useFlag('workflow-step-attachments');
  if (!enabled) return null;
  return <WorkflowStepAttachmentsEnabled context={context} />;
}
