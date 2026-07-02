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

  return { scrollContainerRef, getScrollElement };
}
