// External write-back approval queue.
//
// This mirrors the CRM write queue but is separate on purpose. Enqueueing a
// RightCapital or Holistiplan proposal saves it for review. It never sends.
// The only send path is approve(), which prepares and approves a saved
// proposal by id.

import { create } from 'zustand';

import {
  externalWriteApproveProposal,
  externalWriteDeleteProposal,
  externalWriteListProposals,
  externalWritePrepareProposal,
  externalWriteSaveProposal,
  hashExternalWriteValue,
  type ExternalWriteOperation,
  type ExternalWriteProposalPayload,
  type ExternalWriteProposalRecord,
  type ExternalWriteReceipt,
  type ExternalWriteStatus,
  type ExternalWriteTarget,
} from '@/platform/utils/external-write-commands';

export type { ExternalWriteStatus, ExternalWriteTarget };

export interface RightCapitalIncomeProposal {
  target: 'rightcapital';
  kind: 'income';
  matterId: string;
  rightCapitalHouseholdId: string;
  existing: {
    incomeId?: string;
    incomeType?: string;
    owner?: string;
    amount?: number;
    frequency?: string;
    startDate?: string;
    endDate?: string;
    notes?: string;
  };
  fromSource: {
    incomeType: string;
    owner?: string;
    amount: number;
    frequency: string;
    startDate?: string;
    endDate?: string;
    confidence: 'high' | 'medium' | 'low';
    quote: string;
  };
  final: {
    incomeId?: string;
    incomeType: string;
    owner?: string;
    amount: number;
    frequency: string;
    startDate?: string;
    endDate?: string;
    notes: string;
  };
  sourceRef: string;
}

export interface HolistiplanUploadProposal {
  target: 'holistiplan';
  kind: 'tax_document_upload';
  matterId: string;
  holistiplanHouseholdId?: string;
  holistiplanClientId?: string;
  documents: Array<{
    documentRef: string;
    displayName: string;
    taxYear?: number;
    documentKind?: 'tax_return' | 'w2' | '1099' | 'other';
    source: 'intake' | 'client_folder' | 'email';
  }>;
  sourceRef: string;
}

export type ProposedExternalWrite =
  | {
      id: string;
      proposalType: 'rightcapital_income';
      status: ExternalWriteStatus;
      requestedAt?: string;
      remoteId?: string;
      receiptRef?: string;
      error?: string;
      receipt?: ExternalWriteReceipt;
      data: RightCapitalIncomeProposal;
    }
  | {
      id: string;
      proposalType: 'holistiplan_upload';
      status: ExternalWriteStatus;
      requestedAt?: string;
      remoteId?: string;
      receiptRef?: string;
      error?: string;
      receipt?: ExternalWriteReceipt;
      data: HolistiplanUploadProposal;
    };

interface ExternalWriteQueueState {
  items: ProposedExternalWrite[];
  enqueueRightCapitalIncome: (proposal: RightCapitalIncomeProposal) => string;
  enqueueHolistiplanUpload: (proposal: HolistiplanUploadProposal) => string;
  hydrateFromBackend: () => Promise<void>;
  approve: (ids: string[]) => Promise<void>;
  dismiss: (id: string) => void;
  updateRightCapitalIncomeFinal: (
    id: string,
    patch: Partial<RightCapitalIncomeProposal['final']>,
  ) => void;
}

function newId(): string {
  return `extw-${Math.random().toString(36).slice(2)}-${Math.random().toString(36).slice(2)}`;
}

let lastRequestedAtMs = 0;
function newRequestedAt(): string {
  const now = Date.now();
  lastRequestedAtMs = now > lastRequestedAtMs ? now : lastRequestedAtMs + 1;
  return new Date(lastRequestedAtMs).toISOString();
}

