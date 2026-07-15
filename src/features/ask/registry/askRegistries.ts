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
export const askModeRegistry: readonly AskModeDescriptor[] = legacyAskModes;
export const askSourceRegistry: readonly AskSourceDescriptor[] =
  legacyAskSources;
export const askAnswerActionRegistry: readonly AskAnswerActionDescriptor[] =
  legacyAskAnswerActions;

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

export function getAskAnswerActions(): readonly AskAnswerActionDescriptor[] {
  validateAskAnswerActionDescriptors(askAnswerActionRegistry);
  return askAnswerActionRegistry.slice().sort((a, b) => a.order - b.order);
}
