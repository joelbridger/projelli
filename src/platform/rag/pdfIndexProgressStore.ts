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
  ownerId: string | null;
  begin: (progress: PdfIndexProgress, ownerId: string) => void;
  set: (progress: PdfIndexProgress, ownerId?: string) => void;
  clear: (ownerId?: string) => void;
  clearSoon: (ownerId?: string) => void;
}

let clearTimer: ReturnType<typeof setTimeout> | null = null;

export const usePdfIndexProgressStore = create<PdfIndexProgressState>((set, get) => ({
  current: null,
  ownerId: null,
  begin: (progress, ownerId) => {
    if (clearTimer !== null) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    set({ current: progress, ownerId });
  },
  set: (progress, ownerId) => {
    // Only `begin` may claim ownership. A slower old run cannot reclaim the
    // banner after a newer run has started.
    if (ownerId !== undefined && get().ownerId !== ownerId) return;
    if (clearTimer !== null) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    set({ current: progress, ownerId: ownerId ?? null });
  },
  clear: (ownerId) => {
    if (ownerId !== undefined && get().ownerId !== ownerId) return;
    if (clearTimer !== null) {
      clearTimeout(clearTimer);
      clearTimer = null;
    }
    set({ current: null, ownerId: null });
  },
  clearSoon: (ownerId) => {
    // An older workspace/run must never cancel or replace the active run's
    // timer, or erase its live banner after a workspace switch.
    if (ownerId !== undefined && get().ownerId !== ownerId) return;
    if (clearTimer !== null) clearTimeout(clearTimer);
    clearTimer = setTimeout(() => {
      clearTimer = null;
      if (ownerId === undefined || get().ownerId === ownerId) {
        set({ current: null, ownerId: null });
      }
    }, 4000);
    const maybeNodeTimer = clearTimer as { unref?: () => void };
    maybeNodeTimer.unref?.();
  },
}));
