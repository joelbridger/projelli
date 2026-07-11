/** Fixed, fabricated-only fidelity contract. */
export const corpusManifest = {
  label: 'DEMO Northcrest Advisory Practice — fabricated data only',
  seed: 'northcrest-demo-20260711',
  fidelityCounts: {
    contacts: 124,
    status_updates: 63,
    tasks: 58,
    events: 37,
    opportunities: 25,
    projects: 16,
    workflow_templates: 0,
    workflows: 0,
    workflow_steps: 0,
    custom_fields: 3,
    tags: 5,
    opportunity_stage: 0,
    contact_roles: 4,
    users: 4,
    teams: 2,
    customizable_categories: 4,
    stream_items: 113,
  },
  excludedFromDirectImport: [
    'workflow_instances',
    'attachments',
    'files',
    'documents',
  ],
  quirks: {
    notesResponseKey: 'status_updates',
    maxPerPage: 100,
    activityPagination: 'opaque meta.cursor; no Link header',
    opportunityStageLookup: 'empty despite raw stage ids',
    workflowCurrentState: 'UNVERIFIED; Basic plan cannot create workflows',
    taskSubtasks: 'UNVERIFIED simulated nested shape',
  },
} as const;
export type CorpusCollection = keyof typeof corpusManifest.fidelityCounts;
