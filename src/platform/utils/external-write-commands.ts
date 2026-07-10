import { invoke, isTauri } from '@tauri-apps/api/core';

export type ExternalWriteTarget = 'wealthbox' | 'rightcapital' | 'holistiplan';

export type ExternalWriteStatus =
  | 'proposed'
  | 'sending'
  | 'sent'
  | 'failed'
  | 'verify_pending'
  | 'stale';

export type ExternalWriteOperation =
  | {
      target: 'rightcapital';
      payload: {
        type: 'upsert_income';
        client_id: string;
        income_id?: string | null;
        income_type: string;
        owner?: string | null;
        amount: { amount: number; currency: string };
        frequency: string;
        start_date?: string | null;
        end_date?: string | null;
        notes: string;
      };
    }
  | {
      target: 'holistiplan';
      payload:
        | { type: 'ensure_household'; household_id?: string | null; display_name: string }
        | { type: 'ensure_client'; household_id: string; client_id?: string | null; display_name: string }
        | { type: 'upload_tax_document'; document_ref: string; tax_year: number; document_kind: string }
        | { type: 'import_report'; report_id: string; destination_ref: string };
    }
  | {
      target: 'wealthbox';
      payload: Record<string, unknown>;
    };

export interface ExternalWriteProposalPayload {
  id: string;
  target: ExternalWriteTarget;
  operation: ExternalWriteOperation;
  matterId: string;
  subjectKey?: string;
  sourceRef: string;
  requestedAt?: string;
  beforeHash?: string;
  afterHash: string;
  currentJson?: string;
  sourceJson?: string;
  finalJson?: string;
  status?: ExternalWriteStatus;
  remoteId?: string;
  receiptRef?: string;
  error?: string;
}

export interface ExternalWriteProposalRecord extends ExternalWriteProposalPayload {
  subjectKey: string;
  status: ExternalWriteStatus;
  currentJson: string;
  sourceJson: string;
  finalJson: string;
  contentHash: string;
  createdAt: string;
  updatedAt: string;
}

export interface ExternalWriteReceipt {
  target: ExternalWriteTarget;
  operation: string;
  remoteId: string;
  deduped: boolean;
  receiptRef: string;
}

function stableJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stableJson).join(',')}]`;
  if (value && typeof value === 'object') {
    const obj = value as Record<string, unknown>;
    return `{${Object.keys(obj).sort().map((key) => `${JSON.stringify(key)}:${stableJson(obj[key])}`).join(',')}}`;
  }
  if (typeof value === 'undefined') return 'null';
  return JSON.stringify(value);
}

export function hashExternalWriteValue(value: unknown): string {
  let hash = 0x811c9dc5;
  const input = stableJson(value);
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `fnv1a:${(hash >>> 0).toString(16).padStart(8, '0')}`;
}

export async function externalWriteSetWorkspace(path: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('external_write_set_workspace', { path });
}

export async function externalWriteSaveProposal(
  proposal: ExternalWriteProposalPayload,
): Promise<ExternalWriteProposalRecord | null> {
  if (!isTauri()) return null;
  return invoke<ExternalWriteProposalRecord>('external_write_save_proposal', { proposal });
}

export async function externalWritePrepareProposal(args: {
  proposalId: string;
  subjectKey: string;
  requestedAt: string;
}): Promise<ExternalWriteProposalRecord | null> {
  if (!isTauri()) return null;
  return invoke<ExternalWriteProposalRecord>('external_write_prepare_proposal', args);
}

export async function externalWriteApproveProposal(proposalId: string): Promise<ExternalWriteReceipt> {
  if (!isTauri()) throw new Error('External write-back is only available in the desktop app.');
  return invoke<ExternalWriteReceipt>('external_write_approve_proposal', { proposalId });
}

export async function externalWriteListProposals(): Promise<ExternalWriteProposalRecord[]> {
  if (!isTauri()) return [];
  return invoke<ExternalWriteProposalRecord[]>('external_write_list_proposals');
}

export async function externalWriteDeleteProposal(proposalId: string): Promise<void> {
  if (!isTauri()) return;
  await invoke('external_write_delete_proposal', { proposalId });
}
