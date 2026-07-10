import { AuditService } from '@/platform/audit/AuditService';
import { maskAccountNumber } from './format';
import type { AcatsTransferDraft } from './types';

const acatsAudit = new AuditService('acats');

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

export async function auditAcatsDraftApproval(draft: AcatsTransferDraft): Promise<void> {
  await acatsAudit.mustLogDurable(
    'acats.approve',
    `Approved ACATS draft for matter ${draft.matterId}: delivering firm ${deliveringFirmName(draft)}, account ${maskedDeliveringAccountNumber(draft)}.`,
    {
      userDecision: 'approved',
      metadata: {
        ...buildAcatsApprovalAuditMetadata(draft),
        reviewStatus: 'approved',
      },
    },
  );
}

export async function auditSchwabPrepPacketExport(
  draft: AcatsTransferDraft,
  destinationFileName: string,
): Promise<void> {
  await acatsAudit.mustLogDurable(
    'acats.export',
    `Exported Schwab Prep Packet for matter ${draft.matterId}: delivering firm ${deliveringFirmName(draft)}, account ${maskedDeliveringAccountNumber(draft)}, file ${destinationFileName}.`,
    {
      userDecision: 'approved',
      metadata: {
        ...buildAcatsApprovalAuditMetadata(draft),
        destinationFileName,
      },
      outputs: {
        destinationFileName,
      },
    },
  );
}
