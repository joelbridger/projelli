import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { CrmPipelineSurface } from './CrmPipelineSurface';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const household: LiveCrmRecord = { id: 'household-1', kind: 'household', name: 'Morgan household' };
const pipeline: LiveCrmRecord = { id: 'pipeline-1', kind: 'pipelineDef', matterId: 'firm_home', name: 'New client path', stageIds: ['stage-discovery', 'stage-decision'], stageOrder: ['stage-discovery', 'stage-decision'], archived: false };
const discovery: LiveCrmRecord = { id: 'stage-discovery', kind: 'stageDef', matterId: 'firm_home', pipelineId: 'pipeline-1', name: 'Discovery', statusEffect: 'open', triggerRules: [], archived: false };
const decision: LiveCrmRecord = { id: 'stage-decision', kind: 'stageDef', matterId: 'firm_home', pipelineId: 'pipeline-1', name: 'Decision', statusEffect: 'open', triggerRules: [{ id: 'rule-1', event: 'entered', workflowTemplateId: 'workflow-1', proposalRequired: true, enabled: true }], archived: false };
const workflow: LiveCrmRecord = { id: 'workflow-1', kind: 'workflowTemplate', name: 'Welcome workflow' };
const opportunity: LiveCrmRecord = { id: 'opportunity-1', kind: 'opportunity', matterId: 'firm_home', householdId: 'household-1', name: 'Morgan rollover', pipelineId: 'pipeline-1', stageId: 'stage-discovery', amount: { value: 450000, currency: 'USD' }, fee: { value: 4500, currency: 'USD' }, status: 'open', contextRefs: [], tagIds: [], customFields: {} };

function data(records: readonly LiveCrmRecord[], save = vi.fn()) {
  return { records, save, error: null, freshness: { kind: 'live' as const } };
}

describe('CrmPipelineSurface', () => {
  it('uses an honest first-use state when no pipeline exists', () => {
    render(<CrmPipelineSurface route="pipeline" onNavigate={vi.fn()} data={data([household])} />);
    expect(screen.getByTestId('crm-pipeline-first-use-pipeline')).toHaveTextContent(/nothing has been pre-filled/i);
    expect(screen.queryByText(/Patel|Avery|Chen|Lewis/)).not.toBeInTheDocument();
  });

  it('saves an edited opportunity and creates an approval, never a workflow instance, when it enters a triggered stage', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<CrmPipelineSurface route="pipeline" onNavigate={vi.fn()} data={data([household, pipeline, discovery, decision, workflow, opportunity], save)} />);
    fireEvent.click(screen.getByTestId('crm-opportunity-edit-opportunity-1'));
    fireEvent.change(screen.getByTestId('crm-opportunity-stage'), { target: { value: 'stage-decision' } });
    fireEvent.click(screen.getByTestId('crm-opportunity-save'));
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'opportunity-1', kind: 'opportunity', stageId: 'stage-decision', amount: { value: 450000, currency: 'USD' }, fee: { value: 4500, currency: 'USD' } })); });
    await waitFor(() => { expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'proposalRecord', proposalKind: 'workflow_launch', state: 'pending', proposedMutation: { kind: 'workflow_launch', workflowTemplateId: 'workflow-1' } })); });
    expect((save.mock.calls as [LiveCrmRecord][]).some(([record]) => record.kind === 'workflowInstance')).toBe(false);
  });

  it('creates a complete opportunity through the visible record form', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<CrmPipelineSurface route="pipeline" onNavigate={vi.fn()} data={data([household, pipeline, discovery], save)} />);
    fireEvent.click(screen.getByTestId('crm-pipeline-new'));
    fireEvent.change(screen.getByTestId('crm-opportunity-name'), { target: { value: 'Morgan estate plan' } });
    fireEvent.change(screen.getByTestId('crm-opportunity-amount'), { target: { value: '650000' } });
    fireEvent.change(screen.getByTestId('crm-opportunity-fee'), { target: { value: '6500' } });
    fireEvent.click(screen.getByTestId('crm-opportunity-save'));
    await waitFor(() => {
      expect(save).toHaveBeenCalledWith(expect.objectContaining({
        kind: 'opportunity',
        name: 'Morgan estate plan',
        householdId: 'household-1',
        pipelineId: 'pipeline-1',
        stageId: 'stage-discovery',
        amount: { value: 650000, currency: 'USD' },
        fee: { value: 6500, currency: 'USD' },
      }));
    });
  });

  it('persists pipeline and stage configuration through the supplied live-record writer', () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(<CrmPipelineSurface route="pipeline-settings" onNavigate={vi.fn()} data={data([], save)} />);
    fireEvent.change(screen.getByTestId('crm-pipeline-name'), { target: { value: 'Referral path' } });
    fireEvent.click(screen.getByTestId('crm-pipeline-save'));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'pipelineDef', name: 'Referral path', stageOrder: [] }));
  });
});
