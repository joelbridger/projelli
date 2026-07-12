/**
 * Wealthbox depth contracts.
 *
 * These intentionally model only shapes seen in the live API probe.  A caller
 * can prepare a task assignment or a workflow handoff, but cannot turn an
 * unproven workflow state into a successful CRM write.
 */

export const WEALTHBOX_PAGE_CAP = 100;

export type WealthboxDocumentType =
  | 'Contact'
  | 'Household'
  | 'Task'
  | 'Opportunity'
  | 'Project';

export interface WealthboxCustomFieldDefinition {
  id: number;
  name: string;
  document_type: string;
  field_type: string;
  metadata: Record<string, unknown>;
  options: unknown[];
}

export interface WealthboxCustomFieldValue {
  id: number;
  name: string;
  document_type: string;
  field_type: string;
  metadata: Record<string, unknown>;
  value: string | number | boolean | string[] | null;
}

export interface WealthboxCustomFieldPage {
  meta?: {
    page?: number;
    total_pages?: number;
  };
  custom_fields?: WealthboxCustomFieldDefinition[];
}

export interface WealthboxCustomFieldRecord {
  id: number | string;
  name?: string;
  custom_fields?: WealthboxCustomFieldValue[];
}

export interface WealthboxCustomFieldRegistry {
  definitions: WealthboxCustomFieldDefinition[];
  pagesRead: number;
}

export interface WealthboxAskSource {
  sourceId: string;
  recordId: string;
  text: string;
  fieldId: number;
  fieldName: string;
  documentType: string;
  fieldType: string;
}

export interface WealthboxCustomFieldIngestion {
  sources: WealthboxAskSource[];
  warnings: string[];
}

export interface WealthboxTaskAssigneeTarget {
  kind: 'task_assignee';
  userId: number;
  displayName: string;
}

/**
 * Wealthbox's Basic sandbox blocked workflow creation, so this is a target
 * for the advisor's reviewed handoff, never an assertion about the current
 * workflow step or status.
 */
export interface WealthboxWorkflowTarget {
  kind: 'workflow';
  templateId: number;
  templateName: string;
  contactId: number;
}

export interface WealthboxTaskWriteDraft {
  kind: 'task';
  title: string;
  description: string;
  dueDate: string;
  contactId: number;
  assignee?: WealthboxTaskAssigneeTarget;
  workflowTarget?: WealthboxWorkflowTarget;
}

export type WealthboxWriteDisposition =
  | 'ready_for_task_write'
  | 'needs_assignee_api_confirmation'
  | 'workflow_manual_handoff';

export interface WealthboxPreparedWrite {
  disposition: WealthboxWriteDisposition;
  request?: {
    method: 'POST';
    path: '/tasks';
    body: Record<string, unknown>;
  };
  target?: WealthboxWorkflowTarget;
  notice?: string;
}

export interface WealthboxDepthTransport {
  getJson: <T>(path: string) => Promise<T>;
}
