/**
 * B1's date contract is declared on the IPC `RagHit` itself so the Rust/TS
 * checker verifies every producer field. This module still augments saved
 * sources, which are intentionally a separate transport shape.
 */
import type { DateConflictFlag, DatedFact, SourceDate } from '@/platform/retrieval/dates';

/** Persist the same optional date contract with Ask's saved source records. */
declare module '@/platform/types/ai' {
  interface WorkspaceSource {
    sourceDate?: SourceDate;
    datedFact?: DatedFact;
    dateConflict?: DateConflictFlag;
  }
}

export {};
