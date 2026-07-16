import type { ReactNode } from 'react';
import type { TeamActivityItem } from './contracts';

export type ActivityToolStateValue =
  | null
  | boolean
  | number
  | string
  | readonly ActivityToolStateValue[]
  | { readonly [key: string]: ActivityToolStateValue };

/** Temporary state owned by one mounted tool. It is never persisted or shared. */
export interface ActivityToolState<Value extends ActivityToolStateValue = ActivityToolStateValue> {
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

export interface ActivityToolContext<Value extends ActivityToolStateValue = ActivityToolStateValue> {
  /** The complete feed supplied by the team-feed public contract. */
  sourceItems: readonly DeepReadonly<TeamActivityItem>[];
  /** The feed after every enabled registered filter has composed. */
  visibleItems: readonly DeepReadonly<TeamActivityItem>[];
  state: ActivityToolState<Value>;
}

export interface ActivityToolDescriptor<Value extends ActivityToolStateValue = ActivityToolStateValue> {
  /** Also scopes this tool's local state, so IDs must be unique. */
  id: string;
  order: number;
  /** Checked before a tool receives feed data or creates any mount wrapper. */
  isEnabled?(): boolean;
  mount(context: ActivityToolContext<Value>): ReactNode;
  /** Enabled filters compose with AND and retain surviving source order. */
  filter?(item: DeepReadonly<TeamActivityItem>, context: ActivityToolContext<Value>): boolean;
  /** Accessible feature-owned result shown when filtering hides every source item. */
  renderEmptyResult?(context: ActivityToolContext<Value>): ReactNode;
}

export interface ActivityToolComposition {
  tools: readonly ActivityToolDescriptor[];
}

/** Append feature-owned feed tools here without changing the team-feed surface. */
export const activityToolRegistry: readonly ActivityToolDescriptor[] = [];

export function validateActivityToolDescriptors(
  descriptors: readonly ActivityToolDescriptor[],
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (ids.has(descriptor.id)) {
      throw new Error(`[activityToolRegistry] duplicate id: ${descriptor.id}`);
    }
    if (!/^[a-z0-9]+(?:[.-][a-z0-9]+)*$/.test(descriptor.id)) {
      throw new Error(`[activityToolRegistry] id must use lowercase letters, numbers, dots, or hyphens: ${descriptor.id}`);
    }
    if (!Number.isFinite(descriptor.order)) {
      throw new Error(`[activityToolRegistry] order must be finite: ${descriptor.id}`);
    }
    if (typeof descriptor.mount !== 'function') {
      throw new Error(`[activityToolRegistry] mount must be a function: ${descriptor.id}`);
    }
    if (descriptor.filter !== undefined && typeof descriptor.filter !== 'function') {
      throw new Error(`[activityToolRegistry] filter must be a function: ${descriptor.id}`);
    }
    if (descriptor.renderEmptyResult !== undefined && typeof descriptor.renderEmptyResult !== 'function') {
      throw new Error(`[activityToolRegistry] renderEmptyResult must be a function: ${descriptor.id}`);
    }
    ids.add(descriptor.id);
  }
}

/** Builds a validated, ordered configuration without mutating the shared registry. */
export function createActivityToolComposition(
  ...contributions: readonly ActivityToolDescriptor[]
): ActivityToolComposition {
  const tools = [...activityToolRegistry, ...contributions];
  validateActivityToolDescriptors(tools);
  return { tools: tools.slice().sort((left, right) => left.order - right.order) };
}

export const defaultActivityToolComposition = createActivityToolComposition();

type ActivityToolStateFactory = <Value extends ActivityToolStateValue>(
  id: string,
) => ActivityToolState<Value>;

function copiedItems(items: readonly TeamActivityItem[]): readonly DeepReadonly<TeamActivityItem>[] {
  return structuredClone(items);
}

function contextFor<Value extends ActivityToolStateValue>(
  descriptor: ActivityToolDescriptor<Value>,
  sourceItems: readonly TeamActivityItem[],
  visibleItems: readonly TeamActivityItem[],
  stateFor: ActivityToolStateFactory,
): ActivityToolContext<Value> {
  return {
    sourceItems: copiedItems(sourceItems),
    visibleItems: copiedItems(visibleItems),
    state: stateFor<Value>(descriptor.id),
  };
}

export function enabledActivityTools(
  composition: ActivityToolComposition,
): readonly ActivityToolDescriptor[] {
  validateActivityToolDescriptors(composition.tools);
  return composition.tools.filter((descriptor) => descriptor.isEnabled?.() ?? true);
}

/** Applies enabled filters to copies and returns untouched source items in stable order. */
export function projectActivityItems(
  items: readonly TeamActivityItem[],
  tools: readonly ActivityToolDescriptor[],
  stateFor: ActivityToolStateFactory,
): readonly TeamActivityItem[] {
  const filters = tools.filter((descriptor) => typeof descriptor.filter === 'function');
  if (filters.length === 0) return items;
  const callbacks = filters.map((descriptor) => ({
    descriptor,
    context: contextFor(descriptor, items, items, stateFor),
  }));
  return items.filter((item) => callbacks.every(({ descriptor, context }) =>
    descriptor.filter?.(structuredClone(item), context) ?? true));
}

export function activityToolMountContext<Value extends ActivityToolStateValue>(
  descriptor: ActivityToolDescriptor<Value>,
  sourceItems: readonly TeamActivityItem[],
  visibleItems: readonly TeamActivityItem[],
  stateFor: ActivityToolStateFactory,
): ActivityToolContext<Value> {
  return contextFor(descriptor, sourceItems, visibleItems, stateFor);
}
