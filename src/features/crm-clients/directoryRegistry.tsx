import type { ReactNode } from 'react';
import type { CrmPerson, HouseholdDirectoryEntry } from './adapters';

/** Feature modules augment these maps beside their directory descriptors. */
export interface DirectoryToolIdMap {}
export interface DirectoryActionIdMap {}
export interface DirectoryRailIdMap {}
export interface DirectoryViewIdMap {}
export interface DirectoryQueryIdMap {}

export type DirectoryToolId = Extract<keyof DirectoryToolIdMap, string>;
export type DirectoryActionId = Extract<keyof DirectoryActionIdMap, string>;
export type DirectoryRailId = Extract<keyof DirectoryRailIdMap, string>;
export type DirectoryViewId = Extract<keyof DirectoryViewIdMap, string>;
export type DirectoryQueryId = Extract<keyof DirectoryQueryIdMap, string>;

type DeepReadonly<T> = T extends (...args: never[]) => unknown
  ? T
  : T extends readonly (infer Item)[]
    ? readonly DeepReadonly<Item>[]
    : T extends object
      ? { readonly [Key in keyof T]: DeepReadonly<T[Key]> }
      : T;

export type DirectoryResult =
  | Readonly<{ kind: 'household'; record: DeepReadonly<HouseholdDirectoryEntry> }>
  | Readonly<{ kind: 'person'; record: DeepReadonly<CrmPerson> }>;

export interface DirectoryContext {
  query: { value: string; setValue(value: string): void };
  selection: {
    person: CrmPerson | null;
    setPerson(person: CrmPerson | null): void;
  };
  /** The selected result view. Feature views use their registered descriptor id. */
  view: { value: string | null; setValue(value: string | null): void };
  /** Compatibility alias for `view`; it is not result ordering. */
  sort: { value: string | null; setValue(value: string | null): void };
  filters: {
    tab: string;
    setTab(value: string): void;
    externalOnly: boolean;
    setExternalOnly(value: boolean): void;
    needsVerification: boolean;
    setNeedsVerification(value: boolean): void;
  };
  records: DeepReadonly<{
    people: readonly CrmPerson[];
    households: readonly HouseholdDirectoryEntry[];
  }>;
  repository: {
    openHousehold(id: string): void;
    reviewRecipient(id: string): void;
    createHousehold(name: string): Promise<void> | void;
  };
  composition: DirectoryComposition;
}

interface DirectoryDescriptorBase<Id extends string> {
  id: Id;
  order: number;
  mount(context: DirectoryContext): ReactNode;
}

export interface DirectoryToolDescriptor extends DirectoryDescriptorBase<DirectoryToolId> {
  /**
   * Lets a descriptor opt out before the directory shell creates its layout
   * wrapper. Use this for flag-gated tools that otherwise render `null`.
   */
  isEnabled?(): boolean;
}
export interface DirectoryActionDescriptor extends DirectoryDescriptorBase<DirectoryActionId> {}
export interface DirectoryRailDescriptor extends DirectoryDescriptorBase<DirectoryRailId> {}
export interface DirectoryViewDescriptor<Id extends string = DirectoryViewId>
  extends DirectoryDescriptorBase<Id> {
  /** A view is mounted only when this resolver selects it. */
  isActive(context: DirectoryContext): boolean;
  /** Active feature views may explicitly replace active legacy or feature views. */
  replaces?: readonly string[];
  /** The one safe view used when no descriptor is active. */
  fallback?: boolean;
}

/**
 * A feature-owned read-only contribution to the visible directory projection.
 * Filters compose with AND; comparators compose in descriptor order.
 */
export interface DirectoryQueryDescriptor<Id extends string = DirectoryQueryId> {
  id: Id;
  order: number;
  isActive(context: DirectoryContext): boolean;
  filter?(result: DirectoryResult, context: DirectoryContext): boolean;
  compare?(left: DirectoryResult, right: DirectoryResult, context: DirectoryContext): number;
}

