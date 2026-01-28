import { create } from 'zustand';
import type { RunRecord, WorkflowTemplate } from '@/types/workflow';

interface WorkflowState {
  // Available templates
  templates: WorkflowTemplate[];

  // Current run
  currentRun: RunRecord | null;
  isRunning: boolean;

  // Run history
  runHistory: RunRecord[];

  // Actions
  setTemplates: (templates: WorkflowTemplate[]) => void;
  startRun: (run: RunRecord) => void;
  updateRun: (updates: Partial<RunRecord>) => void;
  completeRun: (run: RunRecord) => void;
  cancelRun: () => void;
  addToHistory: (run: RunRecord) => void;
  clearHistory: () => void;
}

export const useWorkflowStore = create<WorkflowState>((set) => ({
  templates: [],
  currentRun: null,
  isRunning: false,
  runHistory: [],

  setTemplates: (templates) => {
    set({ templates });
  },

  startRun: (run) => {
    set({ currentRun: run, isRunning: true });
  },

  updateRun: (updates) => {
    set((state) => ({
      currentRun: state.currentRun
        ? { ...state.currentRun, ...updates }
        : null,
    }));
  },

  completeRun: (run) => {
    set((state) => ({
      currentRun: null,
      isRunning: false,
      runHistory: [run, ...state.runHistory],
    }));
  },

  cancelRun: () => {
    set({ currentRun: null, isRunning: false });
  },

  addToHistory: (run) => {
    set((state) => ({
      runHistory: [run, ...state.runHistory],
    }));
  },

  clearHistory: () => {
    set({ runHistory: [] });
  },
}));
