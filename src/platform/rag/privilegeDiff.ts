/**
 * F-121 (VG-5b) — the pure half of the privilege-exclusion "see it work"
 * demonstration. Given the SAME question retrieved twice — once with the
 * default exclusion (privileged sources filtered in the search engine) and
 * once with the explicit include-privileged opt-in — the hits that appear
 * ONLY in the included result are exactly what the exclusion is withholding
 * right now. Results arrive score-sorted, so the first withheld hit is the
 * top source the user is being protected from leaking.
 */
import type { RagHit } from '@/platform/utils/tauri-commands';
import { citationBasename } from '@/platform/rag/workspaceCommand';

export interface PrivilegeDiffSummary {
  /** How many sources the exclusion withheld from this question. */
  withheldCount: number;
  /** Basename of the highest-scoring withheld source, or null when none. */
  topWithheldBasename: string | null;
}

export function summarizePrivilegeDiff(
  excluded: Pick<RagHit, 'id' | 'path'>[],
  included: Pick<RagHit, 'id' | 'path'>[],
): PrivilegeDiffSummary {
  const excludedIds = new Set(excluded.map((h) => h.id));
  const withheld = included.filter((h) => !excludedIds.has(h.id));
  return {
    withheldCount: withheld.length,
    topWithheldBasename: withheld[0] ? citationBasename(withheld[0].path) : null,
  };
}
