import type {
  AskAnswerActionDescriptor,
  AskModeDescriptor,
  AskSourceDescriptor,
} from './types';
import {
  legacyAskAnswerActions,
  legacyAskModes,
  legacyAskSources,
} from './compatibility';

function validateDescriptors(
  registry: string,
  descriptors: readonly { id: string; order: number }[]
): void {
  const ids = new Set<string>();
  for (const descriptor of descriptors) {
    if (!descriptor.id.trim()) throw new Error(`[${registry}] id is required`);
    if (ids.has(descriptor.id))
      throw new Error(`[${registry}] duplicate id: ${descriptor.id}`);
    if (!Number.isFinite(descriptor.order))
      throw new Error(`[${registry}] order must be finite: ${descriptor.id}`);
    ids.add(descriptor.id);
  }
}

export function validateAskModeDescriptors(
  descriptors: readonly AskModeDescriptor[]
): void {
  validateDescriptors('askModeRegistry', descriptors);
  for (const descriptor of descriptors) {
    if (
      typeof descriptor.buildRetrievalPlan !== 'function' ||
      typeof descriptor.promptFormat !== 'function'
    ) {
      throw new Error(
        `[askModeRegistry] invalid mode metadata: ${descriptor.id}`
      );
    }
  }
}

export function validateAskSourceDescriptors(
  descriptors: readonly AskSourceDescriptor[]
): void {
  validateDescriptors('askSourceRegistry', descriptors);
  for (const descriptor of descriptors) {
    if (
      typeof descriptor.matches !== 'function' ||
      typeof descriptor.canOpen !== 'function' ||
      typeof descriptor.open !== 'function'
    ) {
      throw new Error(
        `[askSourceRegistry] invalid source metadata: ${descriptor.id}`
      );
    }
  }
}

export function validateAskAnswerActionDescriptors(
  descriptors: readonly AskAnswerActionDescriptor[]
): void {
  validateDescriptors('askAnswerActionRegistry', descriptors);
  for (const descriptor of descriptors) {
    if (
      ![
        'navigation',
        'create-task',
        'create-note',
        'create-draft',
        'answer-completed',
      ].includes(descriptor.kind) ||
      typeof descriptor.execute !== 'function'
    ) {
      throw new Error(
        `[askAnswerActionRegistry] invalid action metadata: ${descriptor.id}`
      );
    }
  }
}

/** Compatibility entries preserve the existing Ask pipeline and source routes. */
const askModes: AskModeDescriptor[] = [...legacyAskModes];
const askSources: AskSourceDescriptor[] = [...legacyAskSources];
const askAnswerActions: AskAnswerActionDescriptor[] = [
  ...legacyAskAnswerActions,
];

export const askModeRegistry: readonly AskModeDescriptor[] = askModes;
export const askSourceRegistry: readonly AskSourceDescriptor[] = askSources;
export const askAnswerActionRegistry: readonly AskAnswerActionDescriptor[] =
  askAnswerActions;

export function registerAskMode(descriptor: AskModeDescriptor): void {
  validateAskModeDescriptors([...askModes, descriptor]);
  askModes.push(descriptor);
}

export function registerAskSource(descriptor: AskSourceDescriptor): void {
  validateAskSourceDescriptors([...askSources, descriptor]);
  askSources.push(descriptor);
}

export function registerAskAnswerAction(
  descriptor: AskAnswerActionDescriptor
): void {
  validateAskAnswerActionDescriptors([...askAnswerActions, descriptor]);
  askAnswerActions.push(descriptor);
}

export function getAskMode(id: string): AskModeDescriptor {
  validateAskModeDescriptors(askModeRegistry);
  const descriptor = askModeRegistry.find((entry) => entry.id === id);
  if (!descriptor) throw new Error(`[askModeRegistry] unknown mode: ${id}`);
  return descriptor;
}

export function getAskSource(
  source: Parameters<AskSourceDescriptor['matches']>[0]
): AskSourceDescriptor | undefined {
  validateAskSourceDescriptors(askSourceRegistry);
  return askSourceRegistry
    .slice()
    .sort((a, b) => a.order - b.order)
    .find((entry) => entry.matches(source));
}

/** Route a source through the registered client-safe opener. */
export function openAskSource(
  source: Parameters<AskSourceDescriptor['matches']>[0],
  context: Parameters<AskSourceDescriptor['open']>[1]
): boolean {
  const descriptor = getAskSource(source);
  if (!descriptor?.canOpen(source, context)) return false;
  descriptor.open(source, context);
  return true;
}

export function getAskAnswerActions(): readonly AskAnswerActionDescriptor[] {
  validateAskAnswerActionDescriptors(askAnswerActionRegistry);
  return askAnswerActionRegistry.slice().sort((a, b) => a.order - b.order);
}
