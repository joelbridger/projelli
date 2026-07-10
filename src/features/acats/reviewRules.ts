import { fieldValue } from './format';
import type { AcatsTransferDraft } from './types';

export type AcatsConfirmedFields = Record<string, true>;
export type AcatsAcknowledgedWarnings = Record<string, true>;

export const ACATS_CRITICAL_FIELD_LABELS: Record<string, string> = {
  'deliveringFirm.name': 'delivering firm',
  'deliveringAccount.accountNumber': 'delivering account number',
  'deliveringAccount.accountTitle': 'account title',
  'deliveringAccount.registrationType': 'registration type',
  sourceStatementDate: 'statement date',
  'instruction.transferType': 'full or partial transfer',
};

export function requiredAcatsConfirmationKeys(): string[] {
  return Object.keys(ACATS_CRITICAL_FIELD_LABELS);
}

function hasCriticalValue(draft: AcatsTransferDraft, key: string): boolean {
  switch (key) {
    case 'deliveringFirm.name':
      return Boolean(draft.deliveringFirm.name?.value);
    case 'deliveringAccount.accountNumber':
      return Boolean(draft.deliveringAccount.accountNumber?.value);
    case 'deliveringAccount.accountTitle':
      return Boolean(draft.deliveringAccount.accountTitle?.value);
    case 'deliveringAccount.registrationType':
      return Boolean(
        draft.deliveringAccount.registrationType?.value &&
          draft.deliveringAccount.registrationType.value !== 'unknown',
      );
    case 'sourceStatementDate':
      return Boolean(draft.sourceStatementDate?.value);
    case 'instruction.transferType':
      return draft.instruction.transferType !== 'unknown';
    default:
      return false;
  }
}

export function getAcatsReviewBlockingItems({
  draft,
  confirmedFields,
  acknowledgedWarnings,
}: {
  draft: AcatsTransferDraft | null;
  confirmedFields: AcatsConfirmedFields;
  acknowledgedWarnings: AcatsAcknowledgedWarnings;
}): string[] {
  if (!draft) return ['Load a transfer draft'];
  const blockers: string[] = [];
  for (const key of requiredAcatsConfirmationKeys()) {
    const label = ACATS_CRITICAL_FIELD_LABELS[key] ?? key;
    if (!hasCriticalValue(draft, key)) {
      blockers.push(`Fill ${label}`);
      continue;
    }
    if (!confirmedFields[key]) blockers.push(`Confirm ${label}`);
  }
  if (draft.instruction.transferType === 'partial') {
    draft.assets.forEach((asset, index) => {
      const assetIndex = String(index);
      const name = fieldValue(asset.description) || `asset ${String(index + 1)}`;
      if (asset.action === 'unknown') blockers.push(`Choose transfer action for ${name}`);
      if (!confirmedFields[`assets.${assetIndex}.action`]) {
        blockers.push(`Confirm transfer action for ${name}`);
      }
    });
  }
  for (const warning of draft.warnings) {
    if (!acknowledgedWarnings[warning]) blockers.push(`Acknowledge warning: ${warning}`);
  }
  return blockers;
}

export function isAcatsDraftReadyForApproval(args: {
  draft: AcatsTransferDraft | null;
  confirmedFields: AcatsConfirmedFields;
  acknowledgedWarnings: AcatsAcknowledgedWarnings;
}): boolean {
  return getAcatsReviewBlockingItems(args).length === 0;
}
