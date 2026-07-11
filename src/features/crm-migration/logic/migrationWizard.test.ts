import { describe, expect, it } from 'vitest';

import {
  IMPORT_SEQUENCE,
  canStartCutover,
  createMigrationWizardState,
  reduceMigrationWizard,
  type MigrationWizardState,
} from './migrationWizard';

function reachParallelRun(): MigrationWizardState {
  let state = reduceMigrationWizard(createMigrationWizardState(), { type: 'CONNECTED', importBatchId: 'batch-1' });
  for (const phase of IMPORT_SEQUENCE) {
    state = reduceMigrationWizard(state, { type: 'START_IMPORT', phase });
    state = reduceMigrationWizard(state, { type: 'IMPORT_PROGRESS', phase, fetched: 2, landed: 2, skipped: 0 });
    state = reduceMigrationWizard(state, { type: 'IMPORT_COMPLETED', phase, completedAt: '2026-07-11T00:00:00Z', fullReconciliation: phase === 'activity' });
  }
  state = reduceMigrationWizard(state, { type: 'Fidelity_READY', reportSha256: 'report-hash' });
  return reduceMigrationWizard(state, { type: 'START_PARALLEL_RUN' });
}

describe('migration wizard logic', () => {
  it('requires contact-first sequencing and preserves resumable checkpoints', () => {
    let state = reduceMigrationWizard(createMigrationWizardState(), { type: 'CONNECTED', importBatchId: 'batch-1' });
    state = reduceMigrationWizard(state, { type: 'START_IMPORT', phase: 'notes' });
    expect(state.error).toContain('required safe order');

    state = reduceMigrationWizard(state, { type: 'START_IMPORT', phase: 'contacts' });
    state = reduceMigrationWizard(state, { type: 'PAUSE_IMPORT', phase: 'contacts', checkpoint: 'page:2' });
    expect(state.importProgress.contacts).toMatchObject({ status: 'paused', checkpoint: 'page:2' });

    state = reduceMigrationWizard(state, { type: 'START_IMPORT', phase: 'contacts' });
    expect(state.importProgress.contacts.status).toBe('running');
  });

  it('keeps last incremental sync separate from full reconciliation', () => {
    let state = reduceMigrationWizard(createMigrationWizardState(), { type: 'CONNECTED', importBatchId: 'batch-1' });
    state = reduceMigrationWizard(state, { type: 'START_IMPORT', phase: 'contacts' });
    state = reduceMigrationWizard(state, { type: 'IMPORT_COMPLETED', phase: 'contacts', completedAt: 'incremental', fullReconciliation: false });
    expect(state.lastIncrementalSyncAt).toBe('incremental');
    expect(state.lastFullReconciliationAt).toBeNull();
  });

  it('blocks cutover until every non-API fallback has an explicit decision', () => {
    let state = reachParallelRun();
    state = reduceMigrationWizard(state, {
      type: 'ADD_WORKFLOW_CHECKLIST',
      item: { id: 'workflow-1', legacyProjectRef: 'project:1', householdRef: 'household:1', activityEvidenceRefs: [], decision: 'pending' },
    });
    expect(canStartCutover(state)).toBe(false);

    state = reduceMigrationWizard(state, {
      type: 'DECIDE_WORKFLOW',
      id: 'workflow-1',
      decision: 'recreate',
      resultingWorkflowInstanceRef: 'workflow:lantern-1',
    });
    state = reduceMigrationWizard(state, {
      type: 'ATTACHMENTS_REQUIRED',
      householdRefs: ['household:1'],
    });
    state = reduceMigrationWizard(state, {
      type: 'ACCOUNT_ATTACHMENT',
      record: { householdRef: 'household:1', status: 'gap', gapReason: 'No supported API read path' },
    });
    expect(canStartCutover(state)).toBe(true);

    state = reduceMigrationWizard(state, { type: 'START_CUTOVER' });
    expect(state.step).toBe('cutover');
  });

  it('records only the three proven write-back paths', () => {
    const state = createMigrationWizardState();
    expect(state.writeBackFields.filter(field => field.state === 'round_trips').map(field => field.field))
      .toEqual(['notes.create', 'tasks.create', 'contacts.background_information']);
  });
});