export interface DirectoryContribution {
  views?: readonly DirectoryViewDescriptor<string>[];
  queries?: readonly DirectoryQueryDescriptor<string>[];
}

export interface DirectoryComposition {
  views: readonly DirectoryViewDescriptor<string>[];
  queries: readonly DirectoryQueryDescriptor<string>[];
}

function validateDescriptors(
  name: string,
  descriptors: readonly DirectoryDescriptorBase<string>[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id))
      throw new Error(`[${name}] duplicate id: ${descriptor.id}`);
    if (!Number.isFinite(descriptor.order))
      throw new Error(`[${name}] order must be finite: ${descriptor.id}`);
    if (typeof descriptor.mount !== 'function')
      throw new Error(`[${name}] mount must be a function: ${descriptor.id}`);
    ids.add(descriptor.id);
  }
}

export const validateDirectoryToolDescriptors = (
  descriptors: readonly DirectoryToolDescriptor[]
) => {
  validateDescriptors('directoryToolRegistry', descriptors);
};
export const validateDirectoryActionDescriptors = (
  descriptors: readonly DirectoryActionDescriptor[]
) => {
  validateDescriptors('directoryActionRegistry', descriptors);
};
export const validateDirectoryRailDescriptors = (
  descriptors: readonly DirectoryRailDescriptor[]
) => {
  validateDescriptors('directoryRailRegistry', descriptors);
};
export const validateDirectoryViewDescriptors = (
  descriptors: readonly DirectoryViewDescriptor<string>[]
) => {
  validateDescriptors('directoryViewRegistry', descriptors);
  const fallbacks = descriptors.filter((descriptor) => descriptor.fallback);
  if (fallbacks.length !== 1) {
    throw new Error('[directoryViewRegistry] exactly one fallback view is required');
  }
  for (const descriptor of descriptors) {
    if (typeof descriptor.isActive !== 'function') {
      throw new Error(`[directoryViewRegistry] isActive must be a function: ${descriptor.id}`);
    }
    if (descriptor.replaces?.includes(descriptor.id)) {
      throw new Error(`[directoryViewRegistry] view cannot replace itself: ${descriptor.id}`);
    }
  }
};

export function validateDirectoryQueryDescriptors(
  descriptors: readonly DirectoryQueryDescriptor<string>[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) throw new Error(`[directoryQueryRegistry] duplicate id: ${descriptor.id}`);
    if (!Number.isFinite(descriptor.order)) throw new Error(`[directoryQueryRegistry] order must be finite: ${descriptor.id}`);
    if (typeof descriptor.isActive !== 'function') throw new Error(`[directoryQueryRegistry] isActive must be a function: ${descriptor.id}`);
    if (typeof descriptor.filter !== 'function' && typeof descriptor.compare !== 'function') {
      throw new Error(`[directoryQueryRegistry] filter or compare is required: ${descriptor.id}`);
    }
    ids.add(descriptor.id);
  }
}

import {
  legacyDirectoryActions,
  legacyDirectoryRails,
  legacyDirectoryTools,
  legacyDirectoryViews,
} from './directoryRegistryCompatibility';
import { bulkSelectDirectoryTool } from './extensions/bulk-select';

/** Append feature-owned directory tools here without changing the directory shell. */
export const directoryToolRegistry: readonly DirectoryToolDescriptor[] = [
  ...legacyDirectoryTools,
  bulkSelectDirectoryTool,
];
export const directoryActionRegistry: readonly DirectoryActionDescriptor[] =
  legacyDirectoryActions;
export const directoryRailRegistry: readonly DirectoryRailDescriptor[] =
  legacyDirectoryRails;
export const directoryViewRegistry: readonly DirectoryViewDescriptor<string>[] =
  legacyDirectoryViews;
export const directoryQueryRegistry: readonly DirectoryQueryDescriptor<string>[] = [];

function sorted<T extends DirectoryDescriptorBase<string>>(
  descriptors: readonly T[],
  validate: (items: readonly T[]) => void
): readonly T[] {
  validate(descriptors);
  return descriptors.slice().sort((a, b) => a.order - b.order);
}

