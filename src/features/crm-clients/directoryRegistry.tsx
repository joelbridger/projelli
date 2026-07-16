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

/**
 * Short-lived, feature-owned state that affects one directory projection.
 * This is intentionally separate from preferences: it is local to the mounted
 * directory surface and is never persisted or shared with another surface.
 */
export type DirectoryFeatureStateValue =
  | null
  | boolean
  | number
  | string
  | readonly DirectoryFeatureStateValue[]
  | { readonly [key: string]: DirectoryFeatureStateValue };

/**
 * Directory features use a stable, feature-owned namespace (for example,
 * `crm-list-sort`) to read and set their transient projection state. Calling
 * `set` re-renders this directory surface, so query `isActive`, `filter`, and
 * `compare` callbacks receive the current value. Namespaces never collide,
 * and this channel is deliberately not a global store or event bus.
 */
export interface DirectoryFeatureState<Value extends DirectoryFeatureStateValue = DirectoryFeatureStateValue> {
  get(): Value | undefined;
  set(value: Value): void;
}

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

/** A feature callback receives only its own already-scoped state port. */
export type DirectoryFeatureContext<Value extends DirectoryFeatureStateValue = DirectoryFeatureStateValue> =
  DirectoryContext & { featureState: DirectoryFeatureState<Value> };

interface DirectoryDescriptorBase<Id extends string> {
  id: Id;
  order: number;
  mount: (context: DirectoryContext) => ReactNode;
}

export interface DirectoryToolDescriptor<Id extends string = DirectoryToolId> extends DirectoryDescriptorBase<Id> {
  /**
   * Lets a descriptor opt out before the directory shell creates its layout
   * wrapper. Use this for flag-gated tools that otherwise render `null`.
   */
  isEnabled?(): boolean;
}

export interface DirectoryFeatureToolDescriptor<Value extends DirectoryFeatureStateValue = DirectoryFeatureStateValue> {
  id: string;
  order: number;
  mount: (context: DirectoryFeatureContext<Value>) => ReactNode;
  isEnabled?(): boolean;
}
export interface DirectoryActionDescriptor extends DirectoryDescriptorBase<DirectoryActionId> {}
export interface DirectoryRailDescriptor extends DirectoryDescriptorBase<DirectoryRailId> {}
export interface DirectoryViewDescriptor<Id extends string = DirectoryViewId>
  extends DirectoryDescriptorBase<Id> {
  /** A view is mounted only when this resolver selects it. */
  isActive: (context: DirectoryContext) => boolean;
  /** Active feature views may explicitly replace active legacy or feature views. */
  replaces?: readonly string[];
  /** The one safe view used when no descriptor is active. */
  fallback?: boolean;
}

export interface DirectoryFeatureViewDescriptor<Value extends DirectoryFeatureStateValue = DirectoryFeatureStateValue> {
  id: string;
  order: number;
  mount: (context: DirectoryFeatureContext<Value>) => ReactNode;
  isActive: (context: DirectoryFeatureContext<Value>) => boolean;
  replaces?: readonly string[];
  fallback?: boolean;
}

/**
 * A feature-owned read-only contribution to the visible directory projection.
 * Filters compose with AND; comparators compose in descriptor order.
 */
export interface DirectoryQueryDescriptor<Id extends string = DirectoryQueryId> {
  id: Id;
  order: number;
  isActive: (context: DirectoryContext) => boolean;
  filter?: (result: DirectoryResult, context: DirectoryContext) => boolean;
  compare?: (left: DirectoryResult, right: DirectoryResult, context: DirectoryContext) => number;
}

export interface DirectoryFeatureQueryDescriptor<Value extends DirectoryFeatureStateValue = DirectoryFeatureStateValue> {
  id: string;
  order: number;
  isActive: (context: DirectoryFeatureContext<Value>) => boolean;
  filter?: (result: DirectoryResult, context: DirectoryFeatureContext<Value>) => boolean;
  compare?: (left: DirectoryResult, right: DirectoryResult, context: DirectoryFeatureContext<Value>) => number;
}

export interface DirectoryStatefulContribution<Value extends DirectoryFeatureStateValue = DirectoryFeatureStateValue> {
  /** Unique ownership key for this feature's local, non-persistent state slot. */
  namespace: string;
  tools?: readonly DirectoryFeatureToolDescriptor<Value>[];
  views?: readonly DirectoryFeatureViewDescriptor<Value>[];
  queries?: readonly DirectoryFeatureQueryDescriptor<Value>[];
}

/** A contribution that does not request feature state needs no namespace. */
export interface DirectoryStatelessContribution {
  namespace?: never;
  tools?: readonly DirectoryToolDescriptor<string>[];
  views?: readonly DirectoryViewDescriptor<string>[];
  queries?: readonly DirectoryQueryDescriptor<string>[];
}

