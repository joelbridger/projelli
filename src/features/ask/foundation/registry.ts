import type {
  AskAnswerActionDescriptor,
  AskModeDescriptor,
  AskSourceAdapter,
} from './contracts';

function validateOrdered(
  name: string,
  descriptors: readonly { readonly id: string; readonly order: number }[]
): void {
  const ids = new Set<string>();
  let previous = -Infinity;
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim()) throw new Error(`[${name}] id is required`);
    if (ids.has(descriptor.id))
      throw new Error(`[${name}] duplicate id: ${descriptor.id}`);
    if (!Number.isFinite(descriptor.order))
      throw new Error(`[${name}] order must be finite: ${descriptor.id}`);
    if (descriptor.order < previous)
      throw new Error(
        `[${name}] descriptor order must be stable: ${descriptor.id}`
      );
    ids.add(descriptor.id);
    previous = descriptor.order;
  }
}

export function validateAskSourceRegistry(
  descriptors: readonly AskSourceAdapter[]
): void {
  validateOrdered('askSourceRegistry', descriptors);
  for (const descriptor of descriptors) {
    if (
      !descriptor.sourceKinds.length ||
      typeof descriptor.listCandidates !== 'function'
    ) {
      throw new Error(`[askSourceRegistry] invalid adapter: ${descriptor.id}`);
    }
  }
}

export function validateAskModeRegistry(
  descriptors: readonly AskModeDescriptor[]
): void {
  validateOrdered('askModeRegistry', descriptors);
  for (const descriptor of descriptors) {
    if (
      typeof descriptor.buildScope !== 'object' ||
      !['normal', 'meeting-report'].includes(descriptor.responseFormat)
    ) {
      throw new Error(`[askModeRegistry] invalid mode: ${descriptor.id}`);
    }
  }
}

export function validateAskAnswerActionRegistry(
  descriptors: readonly AskAnswerActionDescriptor[]
): void {
  validateOrdered('askAnswerActionRegistry', descriptors);
  for (const descriptor of descriptors) {
    if (
      typeof descriptor.isAvailable !== 'function' ||
      typeof descriptor.execute !== 'function'
    ) {
      throw new Error(
        `[askAnswerActionRegistry] invalid action: ${descriptor.id}`
      );
    }
  }
}

const sourceAdapters: AskSourceAdapter[] = [];
const modes: AskModeDescriptor[] = [];
const actions: AskAnswerActionDescriptor[] = [];

/** Empty contributors are intentional: unavailable producers cannot be substituted. */
export const askSourceRegistry: readonly AskSourceAdapter[] = sourceAdapters;
export const askModeRegistry: readonly AskModeDescriptor[] = modes;
export const askAnswerActionRegistry: readonly AskAnswerActionDescriptor[] =
  actions;
/** Compatibility name, explicitly mapped to the single canonical action registry. */
export const askActionRegistry = askAnswerActionRegistry;

function append<T extends { readonly order: number }>(
  target: T[],
  descriptor: T,
  validate: (entries: readonly T[]) => void
): void {
  const next = [...target, descriptor].sort(
    (left, right) => left.order - right.order
  );
  validate(next);
  target.splice(0, target.length, ...next);
}

export function registerAskSource(adapter: AskSourceAdapter): void {
  append(sourceAdapters, adapter, validateAskSourceRegistry);
}

export function registerAskMode(mode: AskModeDescriptor): void {
  append(modes, mode, validateAskModeRegistry);
}

export function registerAskAnswerAction(
  action: AskAnswerActionDescriptor
): void {
  append(actions, action, validateAskAnswerActionRegistry);
}
