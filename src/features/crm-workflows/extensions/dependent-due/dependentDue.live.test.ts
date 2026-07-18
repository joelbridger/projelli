import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyWorkflowStepCompletion,
  createTemplate,
  startWorkflow,
  workflowRecords,
  WorkflowCompletionRefusedError,
  type LiveWorkflowInstance,
} from '@/features/crm-home/workflowLive';
import {
  loadLiveCrmRecords,
  saveLiveCrmRecord,
  type LiveCrmRecord,
} from '@/platform/crm/liveRecords';
import { setDevFlagOverride } from '@/platform/flags';
import {
  readWorkflowStepTiming,
  saveWorkflowStepMetadata,
} from '../../workflowStepPersistence';

const boundary = vi.hoisted(() => ({
  records: [] as LiveCrmRecord[],
  invoke: vi.fn<(command: string, args?: { record?: LiveCrmRecord }) => Promise<unknown>>(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: () => true,
  invoke: (command: string, args?: { record?: LiveCrmRecord }) => boundary.invoke(command, args),
}));

const workspaceRoot = '/workspace';

function seededInstance(): LiveWorkflowInstance {
  const template = createTemplate('Annual review', ['Prepare', 'Meet', 'Follow up']);
  const instance = startWorkflow(template, { id: 'river-household', label: 'River household' });
  instance.createdAt = '2026-07-01T09:00:00.000Z';
  return instance;
}

async function freshInstance(id: string): Promise<LiveWorkflowInstance> {
  const records = await loadLiveCrmRecords(workspaceRoot);
  const instance = workflowRecords(records).instances.find((candidate) => candidate.id === id);
  if (!instance) throw new Error('Expected a freshly loaded workflow instance.');
  return instance;
}

beforeEach(() => {
  boundary.records = [seededInstance()];
  boundary.invoke.mockReset();
  boundary.invoke.mockImplementation((command, args) => {
    if (command === 'crm_set_workspace') return Promise.resolve();
    if (command === 'crm_live_list') return Promise.resolve(structuredClone(boundary.records));
    if (command === 'crm_live_upsert' && args?.record) {
      const record = structuredClone(args.record);
      boundary.records = boundary.records.some((candidate) => candidate.id === record.id)
        ? boundary.records.map((candidate) => candidate.id === record.id ? record : candidate)
        : [...boundary.records, record];
      return Promise.resolve(structuredClone(record));
    }
    return Promise.reject(new Error(`Unexpected command ${command}`));
  });
  setDevFlagOverride('workflow-dependent-due', true);
  vi.useFakeTimers();
});

afterEach(() => {
  setDevFlagOverride('workflow-dependent-due', undefined);
  vi.useRealTimers();
  vi.clearAllMocks();
});

describe('workflow dependent due canonical live route', () => {
  it('survives fresh reads, refuses out-of-order saves, recalculates open due times, and preserves completed history', async () => {
    let instance = await freshInstance(boundary.records[0]?.id ?? 'missing');
    const [firstId, secondId, thirdId] = Object.keys(instance.snapshot.steps);
    if (!firstId || !secondId || !thirdId) throw new Error('Expected three workflow steps.');

    instance = await saveWorkflowStepMetadata(instance, secondId, {
      sequential: true,
      dependentDue: {
        base: 'predecessor_completion', predecessorStepId: firstId,
        direction: 'after', offset: 2, unit: 'days',
      },
    }, (record) => saveLiveCrmRecord(workspaceRoot, record));
    instance = await saveWorkflowStepMetadata(instance, thirdId, {
      dependentDue: {
        base: 'predecessor_completion', predecessorStepId: secondId,
        direction: 'after', offset: 1, unit: 'weeks',
      },
    }, (record) => saveLiveCrmRecord(workspaceRoot, record));

    instance = await freshInstance(instance.id);
    expect(readWorkflowStepTiming(instance, secondId)).toMatchObject({
      sequential: true,
      rule: { predecessorStepId: firstId, offset: 2, unit: 'days' },
      blockedByStepId: firstId,
    });
    expect(readWorkflowStepTiming(instance, secondId).dueAt).toBeUndefined();
    expect(boundary.invoke.mock.calls.map(([command]) => command)).toContain('crm_live_upsert');
    expect(boundary.invoke.mock.calls.map(([command]) => command)).toContain('crm_live_list');

    boundary.invoke.mockClear();
    expect(() => applyWorkflowStepCompletion(instance, secondId)).toThrow(WorkflowCompletionRefusedError);
    expect(boundary.invoke.mock.calls.map(([command]) => command)).not.toContain('crm_live_upsert');
    const afterRefusal = await freshInstance(instance.id);
    expect(afterRefusal.snapshot.steps[firstId]?.status).toBe('todo');
    expect(afterRefusal.snapshot.steps[secondId]?.status).toBe('todo');

    vi.setSystemTime(new Date('2026-07-10T10:00:00.000Z'));
    await saveLiveCrmRecord(workspaceRoot, applyWorkflowStepCompletion(afterRefusal, firstId));
    const afterFirstCompletion = await freshInstance(instance.id);
    expect(readWorkflowStepTiming(afterFirstCompletion, secondId).dueAt)
      .toBe('2026-07-12T10:00:00.000Z');
    expect(readWorkflowStepTiming(afterFirstCompletion, secondId).blockedByStepId).toBeUndefined();

    vi.setSystemTime(new Date('2026-07-11T11:00:00.000Z'));
    await saveLiveCrmRecord(workspaceRoot, applyWorkflowStepCompletion(afterFirstCompletion, secondId));
    const afterSecondCompletion = await freshInstance(instance.id);
    expect(readWorkflowStepTiming(afterSecondCompletion, thirdId).dueAt)
      .toBe('2026-07-18T11:00:00.000Z');

    const corrected = structuredClone(afterSecondCompletion);
    corrected.snapshot.steps[firstId]?.completionOperations.push({
      completionId: 'first-correction', completedBy: 'advisor',
      completedAt: '2026-07-20T10:00:00.000Z', sourceOperationId: 'first-correction-operation',
    });
    corrected.snapshot.steps[secondId]?.completionOperations.push({
      completionId: 'second-correction', completedBy: 'advisor',
      completedAt: '2026-07-21T11:00:00.000Z', sourceOperationId: 'second-correction-operation',
    });
    await saveLiveCrmRecord(workspaceRoot, corrected);
    const afterCorrection = await freshInstance(instance.id);
    expect(readWorkflowStepTiming(afterCorrection, secondId).dueAt)
      .toBe('2026-07-12T10:00:00.000Z');
    expect(readWorkflowStepTiming(afterCorrection, thirdId).dueAt)
      .toBe('2026-07-28T11:00:00.000Z');

    boundary.invoke.mockClear();
    const forbiddenSave = vi.fn((record: LiveCrmRecord) => saveLiveCrmRecord(workspaceRoot, record));
    await expect(saveWorkflowStepMetadata(afterCorrection, thirdId, {
      dependentDue: {
        base: 'predecessor_completion', predecessorStepId: firstId,
        direction: 'after', offset: 1, unit: 'days',
      },
    }, forbiddenSave)).rejects.toThrow('immediately previous');
    expect(forbiddenSave).not.toHaveBeenCalled();
    const afterInvalidRule = await freshInstance(instance.id);
    expect(readWorkflowStepTiming(afterInvalidRule, thirdId).rule?.predecessorStepId).toBe(secondId);
  });
});