export type DirectoryContribution<Value extends DirectoryFeatureStateValue = never> =
  | DirectoryStatelessContribution
  | DirectoryStatefulContribution<Value>;

export interface DirectoryComposition {
  tools: readonly DirectoryToolDescriptor<string>[];
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
  descriptors: readonly DirectoryToolDescriptor<string>[]
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

const featureStatePortFactory = Symbol('directory feature state port factory');
type DirectoryHostContext = DirectoryContext & {
  readonly [featureStatePortFactory]?: <Value extends DirectoryFeatureStateValue>(namespace: string) => DirectoryFeatureState<Value>;
};

export function withDirectoryFeatureStatePort<Value extends DirectoryFeatureStateValue>(
  context: DirectoryContext,
  namespace: string,
): DirectoryFeatureContext<Value> {
  const factory = (context as DirectoryHostContext)[featureStatePortFactory];
  if (!factory) throw new Error('[directoryComposition] feature state port is unavailable outside DirectorySurface');
  return { ...context, featureState: factory<Value>(namespace) };
}

export function createDirectoryContextWithFeatureStatePorts(
  context: DirectoryContext,
  factory: NonNullable<DirectoryHostContext[typeof featureStatePortFactory]>,
): DirectoryContext {
  return { ...context, [featureStatePortFactory]: factory } as DirectoryHostContext;
}

type BoundDirectoryContribution = {
  tools: readonly DirectoryToolDescriptor<string>[];
  views: readonly DirectoryViewDescriptor<string>[];
  queries: readonly DirectoryQueryDescriptor<string>[];
};

function bindContribution<Value extends DirectoryFeatureStateValue>(
  contribution: DirectoryContribution<Value>,
): BoundDirectoryContribution {
  if (contribution.namespace === undefined) {
    return {
      tools: contribution.tools ?? [],
      views: contribution.views ?? [],
      queries: contribution.queries ?? [],
    };
  }
  const namespace = contribution.namespace;
  const scoped = (context: DirectoryContext) =>
    withDirectoryFeatureStatePort<Value>(context, namespace);
  return {
    tools: (contribution.tools ?? []).map((descriptor): DirectoryToolDescriptor<string> => ({
      ...descriptor,
      mount: (context) => descriptor.mount(scoped(context)),
    })),
    views: (contribution.views ?? []).map((descriptor): DirectoryViewDescriptor<string> => ({
      ...descriptor,
      isActive: (context) => descriptor.isActive(scoped(context)),
      mount: (context) => descriptor.mount(scoped(context)),
    })),
    queries: (contribution.queries ?? []).map((descriptor): DirectoryQueryDescriptor<string> => {
      const filter = descriptor.filter;
      const compare = descriptor.compare;
      return {
        id: descriptor.id,
        order: descriptor.order,
        isActive: (context) => descriptor.isActive(scoped(context)),
        ...(filter ? { filter: (result, context) => filter(result, scoped(context)) } : {}),
        ...(compare ? { compare: (left, right, context) => compare(left, right, scoped(context)) } : {}),
      };
    }),
  };
}

/** Builds a complete directory configuration without mutating the shared registries. */
export function createDirectoryComposition(
  ...contributions: readonly DirectoryContribution[]
): DirectoryComposition {
  const validNamespace = /^[a-z0-9]+(?:[.-][a-z0-9]+)*$/;
  const namespaces = new Set<string>();
  for (const contribution of contributions) {
    if (contribution.namespace === undefined) continue;
    if (!validNamespace.test(contribution.namespace)) {
      throw new Error('[directoryComposition] feature namespace must use lowercase letters, numbers, dots, or hyphens');
    }
    if (namespaces.has(contribution.namespace)) {
      throw new Error(`[directoryComposition] duplicate feature namespace: ${contribution.namespace}`);
    }
    namespaces.add(contribution.namespace);
  }
  const bound = contributions.map((contribution) => bindContribution(contribution));
  const tools = [
    ...directoryToolRegistry,
    ...bound.flatMap((contribution) => contribution.tools),
  ];
  const views = [
    ...directoryViewRegistry,
    ...bound.flatMap((contribution) => contribution.views),
  ];
  const queries = [
    ...directoryQueryRegistry,
    ...bound.flatMap((contribution) => contribution.queries),
  ];
  validateDirectoryToolDescriptors(tools);
  validateDirectoryViewDescriptors(views);
  validateDirectoryQueryDescriptors(queries);
  return {
    tools: tools.slice().sort((left, right) => left.order - right.order),
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
