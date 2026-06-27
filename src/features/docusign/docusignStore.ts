import { create } from 'zustand';
import type { DocusignSyncProgress } from '@/platform/utils/docusign-commands';

interface DocusignState {
  progress: DocusignSyncProgress | null;
  setProgress: (progress: DocusignSyncProgress) => void;
}

export const useDocusignStore = create<DocusignState>((set) => ({
  progress: null,
  setProgress: (progress) => { set({ progress }); },
}));
