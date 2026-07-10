import { describe, expect, it } from 'vitest';

import { emailQuarantinePolicy } from './emailQuarantinePolicy';
import type { EmailReplyQuarantineReason } from './emailReplyTypes';

const reasons: EmailReplyQuarantineReason[] = [
  'auth_failed', 'lookalike', 'ambiguous_sender', 'ambiguous_request',
  'inactive_request', 'accepted_item_update', 'attachment_metadata_missing',
];

describe('emailQuarantinePolicy', () => {
  it.each(reasons)('gives %s a plain warning and a manual action', (reason) => {
    const policy = emailQuarantinePolicy(reason);
    expect(policy.reasonText).not.toHaveLength(0);
    expect(policy.requiredAction).toContain('yourself');
    expect(policy.requiresExplicitTarget).toBe(true);
    expect(policy.allowsFastPath).toBe(false);
    expect(policy.hasPreselectedRows).toBe(false);
    expect(policy.confidenceTier).toBeNull();
  });

  it.each(['auth_failed', 'lookalike', 'ambiguous_sender', 'ambiguous_request'] as const)(
    '%s cannot disappear as an informational dismissal',
    (reason) => {
      expect(emailQuarantinePolicy(reason).dismissible).toBe(false);
    }
  );
});
