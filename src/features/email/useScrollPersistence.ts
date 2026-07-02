import { useCallback, useEffect, useRef } from 'react';
import type { Matter } from '@/platform/types/matter';

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
 */
export function useScrollPersistence(activeMatter: Matter | null | undefined): {
  scrollContainerRef: (node: HTMLDivElement | null) => void;
  /** The currently-attached scroll node, if any — for callers (e.g. a
   *  virtualizer's `getScrollElement`) that need to read it imperatively
   *  rather than receive it as a ref object. */
  getScrollElement: () => HTMLDivElement | null;
  /**
   * The saved scroll offset for the CURRENT matter, read synchronously
   * (no DOM node needed) — for a virtualizer's `initialOffset`.
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

  const restore = (node: HTMLDivElement, key: string): void => {
    const saved = sessionStorage.getItem(key);
    if (saved) {
      node.scrollTop = Number(saved);
    }
  };
  const save = (node: HTMLDivElement | null, key: string): void => {
    if (node) {
      sessionStorage.setItem(key, String(node.scrollTop));
    }
  };

  // The matter changed while the scroll node stayed mounted (e.g. the
  // non-embedded "Email" nav surface isn't remounted per-matter the way
  // embedded per-client sub-tabs are) — save under the OLD key and restore
  // under the NEW one for whatever node is currently attached.
  useEffect(() => {
    if (scrollKeyRef.current === scrollKey) return;
    save(nodeRef.current, scrollKeyRef.current);
    scrollKeyRef.current = scrollKey;
    if (nodeRef.current) {
      restore(nodeRef.current, scrollKey);
    }
  }, [scrollKey]);

  // Whole-component unmount: save whatever is currently attached.
  useEffect(() => {
    return () => {
      save(nodeRef.current, scrollKeyRef.current);
    };
  }, []);

  const scrollContainerRef = useCallback((node: HTMLDivElement | null) => {
    if (node === nodeRef.current) return;
    // The previously-attached node (if any) is being replaced or removed
    // (e.g. the results box unmounts while a new search is loading) — save
    // its final position before losing the reference to it.
    save(nodeRef.current, scrollKeyRef.current);
    nodeRef.current = node;
    if (node) {
      restore(node, scrollKeyRef.current);
    }
  }, []);

  const getScrollElement = useCallback(() => nodeRef.current, []);

  // Read fresh each call rather than memoized: a virtualizer only actually
  // consults this ONCE (at its own internal instance construction), but
  // reading live here rather than capturing a stale closure value is both
  // simpler and safer if that assumption ever changes upstream.
  const getInitialScrollOffset = useCallback(() => {
    const saved = sessionStorage.getItem(scrollKeyRef.current);
    return saved ? Number(saved) : 0;
  }, []);

  return { scrollContainerRef, getScrollElement, getInitialScrollOffset };
}
