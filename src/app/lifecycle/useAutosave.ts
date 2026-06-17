/**
 * useAutosave — writes dirty editor tabs to disk every 2 seconds.
 *
 * Extracted from App.tsx (Phase 3 decomposition). Routes through the shared
 * `writeTabContent` writer so binary formats (.docx/.xlsx/.pptx) decode their
 * data-URL content back to bytes before hitting disk. The service ref is passed
 * (a stable object) so the interval re-registers only when the tab set or the
 * writer changes — matching the original effect's cadence.
 */
import { useEffect } from 'react';

interface AutosaveTab {
  path: string;
  content: string;
  isDirty: boolean;
}

export function useAutosave(
  openTabs: AutosaveTab[],
  writeTabContent: (path: string, content: string) => Promise<void>,
  markSaved: (path: string) => void,
  serviceRef: { readonly current: unknown },
): void {
  useEffect(() => {
    const autosaveInterval = setInterval(() => {
      // Explicitly void the inner async IIFE: each tick's Promise is
      // fire-and-forget by design (all errors are caught inside), but we
      // surface any unexpected outer-rejection to the console rather than
      // swallowing it silently.
      void (async () => {
        if (!serviceRef.current) return;
        for (const tab of openTabs) {
          if (tab.isDirty) {
            try {
              await writeTabContent(tab.path, tab.content);
              markSaved(tab.path);
            } catch (error) {
              console.error('Autosave failed for:', tab.path, error);
            }
          }
        }
      })().catch((err) => {
        console.error('Autosave interval unexpected error:', err);
      });
    }, 2000);

    return () => clearInterval(autosaveInterval);
  }, [openTabs, markSaved, writeTabContent, serviceRef]);
}
