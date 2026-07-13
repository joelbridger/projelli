import type { CrmHomeAdapter } from './types';

export type CrmHomeRoute =
  | 'today'
  | 'tasks'
  | 'projects'
  | 'workflows'
  | 'propagation'
  | 'pipeline'
  | 'pipeline-settings'
  | 'reports'
  | 'activity'
  | 'views'
  | 'firm-setup'
  | 'firm-organization'
  | 'fields-tags'
  | 'intake-links'
  | 'workspaces'
  | 'migration'
  | 'fidelity'
  | 'workflow-recreation'
  | 'attachment-accounting'
  | 'archive-export'
  | 'rollback-export'
  | 'search'
  | 'email'
  | 'email-dropbox'
  | 'email-broadcast'
  | 'calendar'
  | 'timeline';

export interface CrmHouseholdAddRequest {
  kind: 'task' | 'opportunity' | 'workflow';
  householdId: string;
  householdLabel: string;
}

export interface CrmHomeProps {
  adapter?: CrmHomeAdapter;
  initialRoute?: CrmHomeRoute;
  addRequest?: CrmHouseholdAddRequest;
  onAddRequestConsumed?: () => void;
  /** Sample records are visual-test-only and always visibly labelled. */
  preview?: boolean;
}
