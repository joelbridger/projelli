/**
 * Live progress for the renderer-side PDF indexing pass.
 *
 * Rust reports the office/text workspace walk through Tauri events. PDFs are
 * extracted in the renderer first, so this small store lets the same banner
 * show the second pass too.
 */

import { create } from 'zustand';

export interface PdfIndexProgress {
  processed: number;
  total: number;
  currentPath: string | null;
}

interface PdfIndexProgressState {
  current: PdfIndexProgress | null;
  set: (progress: PdfIndexProgress) => void;
  clear: () => void;
  clearSoon: () => void;
}

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export const usePdfIndexProgressStore = create<PdfIndexProgressState>((set) => ({
  current: null,
  set: (progress) => {
    if (clearTimer !== null) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    set({ current: progress });
  },
  clear: () => {
    if (clearTimer !== null) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    set({ current: null });
  },
  clearSoon: () => {
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clearTimer = null;
      set({ current: null });
    }, 4000);
    const maybeNodeTimer = clearTimer as { unref?: () => void };
    maybeNodeTimer.unref?.();
  },
}));
