// useCitationHandlers — the citation-click + missing-source handlers shared by
// the inline citation chips and the Sources accordion. Extracted VERBATIM from
// AIChatViewer; the useCallback dependency arrays are copied byte-for-byte
// (setMissingSourceWarning is a stable setState setter, intentionally absent).

import { useCallback } from 'react';
import { EV_OPEN_EMAIL } from '@/config/identity';

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
      // WS-B/C — email sources resolve to `mail:<message-id>`, not a file on
      // disk. Open them via a decoupled custom event the mail viewer
      // subscribes to, rather than the editor's file-open pipeline.
      if (sourceType === 'mail' || path.startsWith('mail:')) {
        if (typeof window !== 'undefined') {
          window.dispatchEvent(
            new CustomEvent(EV_OPEN_EMAIL, {
              detail: { sourceId: path },
            }),
          );
        }
        return;
      }
      if (!onOpenFileAtPath) return;
      if (sourceType === 'pdf' && pageNumber != null) {
        // Open PDF viewer at the specific page using pageNumber as the
        // navigation hint. The PDF viewer interprets the second argument
        // as a page number when the file extension is .pdf.
        void onOpenFileAtPath(path, pageNumber);
      } else {
        // F-504: forward the cited chunk's text so the editor can locate
        // the passage by exact search instead of guessing from the index.
        void onOpenFileAtPath(path, paragraphIndex, snippet);
      }
    },
    [onOpenFileAtPath],
  );

  const handleMissingSource = useCallback((basename: string) => {
    setMissingSourceWarning(
      `Source file not found: ${basename}. Retrieval may be stale. Re-indexing...`,
    );
  }, []);

  return { handleCitationClick, handleMissingSource };
}
