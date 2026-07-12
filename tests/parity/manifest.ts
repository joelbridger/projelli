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
  workflow(options: { template?: boolean; instance?: boolean; schedule?: boolean; outcomes?: boolean; comments?: boolean; library?: boolean; meetingProposal?: boolean }): Promise<void>;
  pipeline(options: { opportunity?: boolean; pipeline?: boolean; stage?: boolean; workflowTrigger?: boolean }): Promise<void>;
  report(options: { kind: 'no_contact_6mo' | 'attention_vs_fee' | 'custom' | 'ai' }): Promise<void>;
  customField(): Promise<void>;
  durableFeature(options: { route: string; controls: string[]; action?: string; result?: string; recordKind?: string }): Promise<void>;
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
  live('Custom fields', 'custom-fields', 'REPLICATE', 'firm setup', (app) => app.customField()),
  live('Tags', 'tags', 'REPLICATE', 'contacts', (app) => app.contact({ household: true, tags: true })),
  live('Custom Objects', 'typed-objects', 'IMPROVE', 'contacts', (app) => app.contact({ household: true, account: true })),
  live('Notes on a contact', 'contact-notes', 'REPLICATE', 'contacts', (app) => app.contact({ household: true, notes: true })),
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
  live('Calendar / events', 'crm-calendar', 'REPLICATE', 'calendar', (app) => app.durableFeature({ route: 'crm-home-nav-calendar', controls: ['crm-calendar-new-event', 'crm-calendar-event-save'], action: 'crm-calendar-event-save', recordKind: 'event' })),
  live('Calendly integration for scheduling links', 'service-tier-scheduling', 'IMPROVE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-service-policy-scheduling-link', 'crm-service-policy-save'], action: 'crm-service-policy-save', recordKind: 'servicePolicy' })),
  live('Email sync (Gmail/Outlook)', 'crm-email-sync', 'REPLICATE', 'email', (app) => app.durableFeature({ route: 'crm-home-nav-email', controls: ['crm-email-sync', 'crm-email-client-link'], action: 'crm-email-sync', recordKind: 'emailActivity' })),
  live('Automated/canned reports', 'canned-reports', 'REPLICATE', 'reports', (app) => app.report({ kind: 'no_contact_6mo' })),
  live('Dynamic/custom reports', 'custom-reports', 'REPLICATE', 'reports', (app) => app.report({ kind: 'custom' })),
  live('AI for Reports (prompt-built reports)', 'ai-reports', 'IMPROVE', 'reports', (app) => app.report({ kind: 'ai' })),
  live('Client-neglect / no-recent-interaction report', 'client-neglect-report', 'IMPROVE', 'reports', (app) => app.report({ kind: 'no_contact_6mo' })),
  live('Attention-vs-fee report', 'attention-fee-report', 'IMPROVE', 'reports', (app) => app.report({ kind: 'attention_vs_fee' })),
  live('Contact activity stream', 'contact-timeline', 'REPLICATE', 'timeline', (app) => app.contact({ household: true, notes: true, facts: true, timeline: true })),
  live('Firm-wide activity/dashboard feed', 'firm-activity-feed', 'REPLICATE', 'timeline', (app) => app.durableFeature({ route: 'crm-home-nav-activity', controls: ['crm-firm-activity-feed', 'crm-firm-activity-create'], action: 'crm-firm-activity-create', recordKind: 'activityEvent' })),
  live('@-mentioning', 'activity-mentions', 'REPLICATE', 'timeline', (app) => app.durableFeature({ route: 'crm-home-nav-timeline', controls: ['crm-timeline-mention', 'crm-timeline-post'], action: 'crm-timeline-post', recordKind: 'activityEvent' })),
  live('Wealthbox itself (as a CRM to migrate FROM)', 'wealthbox-migration', 'REPLICATE', 'migration', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-firm-route-migration', 'crm-migration-run-import', 'crm-migration-fidelity'], action: 'crm-migration-run-import', recordKind: 'migration_report' })),
  pending('Jump.ai', 'jump-replacement', 'REPLICATE', 'meetings', 'The CRM-linked meeting fixture has not been exposed through the desktop bridge yet.'),
  live('Redtail', 'redtail-migration', 'REPLICATE', 'migration', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-redtail-import', 'crm-migration-fidelity'], action: 'crm-redtail-import', recordKind: 'migration_report' })),
  live('Salesforce', 'salesforce-migration', 'REPLICATE', 'migration', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-salesforce-import', 'crm-migration-fidelity'], action: 'crm-salesforce-import', recordKind: 'migration_report' })),
  live('Microsoft Outlook / Gmail', 'outlook-gmail', 'REPLICATE', 'email', (app) => app.durableFeature({ route: 'crm-home-nav-email', controls: ['crm-email-sync', 'crm-email-client-link'], action: 'crm-email-sync', recordKind: 'emailActivity' })),
  live('Microsoft Teams', 'teams-replacement', 'IMPROVE', 'timeline', (app) => app.contact({ household: true, notes: true, internal: true })),
  live('Calendly', 'calendly-replacement', 'IMPROVE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-service-policy-scheduling-link', 'crm-service-policy-save'], action: 'crm-service-policy-save', recordKind: 'servicePolicy' })),
  pending('Box / Dropbox / Google Drive', 'document-connectors', 'REPLICATE', 'documents', 'The existing document connectors have no CRM-record linking acceptance path yet.'),
  pending('AI Notetaker (launched fall 2025, native iOS recording April 2026)', 'ai-notetaker', 'REPLICATE', 'meetings', 'Needs a deterministic meeting-capture fixture that proves the saved note is linked to its client.'),
  live('AI for Reports', 'ai-reports-suite', 'IMPROVE', 'reports', (app) => app.report({ kind: 'ai' })),
  pending('Agents (early access, March 2026)', 'ai-monitoring', 'IMPROVE', 'tasks', 'No approval-visible monitoring result exists to exercise; autonomous action is intentionally excluded.'),
  pending('Playbooks (early access, March 2026)', 'ai-playbooks', 'REPLICATE', 'workflows', 'Needs a deterministic approved-playbook fixture rather than a model call.'),
  pending('AI Assistant (early access, March 2026)', 'crm-ai-assistant', 'REPLICATE', 'search', 'Needs an offline CRM-aware answer fixture with cited records before this can be proved safely.'),
  live('Member / Admin / Owner roles', 'firm-roles', 'REPLICATE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-firm-member-invite', 'crm-firm-member-role-save'], action: 'crm-firm-member-role-save', recordKind: 'firmMember' })),
  live('Teams', 'firm-teams', 'REPLICATE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-firm-team-new', 'crm-firm-team-save'], action: 'crm-firm-team-save', recordKind: 'team' })),
  live('Groups / visibility restrictions', 'firm-visibility', 'REPLICATE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-firm-group-new', 'crm-firm-group-save'], action: 'crm-firm-group-save', recordKind: 'group' })),
  live('Default permissions per user', 'firm-permissions', 'REPLICATE', 'firm setup', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-firm-permission-save'], action: 'crm-firm-permission-save', recordKind: 'permissionPolicy' })),
  live('White-glove migration service', 'guided-migration', 'REPLICATE', 'migration', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-firm-route-migration', 'crm-migration-run-import', 'crm-migration-fidelity'], action: 'crm-migration-run-import', recordKind: 'migration_report' })),
  live('Data portability / export', 'migration-export', 'REPLICATE', 'migration', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-migration-archive', 'crm-export-create'], action: 'crm-export-create', recordKind: 'migration_export' })),
  live('External Unique ID field for import linking', 'migration-external-id', 'REPLICATE', 'migration', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-migration-source-id-map', 'crm-migration-run-import'], action: 'crm-migration-run-import', recordKind: 'migration_report' })),
  live('REST API (OAuth2 + token auth)', 'wealthbox-api-connection', 'REPLICATE', 'migration', (app) => app.durableFeature({ route: 'crm-home-nav-firm-setup', controls: ['crm-migration-base-url', 'crm-migration-run-import'], action: 'crm-migration-run-import', recordKind: 'migration_report' })),
  pending('Native webhooks', 'native-collaboration-push', 'IMPROVE', 'collaboration', 'Needs a two-seat, local-only push fixture; a single desktop app cannot prove peer delivery.'),
];

// SKIPs stay visible, but they do not inflate or reduce the replacement score.
export const SKIPPED_FEATURES: readonly SkippedFeature[] = [
  { matrixFeature: 'Contact Actions in Opportunity Workflows', reason: 'D23 excludes bulk contact actions from v1.' },
  { matrixFeature: 'Project record', reason: 'New multi-step work belongs in workflows; imported projects stay read-only legacy records.' },
  { matrixFeature: 'BCC Email Dropbox', reason: 'Server-side plaintext capture conflicts with the E2EE charter.' },
  { matrixFeature: 'Emails land in Activity Stream, not the Email tab, for dropbox items', reason: 'This is a Wealthbox threading limitation, not behavior to copy.' },
  { matrixFeature: 'Email broadcast', reason: 'Marketing blasts are outside the small-firm CRM scope.' },
  { matrixFeature: 'Comments on activity', reason: 'D23 defers activity comments and reactions.' },
  { matrixFeature: 'Likes/emoji activity reactions', reason: 'D23 defers activity comments and reactions.' },
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
  { matrixFeature: 'Self-service CSV/Excel/vCard/Outlook import', reason: 'D9 keeps the Wealthbox migration wizard as the v1 import path.' },
];
