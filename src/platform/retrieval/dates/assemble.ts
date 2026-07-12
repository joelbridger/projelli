import type { WorkspaceSource } from '@/platform/types/ai';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { flagDatedEvidenceConflicts } from './conflicts';

/**
 * Prepares the exact retrieval hits that an answer binds to. This is the
 * important boundary for Ask: citations are created from hits, not from the
 * separate saved-source list. Decorating here means a live citation and its
 * saved source always carry the same normalized date and conflict context.
 */
export function prepareDatedRagHits(hits: RagHit[]): RagHit[] {
  return flagDatedEvidenceConflicts(hits);
}

/**
 * The single hit-assembly adapter for date metadata. It is deliberately a
 * pass-through for existing retrieval fields, so rows written before B1 remain
 * readable while new mail, document, and CRM adapters can add `sourceDate`.
 */
export function buildDatedWorkspaceSources(hits: RagHit[]): WorkspaceSource[] {
  return prepareDatedRagHits(hits).map((hit) => ({
    path: hit.path,
    chunkText: hit.chunkText,
    score: hit.score,
    paragraphIndex: hit.paragraphIndex,
    ...(hit.sourceType !== undefined ? { sourceType: hit.sourceType } : {}),
    ...(hit.pageNumber !== undefined ? { pageNumber: hit.pageNumber } : {}),
    ...(hit.extraction !== undefined ? { extraction: hit.extraction } : {}),
    ...(hit.extractionConfidence !== undefined ? { extractionConfidence: hit.extractionConfidence } : {}),
    ...(hit.locator !== undefined ? { locator: hit.locator } : {}),
    ...(hit.id !== undefined ? { id: hit.id } : {}),
    ...(hit.matterId !== undefined ? { matterId: hit.matterId } : {}),
    ...(hit.sourceId !== undefined ? { sourceId: hit.sourceId } : {}),
    ...(hit.sourceDate !== undefined ? { sourceDate: hit.sourceDate } : {}),
    ...(hit.datedFact !== undefined ? { datedFact: hit.datedFact } : {}),
    ...(hit.dateConflict !== undefined ? { dateConflict: hit.dateConflict } : {}),
  }));
}
