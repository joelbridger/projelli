import { create } from 'zustand';
import type { MailSyncProgress } from '@/platform/utils/mail-commands';

interface MailState {
  connected: boolean;
  progress: MailSyncProgress | null;
  setConnected: (v: boolean) => void;
  setProgress: (p: MailSyncProgress) => void;
}

export const useMailStore = create<MailState>((set) => ({
  connected: false,
  progress: null,
  setConnected: (v) => set({ connected: v }),
  setProgress: (p) => set({ progress: p }),
}));
