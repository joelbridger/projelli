import { describe, expect, it } from 'vitest';
import {
  addWorkflowStepNote,
  applyWorkflowOffer,
  completeWorkflowStep,
  createMeetingWorkflowProposal,
  createTemplate,
  offerForInstance,
  publishTemplateUpdate,
  renameWorkflowStepLocally,
  startScheduledWorkflows,
  startWorkflow,
  undoWorkflowApply,
  updateWorkflowTemplate,
  workflowRecords,
} from './workflowLive';

describe('saved CRM workflow wiring', () => {
  it('keeps completed work untouched and conditionally protects a later household edit on undo', () => {
    const template = createTemplate('Annual review', ['Confirm household details', 'Open accounts', 'Send welcome packet']);
    const started = startWorkflow(template, { id: 'household-northcrest', label: 'Northcrest household' });
    const completed = completeWorkflowStep(started, template.steps[0]!.id);
    const update = publishTemplateUpdate(template, 'Confirm household goals', 'Send welcome summary');
    const offer = offerForInstance(update.template, completed, update.revisionId, update.label);

    expect(offer.engineOffer.decisions.some((decision) => decision.stepId === template.steps[1]!.id)).toBe(true);
    const applied = applyWorkflowOffer(update.template, completed, offer);
    expect(applied.instance.snapshot.steps[template.steps[0]!.id]!.status).toBe('done');
    expect(applied.instance.snapshot.steps[template.steps[0]!.id]!.titleSnapshot).toBe('Confirm household details');
    expect(applied.instance.snapshot.steps[template.steps[1]!.id]!.titleSnapshot).toBe('Confirm household goals');

    const added = update.template.steps.at(-1)!;
    const locallyTailored = renameWorkflowStepLocally(applied.instance, added.id, 'Northcrest welcome summary');
    const undone = undoWorkflowApply(locallyTailored);
    expect(undone.protectedCells).toContain(`${added.id}:title`);
    expect(undone.protectedCells).toContain(`${added.id}:added-step`);
    expect(undone.instance.snapshot.steps[template.steps[0]!.id]!.status).toBe('done');
  });

  it('keeps comments and chosen workflow paths in the saved instance', () => {
    const template = createTemplate('Review', ['Prepare', 'Meet', 'Follow up']);
    const first = template.steps[0]!;
    const next = template.steps[1]!;
    const configured = updateWorkflowTemplate(template, { outcomes: { [first.id]: [{ id: 'held', label: 'Meeting held', nextStepId: next.id }] } });
    const started = startWorkflow(configured, { id: 'household-1', label: 'River household' });
    const noted = addWorkflowStepNote(started, first.id, 'Client asked for a tax projection.');
    const completed = completeWorkflowStep(noted, first.id, 'held');

    expect(completed.snapshot.steps[first.id]!.stepNotes).toContain('Client asked for a tax projection.');
    expect(completed.snapshot.steps[first.id]!.outcome).toBe('Meeting held');
    expect(completed.snapshot.steps[next.id]!.status).toBe('in_progress');
  });

  it('starts a selected household once for each scheduled run', () => {
    const template = createTemplate('Annual review', ['Prepare review']);
    const configured = updateWorkflowTemplate(template, { schedule: { frequency: 'annual', timezone: 'UTC', startsAt: '2026-01-01', householdIds: ['h-1'], enabled: true } });
    const first = startScheduledWorkflows(configured, [{ id: 'h-1', label: 'River household' }], new Date('2026-07-12T12:00:00Z'));
    const repeat = startScheduledWorkflows(first.template, [{ id: 'h-1', label: 'River household' }], new Date('2026-07-12T13:00:00Z'));

    expect(first.instances).toHaveLength(1);
    expect(first.instances[0]!.scheduleRunKey).toBe('2026');
    expect(repeat.instances).toHaveLength(0);
  });

  it('carries a mapped household client matter into the started instance', () => {
    const template = createTemplate('Annual review', ['Prepare review']);
    const instance = startWorkflow(template, {
      id: 'household-1',
      matterId: 'matter-1',
      label: 'River household',
    });

    expect(instance.householdId).toBe('household-1');
    expect(instance.matterId).toBe('matter-1');
  });

  it('makes a meeting-based launch a reviewable proposal instead of starting work', () => {
    const template = createTemplate('Trade request', ['Review request']);
    const proposal = createMeetingWorkflowProposal({ id: 'meeting-1', kind: 'activityEvent', matterId: 'h-1', summary: 'Discussed an account transfer' }, template, { id: 'h-1', label: 'River household' });

    expect(proposal.kind).toBe('proposalRecord');
    expect(proposal['proposalKind']).toBe('workflow_launch');
    expect(proposal['state']).toBe('pending');
    expect(proposal['contextRefs']).toEqual([{ kind: 'activityEvent', id: 'meeting-1', matterId: 'h-1' }]);
  });

  it('retains stable step ids and tag ids through template save, reload, and start', () => {
    const template = createTemplate('Annual review', ['Prepare', 'Meet']);
    const originalIds = template.steps.map((step) => step.id);
    const tagged = updateWorkflowTemplate(template, {
      steps: template.steps.map((step, index) => ({
        ...step,
        tagIds: index === 0 ? ['tag:prep'] : ['tag:meeting'],
      })),
    });
    const reloaded = structuredClone(tagged);
    const started = startWorkflow(reloaded, { id: 'household-1', label: 'River household' });

    expect(reloaded.steps.map((step) => step.id)).toEqual(originalIds);
    expect(reloaded.steps.map((step) => step.tagIds)).toEqual([['tag:prep'], ['tag:meeting']]);
    expect(Object.values(started.snapshot.steps).map((step) => step.tagIds)).toEqual([
      ['tag:prep'],
      ['tag:meeting'],
    ]);

    const published = publishTemplateUpdate(reloaded, 'Meet with client', 'Follow up');
    expect(published.template.steps.find((step) => step.id === originalIds[1])?.tagIds)
      .toEqual(['tag:meeting']);
    expect(published.template.steps.at(-1)?.tagIds).toEqual([]);
  });

  it('rejects template metadata edits that replace, add, or remove stable step ids', () => {
    const template = createTemplate('Annual review', ['Prepare', 'Meet']);
    const firstStep = template.steps[0];
    if (!firstStep) throw new Error('Expected a workflow step.');
    const renamed = template.steps.map((step, index) => index === 0
      ? { ...step, id: 'replacement-step' }
      : step);

    expect(() => updateWorkflowTemplate(template, { steps: renamed }))
      .toThrow('stable step IDs');
    expect(() => updateWorkflowTemplate(template, { steps: template.steps.slice(0, 1) }))
      .toThrow('stable step IDs');
    expect(() => updateWorkflowTemplate(template, {
      steps: [...template.steps, { ...firstStep, id: 'added-step' }],
    })).toThrow('stable step IDs');
    expect(template.steps.map((step) => step.id)).toHaveLength(2);
  });

  it('normalizes pre-foundation template and instance metadata without inventing values', () => {
    const template = createTemplate('Legacy workflow', ['Prepare']);
    const instance = startWorkflow(template, { id: 'household-1', label: 'River household' });
    const templateStep = template.steps[0];
    const instanceStep = Object.values(instance.snapshot.steps)[0];
    if (!templateStep || !instanceStep) throw new Error('Expected workflow steps.');
    Reflect.deleteProperty(templateStep, 'tagIds');
    Reflect.deleteProperty(instanceStep, 'tagIds');
    Reflect.deleteProperty(instanceStep, 'documentRefs');

    const normalized = workflowRecords([template, instance]);

    expect(normalized.templates[0]?.steps[0]?.tagIds).toEqual([]);
    expect(Object.values(normalized.instances[0]?.snapshot.steps ?? {})[0]).toMatchObject({
      tagIds: [],
      documentRefs: [],
    });
  });
});
