import type { IntakeRecord } from '@/platform/intake/intakeStore';
import type { SignatureStatus } from '@/platform/intake/docusignSignature/signatureRecord';
import { signatureStatusLabel } from './docusignSigning/signatureStatusLabel';

function statusLabel(state: string): string {
  switch (state) {
    case 'received':
      return 'received';
    case 'accepted':
      return 'accepted';
    case 'needs_followup':
      return 'needs another look';
    case 'not_needed':
      return 'not needed';
    case 'provided':
      return 'provided';
    default:
      return 'not started';
  }
}

export function requestItemStatusLabel(
  intake: IntakeRecord,
  itemId: string,
  state: string,
  signatureStatuses?: Record<string, SignatureStatus | undefined>,
): string {
  const requestItem = intake.requestItems?.find((candidate) => candidate.item_id === itemId);
  if (requestItem?.t === 'signature') return signatureStatusLabel(signatureStatuses?.[itemId]);
  if (requestItem?.t !== 'pdf_fill') return statusLabel(state);
  if (state === 'received') return 'Form returned';
  if (state === 'needs_followup') return 'Needs follow-up';
  return 'Form ready';
}

export function requestItemDisplayLabel(intake: IntakeRecord, itemId: string, fallback: string): string {
  return intake.requestItems?.find((candidate) => candidate.item_id === itemId)?.t === 'pdf_fill'
    ? 'Form'
    : fallback;
}
