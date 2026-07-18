import { isEnabled as isFlagEnabled } from '@/platform/flags/router';
import type {
  PersistedSelectionHint,
  RehydratedSelectionInput,
} from './selectionTypes';

interface SelectionWriterBridgeHandlers {
  readonly rehydrate: (input: RehydratedSelectionInput) => void;
  readonly readPersistenceHint: () => PersistedSelectionHint;
}

let handlers: SelectionWriterBridgeHandlers | null = null;
let queuedRehydration: RehydratedSelectionInput | null = null;

export function selectionWriterRetirementEnabled(): boolean {
  return isFlagEnabled('selection-authority-boot-gate');
}

export function registerSelectionWriterBridge(
  next: SelectionWriterBridgeHandlers
): () => void {
  handlers = next;
  if (queuedRehydration) {
    const queued = queuedRehydration;
    queuedRehydration = null;
    next.rehydrate(queued);
  }
  return () => {
    if (handlers === next) handlers = null;
  };
}

export function rehydrateSelectionFromData(
  input: RehydratedSelectionInput
): void {
  if (!selectionWriterRetirementEnabled()) return;
  if (handlers) {
    handlers.rehydrate(input);
    return;
  }
  queuedRehydration = input;
}

export function readSelectionPersistenceHint(): PersistedSelectionHint | undefined {
  if (!selectionWriterRetirementEnabled()) return undefined;
  return handlers?.readPersistenceHint();
}

