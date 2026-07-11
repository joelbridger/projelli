/**
 * Migration wizard state machine.
 *
 * The state machine uses canonical entity references while keeping its small
 * UI-only transition state separate from persisted migration records.
 */

import type { EntityRef as CrmEntityRef } from '@/platform/crm/types';
/** UI state stores the canonical reference identifier; persistence restores its kind. */
export type EntityRef = CrmEntityRef['id'];

export type WizardStep =
  | 'connect'
  | 'scan'
  | 'map'
  | 'import'
  | 'fidelity'
  | 'parallel_run'
  | 'cutover'
  | 'export';

export type ImportPhase =
  | 'contacts'
  | 'notes'
  | 'tasks'
  | 'events'
  | 'opportunities'
  | 'projects'
  | 'workflow_templates'
  | 'custom_fields'
  | 'activity';

export const IMPORT_SEQUENCE: readonly ImportPhase[] = [
  'contacts',
  'notes',
  'tasks',
  'events',
  'opportunities',
  'projects',
  'workflow_templates',
  'custom_fields',
  'activity',
] as const;

export type ImportPhaseStatus = 'pending' | 'running' | 'paused' | 'complete' | 'failed';

export interface ImportProgress {
  status: ImportPhaseStatus;
  fetched: number;
  landed: number;
  skipped: number;
  checkpoint?: string;
}

export interface WorkflowChecklist {
  id: string;
  legacyProjectRef: EntityRef;
  householdRef: EntityRef | null;
  sourceTemplateLabel?: string;
  activityEvidenceRefs: EntityRef[];
  decision: 'pending' | 'recreate' | 'gap' | 'not_needed';
  resultingWorkflowInstanceRef?: EntityRef;
  gapReason?: string;
}

export interface AttachmentAccounting {
  householdRef: EntityRef;
  status: 'exported' | 'gap';
  exportSource?: string;
  gapReason?: string;
}

export type WriteBackState =
  | 'round_trips'
  | 'lantern_only'
  | 'read_only_mirror'
  | 'guided_fallback';

export interface WriteBackField {
  field: string;
  state: WriteBackState;
  detail: string;
}

export interface MigrationWizardState {
  step: WizardStep;
  importBatchId: string | null;
  importProgress: Record<ImportPhase, ImportProgress>;
  checklistItems: WorkflowChecklist[];
  affectedAttachmentHouseholdRefs: EntityRef[];
  attachmentAccounting: AttachmentAccounting[];
  writeBackFields: WriteBackField[];
  lastIncrementalSyncAt: string | null;
  lastFullReconciliationAt: string | null;
  archiveManifestRef: EntityRef | null;
  fidelityReportSha256: string | null;
  error: string | null;
}

function emptyProgress(): Record<ImportPhase, ImportProgress> {
  return Object.fromEntries(
    IMPORT_SEQUENCE.map(phase => [phase, { status: 'pending', fetched: 0, landed: 0, skipped: 0 }]),
  ) as Record<ImportPhase, ImportProgress>;
}

export function createMigrationWizardState(): MigrationWizardState {
  return {
    step: 'connect',
    importBatchId: null,
    importProgress: emptyProgress(),
    checklistItems: [],
    affectedAttachmentHouseholdRefs: [],
    attachmentAccounting: [],
    writeBackFields: [
      { field: 'notes.create', state: 'round_trips', detail: 'Creates a new Wealthbox note after approval.' },
      { field: 'tasks.create', state: 'round_trips', detail: 'Creates a new Wealthbox task after approval.' },
      { field: 'contacts.background_information', state: 'round_trips', detail: 'Writes only after a fresh value check.' },
      { field: 'opportunities.*', state: 'read_only_mirror', detail: 'Read-only during the parallel run.' },
      { field: 'projects.*', state: 'read_only_mirror', detail: 'Read-only during the parallel run.' },
      { field: 'workflows.*', state: 'guided_fallback', detail: 'Open work is recreated by an operator at cutover.' },
      { field: '*', state: 'lantern_only', detail: 'This stays in Lantern until cutover.' },
    ],
    lastIncrementalSyncAt: null,
    lastFullReconciliationAt: null,
    archiveManifestRef: null,
    fidelityReportSha256: null,
    error: null,
  };
}

