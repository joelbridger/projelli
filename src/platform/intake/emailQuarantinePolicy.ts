import type { EmailReplyQuarantineReason } from './emailReplyTypes';

export interface EmailQuarantinePolicy {
  reasonText: string;
  requiredAction: string;
  /** Informational rows can be cleared after an explicit advisor dismissal. */
  dismissible: boolean;
  /** A filing can never infer these values from an email or a model result. */
  requiresExplicitTarget: true;
  allowsFastPath: false;
  hasPreselectedRows: false;
  confidenceTier: null;
}

const POLICY: Record<EmailReplyQuarantineReason, EmailQuarantinePolicy> = {
  auth_failed: {
    reasonText: 'This email did not prove it came from the client.',
    requiredAction: 'Open the message, verify it with the client, then choose the client, request, and open item yourself.',
    dismissible: false,
    requiresExplicitTarget: true,
    allowsFastPath: false,
    hasPreselectedRows: false,
    confidenceTier: null,
  },
  lookalike: {
    reasonText: "The sender address is not on this client's record. It may be a different person or a typo.",
    requiredAction: 'Open the message and choose the client, request, and open item yourself before filing anything.',
    dismissible: false,
    requiresExplicitTarget: true,
    allowsFastPath: false,
    hasPreselectedRows: false,
    confidenceTier: null,
  },
  ambiguous_sender: {
    reasonText: 'This sender could belong to more than one client.',
    requiredAction: 'Verify the sender, then choose one client, request, and open item yourself.',
    dismissible: false,
    requiresExplicitTarget: true,
    allowsFastPath: false,
    hasPreselectedRows: false,
    confidenceTier: null,
  },
  ambiguous_request: {
    reasonText: 'This email does not clearly belong to one onboarding request.',
    requiredAction: 'Open the message and choose the correct client, request, and open item yourself.',
    dismissible: false,
    requiresExplicitTarget: true,
    allowsFastPath: false,
    hasPreselectedRows: false,
    confidenceTier: null,
  },
  inactive_request: {
    reasonText: 'This email is tied to an inactive onboarding request.',
    requiredAction: 'Open the message and choose an active request and open item yourself, or dismiss it as not intake material.',
    dismissible: true,
    requiresExplicitTarget: true,
    allowsFastPath: false,
    hasPreselectedRows: false,
    confidenceTier: null,
  },
  accepted_item_update: {
    reasonText: 'This email may update an item that was already accepted.',
    requiredAction: 'Open the message and choose an open replacement item yourself, or dismiss it as not intake material.',
    dismissible: true,
    requiresExplicitTarget: true,
    allowsFastPath: false,
    hasPreselectedRows: false,
    confidenceTier: null,
  },
  attachment_metadata_missing: {
    reasonText: 'This email does not include enough attachment information to file safely.',
    requiredAction: 'Open the message, verify an attachment is available, then choose the client, request, and open item yourself.',
    dismissible: true,
    requiresExplicitTarget: true,
    allowsFastPath: false,
    hasPreselectedRows: false,
    confidenceTier: null,
  },
};

// W3-LANE3-MANUAL-ONLY
export function emailQuarantinePolicy(
  reason: EmailReplyQuarantineReason
): EmailQuarantinePolicy {
  return POLICY[reason];
}
