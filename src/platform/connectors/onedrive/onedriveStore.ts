import { create } from 'zustand';
import type { OneDriveSyncProgress } from '@/platform/utils/onedrive-commands';
import { useWorkspaceStore } from '@/platform/fs/workspaceStore';

interface OneDriveState {
  progress: OneDriveSyncProgress | null;
  progressWorkspaceRoot: string | null;
  setProgress: (p: OneDriveSyncProgress) => void;
  clearProgress: () => void;
}

export const useOneDriveStore = create<OneDriveState>((set) => ({
  progress: null,
  progressWorkspaceRoot: null,
  setProgress: (p) => {
    set({
      progress: p,
      progressWorkspaceRoot: useWorkspaceStore.getState().rootPath,
    });
  },
  clearProgress: () => { set({ progress: null, progressWorkspaceRoot: null }); },
}));
