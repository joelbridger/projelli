/**
 * VG-2 — live progress for the local OCR pipeline.
 *
 * OCR is honest work: ~0.5 s per scanned page, so a 50-page scanned filing
 * takes real time. While `MemoryService.indexPdfFile` is reading scanned
 * pages it publishes `{ path, page, totalPages }` here, and the rag progress
 * banner renders the localized line ("Reading scanned pages with local OCR:
 * page N of M. Nothing leaves your machine.") so the user sees exactly what
 * the CPU is doing and that it is local.
 *
 * `page`/`totalPages` count the pages being OCR'd (the scanned subset of the
 * file), not the file's full page count — "page 2 of 3" means the second of
 * three scanned pages.
 *
 * Zustand so the non-React MemoryService can publish
 * (`useOcrProgressStore.getState().set(...)`) and the banner can subscribe.
 */

import { create } from 'zustand';

export interface OcrProgress {
  /** Workspace-relative or absolute path of the PDF being read. */
  path: string;
  /** 1-based index of the scanned page currently being OCR'd. */
  page: number;
  /** Total number of scanned pages queued for OCR in this file. */
  totalPages: number;
}

interface OcrProgressState {
  /** The in-flight OCR batch, or null when no OCR is running. */
  current: OcrProgress | null;
  set: (progress: OcrProgress) => void;
  clear: () => void;
}

export const useOcrProgressStore = create<OcrProgressState>((set) => ({
  current: null,
  set: (progress) => {
    set({ current: progress });
  },
  clear: () => {
    set({ current: null });
  },
}));
