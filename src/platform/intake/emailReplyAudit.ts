import type { AuditEntry } from '@/platform/types/audit';

import type { EmailReplyProposalRecord } from './emailReplyProposalStore';

export type EmailReplyAuditEmitter = (
  entry: Omit<AuditEntry, 'id' | 'timestamp'>
) => Promise<void>;

let activeEmailReplyAuditEmitter: EmailReplyAuditEmitter | null = null;

export function setIntakeEmailReplyAuditEmitter(
  emitter: EmailReplyAuditEmitter | null
): void {
  activeEmailReplyAuditEmitter = emitter;
}

export function logIntakeEmailReplyAudit(
  entry: Omit<AuditEntry, 'id' | 'timestamp'>
): Promise<void> | undefined {
  if (!activeEmailReplyAuditEmitter) return undefined;
  return activeEmailReplyAuditEmitter(entry);
}

export async function mustLogIntakeEmailReplyAudit(
  entry: Omit<AuditEntry, 'id' | 'timestamp'>
): Promise<void> {
  if (!activeEmailReplyAuditEmitter) {
    throw new Error('Email reply audit is not available.');
  }
  await activeEmailReplyAuditEmitter({
    ...entry,
    metadata: {
      ...entry.metadata,
      auditMustPersist: true,
    },
  });
}

export function emailReplyAuditPairId(proposalId: string): string {
  return `intake_email_reply:${proposalId}:${Date.now().toString(36)}`;
}

export function buildEmailReplyAuditEntry(input: {
  proposal: Pick<
    EmailReplyProposalRecord,
    | 'proposalId'
    | 'messageId'
    | 'provider'
    | 'account'
    | 'matchedMatterId'
    | 'matchedRequestId'
  >;
  phase: 'intent' | 'outcome';
  operation?: 'accept' | 'dismiss';
  auditPairId: string;
  advisorId: string;
  itemIds: string[];
  status: 'intent' | 'accepted' | 'partial' | 'failed' | 'refused' | 'dismissed';
  filePaths?: string[];
  factIds?: string[];
  error?: string;
}): Omit<AuditEntry, 'id' | 'timestamp'> {
  return {
    action: 'intake_email_reply',
    description:
      input.operation === 'dismiss' && input.phase === 'intent'
        ? 'Email intake reply dismissal started. Source: normal email. Channel: email reply.'
        : input.operation === 'dismiss'
          ? 'Email intake reply dismissed. Source: normal email. Channel: email reply.'
          : input.phase === 'intent'
        ? 'Email intake reply review started. Source: normal email. Channel: email reply.'
        : `Email intake reply review finished with status ${input.status}. Source: normal email. Channel: email reply.`,
    model: undefined,
    inputs: {
      matterId: input.proposal.matchedMatterId,
      requestId: input.proposal.matchedRequestId,
      itemIds: input.itemIds,
      provider: input.proposal.provider,
      account: input.proposal.account,
      messageId: input.proposal.messageId,
      channel: 'email_reply',
    },
    outputs: {
      status: input.status,
      filePaths: input.filePaths ?? [],
      factIds: input.factIds ?? [],
      ...(input.error ? { error: input.error } : {}),
    },
    userDecision:
      input.phase === 'intent'
        ? input.operation === 'dismiss'
          ? 'rejected'
          : 'approved'
        : 'auto',
    metadata: {
      auditEventType: 'intake_email_reply',
      phase: input.phase,
      auditPairId: input.auditPairId,
      proposalId: input.proposal.proposalId,
      advisorId: input.advisorId,
      channel: 'email_reply',
      operation: input.operation ?? 'accept',
      e2ee: false,
    },
  };
}
