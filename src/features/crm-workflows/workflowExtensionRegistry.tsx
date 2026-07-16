import { Fragment, type ReactNode } from 'react';
import type {
  LiveWorkflowInstance,
  LiveWorkflowTemplate,
} from '@/features/crm-home/workflowLive';
import {
  legacyWorkflowRules,
  legacyWorkflowStepExtensions,
} from './workflowExtensionRegistryCompatibility';
import { workflowStepAttachmentsExtension } from './extensions/attachments';
import type { WorkflowStepMetadataPatch } from './workflowStepPersistence';

/** Feature modules augment these maps beside their descriptors. */
export interface WorkflowStepExtensionIdMap {}
export interface WorkflowRuleIdMap {}

export type WorkflowStepExtensionId = Extract<
  keyof WorkflowStepExtensionIdMap,
  string
>;
export type WorkflowRuleId = Extract<keyof WorkflowRuleIdMap, string>;

export interface WorkflowStepExtensionContext {
  instance: LiveWorkflowInstance;
  stepId: string;
  /** Validates, saves, and returns the canonical instance state after the patch. */
  saveStepMetadata: (patch: WorkflowStepMetadataPatch) => Promise<LiveWorkflowInstance>;
  /** Preserves the current step controls while they move behind this seam. */
  compatibilityMount: ReactNode;
}

export interface WorkflowRuleContext {
  template: LiveWorkflowTemplate;
  /** Preserves the current template rules while they move behind this seam. */
  compatibilityMount: ReactNode;
}

export interface WorkflowStepExtensionDescriptor {
  id: WorkflowStepExtensionId;
  order: number;
  mount: (context: WorkflowStepExtensionContext) => ReactNode;
}

export interface WorkflowRuleDescriptor {
  id: WorkflowRuleId;
  order: number;
  mount: (context: WorkflowRuleContext) => ReactNode;
}

function validateDescriptors(
  registryName: string,
  descriptors: readonly { id: string; order: number; mount: unknown }[]
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
    ids.add(descriptor.id);
  }
}

export function validateWorkflowStepExtensionDescriptors(
  descriptors: readonly WorkflowStepExtensionDescriptor[]
): void {
  validateDescriptors('workflowStepExtensionRegistry', descriptors);
}

export function validateWorkflowRuleDescriptors(
  descriptors: readonly WorkflowRuleDescriptor[]
): void {
  validateDescriptors('workflowRuleRegistry', descriptors);
}

/** Append-only mount lists. Existing entries keep their order. */
export const workflowStepExtensionRegistry: readonly WorkflowStepExtensionDescriptor[] =
  [...legacyWorkflowStepExtensions, workflowStepAttachmentsExtension];
export const workflowRuleRegistry: readonly WorkflowRuleDescriptor[] =
  legacyWorkflowRules;

export function getWorkflowStepExtensions(
  descriptors: readonly WorkflowStepExtensionDescriptor[] = workflowStepExtensionRegistry
): readonly WorkflowStepExtensionDescriptor[] {
  validateWorkflowStepExtensionDescriptors(descriptors);
  return descriptors.slice().sort((left, right) => left.order - right.order);
}

export function getWorkflowRules(
  descriptors: readonly WorkflowRuleDescriptor[] = workflowRuleRegistry
): readonly WorkflowRuleDescriptor[] {
  validateWorkflowRuleDescriptors(descriptors);
  return descriptors.slice().sort((left, right) => left.order - right.order);
}

export function mountWorkflowStepExtensions(
  context: WorkflowStepExtensionContext,
  descriptors?: readonly WorkflowStepExtensionDescriptor[]
): ReactNode {
  return getWorkflowStepExtensions(descriptors).map((descriptor) => (
    <Fragment key={descriptor.id}>{descriptor.mount(context)}</Fragment>
  ));
}

export function mountWorkflowRules(
  context: WorkflowRuleContext,
  descriptors?: readonly WorkflowRuleDescriptor[]
): ReactNode {
  return getWorkflowRules(descriptors).map((descriptor) => (
    <Fragment key={descriptor.id}>{descriptor.mount(context)}</Fragment>
  ));
}