export type MigrationWizardEvent =
  | { type: 'CONNECTED'; importBatchId: string }
  | { type: 'START_IMPORT'; phase: ImportPhase }
  | { type: 'PAUSE_IMPORT'; phase: ImportPhase; checkpoint: string }
  | { type: 'IMPORT_PROGRESS'; phase: ImportPhase; fetched: number; landed: number; skipped: number }
  | { type: 'IMPORT_COMPLETED'; phase: ImportPhase; completedAt: string; fullReconciliation: boolean }
  | { type: 'IMPORT_FAILED'; phase: ImportPhase; message: string }
  | { type: 'ADD_WORKFLOW_CHECKLIST'; item: WorkflowChecklist }
  | { type: 'DECIDE_WORKFLOW'; id: string; decision: Exclude<WorkflowChecklist['decision'], 'pending'>; resultingWorkflowInstanceRef?: EntityRef; gapReason?: string }
  | { type: 'ACCOUNT_ATTACHMENT'; record: AttachmentAccounting }
  | { type: 'ATTACHMENTS_REQUIRED'; householdRefs: EntityRef[] }
  | { type: 'Fidelity_READY'; reportSha256: string }
  | { type: 'START_PARALLEL_RUN' }
  | { type: 'START_CUTOVER' }
  | { type: 'ARCHIVE_SEALED'; manifestRef: EntityRef }
  | { type: 'START_EXPORT' }
  | { type: 'CLEAR_ERROR' };

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

function nextPendingPhase(state: MigrationWizardState): ImportPhase | undefined {
  return IMPORT_SEQUENCE.find(phase => state.importProgress[phase].status === 'pending');
}

function allImportsComplete(state: MigrationWizardState): boolean {
  return IMPORT_SEQUENCE.every(phase => state.importProgress[phase].status === 'complete');
}

export function hasCompleteAttachmentAccounting(state: MigrationWizardState): boolean {
  // A record is only created for affected households. Each affected household
  // must therefore resolve to exactly one exported-or-gap decision.
  const byHousehold = new Map<EntityRef, AttachmentAccounting[]>();
  state.attachmentAccounting.forEach(record => {
    byHousehold.set(record.householdRef, [...(byHousehold.get(record.householdRef) ?? []), record]);
  });
  return state.affectedAttachmentHouseholdRefs.every(householdRef => {
    const records = byHousehold.get(householdRef) ?? [];
    const [record] = records;
    return record !== undefined && records.length === 1 && ['exported', 'gap'].includes(record.status);
  });
}

export function hasCompletedWorkflowChecklist(state: MigrationWizardState): boolean {
  return state.checklistItems.every(item => item.decision !== 'pending');
}

export function canStartCutover(state: MigrationWizardState): boolean {
  return state.step === 'parallel_run'
    && allImportsComplete(state)
    && state.fidelityReportSha256 !== null
    && hasCompleteAttachmentAccounting(state)
    && hasCompletedWorkflowChecklist(state);
}

