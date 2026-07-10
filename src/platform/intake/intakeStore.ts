import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import { SK_INTAKES } from '@/config/identity';
import type { IntakeNudgeAttempt } from './nudgeTypes';
import type { Tier1WarningReason } from './documentDetectiveTypes';
import type { RequestItem } from './types';

export type IntakeItemState = 'not_started' | 'provided' | 'received' | 'accepted' | 'needs_followup' | 'not_needed';
export type IntakeStatus = 'draft' | 'active' | 'revoked' | 'expired' | 'completed';

export interface IntakeProvenanceSummary {
  channel: 'intake_link' | 'email_reply' | 'phone_walkthrough' | 'doc_extraction' | 'manual';
  label: string;
  at: string;
  enteredBy?: string;
  confirmedBy?: string;
  verification?: 'client_stated' | 'document_verified' | 'advisor_confirmed';
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
  /** Client-supplied Tier 1 context only. It is not advisor-side verification. */
  keptWarnedFile?: boolean;
  keptWarnedFileReason?: Tier1WarningReason;
  receivedAt: string;
  provenance: IntakeProvenanceSummary;
}

/** Non-sensitive proof that a quarantined attachment was saved to this target. */
export interface EmailReplyManualFileReceipt {
  quarantineId: string;
  targetMatterId: string;
  targetRequestId: string;
  targetItemId: string;
  filePath: string;
  completedAt: string;
}

export interface IntakeFlag {
  id: string;
  kind:
    | 'duplicate'
    | 'new_device'
    | 'integrity_mismatch'
    | 'routing_failed'
    | 'stale_overwrite'
    | 'vault_off_nudge';
  itemId?: string;
  submissionId?: string;
  message: string;
  at: string;
}

export interface IntakeRecord {
  intakeId: string;
  matterId: string;
  clientFirstName: string;
  clientEmail?: string;
  clientPhone?: string;
  firmName: string;
  status: IntakeStatus;
  /** Local creation time used only for the advisor's aggregate onboarding KPIs. */
  createdAt?: string;
  /** Local completion time used only for the advisor's aggregate onboarding KPIs. */
  completedAt?: string;
  link?: string;
  expiresAt: string;
  lastClientActivityAt?: string;
  checklistVersion: number;
  /** The advisor-side copy of the sealed checklist, used for phone walkthroughs. */
  requestItems?: RequestItem[];
  items: IntakeChecklistState[];
  receivedItems: IntakeReceivedItem[];
  emailReplyManualFileReceipts?: EmailReplyManualFileReceipt[];
  flags: IntakeFlag[];
  knownSessionIds: string[];
  knownSubmissionIds: string[];
  nudges: IntakeNudgeAttempt[];
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
  recordEmailReplyManualFileReceipt: (intakeId: string, receipt: EmailReplyManualFileReceipt) => void;
  addFlag: (intakeId: string, flag: IntakeFlag) => void;
  rememberSession: (intakeId: string, sessionId: string) => void;
  rememberSubmission: (intakeId: string, submissionId: string) => void;
  recordNudgeAttempt: (intakeId: string, attempt: IntakeNudgeAttempt) => void;
  setLastClientActivity: (intakeId: string, at: string) => void;
  setCursor: (intakeId: string, cursor: number) => void;
  resetForTests: () => void;
}

type PersistableIntakeRecord = Omit<IntakeRecord, 'link'>;
type PersistedIntakeState = { intakesById: Record<string, PersistableIntakeRecord> };

type IntakeRecordWithPossibleSecrets = IntakeRecord & {
  linkSecretB64?: unknown;
  secret?: unknown;
};

function intakeRecordWithDefaults(record: IntakeRecord): IntakeRecord {
  return {
    ...record,
    items: Array.isArray(record.items) ? record.items : [],
    receivedItems: Array.isArray(record.receivedItems) ? record.receivedItems : [],
    emailReplyManualFileReceipts: Array.isArray(record.emailReplyManualFileReceipts)
      ? record.emailReplyManualFileReceipts
      : [],
    flags: Array.isArray(record.flags) ? record.flags : [],
    knownSessionIds: Array.isArray(record.knownSessionIds) ? record.knownSessionIds : [],
    knownSubmissionIds: Array.isArray(record.knownSubmissionIds) ? record.knownSubmissionIds : [],
    nudges: Array.isArray(record.nudges) ? record.nudges : [],
  };
}

export function partializeIntakeStateForPersistence(
  state: Pick<IntakeStoreState, 'intakesById'>,
): PersistedIntakeState {
  return {
    intakesById: Object.fromEntries(
      Object.entries(state.intakesById).map(([intakeId, record]) => {
        const normalized = intakeRecordWithDefaults(record);
        const {
          link: _link,
          linkSecretB64: _linkSecretB64,
          secret: _secret,
          ...persistable
        } = normalized as IntakeRecordWithPossibleSecrets;
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

export function migratePersistedIntakeState(
  persistedState: unknown,
  _version: number,
): PersistedIntakeState {
  return sanitizePersistedIntakeState(persistedState);
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
        intakesById: { ...state.intakesById, [record.intakeId]: intakeRecordWithDefaults(record) },
      })),
      updateIntake: (intakeId, patch) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current) return {};
        return {
          intakesById: {
            ...state.intakesById,
            [intakeId]: intakeRecordWithDefaults({ ...current, ...patch }),
          },
        };
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
      recordEmailReplyManualFileReceipt: (intakeId, receipt) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current) return {};
        const receipts = current.emailReplyManualFileReceipts ?? [];
        const existing = receipts.find(
          (candidate) =>
            candidate.quarantineId === receipt.quarantineId &&
            candidate.targetMatterId === receipt.targetMatterId &&
            candidate.targetRequestId === receipt.targetRequestId &&
            candidate.targetItemId === receipt.targetItemId,
        );
        if (existing) {
          if (existing.filePath === receipt.filePath) return {};
          throw new Error('This quarantined email target already has a different saved file.');
        }
        return {
          intakesById: {
            ...state.intakesById,
            [intakeId]: {
              ...current,
              emailReplyManualFileReceipts: [...receipts, receipt],
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
      rememberSubmission: (intakeId, submissionId) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current || current.knownSubmissionIds.includes(submissionId)) return {};
        return {
          intakesById: {
            ...state.intakesById,
            [intakeId]: {
              ...current,
              knownSubmissionIds: [...current.knownSubmissionIds, submissionId],
            },
          },
        };
      }),
      recordNudgeAttempt: (intakeId, attempt) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current) return {};
        return {
          intakesById: {
            ...state.intakesById,
            [intakeId]: {
              ...current,
              nudges: [...current.nudges, attempt],
            },
          },
        };
      }),
      setLastClientActivity: (intakeId, at) => set((state) => {
        const current = state.intakesById[intakeId];
        if (!current) return {};
        const nextTime = new Date(at).getTime();
        if (!Number.isFinite(nextTime)) return {};
        const currentTime = current.lastClientActivityAt
          ? new Date(current.lastClientActivityAt).getTime()
          : Number.NEGATIVE_INFINITY;
        if (Number.isFinite(currentTime) && nextTime <= currentTime) return {};
        return {
          intakesById: {
            ...state.intakesById,
            [intakeId]: { ...current, lastClientActivityAt: at },
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
      version: 2,
      migrate: migratePersistedIntakeState,
      merge: (persistedState, currentState) => ({
        ...currentState,
        ...sanitizePersistedIntakeState(persistedState),
      }),
      partialize: partializeIntakeStateForPersistence,
    },
  ),
);
