import '@/i18n';
import '@testing-library/jest-dom/vitest';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { createTemplate, startWorkflow, workflowRecords } from '@/features/crm-home/workflowLive';
import type { LiveWorkflowInstance } from '@/features/crm-home/workflowLive';
import {
  addWorkflowStepAttachmentRef,
  listWorkflowStepAttachmentRefs,
  patchWorkflowStepMetadata,
  removeWorkflowStepAttachmentRef,
  type WorkflowStepExtensionContext,
} from '@/features/crm-workflows';
import type { WorkspaceDocumentRef } from '@/features/crm-documents';
import type { FirmTagStore } from '@/features/crm-tags';
import { setDevFlagOverride } from '@/platform/flags';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';
import { WorkflowStepAttachments } from './WorkflowStepAttachments';

const { useFirmTagStore } = vi.hoisted(() => ({ useFirmTagStore: vi.fn() }));

vi.mock('@/features/crm-tags', async (importOriginal) => ({
  ...(await importOriginal<typeof import('@/features/crm-tags')>()),
  useFirmTagStore,
}));

function makeStore(): FirmTagStore {
  return {
    catalog: { version: 1, tags: [{ id: 'tag-prep', name: 'Preparation', color: '#2563eb', status: 'retired' }] },
    errorCode: null,
    list: vi.fn().mockResolvedValue({ version: 1, tags: [] }),
    create: vi.fn(), rename: vi.fn(), setColor: vi.fn(), retire: vi.fn(),
  };
}

function makeContext(): { context: WorkflowStepExtensionContext; saves: LiveWorkflowInstance[] } {
  const template = createTemplate('Annual review', ['Prepare']);
  const initialStep = template.steps[0];
  if (!initialStep) throw new Error('Expected template step');
  initialStep.tagIds = ['tag-prep'];
  let saved = startWorkflow(template, { id: 'matter-river', label: 'River household', matterId: 'matter-river' });
  const saves: LiveWorkflowInstance[] = [];
  const stepId = Object.keys(saved.snapshot.steps)[0];
  if (!stepId) throw new Error('Expected stable workflow step');
  return { context: {
    instance: saved, stepId, compatibilityMount: null,
    saveStepMetadata: (patch) => {
      saved = patchWorkflowStepMetadata(saved, stepId, patch);
      const reloaded = structuredClone(saved);
      saves.push(reloaded);
      return Promise.resolve(reloaded);
    },
  }, saves };
}

function configureWorkspace() {
  useWorkspaceStore.setState({
    rootPath: '/workspace',
    fileTree: [{ id: 'river', name: 'River', path: '/workspace/Clients/River', type: 'folder', children: [
      { id: 'review', name: 'review.docx', path: '/workspace/Clients/River/review.docx', type: 'file' },
      { id: 'summary', name: 'summary.pdf', path: '/workspace/Clients/River/summary.pdf', type: 'file' },
      { id: 'other', name: 'other.pdf', path: '/workspace/Clients/Other/other.pdf', type: 'file' },
    ] }],
  });
  useMatterStore.setState({ matters: [
    { id: 'matter-river', name: 'River', client: 'River', folderPaths: ['/workspace/Clients/River'], createdAt: '2026-01-01T00:00:00Z' },
    { id: 'matter-other', name: 'Other', client: 'Other', folderPaths: ['/workspace/Clients/Other'], createdAt: '2026-01-01T00:00:00Z' },
  ] });
}

afterEach(() => {
  cleanup();
  setDevFlagOverride('workflow-step-attachments', undefined);
  useWorkspaceStore.setState({ rootPath: null, fileTree: [] });
  useMatterStore.setState({ matters: [] });
  useFirmTagStore.mockReset();
});