export const getDirectoryTools = () =>
  sorted(directoryToolRegistry, validateDirectoryToolDescriptors);
export const getDirectoryActions = () =>
  sorted(directoryActionRegistry, validateDirectoryActionDescriptors);
export const getDirectoryRails = () =>
  sorted(directoryRailRegistry, validateDirectoryRailDescriptors);
export const getDirectoryViews = () =>
  sorted(directoryViewRegistry, validateDirectoryViewDescriptors);

/** Builds a complete directory configuration without mutating the shared registries. */
export function createDirectoryComposition(
  ...contributions: readonly DirectoryContribution[]
): DirectoryComposition {
  const views = [
    ...directoryViewRegistry,
    ...contributions.flatMap((contribution) => contribution.views ?? []),
  ];
  const queries = [
    ...directoryQueryRegistry,
    ...contributions.flatMap((contribution) => contribution.queries ?? []),
  ];
  validateDirectoryViewDescriptors(views);
  validateDirectoryQueryDescriptors(queries);
  return {
    views: views.slice().sort((left, right) => left.order - right.order),
    queries: queries.slice().sort((left, right) => left.order - right.order),
  };
}

export const defaultDirectoryComposition = createDirectoryComposition();

function createDirectoryQueryContext(context: DirectoryContext): DirectoryContext {
  return {
    ...context,
    records: {
      people: structuredClone(context.records.people),
      households: structuredClone(context.records.households),
    },
  };
}

/** Resolves exactly one view, so a selected feature view replaces rather than duplicates cards. */
export function resolveDirectoryView(
  context: DirectoryContext,
  descriptors: readonly DirectoryViewDescriptor<string>[] = context.composition.views
): DirectoryViewDescriptor<string> {
  validateDirectoryViewDescriptors(descriptors);
  const active = descriptors.filter((descriptor) => descriptor.isActive(context));
  const selected = active.filter((candidate) =>
    !active.some((descriptor) => descriptor !== candidate && descriptor.replaces?.includes(candidate.id))
  );
  if (selected.length > 1) {
    throw new Error(`[directoryViewRegistry] multiple active views: ${selected.map(({ id }) => id).join(', ')}`);
  }
  return selected[0] ?? descriptors.find((descriptor) => descriptor.fallback) as DirectoryViewDescriptor<string>;
}

/** Applies feature filters and ordering to copied projections, never to stored records. */
export function projectDirectoryResults<T extends CrmPerson | HouseholdDirectoryEntry>(
  kind: DirectoryResult['kind'],
  records: readonly T[],
  context: DirectoryContext,
  descriptors: readonly DirectoryQueryDescriptor<string>[] = context.composition.queries
): readonly T[] {
  validateDirectoryQueryDescriptors(descriptors);
  if (descriptors.length === 0) return records;
  // The public type makes every record field read-only. Copies also isolate the
  // caller at runtime if feature code bypasses that type contract.
  const callbackContext = createDirectoryQueryContext(context);
  const active = descriptors.filter((descriptor) => descriptor.isActive(callbackContext));
  if (active.length === 0) return records;

  const projected = records
    .map((record, index) => ({
      result: { kind, record: structuredClone(record) } as DirectoryResult,
      record,
      index,
    }))
    .filter(({ result }) => active.every((descriptor) => descriptor.filter?.(result, callbackContext) ?? true));
  const hasComparator = active.some((descriptor) => typeof descriptor.compare === 'function');
  if (!hasComparator) return projected.map(({ record }) => record);
  return projected
    .slice()
    .sort((left, right) => {
      for (const descriptor of active) {
        if (typeof descriptor.compare !== 'function') continue;
        const result = descriptor.compare(left.result, right.result, callbackContext);
        if (!Number.isFinite(result)) throw new Error('[directoryQueryRegistry] compare must return a finite number');
        if (result !== 0) return result;
      }
      return left.index - right.index;
    })
    .map(({ record }) => record);
}
