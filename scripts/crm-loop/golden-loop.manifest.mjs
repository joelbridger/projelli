/**
 * The complete CRM surface inventory. A surface only counts as covered when
 * it is explicitly assigned to real driver(s). Keep this list in lockstep
 * with CrmHomeRoute: run-all also reads that source and fails on drift.
 * Entries stay alphabetically sorted by route, after the shell-owned clients.
 */
export const SURFACES = Object.freeze([
  { id: 'clients', drivers: ['clients.mjs', 'contacts.mjs', 'email-calendar.mjs', 'timeline.mjs'] },
  { id: 'activity', drivers: ['activity.mjs'] },
  { id: 'archive-export', drivers: ['migration.mjs'] },
  { id: 'attachment-accounting', drivers: ['migration.mjs'] },
  { id: 'fidelity', drivers: ['migration.mjs'] },
  { id: 'firm-setup', drivers: ['firm.mjs'] },
  { id: 'fields-tags', drivers: ['firm.mjs'] },
  { id: 'intake-links', drivers: ['firm.mjs'] },
  { id: 'migration', drivers: ['migration.mjs'] },
  { id: 'pipeline', drivers: ['pipeline.mjs'] },
  { id: 'pipeline-settings', drivers: ['pipeline.mjs'] },
  { id: 'propagation', drivers: ['workflows.mjs', 'workflows-full.mjs'] },
  { id: 'reports', drivers: ['reports.mjs'] },
  { id: 'rollback-export', drivers: ['migration.mjs'] },
  { id: 'search', drivers: ['ask.mjs', 'search.mjs'] },
  { id: 'tasks', drivers: ['tasks.mjs', 'today-tasks.mjs'] },
  { id: 'today', drivers: ['today-tasks.mjs'] },
  { id: 'views', drivers: ['views.mjs'] },
  { id: 'workflow-recreation', drivers: ['migration.mjs'] },
  { id: 'workflows', drivers: ['workflows.mjs', 'workflows-full.mjs'] },
]);
