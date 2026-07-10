import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { SK_INTAKES } from '@/config/identity';

export type IntakeItemState = 'not_started' | 'provided' | 'received' | 'accepted' | 'needs_followup' | 'not_needed';
export type IntakeStatus = 'draft' | 'active' | 'revoked' | 'expired' | 'completed';

export interface IntakeProvenanceSummary {
  channel: 'intake_link' | 'email_reply' | 'phone_walkthrough' | 'doc_extraction' | 'manual';
  label: string;
  at: string;
  enteredBy?: string;
}

export interface IntakeChecklistState {
  itemId: string;
  label: string;
  state: IntakeItemState;
  provenance?: IntakeProvenanceSummary;
  factId?: string;
  filePath?: string;
}

export interface IntakeReceivedItem {
  itemId: string;
  label: string;
  filePath?: string;
  factId?: string;
  receivedAt: string;
  provenance: IntakeProvenanceSummary;
}

export interface IntakeFlag {
  id: string;
  kind: 'duplicate' | 'new_device' | 'integrity_mismatch' | 'stale_overwrite' | 'vault_off_nudge';
  itemId?: string;
  submissionId?: string;
  message: string;
  at: string;
}

export interface IntakeRecord {
  intakeId: string;
  matterId: string;
  clientFirstName: string;
  firmName: string;
  status: IntakeStatus;
  link?: string;
  expiresAt: string;
  checklistVersion: number;
  items: IntakeChecklistState[];
  receivedItems: IntakeReceivedItem[];
  flags: IntakeFlag[];
  knownSessionIds: string[];
  publicKeyRawB64?: string;
  checklistCiphertextB64?: string;
  stateCiphertextB64?: string;
  lastCursor?: number;
}

interface IntakeStoreState {
  intakesById: Record<string, IntakeRecord>;
  upsertIntake: (record: IntakeRecord) => void;
  updateIntake: (intakeId: string, patch: Partial<IntakeRecord>) => void;
  getIntakeForMatter: (matterId: string) => IntakeRecord | null;
  hasIntakeForMatter: (matterId: string) => boolean;
  updateItem: (intakeId: string, item: IntakeChecklistState) => void;
  addReceivedItem: (intakeId: string, item: IntakeReceivedItem) => void;
  addFlag: (intakeId: string, flag: IntakeFlag) => void;
  rememberSession: (intakeId: string, sessionId: string) => void;
  setCursor: (intakeId: string, cursor: number) => void;
  resetForTests: () => void;
}

type PersistableIntakeRecord = Omit<IntakeRecord, 'link'>;
type PersistedIntakeState = { intakesById: Record<string, PersistableIntakeRecord> };

type IntakeRecordWithPossibleSecrets = IntakeRecord & {
  linkSecretB64?: unknown;
  secret?: unknown;
};

export function partializeIntakeStateForPersistence(
  state: Pick<IntakeStoreState, 'intakesById'>,
): PersistedIntakeState {
  return {
    intakesById: Object.fromEntries(
      Object.entries(state.intakesById).map(([intakeId, record]) => {
        const {
          link: _link,
          linkSecretB64: _linkSecretB64,
          secret: _secret,
          ...persistable
        } = record as IntakeRecordWithPossibleSecrets;
        return [intakeId, persistable];
      }),
    ),
  };
}

export function sanitizePersistedIntakeState(
  persistedState: unknown,
): PersistedIntakeState {
  const state = persistedState as { intakesById?: unknown } | null | undefined;
  const intakesById =
    state?.intakesById && typeof state.intakesById === 'object'
      ? state.intakesById as Record<string, IntakeRecord>
      : {};
  return partializeIntakeStateForPersistence({ intakesById });
}

function dedupeById<T extends { id?: string; itemId?: string; submissionId?: string }>(
  items: T[],
  next: T,
): T[] {
  const key = next.id ?? `${next.itemId ?? ''}:${next.submissionId ?? ''}`;
  return [
    ...items.filter((item) => (item.id ?? `${item.itemId ?? ''}:${item.submissionId ?? ''}`) !== key),
    next,
  ];
}

export const useIntakeStore = create<IntakeStoreState>()(
  persist<IntakeStoreState, [], [], PersistedIntakeState>(
    (set, get) => ({
      intakesById: {},
      upsertIntake: (record) => set((state) => ({
        intakesById: { ...state.intakesById, [record.intakeId]: record },
      })),
      updateIntake: (intakeId, patch) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current) return {};
        return { intakesById: { ...state.intakesById, [intakeId]: { ...current, ...patch } } };
      }),
      getIntakeForMatter: (matterId) =>
        Object.values(get().intakesById).find((record) => record.matterId === matterId) ?? null,
      hasIntakeForMatter: (matterId) =>
        Object.values(get().intakesById).some((record) => record.matterId === matterId),
      updateItem: (intakeId, item) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current) return {};
        const items = [
          ...current.items.filter((candidate) => candidate.itemId !== item.itemId),
          item,
        ];
        return { intakesById: { ...state.intakesById, [intakeId]: { ...current, items } } };
      }),
      addReceivedItem: (intakeId, item) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current) return {};
        return {
          intakesById: {
            ...state.intakesById,
            [intakeId]: {
              ...current,
              receivedItems: dedupeById(current.receivedItems, item),
            },
          },
        };
      }),
      addFlag: (intakeId, flag) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current) return {};
        return {
          intakesById: {
            ...state.intakesById,
            [intakeId]: {
              ...current,
              flags: dedupeById(current.flags, flag),
            },
          },
        };
      }),
      rememberSession: (intakeId, sessionId) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current || current.knownSessionIds.includes(sessionId)) return {};
        return {
          intakesById: {
            ...state.intakesById,
            [intakeId]: { ...current, knownSessionIds: [...current.knownSessionIds, sessionId] },
          },
        };
      }),
      setCursor: (intakeId, cursor) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current) return {};
        return { intakesById: { ...state.intakesById, [intakeId]: { ...current, lastCursor: cursor } } };
      }),
      resetForTests: () => set({ intakesById: {} }),
    }),
    {
      name: SK_INTAKES,
      version: 1,
      migrate: sanitizePersistedIntakeState,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedIntakeState(persistedState),
      }),
      partialize: partializeIntakeStateForPersistence,
    },
  ),
);
