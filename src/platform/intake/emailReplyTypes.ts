import type {
  MailAttachmentRef,
  MailAuthResult,
  MailAuthSource,
  MailAuthVerdict,
} from '@/platform/utils/mail-commands';

export type {
  MailAttachmentRef,
  MailAuthResult,
  MailAuthSource,
  MailAuthVerdict,
};

export type EmailReplyQuarantineReason =
  | 'auth_failed'
  | 'lookalike'
  | 'ambiguous_sender'
  | 'ambiguous_request'
  | 'inactive_request'
  | 'accepted_item_update'
  | 'attachment_metadata_missing';

export interface EmailReplyMessageRef {
  messageId: string;
  provider: string;
  account: string;
  received: string | null;
  sender: string;
  authResult: MailAuthResult;
  threadId: string | null;
}

export interface EmailReplyCandidate extends EmailReplyMessageRef {
  kind: 'candidate';
  matchedMatterId: string;
  matchedRequestId: string;
  targetOpenItemIds: string[];
  confidenceEligible: boolean;
  attachments: MailAttachmentRef[];
}

export interface EmailReplyQuarantine extends EmailReplyMessageRef {
  kind: 'quarantine';
  reason: EmailReplyQuarantineReason;
  matchedMatterId?: string;
  matchedRequestId?: string;
}

export interface EmailReplyIgnore {
  kind: 'ignore';
}

export type EmailReplyMatchResult =
  | EmailReplyCandidate
  | EmailReplyQuarantine
  | EmailReplyIgnore;

export interface EmailReplyMailInput {
  id: string;
  provider?: string | null;
  account?: string | null;
  date?: string | null;
  receivedDateTime?: string | null;
  from?: string | null;
  fromAddr?: string | null;
  authResult?: MailAuthResult | null;
  threadId?: string | null;
  hasAttachments?: boolean;
  attachmentsUnsupported?: boolean;
  attachments?: MailAttachmentRef[];
}

export const MISSING_MAIL_AUTH_RESULT: MailAuthResult = {
  dkim: 'none',
  spf: 'none',
  dmarc: 'none',
  aligned: false,
  source: 'missing',
};
