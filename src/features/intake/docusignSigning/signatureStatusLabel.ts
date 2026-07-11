import type { SignatureStatus } from '@/platform/intake/docusignSignature/signatureRecord';

export function signatureStatusLabel(status: SignatureStatus | undefined): string {
  switch (status) {
    case 'ready_to_send':
    case 'not_ready':
      return 'Ready to send';
    case 'envelope_created':
    case 'signing_opened':
      return 'Awaiting signature';
    case 'completion_pending':
      return 'Confirming signed form';
    case 'signed':
      return 'Signed';
    case 'declined':
      return 'Declined';
    case 'voided':
    case 'needs_followup':
      return 'Needs follow-up';
    default:
      return 'Ready to send';
  }
}
