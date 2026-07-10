import { getMatterAuditEmitterAsync } from '@/platform/matter/matterStore';
import type { AuditEntry } from '@/platform/types/audit';
import { maskAccountNumber } from './format';
import type { AcatsTransferDraft } from './types';

function deliveringFirmName(draft: AcatsTransferDraft): string {
  return draft.deliveringFirm.name?.value ?? 'Unknown firm';
}

function maskedDeliveringAccountNumber(draft: AcatsTransferDraft): string {
  return maskAccountNumber(draft.deliveringAccount.accountNumber?.value);
}

export function buildAcatsApprovalAuditMetadata(draft: AcatsTransferDraft): Record<string, string | number> {
  return {
    draftId: draft.id,
    matterId: draft.matterId,
    deliveringFirm: deliveringFirmName(draft),
    deliveringAccountNumber: maskedDeliveringAccountNumber(draft),
    reviewStatus: draft.reviewStatus,
    assetCount: draft.assets.length,
  };
}

async function emitAcatsAuditEntry(entry: Omit<AuditEntry, 'id' | 'timestamp'>): Promise<void> {
  const emitAuditEntry = getMatterAuditEmitterAsync();
  if (!emitAuditEntry) {
    throw new Error('ACATS audit emitter is not registered; refusing to continue without a durable Activity Log row.');
  }
  await emitAuditEntry(entry);
}

export async function auditAcatsDraftApproval(draft: AcatsTransferDraft): Promise<void> {
  await emitAcatsAuditEntry({
    action: 'acats.approve',
    description: `Approved ACATS draft for matter ${draft.matterId}: delivering firm ${deliveringFirmName(draft)}, account ${maskedDeliveringAccountNumber(draft)}.`,
    model: undefined,
    inputs: {},
    outputs: {},
    userDecision: 'approved',
    metadata: {
      auditMustPersist: true,
      ...buildAcatsApprovalAuditMetadata(draft),
      reviewStatus: 'approved',
    },
  });
}

export async function auditSchwabPrepPacketExport(
  draft: AcatsTransferDraft,
  destinationFileName: string,
): Promise<void> {
  await emitAcatsAuditEntry({
    action: 'acats.export',
    description: `Exported Schwab Prep Packet for matter ${draft.matterId}: delivering firm ${deliveringFirmName(draft)}, account ${maskedDeliveringAccountNumber(draft)}, file ${destinationFileName}.`,
    model: undefined,
    inputs: {},
    outputs: {
      destinationFileName,
    },
    userDecision: 'approved',
    metadata: {
      auditMustPersist: true,
      ...buildAcatsApprovalAuditMetadata(draft),
      destinationFileName,
    },
  });
}
