import { useCallback, useEffect, useRef } from 'react';
import type { Matter } from '@/platform/types/matter';

// Defensive: `save()` only ever writes `String(node.scrollTop)` (always a
// valid number), but a corrupted/hand-edited sessionStorage value would
// otherwise turn into `NaN` here — which would silently no-op a real
// `scrollTop` assignment, or feed `NaN` into the virtualizer's
// `initialOffset` (undefined behavior for its internal math). Module-level
// (not per-render) since it's a pure function of its arguments — that also
// keeps it out of the hooks below's dependency-array analysis, which is
// exactly right: it never changes.
function parseOffset(saved: string | null): number | null {
  if (!saved) return null;
  const n = Number(saved);
  return Number.isFinite(n) ? n : null;
}

function restoreScroll(node: HTMLDivElement, key: string): void {
  const offset = parseOffset(sessionStorage.getItem(key));
  if (offset !== null) {
    node.scrollTop = offset;
  }
}

function saveScroll(node: HTMLDivElement | null, key: string): void {
  if (node) {
    sessionStorage.setItem(key, String(node.scrollTop));
  }
}

/**
 * Persists list scroll position per-matter in sessionStorage.
 * Returns a CALLBACK ref to attach to the scrollable container.
 *
 * Perf (P2.2) fix (Codex review round 2): this used to return a plain
 * `useRef` object, restored/saved by a `useEffect` keyed only on the
 * matter-derived storage key. That worked as long as the scrollable
 * container was ALWAYS mounted (the old design: the whole page was the
 * scroll container). Once virtualization gave the results list its own
 * dedicated, CONDITIONALLY-rendered scroll container (hidden during
 * loading/error/empty states), the effect very often ran before that
 * container existed — `current` was `null`, so it neither restored on
 * mount nor ever captured a real element for its cleanup to save. A
 * callback ref fires exactly when the target DOM node actually
 * mounts/unmounts, so restore/save happen at the right moment regardless
 * of how many times the results list appears and disappears during
 * loading/error/retry cycles within the same matter.
 *
 * @param resultsKey Codex review (P2.2, round 8): identifies WHICH result
 * set is being shown (the caller's query/filter fingerprint) — changing it
 * means the content itself changed, not just a transient loading blip for
 * the SAME content. Without this, round 2's unmount/remount-tolerant
 * restore also restored an old DEEP scroll position into a brand-new
 * search or filter change, potentially hiding the very results the user
 * just asked for below the fold. A real matter switch (`activeMatter`
 * changing) is unaffected — it still restores that matter's own last
 * position, independent of `resultsKey`.
 *
 * Implementation note: an earlier version of this fix detected the
 * resultsKey change with a single ref comparison at the top of the hook
 * body, synchronously ahead of `scrollContainerRef`/`getInitialScrollOffset`
 * (both of which can run in the SAME commit a new results box mounts in —
 * a `useEffect` keyed on `resultsKey` fires one commit too late for that
 * case). That reads/writes a ref directly in the hook's render body, which
 * `eslint-plugin-react-hooks`'s `refs` rule (React Compiler-safety) forbids
 * outright — even the single documented "compare-and-update a ref during
 * render" exception isn't statically provable safe, so it's rejected. The
 * fix below gets the same synchronous guarantee without ANY ref access
 * during render: `scrollContainerRef` and `getInitialScrollOffset` each do
 * their own `lastResultsKeyRef` comparison INSIDE their own callback
 * bodies (never in the hook's top-level flow), and both are recreated
 * (via `[resultsKey]` in their dependency arrays) whenever `resultsKey`
 * changes, so they always compare against the CURRENT `resultsKey` from
 * closure — `lastResultsKeyRef` is written only by `scrollContainerRef`,
 * at the moment a node actually (re)mounts.
 */
