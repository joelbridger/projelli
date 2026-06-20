import type { Chapter } from './types';

export interface ProgressStep {
  id: string;
  title: string;
  /** Zero-based position */
  index: number;
  isCurrent: boolean;
  isCompleted: boolean;
}

/**
 * Derives the ordered progress steps from the chapter list and the current index.
 * Pure function — safe to call anywhere (tests, host, stories).
 */
export function buildProgressSteps(chapters: Chapter[], currentIndex: number): ProgressStep[] {
  return chapters.map((chapter, i) => ({
    id: chapter.id,
    title: chapter.title,
    index: i,
    isCurrent: i === currentIndex,
    isCompleted: i < currentIndex,
  }));
}

/** Fraction 0–1 representing how far through the journey the user is. */
export function progressFraction(currentIndex: number, total: number): number {
  if (total <= 1) return 1;
  return currentIndex / (total - 1);
}
