import { useRef, useEffect } from 'react';
import type { Matter } from '@/platform/types/matter';

/**
 * Persists list scroll position per-matter in sessionStorage.
 * Returns a ref to attach to the scrollable container.
 */
export function useScrollPersistence(activeMatter: Matter | null | undefined): {
  scrollContainerRef: React.RefObject<HTMLDivElement>;
} {
  const scrollContainerRef = useRef<HTMLDivElement>(null);
  const scrollKey = `email-scroll-${activeMatter?.id ?? 'all'}`;

  // Restore scroll on mount; save on unmount.
  useEffect(() => {
    const saved = sessionStorage.getItem(scrollKey);
    if (saved && scrollContainerRef.current) {
      scrollContainerRef.current.scrollTop = Number(saved);
    }
    const el = scrollContainerRef.current;
    return () => {
      if (el) {
        sessionStorage.setItem(scrollKey, String(el.scrollTop));
      }
    };
  }, [scrollKey]);

  return { scrollContainerRef };
}
