// File Backup Store
//
// Tracks which on-disk files have already had a session backup written, so we
// only write a backup copy on the FIRST user edit per session. The goal is to
// give users a safety net for round-trip saves of .xlsx/.docx — formats where
// our serializer may drop advanced formatting the reader preserved — without
// cluttering the workspace with N backups for N keystrokes.
//
// This store is intentionally minimal: a set of paths we've already backed up.
// State is NOT persisted — "session" here means "since the app launched". If
// you close and reopen Advisor Prep Hero, the first edit of a given file writes a new
// backup. That's the behavior users reasonably expect.

import { create } from 'zustand';

interface FileBackupState {
  /** Paths we've already written a backup for in this session. */
  backedUpPaths: Record<string, true>;

  /** Record that we've backed up a given path. */
  markBackedUp: (path: string) => void;

  /** Check if a path already has a backup this session. */
  hasBackup: (path: string) => boolean;

  /** Reset (primarily for tests). */
  clear: () => void;
}

export const useFileBackupStore = create<FileBackupState>((set, get) => ({
  backedUpPaths: {},

  markBackedUp: (path) => {
    set((state) => {
      if (state.backedUpPaths[path]) {
        return state;
      }
      return {
        backedUpPaths: { ...state.backedUpPaths, [path]: true },
      };
    });
  },

  hasBackup: (path) => {
    return Boolean(get().backedUpPaths[path]);
  },

  clear: () => {
    set({ backedUpPaths: {} });
  },
}));

/**
 * Format a local-time timestamp as `YYYYMMDD-HHMMSS` for backup filenames.
 * Local time matches what a user sees in Explorer/Finder, which is what
 * they'll look for when hunting down the backup.
 */
export function formatBackupTimestamp(date: Date = new Date()): string {
  const pad = (n: number, width = 2) => n.toString().padStart(width, '0');
  const y = date.getFullYear();
  const m = pad(date.getMonth() + 1);
  const d = pad(date.getDate());
  const h = pad(date.getHours());
  const min = pad(date.getMinutes());
  const s = pad(date.getSeconds());
  return `${y}${m}${d}-${h}${min}${s}`;
}

/**
 * Compute the backup path for a given source file path.
 * e.g. `/workspace/sheet.xlsx` → `/workspace/sheet.xlsx.backup-20260415-143012.xlsx`.
 */
export function computeBackupPath(originalPath: string, timestamp: string): string {
  const lastDot = originalPath.lastIndexOf('.');
  const ext = lastDot >= 0 ? originalPath.slice(lastDot + 1) : '';
  return `${originalPath}.backup-${timestamp}${ext ? `.${ext}` : ''}`;
}