describe('workflow-step attachments', () => {
  it('exports only durable list, add, and remove attachment operations', () => {
    expect(typeof listWorkflowStepAttachmentRefs).toBe('function');
    expect(typeof addWorkflowStepAttachmentRef).toBe('function');
    expect(typeof removeWorkflowStepAttachmentRef).toBe('function');
  });

  it('is inert while flag-off, with no workspace, tag, or workflow save read', () => {
    const test = makeContext();
    useFirmTagStore.mockReturnValue(makeStore());
    setDevFlagOverride('workflow-step-attachments', false);
    const { container } = render(<WorkflowStepAttachments context={test.context} />);
    expect(container).toBeEmptyDOMElement();
    expect(useFirmTagStore).not.toHaveBeenCalled();
    expect(test.saves).toEqual([]);
  });

  it('validates, saves, reloads, lists, and removes one stable-step document reference', async () => {
    configureWorkspace();
    const test = makeContext();
    useFirmTagStore.mockReturnValue(makeStore());
    setDevFlagOverride('workflow-step-attachments', true);
    const view = render(<WorkflowStepAttachments context={test.context} />);
    fireEvent.change(screen.getByTestId('workflow-step-attachment-picker'), { target: { value: '/workspace/Clients/River/review.docx' } });
    fireEvent.click(screen.getByTestId('workflow-step-attachment-add'));
    await waitFor(() => { expect(screen.getByTestId('workflow-step-attachment-list')).toHaveTextContent('review.docx'); });
    expect(test.saves).toHaveLength(1);

    const firstSave = test.saves[0];
    if (!firstSave) throw new Error('Expected saved workflow instance');
    const reopened = workflowRecords([firstSave]).instances[0];
    if (!reopened) throw new Error('Expected reloaded workflow instance');
    const reopenedContext = { ...test.context, instance: reopened };
    expect(listWorkflowStepAttachmentRefs(reopenedContext)).toEqual([{ kind: 'document', id: 'Clients/River/review.docx', label: 'review.docx', matterId: 'matter-river' }]);

    view.rerender(<WorkflowStepAttachments context={reopenedContext} />);
    await waitFor(() => { expect(screen.getByTestId('workflow-step-attachment-remove-Clients/River/review.docx')).not.toBeDisabled(); });
    fireEvent.click(screen.getByTestId('workflow-step-attachment-remove-Clients/River/review.docx'));
    await waitFor(() => { expect(screen.getByTestId('workflow-step-attachment-empty')).toBeInTheDocument(); });
  });

  it('refuses a wrong-client document without saving or copying tag data', async () => {
    configureWorkspace();
    const test = makeContext();
    useFirmTagStore.mockReturnValue(makeStore());
    setDevFlagOverride('workflow-step-attachments', true);
    render(<WorkflowStepAttachments context={test.context} />);
    fireEvent.change(screen.getByTestId('workflow-step-attachment-picker'), { target: { value: '/workspace/Clients/Other/other.pdf' } });
    fireEvent.click(screen.getByTestId('workflow-step-attachment-add'));
    await waitFor(() => { expect(screen.getByTestId('workflow-step-attachment-error')).toHaveTextContent('wrong_matter'); });
    expect(test.saves).toEqual([]);
    expect(test.context.instance.snapshot.steps[test.context.stepId]?.tagIds).toEqual(['tag-prep']);
  });

  it('rejects duplicate document references through the public document contract', async () => {
    const test = makeContext();
    const ref: WorkspaceDocumentRef = { kind: 'document', id: 'Clients/River/review.docx', label: 'review.docx', matterId: 'matter-river' };
    await addWorkflowStepAttachmentRef(test.context, ref);
    const saved = test.saves[0];
    if (!saved) throw new Error('Expected saved attachment');
    await expect(addWorkflowStepAttachmentRef({ ...test.context, instance: saved }, ref)).rejects.toMatchObject({ code: 'duplicate' });
  });

  it('holds further saves until the live step refreshes, then preserves earlier references', async () => {
    configureWorkspace();
    const test = makeContext();
    useFirmTagStore.mockReturnValue(makeStore());
    setDevFlagOverride('workflow-step-attachments', true);
    const view = render(<WorkflowStepAttachments context={test.context} />);

    fireEvent.change(screen.getByTestId('workflow-step-attachment-picker'), { target: { value: '/workspace/Clients/River/review.docx' } });
    fireEvent.click(screen.getByTestId('workflow-step-attachment-add'));
    await waitFor(() => { expect(test.saves).toHaveLength(1); });
    expect(screen.getByTestId('workflow-step-attachment-add')).toBeDisabled();

    const saved = test.saves[0];
    if (!saved) throw new Error('Expected first saved attachment');
    view.rerender(<WorkflowStepAttachments context={{ ...test.context, instance: saved }} />);
    await waitFor(() => { expect(screen.getByTestId('workflow-step-attachment-picker')).not.toBeDisabled(); });
    fireEvent.change(screen.getByTestId('workflow-step-attachment-picker'), { target: { value: '/workspace/Clients/River/summary.pdf' } });
    fireEvent.click(screen.getByTestId('workflow-step-attachment-add'));
    await waitFor(() => { expect(test.saves).toHaveLength(2); });

    const secondSave = test.saves[1];
    if (!secondSave) throw new Error('Expected second saved attachment');
    expect(listWorkflowStepAttachmentRefs({ ...test.context, instance: secondSave }).map((ref) => ref.id)).toEqual([
      'Clients/River/review.docx',
      'Clients/River/summary.pdf',
    ]);
  });
});
