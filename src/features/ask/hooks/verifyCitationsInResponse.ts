// verifyCitationsInResponse — the citation normalize-then-verify step that
// runs once the model's full answer is in. Extracted VERBATIM from the
// streaming and non-streaming send paths, which had byte-identical copies.
//
// ⚠️ This drives the trust labels. The order is load-bearing: F-503 repairs
// number-keyed local-model citations BEFORE verification so the verify loop and
// chips see resolvable cites, and verifyCitations fires `onVerdict`
// (the per-citation `citation_verified` audit) the moment a misquote /
// cross-matter / fabricated cite is caught — which is BEFORE the caller saves.
// Do not reorder or drop the onVerdict callback.

import type { WorkspaceSource } from '@/platform/types/ai';
import type { CitationVerdict } from '@/platform/types/audit';
import type { useActiveMatter } from '@/platform/matter/matterStore';
import { normalizeNumericCitations, verifyCitations } from '@/platform/rag/workspaceCommand';

export async function verifyCitationsInResponse(
  content: string,
  retrievedSources: WorkspaceSource[],
  activeMatter: ReturnType<typeof useActiveMatter>,
  emitCitationVerified: (citationId: string, verdict: CitationVerdict) => void,
): Promise<{ normalized: string; verified: WorkspaceSource[] }> {
  // F-503 — repair number-keyed local-model citations BEFORE verification so
  // the verify loop and chips see resolvable cites.
  const normalized = normalizeNumericCitations(content, retrievedSources);
  const verified =
    retrievedSources.length > 0
      ? await verifyCitations(normalized, retrievedSources, {
          onVerdict: emitCitationVerified,
          expectedMatterId: activeMatter ? activeMatter.id : null,
        })
      : retrievedSources;
  return { normalized, verified };
}
