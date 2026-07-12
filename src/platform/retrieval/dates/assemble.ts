import type { WorkspaceSource } from '@/platform/types/ai';
import type { RagHit } from '@/platform/utils/tauri-commands';
import { flagDatedEvidenceConflicts } from './conflicts';

/**
 * The single hit-assembly adapter for date metadata. It is deliberately a
 * pass-through for existing retrieval fields, so rows written before B1 remain
 * readable while new mail, document, and CRM adapters can add `sourceDate`.
 */
export function buildDatedWorkspaceSources(hits: RagHit[]): WorkspaceSource[] {
  return flagDatedEvidenceConflicts(hits).map((hit) => ({
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
