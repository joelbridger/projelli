import type { CrmHomeAdapter } from './types';

export type CrmHomeRoute =
  | 'today'
  | 'tasks'
  | 'workflows'
  | 'propagation'
  | 'pipeline'
  | 'pipeline-settings'
  | 'reports'
  | 'activity'
  | 'views'
  | 'firm-setup'
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
  | 'email-broadcast'
  | 'calendar'
  | 'timeline';

export interface CrmHomeProps {
  adapter?: CrmHomeAdapter;
  initialRoute?: CrmHomeRoute;
  /** Sample records are visual-test-only and always visibly labelled. */
  preview?: boolean;
}
