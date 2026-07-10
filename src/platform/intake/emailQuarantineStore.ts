import {
  emailReplyQuarantineGet,
  emailReplyQuarantineList,
  emailReplyQuarantineSetStatus,
  type EmailReplyQuarantineRecord,
  type EmailReplyQuarantineStatus,
} from './emailReplyProposalStore';

/** Thin, masked view over Lane 2's encrypted email-reply quarantine queue. */
export type EmailReplyQuarantine = EmailReplyQuarantineRecord;
export type EmailQuarantineStatus = EmailReplyQuarantineStatus;

export const listEmailQuarantines = emailReplyQuarantineList;
export const getEmailQuarantine = emailReplyQuarantineGet;
export const setEmailQuarantineStatus = emailReplyQuarantineSetStatus;
