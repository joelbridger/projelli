/**
 * The source of truth for the CRM replacement score.  This is deliberately a
 * product checklist, not a source-code inventory: an item can only be BUILT
 * when its acceptance assertion drives the running desktop app and proves the
 * result survives a native restart.
 */

export type Verdict = 'REPLICATE' | 'IMPROVE';

export interface ParityApp {
  ready(): Promise<void>;
  task(options: { recurrence?: boolean; priority?: boolean; assignee?: boolean; activity?: boolean; unified?: boolean; triage?: boolean }): Promise<void>;
  contact(options: { person?: boolean; household?: boolean; relationship?: boolean; roles?: boolean; ownership?: boolean; tags?: boolean; notes?: boolean; internal?: boolean; account?: boolean; addresses?: boolean; facts?: boolean; timeline?: boolean }): Promise<void>;
  documentLink(): Promise<void>;
  workflow(options: { template?: boolean; instance?: boolean; schedule?: boolean; outcomes?: boolean; comments?: boolean; library?: boolean; meetingProposal?: boolean }): Promise<void>;
  jumpMeeting(): Promise<void>;
  approvedPlaybook(): Promise<void>;
  pipeline(options: { opportunity?: boolean; pipeline?: boolean; stage?: boolean; workflowTrigger?: boolean; contactActions?: boolean }): Promise<void>;
  report(options: { kind: 'no_contact_6mo' | 'attention_vs_fee' | 'custom' | 'ai' }): Promise<void>;
  broadcast(): Promise<void>;
  firmDirectory(): Promise<void>;
  firmSetup(): Promise<void>;
  workspaces(): Promise<void>;
  durableFeature(options: { route: string; controls: string[]; action?: string; result?: string; recordKind?: string }): Promise<void>;
  migration(options: { action: 'crm-migration-run-import' | 'crm-redtail-import' | 'crm-salesforce-import'; externalId?: boolean; exportFile?: boolean; fullReview?: boolean }): Promise<void>;
  selfServiceContactImport(): Promise<void>;
}

export interface ParityFeature {
  /** Exact row title in design/01-wealthbox-feature-matrix.md. */
  matrixFeature: string;
  id: string;
  name: string;
  verdict: Verdict;
  area: string;
  /** A reason is required whenever a live assertion cannot honestly exist yet. */
  pending?: string;
  /** Must create/act, restart the native app, and verify the saved result. */
  assert?: (app: ParityApp) => Promise<void>;
}

export interface SkippedFeature {
  matrixFeature: string;
  reason: string;
}

const pending = (matrixFeature: string, id: string, verdict: Verdict, area: string, why: string): ParityFeature => ({
  matrixFeature, id, name: matrixFeature, verdict, area, pending: why,
});

const live = (matrixFeature: string, id: string, verdict: Verdict, area: string, assert: NonNullable<ParityFeature['assert']>): ParityFeature => ({
  matrixFeature, id, name: matrixFeature, verdict, area, assert,
});

