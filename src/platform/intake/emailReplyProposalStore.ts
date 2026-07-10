import { invoke, isTauri } from '@tauri-apps/api/core';

import type { MailAttachmentRef, MailAuthResult } from './emailReplyTypes';
import { maskFactValue } from './factsStore';
import type { FactKind, FactValue, Sensitivity } from './types';

export type EmailReplyConfidence = 'high' | 'medium' | 'low';
export type EmailReplyProposalStatus = 'pending' | 'accepted' | 'dismissed';
export type EmailReplyQuarantineStatus = 'pending' | 'dismissed' | 'manual_filed';

export interface EmailReplyBodyFactProposal {
  subject: string;
  kind: FactKind;
  sensitivity: Sensitivity;
  displayValue: string;
  value?: FactValue;
}

export interface EmailReplyProposalItem {
  id: string;
  kind: 'attachment' | 'body_fact';
  itemId: string;
  label: string;
  confidence: EmailReplyConfidence;
  reasoning?: string;
  checkedByDefault: boolean;
  attachment?: MailAttachmentRef;
  bodyFact?: EmailReplyBodyFactProposal;
}

export interface EmailReplyProposalInput {
  proposalId: string;
  messageId: string;
  provider: string;
  account: string;
  received: string | null;
  sender: string;
  authResult: MailAuthResult;
  threadId: string | null;
  matchedMatterId: string;
  matchedRequestId: string;
  targetOpenItemIds: string[];
  attachmentRefs: MailAttachmentRef[];
  items: EmailReplyProposalItem[];
  confidence: EmailReplyConfidence;
}

