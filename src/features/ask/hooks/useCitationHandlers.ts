// useCitationHandlers — the citation-click + missing-source handlers shared by
// the inline citation chips and the Sources accordion. Extracted VERBATIM from
// AIChatViewer; the useCallback dependency arrays are copied byte-for-byte
// (setMissingSourceWarning is a stable setState setter, intentionally absent).

import { useCallback } from 'react';
import { EV_OPEN_EMAIL } from '@/config/identity';
import { openAskSource } from '../registry/askRegistries';

export interface UseCitationHandlersArgs {
  setMissingSourceWarning: React.Dispatch<React.SetStateAction<string | null>>;
  onOpenFileAtPath?: ((
    path: string,
    paragraphIndex?: number,
    snippet?: string,
  ) => void | Promise<void>) | undefined;
}

export function useCitationHandlers({
  setMissingSourceWarning,
  onOpenFileAtPath,
}: UseCitationHandlersArgs) {
  // M2 — citation click handler. Invoked from both inline citation
  // chips and the Sources accordion. Calls the caller-provided
  // `onOpenFileAtPath` (wired up in App.tsx / MainPanel). If the
  // callback is missing (e.g. in a unit-test mount), no-op.
  //
  // A3: for PDF hits, `pageNumber` is passed and used instead of
  // `paragraphIndex` so the PDF viewer opens at the right page.
  const handleCitationClick = useCallback(
    (
      path: string,
      paragraphIndex: number,
      sourceType?: string,
      pageNumber?: number,
      snippet?: string,
    ) => {
      setMissingSourceWarning(null);
      openAskSource(
        { path, paragraphIndex, sourceType, pageNumber, excerpt: snippet },
        {
          openEmail: (source) => {
            if (typeof window === 'undefined' || !source.path) return;
            // WS-B/C — email sources resolve to `mail:<message-id>`, not a
            // file on disk. The registered mail route preserves that boundary.
            window.dispatchEvent(
              new CustomEvent(EV_OPEN_EMAIL, {
                detail: { sourceId: source.path },
              }),
            );
          },
          ...(onOpenFileAtPath
            ? {
                // CRM references previously followed this hook's default
                // caller-provided opener. Keep that host-owned route exactly.
                openCrm: (source) => {
                  if (!source.path) return;
                  void onOpenFileAtPath(
                    source.path,
                    source.paragraphIndex,
                    source.excerpt,
                  );
                },
                openDocument: (source) => {
                  if (!source.path) return;
                  if (source.sourceType === 'pdf' && source.pageNumber != null) {
                    // Open PDF viewer at the specific page using pageNumber as
                    // the navigation hint.
                    void onOpenFileAtPath(source.path, source.pageNumber);
                  } else {
                    // F-504: forward the cited chunk's text so the editor can
                    // locate the passage by exact search.
                    void onOpenFileAtPath(
                      source.path,
                      source.paragraphIndex,
                      source.excerpt,
                    );
                  }
                },
              }
            : {}),
        },
      );
    },
    // setMissingSourceWarning is a stable useState setter, so listing it does
    // not change the callback's identity — but as a hook argument the linter
    // can no longer prove that, so we include it to keep the inferred deps
    // matching (behaviour identical to the in-component [onOpenFileAtPath]).
    [onOpenFileAtPath, setMissingSourceWarning],
  );

  const handleMissingSource = useCallback((basename: string) => {
    setMissingSourceWarning(
      `Source file not found: ${basename}. Retrieval may be stale. Re-indexing...`,
    );
  }, [setMissingSourceWarning]);

  return { handleCitationClick, handleMissingSource };
}
