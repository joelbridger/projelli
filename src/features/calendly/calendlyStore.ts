import { create } from 'zustand';
import type { CalendlySyncProgress } from '@/platform/utils/calendly-commands';

interface CalendlyState {
  progress: CalendlySyncProgress | null;
  setProgress: (p: CalendlySyncProgress) => void;
}

export const useCalendlyStore = create<CalendlyState>((set) => ({
  progress: null,
  setProgress: (p) => { set({ progress: p }); },
}));