// Every REPLICATE/IMPROVE row in the matrix appears here. Pending does not mean
// "good enough"; it means the next lane must first make the behavior possible
// to prove. The runner cross-checks this list against the matrix on every run.
export const FEATURES: readonly ParityFeature[] = [
  live('Person contact record', 'contact-person', 'REPLICATE', 'contacts', (app) => app.contact({ person: true })),
  live('Household record', 'contact-household', 'REPLICATE', 'contacts', (app) => app.contact({ household: true })),
  live('Household Titles', 'contact-household-titles', 'REPLICATE', 'contacts', (app) => app.contact({ person: true, relationship: true })),
  live('Company / Trust contact types', 'contact-company-trust', 'REPLICATE', 'contacts', (app) => app.contact({ person: true, addresses: true })),
  live('Professional-relationship links', 'contact-professional-links', 'REPLICATE', 'contacts', (app) => app.contact({ person: true, relationship: true })),
  live('Contact Roles', 'contact-roles', 'REPLICATE', 'contacts', (app) => app.contact({ person: true, roles: true })),
  live('"Ownership" (whose client is this)', 'contact-ownership', 'IMPROVE', 'contacts', (app) => app.contact({ household: true, ownership: true })),
  live('Multiple addresses/emails/phones per contact', 'contact-channels', 'REPLICATE', 'contacts', (app) => app.contact({ person: true, addresses: true })),
  live('Tags vs. custom fields not inherited household↔person', 'contact-fact-rollup', 'IMPROVE', 'contacts', (app) => app.contact({ household: true, facts: true })),
  live('Custom fields', 'custom-fields', 'REPLICATE', 'firm setup', (app) => app.firmSetup()),
  live('Tags', 'tags', 'REPLICATE', 'contacts', (app) => app.firmSetup()),
  live('Custom Objects', 'typed-objects', 'IMPROVE', 'contacts', (app) => app.contact({ household: true, account: true })),
  live('Notes on a contact', 'contact-notes', 'REPLICATE', 'contacts', (app) => app.contact({ household: true, notes: true })),
  live('File storage on records', 'record-file-storage', 'REPLICATE', 'documents', (app) => app.documentLink()),
  live('Pinned notes', 'pinned-notes-and-memory', 'IMPROVE', 'contacts', (app) => app.contact({ household: true, notes: true, facts: true })),
  live('Note search (keyword only)', 'crm-note-search', 'IMPROVE', 'search', (app) => app.durableFeature({ route: 'crm-home-nav-search', controls: ['crm-search-input', 'crm-search-result', 'crm-search-create-note'], action: 'crm-search-create-note', result: 'Parity note', recordKind: 'note' })),
  live('Note @-mentions / notify-everybody', 'note-mentions', 'REPLICATE', 'timeline', (app) => app.contact({ household: true, notes: true, internal: true })),
  live('"Inside scoop" / internal-only color', 'internal-note-wall', 'IMPROVE', 'contacts', (app) => app.contact({ household: true, notes: true, internal: true })),
  live('Task record', 'task-record', 'REPLICATE', 'tasks', (app) => app.task({})),
  live('Task assignee', 'task-assignee', 'REPLICATE', 'tasks', (app) => app.task({ assignee: true })),
  live('Task recurrence', 'task-recurrence', 'REPLICATE', 'tasks', (app) => app.task({ recurrence: true })),
  live('Task priority', 'task-priority', 'REPLICATE', 'tasks', (app) => app.task({ priority: true })),
  live('Tasks used as information storage', 'facts-not-tasks', 'IMPROVE', 'contacts', (app) => app.contact({ household: true, facts: true })),
  live('Tasks as an audit trail for plan changes', 'task-change-trail', 'REPLICATE', 'tasks', (app) => app.task({ activity: true })),
  live('Unified Tasks & Workflow Steps', 'unified-work', 'REPLICATE', 'tasks', (app) => app.task({ unified: true })),
  live('Capacity-aware / judgment-aware task triage', 'task-triage', 'IMPROVE', 'tasks', (app) => app.task({ triage: true })),
  live('Workflow templates', 'workflow-templates', 'REPLICATE', 'workflows', (app) => app.workflow({ template: true })),
  live('Wealthbox Library of Workflows', 'workflow-library', 'REPLICATE', 'workflows', (app) => app.workflow({ library: true })),
  live('Workflow instances (open workflows)', 'workflow-instances', 'REPLICATE', 'workflows', (app) => app.workflow({ template: true, instance: true })),
  live('Scheduled workflows', 'workflow-scheduling', 'REPLICATE', 'workflows', (app) => app.workflow({ template: true, schedule: true })),
  live('Workflow outcomes (branch/restart/complete)', 'workflow-outcomes', 'REPLICATE', 'workflows', (app) => app.workflow({ template: true, outcomes: true })),
  live('Coworker commenting on workflow steps', 'workflow-comments', 'REPLICATE', 'workflows', (app) => app.workflow({ template: true, instance: true, comments: true })),
  live('Jump → Wealthbox workflow trigger', 'meeting-workflow-proposal', 'REPLICATE', 'workflows', (app) => app.workflow({ meetingProposal: true })),
  live('Opportunity record', 'opportunity-record', 'REPLICATE', 'pipelines', (app) => app.pipeline({ opportunity: true })),
  live('Opportunity pipelines', 'opportunity-pipelines', 'REPLICATE', 'pipelines', (app) => app.pipeline({ pipeline: true })),
  live('Opportunity stages', 'opportunity-stages', 'REPLICATE', 'pipelines', (app) => app.pipeline({ stage: true })),
  live('Launch workflow from new opportunity', 'opportunity-workflow-trigger', 'REPLICATE', 'pipelines', (app) => app.pipeline({ workflowTrigger: true })),
  live('Contact actions in opportunity workflows', 'opportunity-workflow-contact-actions', 'REPLICATE', 'pipelines', (app) => app.pipeline({ opportunity: true, contactActions: true })),
  live('Calendar / events', 'crm-calendar', 'REPLICATE', 'calendar', (app) => app.durableFeature({ route: 'crm-home-nav-calendar', controls: ['crm-calendar-new-event', 'crm-calendar-event-save'], action: 'crm-calendar-event-save', recordKind: 'event' })),
  live('Calendly integration for scheduling links', 'service-tier-scheduling', 'IMPROVE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-service-policy-scheduling-link', 'crm-service-policy-save'], action: 'crm-service-policy-save', recordKind: 'servicePolicy' })),
  live('Email sync (Gmail/Outlook)', 'crm-email-sync', 'REPLICATE', 'email', (app) => app.durableFeature({ route: 'crm-home-nav-email', controls: ['crm-email-sync', 'crm-email-client-link'], action: 'crm-email-sync', recordKind: 'emailActivity' })),
  live('Email broadcast', 'email-broadcast', 'REPLICATE', 'email', (app) => app.broadcast()),
  live('Automated/canned reports', 'canned-reports', 'REPLICATE', 'reports', (app) => app.report({ kind: 'no_contact_6mo' })),
  live('Dynamic/custom reports', 'custom-reports', 'REPLICATE', 'reports', (app) => app.report({ kind: 'custom' })),
  live('AI for Reports (prompt-built reports)', 'ai-reports', 'IMPROVE', 'reports', (app) => app.report({ kind: 'ai' })),
  live('Client-neglect / no-recent-interaction report', 'client-neglect-report', 'IMPROVE', 'reports', (app) => app.report({ kind: 'no_contact_6mo' })),
  live('Attention-vs-fee report', 'attention-fee-report', 'IMPROVE', 'reports', (app) => app.report({ kind: 'attention_vs_fee' })),
  live('Contact activity stream', 'contact-timeline', 'REPLICATE', 'timeline', (app) => app.contact({ household: true, notes: true, facts: true, timeline: true })),
  live('Firm-wide activity/dashboard feed', 'firm-activity-feed', 'REPLICATE', 'timeline', (app) => app.durableFeature({ route: 'crm-home-nav-activity', controls: ['crm-firm-activity-feed', 'crm-firm-activity-create'], action: 'crm-firm-activity-create', recordKind: 'activityEvent' })),
  live('@-mentioning', 'activity-mentions', 'REPLICATE', 'timeline', (app) => app.durableFeature({ route: 'crm-home-nav-timeline', controls: ['crm-timeline-mention', 'crm-timeline-post'], action: 'crm-timeline-post', recordKind: 'activityEvent' })),
  live('Comments on activity', 'activity-comments', 'REPLICATE', 'timeline', (app) => app.activityConversation()),
  live('Likes/emoji activity reactions', 'activity-reactions', 'REPLICATE', 'timeline', (app) => app.activityConversation()),
  live('Wealthbox itself (as a CRM to migrate FROM)', 'wealthbox-migration', 'REPLICATE', 'migration', (app) => app.migration({ action: 'crm-migration-run-import', fullReview: true })),
  live('Jump.ai', 'jump-replacement', 'REPLICATE', 'meetings', (app) => app.jumpMeeting()),
  live('Redtail', 'redtail-migration', 'REPLICATE', 'migration', (app) => app.migration({ action: 'crm-redtail-import' })),
  live('Salesforce', 'salesforce-migration', 'REPLICATE', 'migration', (app) => app.migration({ action: 'crm-salesforce-import' })),
  live('Microsoft Outlook / Gmail', 'outlook-gmail', 'REPLICATE', 'email', (app) => app.durableFeature({ route: 'crm-home-nav-email', controls: ['crm-email-sync', 'crm-email-client-link'], action: 'crm-email-sync', recordKind: 'emailActivity' })),
  live('Microsoft Teams', 'teams-replacement', 'IMPROVE', 'timeline', (app) => app.contact({ household: true, notes: true, internal: true })),
  live('Calendly', 'calendly-replacement', 'IMPROVE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-service-policy-scheduling-link', 'crm-service-policy-save'], action: 'crm-service-policy-save', recordKind: 'servicePolicy' })),
  pending('Box / Dropbox / Google Drive', 'document-connectors', 'REPLICATE', 'documents', 'The existing document connectors have no CRM-record linking acceptance path yet.'),
  pending('AI Notetaker (launched fall 2025, native iOS recording April 2026)', 'ai-notetaker', 'REPLICATE', 'meetings', 'Needs a deterministic meeting-capture fixture that proves the saved note is linked to its client.'),
  live('AI for Reports', 'ai-reports-suite', 'IMPROVE', 'reports', (app) => app.report({ kind: 'ai' })),
  pending('Agents (early access, March 2026)', 'ai-monitoring', 'IMPROVE', 'tasks', 'No approval-visible monitoring result exists to exercise; autonomous action is intentionally excluded.'),
  live('Playbooks (early access, March 2026)', 'ai-playbooks', 'REPLICATE', 'workflows', (app) => app.approvedPlaybook()),
  pending('AI Assistant (early access, March 2026)', 'crm-ai-assistant', 'REPLICATE', 'search', 'Needs an offline CRM-aware answer fixture with cited records before this can be proved safely.'),
  live('Member / Admin / Owner roles', 'firm-roles', 'REPLICATE', 'firm setup', (app) => app.firmDirectory()),
  live('Teams', 'firm-teams', 'REPLICATE', 'firm setup', (app) => app.firmDirectory()),
  live('Groups / visibility restrictions', 'firm-visibility', 'REPLICATE', 'firm setup', (app) => app.firmDirectory()),
  live('Default permissions per user', 'firm-permissions', 'REPLICATE', 'firm setup', (app) => app.firmDirectory()),
  live('Multiple Workspaces', 'multiple-workspaces', 'REPLICATE', 'firm setup', (app) => app.workspaces()),
  live('White-glove migration service', 'guided-migration', 'REPLICATE', 'migration', (app) => app.migration({ action: 'crm-migration-run-import', fullReview: true })),
  live('Data portability / export', 'migration-export', 'REPLICATE', 'migration', (app) => app.migration({ action: 'crm-migration-run-import', exportFile: true })),
  live('External Unique ID field for import linking', 'migration-external-id', 'REPLICATE', 'migration', (app) => app.migration({ action: 'crm-migration-run-import', externalId: true })),
  live('Self-service CSV/Excel/vCard/Outlook import', 'self-service-contact-import', 'REPLICATE', 'migration', (app) => app.selfServiceContactImport()),
  live('REST API (OAuth2 + token auth)', 'wealthbox-api-connection', 'REPLICATE', 'migration', (app) => app.migration({ action: 'crm-migration-run-import' })),
  pending('Native webhooks', 'native-collaboration-push', 'IMPROVE', 'collaboration', 'Needs a two-seat, local-only push fixture; a single desktop app cannot prove peer delivery.'),

  // ---------------------------------------------------------------------------
  // W89 GAP FEATURES — previously SKIPPED, reinstated 2026-07-12 on Jameson's
  // acceptance bar: "the app can do EVERYTHING Wealthbox can."
  //
  // These are declared here BEFORE their lanes finish, on purpose. The matrix
  // defines the acceptance contract; the lane implements to it. Until a lane
  // lands its test hooks these read NOT BUILT — which is the honest answer, and
  // is exactly the point: the denominator is 79, not 69. A feature we build but
  // do not measure is a rumour, and the first person to discover whether it
  // works would be Jameson, by clicking on it.
  // ---------------------------------------------------------------------------
  live('File storage on records', 'crm-file-attachments', 'REPLICATE', 'documents', (app) => app.durableFeature({ route: 'crm-home-nav-attachments', controls: ['crm-attachments-panel', 'crm-attachment-add', 'crm-attachment-row'], action: 'crm-attachment-add', result: 'Attached', recordKind: 'attachmentLink' })),
  live('BCC Email Dropbox', 'crm-bcc-dropbox', 'IMPROVE', 'email', (app) => app.durableFeature({ route: 'crm-home-nav-email', controls: ['crm-dropbox-address', 'crm-dropbox-capture-row'], action: 'crm-dropbox-capture-run', result: 'Captured', recordKind: 'emailCapture' })),
  live('Email broadcast', 'crm-email-broadcast', 'REPLICATE', 'email', (app) => app.durableFeature({ route: 'crm-home-nav-email', controls: ['crm-broadcast-compose', 'crm-broadcast-audience', 'crm-broadcast-review'], action: 'crm-broadcast-save', result: 'Broadcast saved', recordKind: 'broadcast' })),
  live('Comments on activity', 'activity-comments', 'REPLICATE', 'timeline', (app) => app.durableFeature({ route: 'crm-home-nav-activity', controls: ['crm-activity-comment-input', 'crm-activity-comment-post', 'crm-activity-comment-row'], action: 'crm-activity-comment-post', result: 'Parity comment', recordKind: 'activityComment' })),
  live('Likes/emoji activity reactions', 'activity-reactions', 'REPLICATE', 'timeline', (app) => app.durableFeature({ route: 'crm-home-nav-activity', controls: ['crm-activity-reaction-picker', 'crm-activity-reaction-count'], action: 'crm-activity-reaction-add', recordKind: 'activityReaction' })),
  live('Project record', 'project-record', 'REPLICATE', 'workflows', (app) => app.durableFeature({ route: 'crm-home-nav-projects', controls: ['crm-project-create', 'crm-project-name', 'crm-project-row'], action: 'crm-project-create', result: 'Parity project', recordKind: 'project' })),
  live('Contact Actions in Opportunity Workflows', 'opportunity-contact-actions', 'REPLICATE', 'pipeline', (app) => app.durableFeature({ route: 'crm-home-nav-pipeline', controls: ['crm-opportunity-contact-action', 'crm-opportunity-action-result'], action: 'crm-opportunity-contact-action', result: 'Action recorded', recordKind: 'contactAction' })),
  live('Self-service CSV/Excel/vCard/Outlook import', 'csv-import', 'REPLICATE', 'migration', (app) => app.durableFeature({ route: 'crm-home-nav-migration', controls: ['crm-csv-import-start', 'crm-csv-map-columns', 'crm-csv-import-summary'], action: 'crm-csv-import-run', result: 'Imported', recordKind: 'household' })),
  live('Multiple Workspaces', 'multiple-workspaces', 'REPLICATE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-workspace-list', 'crm-workspace-create', 'crm-workspace-switch'], action: 'crm-workspace-create', result: 'Parity workspace', recordKind: 'workspace' })),
  live('Org Admin cross-workspace user management', 'org-admin', 'REPLICATE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-org-admin-panel', 'crm-org-admin-user-row', 'crm-org-admin-assign'], action: 'crm-org-admin-assign', result: 'Access updated', recordKind: 'orgAssignment' })),

  // Found 2026-07-12, and it is its own lesson. This row is BUILT — the
  // Propagation review surface and its controls have existed for days — but the
  // matrix parser only recognised a verdict cell that began with the literal
  // word REPLICATE/IMPROVE/SKIP, and this row's title was bold. So it matched
  // neither list and fell out of BOTH: never measured, never even reported as
  // unmeasured. A feature must not be able to disappear from the scoreboard
  // because of how somebody formatted a table cell. The parser now strips
  // emphasis; this is the 80th feature.
  live('Template-edit propagation to open instances', 'workflow-propagation', 'IMPROVE', 'workflows', (app) => app.durableFeature({ route: 'crm-home-nav-propagation', controls: ['crm-propagation-review-required', 'crm-propagation-apply', 'crm-propagation-undo'], action: 'crm-propagation-apply', result: 'Applied', recordKind: 'workflowInstance' })),
];

