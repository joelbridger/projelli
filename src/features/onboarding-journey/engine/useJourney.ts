import { useState, useCallback } from 'react';
import type { Chapter, JourneyData } from './types';

export interface UseJourneyOptions {
  reducedMotion?: boolean;
  onComplete: (data: JourneyData) => void;
  onSkip: (data: JourneyData) => void;
}

export interface UseJourneyResult {
  index: number;
  current: Chapter;
  data: JourneyData;
  advance: () => void;
  goBack: () => void;
  skipAll: () => void;
  complete: () => void;
  setData: (patch: Partial<JourneyData>) => void;
  isFirst: boolean;
  isLast: boolean;
  reducedMotion: boolean;
}

/**
 * Pure journey state machine — no side effects outside the provided callbacks.
 * Persistence and localStorage are the host/App's responsibility.
 */
export function useJourney(
  chapters: Chapter[],
  opts: UseJourneyOptions,
): UseJourneyResult {
  const { reducedMotion = false, onComplete, onSkip } = opts;
  const [index, setIndex] = useState(0);
  const [data, setDataState] = useState<JourneyData>({});

  const setData = useCallback((patch: Partial<JourneyData>) => {
    setDataState((prev) => ({ ...prev, ...patch }));
  }, []);

  const advance = useCallback(() => {
    setIndex((prev) => {
      const chapter = chapters[prev];
      // Respect the optional gate
      if (chapter?.canAdvance && !chapter.canAdvance(data)) return prev;
      // Do not advance past the last chapter (complete() does that)
      if (prev >= chapters.length - 1) return prev;
      return prev + 1;
    });
  }, [chapters, data]);

  // Note: advance reads `data` from closure — but setIndex receives a function
  // so React batching is fine. We use `data` directly so canAdvance is evaluated
  // with the latest state at the time advance() is called.

  const goBack = useCallback(() => {
    setIndex((prev) => Math.max(0, prev - 1));
  }, []);

  const skipAll = useCallback(() => {
    // Capture latest data via functional read — data is in closure scope here
    // which is valid because skipAll is recreated when data changes.
    onSkip(data);
  }, [data, onSkip]);

  // complete() reads `data` from closure. Do NOT call setData(...) and
  // complete() in the same synchronous handler and expect complete() to see
  // the new value — setData schedules a re-render; only the *next* render's
  // closure sees the updated data. Set data in onChange/earlier handlers.
  const complete = useCallback(() => {
    onComplete(data);
  }, [data, onComplete]);

  // `chapters` must be non-empty; fall back to index 0 as a safety net.
  // eslint-disable-next-line @typescript-eslint/no-non-null-assertion
  const current: Chapter = (chapters[index] ?? chapters[0])!;

  return {
    index,
    current,
    data,
    advance,
    goBack,
    skipAll,
    complete,
    setData,
    isFirst: index === 0,
    isLast: index === chapters.length - 1,
    reducedMotion,
  };
}
