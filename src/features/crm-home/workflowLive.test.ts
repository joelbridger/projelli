import { describe, expect, it } from 'vitest';
import {
  applyWorkflowOffer,
  completeWorkflowStep,
  createTemplate,
  offerForInstance,
  publishTemplateUpdate,
  renameWorkflowStepLocally,
  startWorkflow,
  undoWorkflowApply,
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
});