export function useScrollPersistence(activeMatter: Matter | null | undefined, resultsKey: string): {
  scrollContainerRef: (node: HTMLDivElement | null) => void;
  /** The currently-attached scroll node, if any — for callers (e.g. a
   *  virtualizer's `getScrollElement`) that need to read it imperatively
   *  rather than receive it as a ref object. */
  getScrollElement: () => HTMLDivElement | null;
  /**
   * The saved scroll offset for the CURRENT matter/results, read
   * synchronously (no DOM node needed) — for a virtualizer's
   * `initialOffset`.
   *
   * Codex review (P2.2, round 6): `scrollContainerRef`'s restore only sets
   * `node.scrollTop` directly, which is enough for a plain scrollable div —
   * but @tanstack/react-virtual tracks its OWN internal scroll-offset state
   * starting at 0, and only updates it in response to a native `scroll`
   * event; it never reads the element's actual `scrollTop` at setup time.
   * So restoring `scrollTop` alone left the virtualizer still believing it
   * was at offset 0 and rendering the TOP window of rows, even though the
   * container was visually scrolled elsewhere — a busy (virtualized) inbox
   * looked like it reset to the top (or went blank) on every reopen.
   * `initialOffset` seeds the virtualizer's internal state directly at
   * construction time, so it agrees with the restored `scrollTop` from
   * the very first render.
   */
  getInitialScrollOffset: () => number;
} {
  const scrollKey = `email-scroll-${activeMatter?.id ?? 'all'}`;
  const scrollKeyRef = useRef(scrollKey);
  const nodeRef = useRef<HTMLDivElement | null>(null);
  // The resultsKey that the container was last (re)mounted for. A DIFFERENT
  // current resultsKey means "this mount is a brand-new result set — start
  // at the top", not "restore wherever the previous set was scrolled to".
  // Initialized to the first-seen resultsKey: the very first-ever mount of
  // a results set is real navigation into it, not a "replace" — it should
  // restore normally, same as any other matter/results combination visited
  // before.
  const lastResultsKeyRef = useRef(resultsKey);

  // The matter changed while the scroll node stayed mounted (e.g. the
  // non-embedded "Email" nav surface isn't remounted per-matter the way
  // embedded per-client sub-tabs are) — save under the OLD key and restore
  // under the NEW one for whatever node is currently attached.
  //
  // Coordinator review (final pass): `restoreScroll` only sets the DOM
  // node's `scrollTop` — a virtualized list (@tanstack/react-virtual)
  // tracks its OWN internal offset independently, updated only by a live
  // `scroll` event, never by reading `scrollTop` on demand (same root
  // cause as the query-reset fix in EmailWorkspace, round 9). Without
  // this, switching clients with a long list still mounted (the case this
  // effect exists for) restored the visual scrollbar position but left
  // the virtualizer still rendering the OLD row window until the user
  // manually scrolled.
  //
  // The dispatch is deferred to a microtask, same as round 9's fix and for
  // the same reason: @tanstack/react-virtual's scroll listener can call
  // `flushSync`, which React rejects when it's still nested inside an
  // in-progress commit. A plain `useEffect` (vs. `useLayoutEffect`) is
  // enough to avoid that nesting in a real browser, where passive effects
  // run in a separate task after paint — but `act()` (React Testing
  // Library, used throughout this codebase's tests) intentionally flushes
  // passive effects SYNCHRONOUSLY within its own call for determinism, so
  // the same nested-`flushSync` conflict resurfaces under test without the
  // deferral. Deferring unconditionally keeps behavior identical in both
  // environments rather than depending on that timing difference.
  useEffect(() => {
    if (scrollKeyRef.current === scrollKey) return;
    saveScroll(nodeRef.current, scrollKeyRef.current);
    scrollKeyRef.current = scrollKey;
    const node = nodeRef.current;
    if (node) {
      restoreScroll(node, scrollKey);
      queueMicrotask(() => {
        node.dispatchEvent(new Event('scroll'));
      });
    }
  }, [scrollKey]);

  // Whole-component unmount: save whatever is currently attached.
  useEffect(() => {
    return () => {
      saveScroll(nodeRef.current, scrollKeyRef.current);
    };
  }, []);

  // Recreated whenever `resultsKey` changes (not on every render) so React
  // detaches/reattaches — this callback always sees the CURRENT resultsKey
  // via closure, with no ref needed to smuggle it in.
  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (node === nodeRef.current) return;
    // The previously-attached node (if any) is being replaced or removed
    // (e.g. the results box unmounts while a new search is loading) — save
    // its final position before losing the reference to it.
    saveScroll(nodeRef.current, scrollKeyRef.current);
    nodeRef.current = node;
    if (node) {
      const isFreshResultsKey = lastResultsKeyRef.current !== resultsKey;
      lastResultsKeyRef.current = resultsKey;
      if (isFreshResultsKey) {
        node.scrollTop = 0;
      } else {
        restoreScroll(node, scrollKeyRef.current);
      }
    }
  }, [resultsKey]);

  const getScrollElement = useCallback(() => nodeRef.current, []);

  // Read fresh each call rather than memoized: a virtualizer only actually
  // consults this ONCE (at its own internal instance construction), but
  // reading live here rather than capturing a stale closure value is both
  // simpler and safer if that assumption ever changes upstream. Read-only —
  // `lastResultsKeyRef` is written by `scrollContainerRef` alone, at actual
  // mount time.
  const getInitialScrollOffset = useCallback(() => {
    if (lastResultsKeyRef.current !== resultsKey) return 0;
    return parseOffset(sessionStorage.getItem(scrollKeyRef.current)) ?? 0;
  }, [resultsKey]);

  return { scrollContainerRef, getScrollElement, getInitialScrollOffset };
}
