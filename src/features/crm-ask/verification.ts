import { invoke, isTauri } from '@tauri-apps/api/core';
import type { CitationVerdict } from '@/platform/utils/tauri-commands';
import { parseCrmCitationPath } from './retrieval';

/** One CRM citation to verify against the live SQLCipher record. */
export interface CrmCitationToVerify {
  /** The citation path, e.g. `crm:note:note-1`. */
  path: string;
  /** The client the answer claims the record belongs to. */
  claimedMatterId: string;
  /** The span the answer attributes to the record. */
  quotedText: string;
}

/**
 * Verify CRM citations against the exact, decrypted live records on this
 * device. A CRM search hit proves a row was RETRIEVED once; it does NOT prove
 * the same record still exists for the same client. This is that second proof:
 * only a `verified` verdict is safe to present as a green "verified" badge.
 *
 * Throws in browser/dev (no Tauri backend) — callers treat that exactly like
 * the RAG verifier being unavailable: the citation stays neutral "source
 * found", never green.
 */
export async function crmVerifyCitations(
  items: CrmCitationToVerify[],
): Promise<CitationVerdict[]> {
  if (items.length === 0) return [];
  if (!isTauri()) {
    throw new Error('CRM verification is only available in the desktop app.');
  }
  const citations = items.map((item) => {
    const parsed = parseCrmCitationPath(item.path);
    return {
      entityId: parsed?.entityId ?? '',
      entityKind: parsed?.entityKind ?? '',
      claimedMatterId: item.claimedMatterId,
      quotedText: item.quotedText,
    };
  });
  return invoke<CitationVerdict[]>('crm_verify_citations', { citations });
}
