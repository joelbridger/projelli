import type { DateConflictFlag, DatedFact, SourceDate } from '@/platform/retrieval/dates';

/**
 * B1 keeps the retrieval bridge backward-compatible while date adapters roll
 * out independently. Module augmentation means all existing `RagHit` imports
 * gain these optional fields without a shared-bridge edit.
 */
declare module '@/platform/utils/tauri-commands' {
  interface RagHit {
    sourceDate?: SourceDate;
    datedFact?: DatedFact;
    dateConflict?: DateConflictFlag;
  }
}

/** Persist the same optional date contract with Ask's saved source records. */
declare module '@/platform/types/ai' {
  interface WorkspaceSource {
    sourceDate?: SourceDate;
    datedFact?: DatedFact;
    dateConflict?: DateConflictFlag;
  }
}

export {};