function incomeTypeWire(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function frequencyWire(value: string): string {
  return value.trim().toLowerCase().replaceAll('-', '_').replaceAll(' ', '_');
}

function rightCapitalOperation(data: RightCapitalIncomeProposal): ExternalWriteOperation {
  return {
    target: 'rightcapital',
    payload: {
      type: 'upsert_income',
      client_id: data.rightCapitalHouseholdId,
      income_id: data.final.incomeId ?? null,
      income_type: incomeTypeWire(data.final.incomeType),
      owner: data.final.owner ?? null,
      amount: { amount: data.final.amount, currency: 'USD' },
      frequency: frequencyWire(data.final.frequency),
      start_date: data.final.startDate ?? null,
      end_date: data.final.endDate ?? null,
      notes: data.final.notes,
    },
  };
}

function holistiplanOperation(data: HolistiplanUploadProposal): ExternalWriteOperation {
  const first = data.documents[0];
  return {
    target: 'holistiplan',
    payload: {
      type: 'upload_tax_document',
      document_ref: first?.documentRef ?? '',
      tax_year: first?.taxYear ?? new Date().getFullYear(),
      document_kind: first?.documentKind ?? 'other',
    },
  };
}

function itemMatterId(item: ProposedExternalWrite): string {
  return item.data.matterId;
}

function itemSubjectKey(item: ProposedExternalWrite): string {
  if (item.proposalType === 'rightcapital_income') return item.data.rightCapitalHouseholdId;
  return item.data.holistiplanHouseholdId ?? item.data.holistiplanClientId ?? 'unmatched-holistiplan-target';
}

function itemTarget(item: ProposedExternalWrite): ExternalWriteTarget {
  return item.data.target;
}

function itemOperation(item: ProposedExternalWrite): ExternalWriteOperation {
  if (item.proposalType === 'rightcapital_income') return rightCapitalOperation(item.data);
  return holistiplanOperation(item.data);
}

function itemBeforeHash(item: ProposedExternalWrite): string | undefined {
  if (item.proposalType !== 'rightcapital_income') return undefined;
  if (!item.data.final.incomeId && !item.data.existing.incomeId) return undefined;
  return hashExternalWriteValue(item.data.existing);
}

function itemAfterHash(item: ProposedExternalWrite): string {
  if (item.proposalType === 'rightcapital_income') return hashExternalWriteValue(item.data.final);
  return hashExternalWriteValue(item.data.documents);
}

function itemToPayload(item: ProposedExternalWrite): ExternalWriteProposalPayload {
  const beforeHash = itemBeforeHash(item);
  const payload: ExternalWriteProposalPayload = {
    id: item.id,
    target: itemTarget(item),
    operation: itemOperation(item),
    matterId: itemMatterId(item),
    subjectKey: itemSubjectKey(item),
    sourceRef: item.data.sourceRef,
    afterHash: itemAfterHash(item),
    currentJson: item.proposalType === 'rightcapital_income' ? JSON.stringify(item.data.existing) : '{}',
    sourceJson: item.proposalType === 'rightcapital_income' ? JSON.stringify(item.data.fromSource) : JSON.stringify(item.data.documents),
    finalJson: item.proposalType === 'rightcapital_income' ? JSON.stringify(item.data.final) : JSON.stringify(item.data.documents),
    status: item.status,
  };
  if (item.requestedAt) payload.requestedAt = item.requestedAt;
  if (beforeHash) payload.beforeHash = beforeHash;
  if (item.remoteId) payload.remoteId = item.remoteId;
  if (item.receiptRef) payload.receiptRef = item.receiptRef;
  if (item.error) payload.error = item.error;
  return payload;
}

function parseJsonObject<T>(raw: string, fallback: T): T {
  try {
    return JSON.parse(raw) as T;
  } catch {
    return fallback;
  }
}

function recordToItem(record: ExternalWriteProposalRecord): ProposedExternalWrite | null {
  if (record.target === 'rightcapital' && record.operation.target === 'rightcapital') {
    const existing = parseJsonObject<RightCapitalIncomeProposal['existing']>(record.currentJson, {});
    const fromSource = parseJsonObject<RightCapitalIncomeProposal['fromSource']>(record.sourceJson, {
      incomeType: 'Other',
      amount: 0,
      frequency: 'annual',
      confidence: 'low',
      quote: '',
    });
    const final = parseJsonObject<RightCapitalIncomeProposal['final']>(record.finalJson, {
      incomeType: fromSource.incomeType,
      amount: fromSource.amount,
      frequency: fromSource.frequency,
      notes: '',
    });
    const item: ProposedExternalWrite = {
      id: record.id,
      proposalType: 'rightcapital_income',
      status: record.status === 'sending' ? 'proposed' : record.status,
      data: {
        target: 'rightcapital',
        kind: 'income',
        matterId: record.matterId,
        rightCapitalHouseholdId: record.subjectKey,
        existing,
        fromSource,
        final,
        sourceRef: record.sourceRef,
      },
    };
    if (record.requestedAt) item.requestedAt = record.requestedAt;
    if (record.remoteId) item.remoteId = record.remoteId;
    if (record.receiptRef) item.receiptRef = record.receiptRef;
    if (record.error) item.error = record.error;
    return item;
  }
  if (record.target === 'holistiplan' && record.operation.target === 'holistiplan') {
    const documents = parseJsonObject<HolistiplanUploadProposal['documents']>(record.finalJson, []);
    const item: ProposedExternalWrite = {
      id: record.id,
      proposalType: 'holistiplan_upload',
      status: record.status === 'sending' ? 'proposed' : record.status,
      data: {
        target: 'holistiplan',
        kind: 'tax_document_upload',
        matterId: record.matterId,
        holistiplanHouseholdId: record.subjectKey,
        documents,
        sourceRef: record.sourceRef,
      },
    };
    if (record.requestedAt) item.requestedAt = record.requestedAt;
    if (record.remoteId) item.remoteId = record.remoteId;
    if (record.receiptRef) item.receiptRef = record.receiptRef;
    if (record.error) item.error = record.error;
    return item;
  }
  return null;
}

function setItem(id: string, patch: Partial<ProposedExternalWrite>) {
  useExternalWriteQueueStore.setState((state) => ({
    items: state.items.map((item) => (item.id === id ? ({ ...item, ...patch } as ProposedExternalWrite) : item)),
  }));
}

function setItemClearingError(id: string, patch: Partial<ProposedExternalWrite>) {
  useExternalWriteQueueStore.setState((state) => ({
    items: state.items.map((item) => {
      if (item.id !== id) return item;
      const { error: _error, ...rest } = item;
      return { ...rest, ...patch } as ProposedExternalWrite;
    }),
  }));
}

function persistProposalItemBestEffort(item: ProposedExternalWrite): void {
  void externalWriteSaveProposal(itemToPayload(item)).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    setItem(item.id, { status: 'failed', error: `Could not save this external write proposal: ${message}` });
  });
}