export interface EmailReplyProposalRecord extends EmailReplyProposalInput {
  status: EmailReplyProposalStatus;
  error?: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface EmailReplyQuarantineInput {
  quarantineId: string;
  messageId: string;
  provider: string;
  account: string;
  received: string | null;
  sender: string;
  authResult: MailAuthResult;
  threadId: string | null;
  reason: string;
  matchedMatterId?: string;
  matchedRequestId?: string;
}

export interface EmailReplyQuarantineRecord extends EmailReplyQuarantineInput {
  status: EmailReplyQuarantineStatus;
  createdAt: string;
  updatedAt: string;
}

const proposals = new Map<string, EmailReplyProposalRecord>();
const quarantines = new Map<string, EmailReplyQuarantineRecord>();

function nowIso(): string {
  return new Date().toISOString();
}

function messageKey(provider: string, account: string, messageId: string): string {
  return `${provider}\u001f${account}\u001f${messageId}`;
}

export function stableEmailReplyId(prefix: 'proposal' | 'quarantine', input: {
  provider: string;
  account: string;
  messageId: string;
}): string {
  const key = messageKey(input.provider, input.account, input.messageId);
  let hash = 2166136261;
  for (let i = 0; i < key.length; i += 1) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `email_reply_${prefix}_${(hash >>> 0).toString(36)}`;
}

function stripBodyFields(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(stripBodyFields);
  if (!value || typeof value !== 'object') return value;
  const out: Record<string, unknown> = {};
  for (const [key, child] of Object.entries(value)) {
    if (
      key === 'body' ||
      key === 'bodyText' ||
      key === 'emailBody' ||
      key === 'rawBody' ||
      key === 'snippet'
    ) {
      continue;
    }
    out[key] = stripBodyFields(child);
  }
  return out;
}

export function maskEmailReplyProposalItem(
  item: EmailReplyProposalItem
): EmailReplyProposalItem {
  const clean = stripBodyFields(item) as EmailReplyProposalItem;
  if (!clean.bodyFact) return clean;
  const { value: _value, ...bodyFact } = clean.bodyFact;
  return {
    ...clean,
    bodyFact: {
      ...bodyFact,
      displayValue:
        bodyFact.displayValue ||
        (clean.bodyFact.value
          ? maskFactValue(bodyFact.kind, clean.bodyFact.value, bodyFact.sensitivity)
          : ''),
    },
  };
}

function maskProposal(record: EmailReplyProposalRecord): EmailReplyProposalRecord {
  return {
    ...record,
    items: record.items.map(maskEmailReplyProposalItem),
  };
}

function hasProcessedMessage(provider: string, account: string, messageId: string): boolean {
  const key = messageKey(provider, account, messageId);
  return (
    Array.from(proposals.values()).some(
      (proposal) =>
        messageKey(proposal.provider, proposal.account, proposal.messageId) === key
    ) ||
    Array.from(quarantines.values()).some(
      (quarantine) =>
        messageKey(quarantine.provider, quarantine.account, quarantine.messageId) === key
    )
  );
}

export async function emailReplyProposalSave(
  input: EmailReplyProposalInput
): Promise<EmailReplyProposalRecord | null> {
  if (isTauri()) {
    return invoke<EmailReplyProposalRecord | null>(
      'intake_email_reply_save_proposal',
      { input }
    );
  }
  if (hasProcessedMessage(input.provider, input.account, input.messageId)) {
    const existing = Array.from(proposals.values()).find(
      (proposal) =>
        messageKey(proposal.provider, proposal.account, proposal.messageId) ===
        messageKey(input.provider, input.account, input.messageId)
    );
    return existing ? maskProposal(existing) : null;
  }
  const at = nowIso();
  const record: EmailReplyProposalRecord = {
    ...input,
    items: stripBodyFields(input.items) as EmailReplyProposalItem[],
    status: 'pending',
    createdAt: at,
    updatedAt: at,
  };
  proposals.set(record.proposalId, record);
  return maskProposal(record);
}

export async function emailReplyQuarantineSave(
  input: EmailReplyQuarantineInput
): Promise<EmailReplyQuarantineRecord | null> {
  if (isTauri()) {
    return invoke<EmailReplyQuarantineRecord | null>(
      'intake_email_reply_save_quarantine',
      { input }
    );
  }
  if (hasProcessedMessage(input.provider, input.account, input.messageId)) {
    return (
      Array.from(quarantines.values()).find(
        (quarantine) =>
          messageKey(quarantine.provider, quarantine.account, quarantine.messageId) ===
          messageKey(input.provider, input.account, input.messageId)
      ) ?? null
    );
  }
  const at = nowIso();
  const record: EmailReplyQuarantineRecord = {
    ...input,
    status: 'pending',
    createdAt: at,
    updatedAt: at,
  };
  quarantines.set(record.quarantineId, record);
  return record;
}

export async function emailReplyProposalList(
  matterId?: string
): Promise<EmailReplyProposalRecord[]> {
  if (isTauri()) {
    return invoke<EmailReplyProposalRecord[]>(
      'intake_email_reply_list_proposals',
      { matterId: matterId ?? null }
    );
  }
  return Array.from(proposals.values())
    .filter((proposal) => proposal.status === 'pending')
    .filter((proposal) => !matterId || proposal.matchedMatterId === matterId)
    .map(maskProposal);
}

export async function emailReplyProposalGetForAccept(
  proposalId: string
): Promise<EmailReplyProposalRecord> {
  if (isTauri()) {
    return invoke<EmailReplyProposalRecord>('intake_email_reply_get_proposal', {
      proposalId,
    });
  }
  const proposal = proposals.get(proposalId);
  if (!proposal) throw new Error('Email reply proposal not found.');
  return proposal;
}

export async function emailReplyProposalSetStatus(
  proposalId: string,
  status: EmailReplyProposalStatus,
  error?: string
): Promise<EmailReplyProposalRecord> {
  if (isTauri()) {
    return invoke<EmailReplyProposalRecord>(
      'intake_email_reply_set_proposal_status',
      { proposalId, status, error: error ?? null }
    );
  }
  const proposal = proposals.get(proposalId);
  if (!proposal) throw new Error('Email reply proposal not found.');
  const next: EmailReplyProposalRecord = {
    ...proposal,
    status,
    ...(error ? { error } : { error: null }),
    updatedAt: nowIso(),
  };
  proposals.set(proposalId, next);
  return maskProposal(next);
}

export async function emailReplyQuarantineList(
  matterId?: string
): Promise<EmailReplyQuarantineRecord[]> {
  if (isTauri()) {
    return invoke<EmailReplyQuarantineRecord[]>(
      'intake_email_reply_list_quarantines',
      { matterId: matterId ?? null }
    );
  }
  return Array.from(quarantines.values())
    .filter((quarantine) => quarantine.status === 'pending')
    .filter((quarantine) => !matterId || quarantine.matchedMatterId === matterId);
}

export function clearInMemoryEmailReplyQueuesForTests(): void {
  proposals.clear();
  quarantines.clear();
}
