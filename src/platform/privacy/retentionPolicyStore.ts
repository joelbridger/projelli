// Per-workspace retention rules for meeting artifacts (Wave 4 Track D).
// Data-safe by construction: anything unreadable coerces to keep-everything —
// a corrupt setting must never delete a recording.
import { create } from 'zustand';
import { persist, createJSONStorage } from 'zustand/middleware';
import { SK_RETENTION_POLICIES } from '@/config/identity';

export type RetentionMode = 'keep-everything' | 'delete-audio-after-days' | 'summary-only';

export interface RetentionPolicy {
  mode: RetentionMode;
  audioRetentionDays: number;
}

export interface RetentionSweepRecord {
  sweptAt: string;
  deletedCount: number;
  errors: string[];
}

export const DEFAULT_RETENTION_POLICY: RetentionPolicy = { mode: 'keep-everything', audioRetentionDays: 30 };

const MODES: readonly RetentionMode[] = ['keep-everything', 'delete-audio-after-days', 'summary-only'];

export function sanitizePolicy(input: unknown): RetentionPolicy {
  if (!input || typeof input !== 'object') return { ...DEFAULT_RETENTION_POLICY };
  const mode = (input as { mode?: unknown }).mode;
  if (typeof mode !== 'string' || !MODES.includes(mode as RetentionMode)) return { ...DEFAULT_RETENTION_POLICY };
  const rawDays = (input as { audioRetentionDays?: unknown }).audioRetentionDays;
  const days = typeof rawDays === 'number' && Number.isFinite(rawDays)
    ? Math.min(3650, Math.max(1, Math.round(rawDays)))
    : DEFAULT_RETENTION_POLICY.audioRetentionDays;
  return { mode: mode as RetentionMode, audioRetentionDays: days };
}

interface RetentionPolicyState {
  policies: Record<string, RetentionPolicy>;
  lastSweep: Record<string, RetentionSweepRecord>;
  getPolicy: (workspaceRoot: string) => RetentionPolicy;
  setPolicy: (workspaceRoot: string, policy: RetentionPolicy) => void;
  recordSweep: (workspaceRoot: string, rec: RetentionSweepRecord) => void;
}

export const useRetentionPolicyStore = create<RetentionPolicyState>()(
  persist(
    (set, get) => ({
      policies: {},
      lastSweep: {},
      getPolicy: (workspaceRoot) => sanitizePolicy(get().policies[workspaceRoot]),
      setPolicy: (workspaceRoot, policy) =>
        set((s) => ({ policies: { ...s.policies, [workspaceRoot]: sanitizePolicy(policy) } })),
      recordSweep: (workspaceRoot, rec) =>
        set((s) => ({ lastSweep: { ...s.lastSweep, [workspaceRoot]: rec } })),
    }),
    {
      name: SK_RETENTION_POLICIES,
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({ policies: s.policies, lastSweep: s.lastSweep }),
    },
  ),
);