// SKIPs stay visible, but they do not inflate or reduce the replacement score.
export const SKIPPED_FEATURES: readonly SkippedFeature[] = [
  { matrixFeature: 'Project record', reason: 'New multi-step work belongs in workflows; imported projects stay read-only legacy records.' },
  { matrixFeature: 'Emails land in Activity Stream, not the Email tab, for dropbox items', reason: 'This is a Wealthbox threading limitation, not behavior to copy.' },
  { matrixFeature: 'Email broadcast', reason: 'Marketing blasts are outside the small-firm CRM scope.' },
  { matrixFeature: 'File storage on records', reason: 'The existing Documents system owns files; CRM records link them.' },
  { matrixFeature: 'RightCapital', reason: 'Read-only reference integration is deferred until a pilot needs it.' },
  { matrixFeature: 'Charles Schwab', reason: 'Custodial feeds are out of scope for this CRM replacement phase.' },
  { matrixFeature: 'DocuSign', reason: 'D9 assigns it to the existing connector, not a new CRM feature.' },
  { matrixFeature: 'JotForm', reason: 'The responsive intake-link flow is the v1 replacement.' },
  { matrixFeature: 'AdvicePay', reason: 'No evidence of use; revisit only if a pilot needs it.' },
  { matrixFeature: 'Orion / Black Diamond / Tamarac / Addepar', reason: 'Large integrations with no evidence of need.' },
  { matrixFeature: 'eMoney / MoneyGuide / Voyant', reason: 'Deferred like RightCapital.' },
  { matrixFeature: 'AI assistant integrations (Bloks, CogniCor, DataDasher, DeepVest)', reason: 'Lantern is AI-native; there is no separate AI product to bolt on.' },
  { matrixFeature: 'Zapier (meta-integration, powers many of the above)', reason: 'No evidence of need for a ≤10-seat firm.' },
  { matrixFeature: 'Caller ID from Wealthbox contacts', reason: 'Dialer and phone infrastructure are a charter exclusion.' },
  { matrixFeature: 'Click-to-call', reason: 'Dialer and phone infrastructure are a charter exclusion.' },
];
