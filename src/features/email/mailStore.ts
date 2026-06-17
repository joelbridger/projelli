import { create } from 'zustand';
import type { MailSyncProgress } from '@/platform/utils/mail-commands';

// localStorage key for the first-connect TTV callout dismissal.
const FIRST_CONNECT_CALLOUT_KEY = 'keepance:email:firstConnectCalloutSeen';

interface MailState {
  connected: boolean;
  progress: MailSyncProgress | null;
  /** True once the user has dismissed the first-connect TTV callout. Persisted
   *  to localStorage so the callout shows exactly once across sessions. */
  firstConnectCalloutSeen: boolean;
  setConnected: (v: boolean) => void;
  setProgress: (p: MailSyncProgress) => void;
  dismissFirstConnectCallout: () => void;
}

export const useMailStore = create<MailState>((set) => ({
  connected: false,
  progress: null,
  firstConnectCalloutSeen:
    typeof localStorage !== 'undefined' &&
    localStorage.getItem(FIRST_CONNECT_CALLOUT_KEY) === '1',
  setConnected: (v) => set({ connected: v }),
  setProgress: (p) => set({ progress: p }),
  dismissFirstConnectCallout: () => {
    if (typeof localStorage !== 'undefined') {
      localStorage.setItem(FIRST_CONNECT_CALLOUT_KEY, '1');
    }
    set({ firstConnectCalloutSeen: true });
  },
}));
