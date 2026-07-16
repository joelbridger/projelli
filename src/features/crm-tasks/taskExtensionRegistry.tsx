import { Fragment, type ReactNode } from 'react';
import type { CrmHouseholdAddRequest } from '@/features/crm-home/routes';
import type {
  CrmFirmMember,
  CrmTask,
  CrmWorkflowWorkItem,
} from '@/features/crm-home/types';
import { taskTemplatesLibrary } from './extensions/templates';
import {
  legacyTaskActions,
  legacyTaskFields,
  legacyTaskTemplates,
} from './taskExtensionRegistryCompatibility';
import { taskCreateV1Template } from './extensions/create';
import { capacityTriageTaskAction } from './extensions/capacity-triage';

/** Feature modules augment these maps beside their descriptors. */
export interface TaskFieldIdMap {}
export interface TaskActionIdMap {}
export interface TaskTemplateIdMap {}

export type TaskFieldId = Extract<keyof TaskFieldIdMap, string>;
export type TaskActionId = Extract<keyof TaskActionIdMap, string>;
export type TaskTemplateId = Extract<keyof TaskTemplateIdMap, string>;

export interface TaskFieldContext {
  task: CrmTask;
  updateTask: (task: CrmTask) => void;
  households: readonly { id: string; name: string }[];
  firmMembers: readonly CrmFirmMember[];
  /** Preserves the current task fields while they move behind this seam. */
  compatibilityMount: ReactNode;
}

export interface TaskActionContext {
  tasks: readonly CrmTask[];
  workflowWorkItems: readonly CrmWorkflowWorkItem[];
  /** Preserves the current task action while it moves behind this seam. */
  compatibilityMount: ReactNode;
}

export interface TaskTemplateContext {
  addRequest?: CrmHouseholdAddRequest;
  onAddRequestConsumed?: () => void;
  onApplied?: (taskId: string) => void;
  onCreate: (task: CrmTask) => void;
}

export interface TaskFieldDescriptor {
  id: TaskFieldId;
  order: number;
  mount: (context: TaskFieldContext) => ReactNode;
}

export interface TaskActionDescriptor {
  id: TaskActionId;
  order: number;
  mount: (context: TaskActionContext) => ReactNode;
}

export interface TaskTemplateDescriptor {
  id: TaskTemplateId;
  order: number;
  create?: (addRequest?: CrmHouseholdAddRequest) => CrmTask;
  mount: (context: TaskTemplateContext) => ReactNode;
}

function validateDescriptors(
  registryName: string,
  descriptors: readonly {
    id: string;
    order: number;
    mount: unknown;
    create?: unknown;
  }[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim()) {
      throw new Error(`[${registryName}] id must not be empty`);
    }
    if (ids.has(descriptor.id)) {
      throw new Error(`[${registryName}] duplicate id: ${descriptor.id}`);
    }
    if (!Number.isFinite(descriptor.order)) {
      throw new Error(
        `[${registryName}] order must be finite: ${descriptor.id}`
      );
    }
    if (typeof descriptor.mount !== 'function') {
      throw new Error(
        `[${registryName}] mount must be a function: ${descriptor.id}`
      );
    }
    if (descriptor.create !== undefined && typeof descriptor.create !== 'function') {
      throw new Error(
        `[${registryName}] create must be a function: ${descriptor.id}`
      );
    }
    ids.add(descriptor.id);
  }
}

export function validateTaskFieldDescriptors(
  descriptors: readonly TaskFieldDescriptor[]
): void {
  validateDescriptors('taskFieldRegistry', descriptors);
}

export function validateTaskActionDescriptors(
  descriptors: readonly TaskActionDescriptor[]
): void {
  validateDescriptors('taskActionRegistry', descriptors);
}

export function validateTaskTemplateDescriptors(
  descriptors: readonly TaskTemplateDescriptor[]
): void {
  validateDescriptors('taskTemplateRegistry', descriptors);
}

/** Append-only mount lists. Existing entries keep their order. */
export const taskFieldRegistry: readonly TaskFieldDescriptor[] =
  legacyTaskFields;
export const taskActionRegistry: readonly TaskActionDescriptor[] = [
  ...legacyTaskActions,
  capacityTriageTaskAction,
];
export const taskTemplateRegistry: readonly TaskTemplateDescriptor[] =
  [...legacyTaskTemplates, taskCreateV1Template, taskTemplatesLibrary];

function ordered<T extends { order: number }>(descriptors: readonly T[]): T[] {
  return descriptors.slice().sort((left, right) => left.order - right.order);
}

export function getTaskFields(
  descriptors: readonly TaskFieldDescriptor[] = taskFieldRegistry
): readonly TaskFieldDescriptor[] {
  validateTaskFieldDescriptors(descriptors);
  return ordered(descriptors);
}

export function getTaskActions(
  descriptors: readonly TaskActionDescriptor[] = taskActionRegistry
): readonly TaskActionDescriptor[] {
  validateTaskActionDescriptors(descriptors);
  return ordered(descriptors);
}

export function getTaskTemplates(
  descriptors: readonly TaskTemplateDescriptor[] = taskTemplateRegistry
): readonly TaskTemplateDescriptor[] {
  validateTaskTemplateDescriptors(descriptors);
  return ordered(descriptors);
}

export function mountTaskFields(
  context: TaskFieldContext,
  descriptors?: readonly TaskFieldDescriptor[]
): ReactNode {
  return getTaskFields(descriptors).map((descriptor) => (
    <Fragment key={descriptor.id}>{descriptor.mount(context)}</Fragment>
  ));
}

export function mountTaskActions(
  context: TaskActionContext,
  descriptors?: readonly TaskActionDescriptor[]
): ReactNode {
  return getTaskActions(descriptors).map((descriptor) => (
    <Fragment key={descriptor.id}>{descriptor.mount(context)}</Fragment>
  ));
}

export function mountTaskTemplates(
  context: TaskTemplateContext,
  descriptors?: readonly TaskTemplateDescriptor[]
): ReactNode {
  return getTaskTemplates(descriptors).map((descriptor) => (
    <Fragment key={descriptor.id}>{descriptor.mount(context)}</Fragment>
  ));
}
