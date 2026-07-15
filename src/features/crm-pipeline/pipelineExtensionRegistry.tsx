import { Fragment, type ReactNode } from 'react';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { CrmHouseholdAddRequest } from '@/features/crm-home/routes';
import {
  legacyOpportunityFields,
  legacyPipelineViews,
} from './pipelineExtensionRegistryCompatibility';

/** Feature modules augment these maps beside their descriptors. */
export interface PipelineViewIdMap {}
export interface OpportunityFieldIdMap {}

export type PipelineViewId = Extract<keyof PipelineViewIdMap, string>;
export type OpportunityFieldId = Extract<keyof OpportunityFieldIdMap, string>;

export type PipelineData = Pick<
  ReturnType<typeof useLiveCrmRecords>,
  'records' | 'save' | 'error' | 'freshness'
>;

export interface PipelineViewContext {
  data: PipelineData;
  onNavigate: (route: PipelineViewId) => void;
  addRequest?: CrmHouseholdAddRequest;
  onAddRequestConsumed?: () => void;
}

export interface OpportunityFieldContext {
  opportunity: LiveCrmRecord | null;
  compatibilityMount: ReactNode;
}

export interface PipelineViewDescriptor {
  id: PipelineViewId;
  order: number;
  mount: (context: PipelineViewContext) => ReactNode;
}

export interface OpportunityFieldDescriptor {
  id: OpportunityFieldId;
  order: number;
  mount: (context: OpportunityFieldContext) => ReactNode;
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

export function validatePipelineViewDescriptors(
  descriptors: readonly PipelineViewDescriptor[]
): void {
  validateDescriptors('pipelineViewRegistry', descriptors);
}

export function validateOpportunityFieldDescriptors(
  descriptors: readonly OpportunityFieldDescriptor[]
): void {
  validateDescriptors('opportunityFieldRegistry', descriptors);
}

/** Append-only mount lists. Existing entries keep their order. */
export const pipelineViewRegistry: readonly PipelineViewDescriptor[] =
  legacyPipelineViews;
export const opportunityFieldRegistry: readonly OpportunityFieldDescriptor[] =
  legacyOpportunityFields;

function ordered<T extends { order: number }>(descriptors: readonly T[]): T[] {
  return descriptors.slice().sort((left, right) => left.order - right.order);
}

export function getPipelineViews(
  descriptors: readonly PipelineViewDescriptor[] = pipelineViewRegistry
): readonly PipelineViewDescriptor[] {
  validatePipelineViewDescriptors(descriptors);
  return ordered(descriptors);
}

export function getPipelineView(
  id: PipelineViewId,
  descriptors: readonly PipelineViewDescriptor[] = pipelineViewRegistry
): PipelineViewDescriptor | undefined {
  return getPipelineViews(descriptors).find(
    (descriptor) => descriptor.id === id
  );
}

export function mountPipelineView(
  id: PipelineViewId,
  context: PipelineViewContext,
  descriptors?: readonly PipelineViewDescriptor[]
): ReactNode {
  return getPipelineView(id, descriptors)?.mount(context) ?? null;
}

export function getOpportunityFields(
  descriptors: readonly OpportunityFieldDescriptor[] = opportunityFieldRegistry
): readonly OpportunityFieldDescriptor[] {
  validateOpportunityFieldDescriptors(descriptors);
  return ordered(descriptors);
}

export function mountOpportunityFields(
  context: OpportunityFieldContext,
  descriptors?: readonly OpportunityFieldDescriptor[]
): ReactNode {
  return getOpportunityFields(descriptors).map((descriptor) => (
    <Fragment key={descriptor.id}>{descriptor.mount(context)}</Fragment>
  ));
}
