import { create } from 'zustand';
import type { OneDriveSyncProgress } from '@/platform/utils/onedrive-commands';

interface OneDriveState {
  progress: OneDriveSyncProgress | null;
  setProgress: (p: OneDriveSyncProgress) => void;
}

export const useOneDriveStore = create<OneDriveState>((set) => ({
  progress: null,
  setProgress: (p) => { set({ progress: p }); },
}));
