import { describe, expect, it } from 'vitest';
import { signatureStatusLabel } from './SendForSignatureDialog';

describe('signature status copy', () => {
  it.each([
    ['ready_to_send', 'Ready to send'], ['envelope_created', 'Awaiting signature'], ['signing_opened', 'Awaiting signature'], ['completion_pending', 'Confirming signed form'], ['signed', 'Signed'], ['declined', 'Declined'], ['voided', 'Needs follow-up'], ['needs_followup', 'Needs follow-up'],
  ] as const)('shows %s plainly', (status, label) => { expect(signatureStatusLabel(status)).toBe(label); });
});