export function reduceMigrationWizard(
  state: MigrationWizardState,
  event: MigrationWizardEvent,
): MigrationWizardState {
  const next = clone(state);
  next.error = null;

  switch (event.type) {
    case 'CONNECTED':
      if (state.step !== 'connect') return { ...state, error: 'The importer is already connected.' };
      next.importBatchId = event.importBatchId;
      next.step = 'scan';
      return next;
    case 'START_IMPORT':
      if (!state.importBatchId || state.step !== 'scan' && state.step !== 'map' && state.step !== 'import') return { ...state, error: 'Connect and scan before importing.' };
      if (event.phase !== nextPendingPhase(state) && state.importProgress[event.phase].status !== 'paused') return { ...state, error: 'Import source types in the required safe order.' };
      next.step = 'import';
      next.importProgress[event.phase] = { ...next.importProgress[event.phase], status: 'running' };
      return next;
    case 'PAUSE_IMPORT':
      if (state.importProgress[event.phase].status !== 'running') return { ...state, error: 'Only a running import can be paused.' };
      next.importProgress[event.phase] = { ...next.importProgress[event.phase], status: 'paused', checkpoint: event.checkpoint };
      return next;
    case 'IMPORT_PROGRESS':
      if (state.importProgress[event.phase].status !== 'running') return { ...state, error: 'Progress must belong to a running import.' };
      if (event.fetched < event.landed + event.skipped) return { ...state, error: 'Imported and skipped records cannot exceed fetched records.' };
      next.importProgress[event.phase] = { ...next.importProgress[event.phase], fetched: event.fetched, landed: event.landed, skipped: event.skipped };
      return next;
    case 'IMPORT_COMPLETED':
      if (state.importProgress[event.phase].status !== 'running') return { ...state, error: 'Only a running import can complete.' };
      next.importProgress[event.phase] = { ...next.importProgress[event.phase], status: 'complete' };
      delete next.importProgress[event.phase].checkpoint;
      next.lastIncrementalSyncAt = event.completedAt;
      if (event.fullReconciliation) next.lastFullReconciliationAt = event.completedAt;
      if (allImportsComplete(next)) next.step = 'fidelity';
      return next;
    case 'IMPORT_FAILED':
      next.importProgress[event.phase] = { ...next.importProgress[event.phase], status: 'failed' };
      next.error = event.message;
      return next;
    case 'ADD_WORKFLOW_CHECKLIST':
      if (next.checklistItems.some(item => item.id === event.item.id)) return { ...state, error: 'That workflow checklist already exists.' };
      next.checklistItems.push(event.item);
      return next;
    case 'DECIDE_WORKFLOW': {
      const item = next.checklistItems.find(candidate => candidate.id === event.id);
      if (!item) return { ...state, error: 'Workflow checklist item not found.' };
      if (event.decision === 'recreate' && !event.resultingWorkflowInstanceRef) return { ...state, error: 'A recreated workflow needs its new Lantern workflow reference.' };
      if (event.decision === 'gap' && !event.gapReason) return { ...state, error: 'A workflow gap needs an explanation.' };
      item.decision = event.decision;
      if (event.resultingWorkflowInstanceRef) item.resultingWorkflowInstanceRef = event.resultingWorkflowInstanceRef;
      if (event.gapReason) item.gapReason = event.gapReason;
      return next;
    }
    case 'ACCOUNT_ATTACHMENT': {
      if (next.attachmentAccounting.some(record => record.householdRef === event.record.householdRef)) return { ...state, error: 'Each affected household has one attachment accounting decision.' };
      if (event.record.status === 'exported' && !event.record.exportSource) return { ...state, error: 'An exported attachment record needs its source.' };
      if (event.record.status === 'gap' && !event.record.gapReason) return { ...state, error: 'An attachment gap needs an explanation.' };
      next.attachmentAccounting.push(event.record);
      return next;
    }
    case 'ATTACHMENTS_REQUIRED':
      next.affectedAttachmentHouseholdRefs = [...new Set(event.householdRefs)].sort();
      return next;
    case 'Fidelity_READY':
      if (state.step !== 'fidelity') return { ...state, error: 'The fidelity report is available after import completes.' };
      next.fidelityReportSha256 = event.reportSha256;
      return next;
    case 'START_PARALLEL_RUN':
      if (state.step !== 'fidelity' || !state.fidelityReportSha256) return { ...state, error: 'Review the completed fidelity report first.' };
      next.step = 'parallel_run';
      return next;
    case 'START_CUTOVER':
      if (!canStartCutover(state)) return { ...state, error: 'Cutover needs a fidelity report plus every workflow and attachment decision.' };
      next.step = 'cutover';
      return next;
    case 'ARCHIVE_SEALED':
      if (state.step !== 'cutover') return { ...state, error: 'Archive sealing happens at cutover.' };
      next.archiveManifestRef = event.manifestRef;
      return next;
    case 'START_EXPORT':
      if (state.step !== 'cutover' || !state.archiveManifestRef) return { ...state, error: 'Seal the archive before creating an export job.' };
      next.step = 'export';
      return next;
    case 'CLEAR_ERROR':
      next.error = null;
      return next;
  }
}
