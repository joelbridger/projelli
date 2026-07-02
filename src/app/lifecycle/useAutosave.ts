/**
 * useAutosave — writes dirty editor tabs to disk every 2 seconds.
 *
 * Extracted from App.tsx (Phase 3 decomposition). Routes through the shared
 * `writeTabContent` writer so binary formats (.docx/.xlsx/.pptx) decode their
 * data-URL content back to bytes before hitting disk.
 *
 * Perf (P1.2): the interval is created ONCE and lives for the component's
 * lifetime — it does NOT depend on `openTabs`. `openTabs` gets a new array
 * reference on every keystroke (any content edit replaces the whole array),
 * so the old effect — keyed on `openTabs` — tore down and recreated the
 * interval on every keystroke too, which reset the 2-second countdown before
 * it ever fired. A continuously-typing user's autosave never ran. The tick
 * now reads the LATEST tabs through a ref that's updated every render
 * (before the interval ever sees it), so the timer itself stays stable while
 * still always saving whatever is current.
 */
import { useEffect, useRef } from 'react';
import { writeCoordinator } from '@/platform/fs/writeCoordinator';

interface AutosaveTab {
  path: string;
  content: string;
  isDirty: boolean;
  /** Content revision at this snapshot (BUG-045). */
  rev?: number;
}

export function useAutosave(
  openTabs: AutosaveTab[],
  writeTabContent: (path: string, content: string) => Promise<void>,
  markSaved: (path: string, savedRev?: number) => void,
  serviceRef: { readonly current: unknown },
): void {
  const openTabsRef = useRef(openTabs);
  useEffect(() => {
    openTabsRef.current = openTabs;
  }, [openTabs]);

  useEffect(() => {
    const autosaveInterval = setInterval(() => {
      // Explicitly void the inner async IIFE: each tick's Promise is
      // fire-and-forget by design (all errors are caught inside), but we
      // surface any unexpected outer-rejection to the console rather than
      // swallowing it silently.
      void (async () => {
        if (!serviceRef.current) return;
        for (const tab of openTabsRef.current) {
          if (tab.isDirty) {
            // BUG-045: capture content + rev together, route through the per-path
            // write coordinator (so a slow write can't overwrite a newer save),
            // then mark clean ONLY if the tab is still at this rev.
            const rev = tab.rev ?? 0;
            const content = tab.content;
            try {
              await writeCoordinator.enqueue(tab.path, rev, () =>
                writeTabContent(tab.path, content),
              );
              markSaved(tab.path, rev);
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
  }, [markSaved, writeTabContent, serviceRef]);
}
