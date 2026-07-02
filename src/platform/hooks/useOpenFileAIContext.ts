// useOpenFileAIContext
//
// Keeps the `fileContextStore` in sync with the currently open tabs. Every
// time a tab opens or its content changes, we re-run `extractForAI` and write
// the result back into the store. When a tab closes, we drop its entry.
//
// Debounce is intentionally scoped per-tab rather than per-store: a user can
// type in `notes.md` while also editing `plan.md` and each file gets its own
// debounce timer. Using a single shared timer would collapse all edits into
// one extraction batch, which wastes CPU when only one file actually changed.
//
// Why we do extraction here instead of inside the store:
//  - Store actions are synchronous in Zustand; `extractForAI` is async.
//  - Keeping the extraction pipeline out of the store lets it stay a pure
//    state container and makes the hook easy to mock in tests.

import { useEffect, useRef } from 'react';

import { useEditorStore } from '@/platform/state/editorStore';
import { useFileContextStore } from '@/platform/state/fileContextStore';
import { extractForAI } from '@/platform/utils/ai-file-context';

const DEBOUNCE_MS = 300;

function getExtension(name: string): string | undefined {
  const dot = name.lastIndexOf('.');
  if (dot < 0 || dot === name.length - 1) return undefined;
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Run `fn` once the browser is idle (or after a short fallback delay on
 * runtimes without `requestIdleCallback`, e.g. older WebKit). Extraction is
 * background bookkeeping, not user-visible work — it should never compete
 * with typing or rendering for the main thread.
 */
function scheduleIdle(fn: () => void): void {
  if (typeof window !== 'undefined' && typeof window.requestIdleCallback === 'function') {
    window.requestIdleCallback(() => { fn(); }, { timeout: 2000 });
  } else {
    setTimeout(fn, 0);
  }
}

export function useOpenFileAIContext(): void {
  const openTabs = useEditorStore((s) => s.openTabs);
  const setContext = useFileContextStore((s) => s.setContext);
  const removeContext = useFileContextStore((s) => s.removeContext);

  // Per-path bookkeeping so we don't re-extract on every render and we can
  // cancel pending debounced work when a tab closes or its content changes.
  const timersRef = useRef<Map<string, ReturnType<typeof setTimeout>>>(new Map());
  // Remember the last content we extracted so we only re-extract on changes.
  // Key: path, value: content string hash-surrogate (just the raw string —
  // collisions are impossible since we compare by identity).
  const lastContentRef = useRef<Map<string, string>>(new Map());

  useEffect(() => {
    const currentPaths = new Set<string>();
    const timers = timersRef.current;
    const lastContent = lastContentRef.current;

    for (const tab of openTabs) {
      currentPaths.add(tab.path);

      const prev = lastContent.get(tab.path);
      if (prev === tab.content) {
        // No content change — nothing to do.
        continue;
      }
      lastContent.set(tab.path, tab.content);

      // Clear any pending extraction for this path; we replace it below.
      const existing = timers.get(tab.path);
      if (existing) {
        clearTimeout(existing);
      }

      // Capture `tab` by value so the closure sees the current snapshot.
      const snapshot = {
        path: tab.path,
        name: tab.name,
        extension: getExtension(tab.name),
        content: tab.content,
      };

      const timer = setTimeout(() => {
        timers.delete(snapshot.path);
        scheduleIdle(() => {
          // Idle scheduling adds an unbounded wait (up to the 2s
          // requestIdleCallback timeout) on top of the debounce, so the tab
          // this snapshot came from may have closed or changed again by the
          // time this actually runs. `lastContent` is updated synchronously
          // on every new edit/close, so comparing against it here — and
          // again after the async extraction resolves — is a cheap way to
          // detect "superseded" without a separate cancellation handle.
          if (lastContent.get(snapshot.path) !== snapshot.content) return;
          void extractForAI(snapshot).then(
            (ctx) => {
              if (lastContent.get(snapshot.path) !== snapshot.content) return;
              if (!ctx) {
                // Either unsupported type or extraction produced empty text.
                // Drop any stale context so the UI doesn't show a chip for a
                // file that no longer contributes content.
                removeContext(snapshot.path);
                return;
              }
              setContext(snapshot.path, ctx);
            },
            (error) => {
              console.warn(
                `[useOpenFileAIContext] extraction failed for "${snapshot.name}":`,
                error
              );
            }
          );
        });
      }, DEBOUNCE_MS);

      timers.set(tab.path, timer);
    }

    // Drop extractions + pending timers for closed tabs.
    for (const path of Array.from(lastContent.keys())) {
      if (!currentPaths.has(path)) {
        const timer = timers.get(path);
        if (timer) {
          clearTimeout(timer);
          timers.delete(path);
        }
        lastContent.delete(path);
        removeContext(path);
      }
    }
  }, [openTabs, setContext, removeContext]);

  // Tear down all outstanding timers when the host component unmounts so we
  // don't leak them in tests that repeatedly mount/unmount the tree.
  useEffect(() => {
    const timers = timersRef.current;
    return () => {
      for (const timer of timers.values()) {
        clearTimeout(timer);
      }
      timers.clear();
    };
  }, []);
}
