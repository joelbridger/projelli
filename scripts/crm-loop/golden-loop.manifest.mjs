/**
 * The complete CRM surface inventory.  A surface only counts as covered when
 * it is explicitly assigned to a real driver.  Keep this list in lockstep
 * with CrmHomeRoute: run-all also reads that source and fails on drift.
 */
export const SURFACES = Object.freeze([
  { id: 'clients', driver: 'clients.mjs' },
  { id: 'today', driver: 'today-tasks.mjs' },
  { id: 'tasks', driver: 'today-tasks.mjs' },
  { id: 'workflows', driver: 'workflows.mjs' },
  { id: 'propagation', driver: 'workflows.mjs' },
  { id: 'pipeline', driver: null },
  { id: 'pipeline-settings', driver: null },
  { id: 'reports', driver: null },
  { id: 'views', driver: 'views.mjs' },
  { id: 'firm-setup', driver: null },
  { id: 'fields-tags', driver: null },
  { id: 'intake-links', driver: null },
  { id: 'migration', driver: 'migration.mjs' },
  { id: 'fidelity', driver: 'migration.mjs' },
  { id: 'workflow-recreation', driver: 'migration.mjs' },
  { id: 'attachment-accounting', driver: 'migration.mjs' },
  { id: 'archive-export', driver: 'migration.mjs' },
  { id: 'rollback-export', driver: 'migration.mjs' },
]);
