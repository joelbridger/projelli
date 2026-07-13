import type { RagHit } from '@/platform/utils/tauri-commands';
import {
  searchCrmRecords,
  type CrmSearchHit,
} from '@/platform/crm/search';

const CRM_CITATION_PREFIX = 'crm:';
export const CRM_ASK_UNAVAILABLE_MESSAGE =
  'Saved CRM records are unavailable right now. Your file search still works. Try reopening this workspace. If it still happens, contact support before changing your CRM connections.';

/** A stable, clickable location for an encrypted CRM record. */
export function crmCitationPath(hit: Pick<CrmSearchHit, 'entityKind' | 'entityId'>): string {
  return CRM_CITATION_PREFIX + hit.entityKind + ':' + hit.entityId;
}

/** Turns an Ask citation back into the record identity it names. */
export function parseCrmCitationPath(path: string): { entityKind: string; entityId: string } | null {
  if (!path.startsWith(CRM_CITATION_PREFIX)) return null;
  const [entityKind, ...id] = path.slice(CRM_CITATION_PREFIX.length).split(':');
  if (!entityKind || id.length === 0 || id.some((part) => !part)) return null;
  return { entityKind, entityId: id.join(':') };
}

/**
 * Adapts CRM FTS rows to Ask's established RAG contract. This is deliberately
 * an adapter, not a second citation system: all downstream prompt building,
 * consent checks, citation binding, and source panels use the same RagHit path.
 */
export function crmSearchHitToRagHit(hit: CrmSearchHit, index = 0): RagHit {
  const path = crmCitationPath(hit);
  return {
    path,
    sourceId: path,
    id: path,
    sourceType: 'crm',
    matterId: hit.matterId,
    chunkText: hit.title + '\n' + hit.content,
    // SQLCipher FTS already ranked this list. Ask only needs a stable ordering
    // score for shared context trimming, not a second ranking algorithm.
    score: 1 - index / 1000,
    paragraphIndex: 0,
    locator: 'CRM ' + hit.entityKind,
  };
}

/**
 * Retrieves only the CRM rows visible to this seat. The Rust command reads the
 * device's decrypted SQLCipher projection; a walled seat has no key and thus
 * no row to return. The local filter is a second, fail-closed boundary in case
 * a backend regression ever returns a row from another active household.
 */
export async function retrieveCrmAskHits(
  workspaceRoot: string | null | undefined,
  query: string,
  matterId: string | null,
  onUnavailable?: (message: string) => void,
): Promise<RagHit[]> {
  if (!workspaceRoot || !query.trim()) return [];
  try {
    const results = await searchCrmRecords(
      workspaceRoot,
      query,
      matterId ?? undefined,
    );
    return results
      .filter((hit) => matterId === null || hit.matterId === matterId)
      .map(crmSearchHitToRagHit);
  } catch {
    // CRM is an optional evidence source. Its local encrypted cache may be
    // locked while the advisor's documents are perfectly healthy, so never
    // reject the whole Ask request over this connector-only failure.
    onUnavailable?.(CRM_ASK_UNAVAILABLE_MESSAGE);
    return [];
  }
}

export function isCrmCitationPath(path: string | null | undefined): boolean {
  return typeof path === 'string' && parseCrmCitationPath(path) !== null;
}