function deleteProposalBestEffort(id: string): void {
  void externalWriteDeleteProposal(id).catch((error: unknown) => {
    console.warn('[externalWriteQueueStore] Could not delete external write proposal:', error);
  });
}

function statusFromError(message: string): ExternalWriteStatus {
  if (message.includes('Delivery unconfirmed') || message.includes('verification pending')) return 'verify_pending';
  if (message.includes('changed since proposal') || message.includes('current hash')) return 'stale';
  return 'failed';
}

async function sendOne(item: ProposedExternalWrite): Promise<void> {
  const requestedAt = item.requestedAt ?? newRequestedAt();
  const sendingItem = { ...item, status: 'sending' as const, requestedAt };
  setItemClearingError(item.id, { status: 'sending', requestedAt });
  try {
    await externalWriteSaveProposal(itemToPayload(sendingItem));
    await externalWritePrepareProposal({
      proposalId: item.id,
      subjectKey: itemSubjectKey(item),
      requestedAt,
    });
    const receipt = await externalWriteApproveProposal(item.id);
    const sentItem = {
      ...sendingItem,
      status: 'sent' as const,
      remoteId: receipt.remoteId,
      receiptRef: receipt.receiptRef,
      receipt,
    };
    setItem(item.id, sentItem);
    // eslint-disable-next-line lantern-async/no-silent-failure -- the queue already shows sent; this only mirrors the receipt to durable proposal storage.
    void externalWriteSaveProposal(itemToPayload(sentItem)).catch(() => undefined);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    const failedItem = { ...sendingItem, status: statusFromError(message), error: message };
    setItem(item.id, failedItem);
    persistProposalItemBestEffort(failedItem);
  }
}

export const useExternalWriteQueueStore = create<ExternalWriteQueueState>()((set, get) => ({
  items: [],

  enqueueRightCapitalIncome: (proposal) => {
    const item: ProposedExternalWrite = {
      id: newId(),
      proposalType: 'rightcapital_income',
      status: 'proposed',
      data: proposal,
    };
    set((state) => ({ items: [...state.items, item] }));
    persistProposalItemBestEffort(item);
    return item.id;
  },

  enqueueHolistiplanUpload: (proposal) => {
    const item: ProposedExternalWrite = {
      id: newId(),
      proposalType: 'holistiplan_upload',
      status: 'proposed',
      data: proposal,
    };
    set((state) => ({ items: [...state.items, item] }));
    persistProposalItemBestEffort(item);
    return item.id;
  },

  hydrateFromBackend: async () => {
    const records = await externalWriteListProposals();
    set({ items: records.map(recordToItem).filter((item): item is ProposedExternalWrite => item !== null) });
  },

  approve: async (ids) => {
    for (const id of ids) {
      const item = get().items.find((candidate) => candidate.id === id);
      if (!item) continue;
      await sendOne(item);
    }
  },

  dismiss: (id) => {
    set((state) => ({ items: state.items.filter((item) => item.id !== id) }));
    deleteProposalBestEffort(id);
  },

  updateRightCapitalIncomeFinal: (id, patch) => {
    const item = get().items.find((candidate) => candidate.id === id);
    if (!item || item.proposalType !== 'rightcapital_income') return;
    const updated: ProposedExternalWrite = {
      ...item,
      data: {
        ...item.data,
        final: { ...item.data.final, ...patch },
      },
    };
    set((state) => ({ items: state.items.map((candidate) => (candidate.id === id ? updated : candidate)) }));
    persistProposalItemBestEffort(updated);
  },
}));
