import { invoke, isTauri } from '@tauri-apps/api/core';

import { maskFactValue } from './factsStore';
import type { FactKind, FactValue, Sensitivity } from './types';
import type { IntakeDocumentSourceRef } from './documentExtractionTypes';

export type DocumentExtractionConfidence = 'high' | 'medium' | 'low';
export type DocumentExtractionProposalStatus = 'pending' | 'accepted' | 'dismissed';

export interface DocumentExtractionProposalItem {
  id: string;
  itemId?: string;
  subject: string;
  kind: Extract<FactKind, 'income_annual' | 'spending_monthly'>;
  value?: FactValue;
  displayValue: string;
  sensitivity: Sensitivity;
  source: IntakeDocumentSourceRef;
  confidence: DocumentExtractionConfidence;
  reason: string;
  checkedByDefault: boolean;
}

export interface DocumentExtractionProposalInput {
  proposalId: string;
  stableKey: string;
  matterId: string;
  requestId: string;
  intakeId: string;
  itemId?: string;
  sourcePath: string;
  items: DocumentExtractionProposalItem[];
}

export interface DocumentExtractionProposalRowCompletion {
  rowId: string;
  factId: string;
  completedAt?: string;
}

export interface DocumentExtractionProposalRecord extends DocumentExtractionProposalInput {
  status: DocumentExtractionProposalStatus;
  completedRows: DocumentExtractionProposalRowCompletion[];
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

const proposals = new Map<string, DocumentExtractionProposalRecord>();

function nowIso(): string { return new Date().toISOString(); }

export function stableDocumentExtractionProposalId(input: {
  matterId: string; requestId: string; intakeId: string; sourcePath: string;
}): string {
  const key = `${input.matterId}\u001f${input.requestId}\u001f${input.intakeId}\u001f${input.sourcePath}`;
  let hash = 2166136261;
  for (let index = 0; index < key.length; index += 1) {
    hash ^= key.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `document_extraction_proposal_${(hash >>> 0).toString(36)}`;
}

export function documentExtractionStableKey(input: {
  matterId: string; requestId: string; intakeId: string; sourcePath: string;
}): string {
  return `${input.matterId}\u001f${input.requestId}\u001f${input.intakeId}\u001f${input.sourcePath}`;
}

export function isDocumentExtractionProposalItemSelectable(item: DocumentExtractionProposalItem): boolean {
  return Boolean(item.value) && (item.kind === 'income_annual' || item.kind === 'spending_monthly');
}

/** List views never receive a raw value or source quote. The review command is the only reveal path. */
export function maskDocumentExtractionProposalItem(item: DocumentExtractionProposalItem): DocumentExtractionProposalItem {
  const { value: rawValue, source, ...rest } = item;
  return {
    ...rest,
    displayValue: rawValue ? maskFactValue(item.kind, rawValue, item.sensitivity) : item.displayValue,
    source: { ...source, snippet: '' },
  };
}

function masked(record: DocumentExtractionProposalRecord): DocumentExtractionProposalRecord {
  return { ...record, items: record.items.map(maskDocumentExtractionProposalItem) };
}

export async function documentExtractionProposalSave(input: DocumentExtractionProposalInput): Promise<DocumentExtractionProposalRecord> {
  if (isTauri()) return invoke<DocumentExtractionProposalRecord>('intake_document_extraction_save_proposal', { input });
  const existing = Array.from(proposals.values()).find((record) => record.stableKey === input.stableKey);
  if (existing) return masked(existing);
  const at = nowIso();
  const record: DocumentExtractionProposalRecord = { ...input, status: 'pending', completedRows: [], createdAt: at, updatedAt: at };
  proposals.set(record.proposalId, record);
  return masked(record);
}

export async function documentExtractionProposalList(matterId?: string): Promise<DocumentExtractionProposalRecord[]> {
  if (isTauri()) return invoke<DocumentExtractionProposalRecord[]>('intake_document_extraction_list_proposals', { matterId: matterId ?? null });
  return Array.from(proposals.values()).filter((record) => record.status === 'pending').filter((record) => !matterId || record.matterId === matterId).map(masked);
}

/** This is deliberately unmasked: it is called only after the advisor opens a review panel. */
export async function documentExtractionProposalGetForAccept(proposalId: string): Promise<DocumentExtractionProposalRecord> {
  if (isTauri()) return invoke<DocumentExtractionProposalRecord>('intake_document_extraction_get_proposal', { proposalId });
  const record = proposals.get(proposalId);
  if (!record) throw new Error('Document extraction proposal not found.');
  return record;
}

export async function documentExtractionProposalSetStatus(proposalId: string, status: DocumentExtractionProposalStatus, error?: string): Promise<DocumentExtractionProposalRecord> {
  if (isTauri()) return invoke<DocumentExtractionProposalRecord>('intake_document_extraction_set_proposal_status', { proposalId, status, error: error ?? null });
  const record = proposals.get(proposalId);
  if (!record) throw new Error('Document extraction proposal not found.');
  const next = { ...record, status, error: error ?? null, updatedAt: nowIso() };
  proposals.set(proposalId, next);
  return masked(next);
}

export async function documentExtractionProposalMarkRowCompleted(input: { proposalId: string; completion: DocumentExtractionProposalRowCompletion }): Promise<DocumentExtractionProposalRecord> {
  if (isTauri()) return invoke<DocumentExtractionProposalRecord>('intake_document_extraction_mark_row_completed', input);
  const record = proposals.get(input.proposalId);
  if (!record) throw new Error('Document extraction proposal not found.');
  const existing = record.completedRows.find((row) => row.rowId === input.completion.rowId);
  if (existing) {
    if (existing.factId === input.completion.factId) return masked(record);
    throw new Error('Document extraction row already has a different completion receipt.');
  }
  const next = { ...record, completedRows: [...record.completedRows, { ...input.completion, completedAt: input.completion.completedAt ?? nowIso() }], updatedAt: nowIso() };
  proposals.set(input.proposalId, next);
  return masked(next);
}

export function clearInMemoryDocumentExtractionQueuesForTests(): void { proposals.clear(); }
