import { mailPersistAttachment } from '@/platform/utils/mail-commands';

import {
  buildEmailReplyAuditEntry,
  emailReplyAuditPairId,
  mustLogIntakeEmailReplyAudit,
} from './emailReplyAudit';
import {
  emailReplyProposalGetForAccept,
  emailReplyProposalMarkRowCompleted,
  emailReplyProposalSetStatus,
  isEmailReplyProposalItemSelectable,
  type EmailReplyProposalItem,
  type EmailReplyProposalRecord,
} from './emailReplyProposalStore';
import {
  intakeFactUpsert,
  type IntakeFactUpsertInput,
  type MaskedClientFact,
} from './factsStore';
import {
  useIntakeStore,
  type IntakeChecklistState,
  type IntakeRecord,
} from './intakeStore';
import { assertRequestSlug } from './requestIdentity';

export interface EmailReplyAcceptResult {
  status: 'accepted' | 'partial' | 'failed';
  filePaths: string[];
  factIds: string[];
  errors: string[];
}

export interface AcceptEmailReplyProposalOptions {
  proposalId: string;
  selectedRowIds: string[];
  approvedRestrictedRowIds?: string[];
  advisorId: string;
  now?: Date;
  getProposal?: (proposalId: string) => Promise<EmailReplyProposalRecord>;
  persistAttachment?: typeof mailPersistAttachment;
  upsertFact?: (input: IntakeFactUpsertInput) => Promise<MaskedClientFact>;
  setProposalStatus?: typeof emailReplyProposalSetStatus;
  markRowCompleted?: typeof emailReplyProposalMarkRowCompleted;
}

export interface DismissEmailReplyProposalOptions {
  proposalId: string;
  advisorId: string;
  getProposal?: (proposalId: string) => Promise<EmailReplyProposalRecord>;
  setProposalStatus?: typeof emailReplyProposalSetStatus;
}

function fallbackHash(value: string): string {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i += 1) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(36);
}

export function safeEmailReplyMessageSegment(messageId: string): string {
  const safe = messageId
    .trim()
    .replace(/[^a-zA-Z0-9._-]+/gu, '_')
    .replace(/^[. ]+|[. ]+$/gu, '')
    .slice(0, 80);
  return safe || `message_${fallbackHash(messageId)}`;
}

export function emailReplyAttachmentDestination(requestSlug: string, messageId: string): string {
  return `Requests/${assertRequestSlug(requestSlug)}/email-replies/${safeEmailReplyMessageSegment(messageId)}`;
}

function currentChecklistItem(
  intake: IntakeRecord,
  itemId: string
): IntakeChecklistState {
  return (
    intake.items.find((item) => item.itemId === itemId) ?? {
      itemId,
      label: itemId,
      state: 'not_started',
    }
  );
}

function markEmailReplyAccepted(input: {
  proposal: EmailReplyProposalRecord;
  row: EmailReplyProposalItem;
  filePath?: string;
  factId?: string;
  at: string;
  advisorId: string;
}): void {
  const store = useIntakeStore.getState();
  const intake = store.intakesById[input.proposal.matchedRequestId];
  if (!intake) return;
  const item = currentChecklistItem(intake, input.row.itemId);
  const provenance = {
    channel: 'email_reply' as const,
    label: 'From email reply. Confirmed by you.',
    at: input.at,
    enteredBy: input.advisorId,
  };
  store.updateItem(intake.intakeId, {
    ...item,
    state: 'accepted',
    provenance,
    ...(input.filePath ? { filePath: input.filePath } : {}),
    ...(input.factId ? { factId: input.factId } : {}),
  });
  store.addReceivedItem(intake.intakeId, {
    itemId: item.itemId,
    label: item.label,
    receivedAt: input.at,
    provenance,
    ...(input.filePath ? { filePath: input.filePath } : {}),
    ...(input.factId ? { factId: input.factId } : {}),
  });
  store.setLastClientActivity(intake.intakeId, input.at);
}

function selectedRows(
  proposal: EmailReplyProposalRecord,
  selectedRowIds: string[]
): EmailReplyProposalItem[] {
  const selected = new Set(selectedRowIds);
  const completed = new Set(proposal.completedRows.map((row) => row.rowId));
  return proposal.items.filter(
    (item) =>
      selected.has(item.id) &&
      !completed.has(item.id) &&
      isEmailReplyProposalItemSelectable(item)
  );
}

function statusFor(errors: string[], successes: number): EmailReplyAcceptResult['status'] {
  if (errors.length === 0) return 'accepted';
  if (successes > 0) return 'partial';
  return 'failed';
}

function factInputForRow(input: {
  proposal: EmailReplyProposalRecord;
  row: EmailReplyProposalItem;
  advisorId: string;
  at: string;
}): IntakeFactUpsertInput {
  if (!input.row.bodyFact?.value) {
    throw new Error('This email fact cannot be saved safely.');
  }
  return {
    matter_id: input.proposal.matchedMatterId,
    subject: input.row.bodyFact.subject || 'primary',
    kind: input.row.bodyFact.kind,
    value: input.row.bodyFact.value,
    sensitivity: input.row.bodyFact.sensitivity,
    provenance: {
      channel: 'email_reply',
      source_ref: `email:${input.proposal.provider}:${input.proposal.account}:${input.proposal.messageId}`,
      entered_by: 'client',
      confirmed_by: input.advisorId,
      at: input.at,
    },
    verification: 'advisor_confirmed',
  };
}

export async function acceptEmailReplyProposal(
  options: AcceptEmailReplyProposalOptions
): Promise<EmailReplyAcceptResult> {
  const proposal = await (options.getProposal ?? emailReplyProposalGetForAccept)(
    options.proposalId
  );
  const rows = selectedRows(proposal, options.selectedRowIds);
  if (rows.length === 0) {
    throw new Error('Choose at least one email reply item to accept.');
  }

  const at = (options.now ?? new Date()).toISOString();
  const auditPairId = emailReplyAuditPairId(proposal.proposalId);
  const itemIds = rows.map((row) => row.itemId);

  // W3-LANE2-FIX-AUDIT-BLOCKS
  await mustLogIntakeEmailReplyAudit(
    buildEmailReplyAuditEntry({
      proposal,
      phase: 'intent',
      auditPairId,
      advisorId: options.advisorId,
      itemIds,
      status: 'intent',
    })
  );

  const filePaths: string[] = [];
  const factIds: string[] = [];
  const errors: string[] = [];
  const approvedRestricted = new Set(options.approvedRestrictedRowIds ?? []);
  const persistAttachment = options.persistAttachment ?? mailPersistAttachment;
  const upsertFact = options.upsertFact ?? intakeFactUpsert;
  const markRowCompleted =
    options.markRowCompleted ?? emailReplyProposalMarkRowCompleted;

  for (const row of rows) {
    try {
      if (row.kind === 'attachment') {
        if (!row.attachment) throw new Error('Attachment metadata is missing.');
        const saved = await persistAttachment(
          proposal.provider,
          proposal.account,
          proposal.messageId,
          row.attachment.id,
          emailReplyAttachmentDestination(requireRequestSlug(proposal.matchedRequestId), proposal.messageId),
          row.attachment.filename || row.attachment.name
        );
        await markRowCompleted({
          proposalId: proposal.proposalId,
          completion: { rowId: row.id, filePath: saved.path, completedAt: at },
        });
        filePaths.push(saved.path);
        markEmailReplyAccepted({
          proposal,
          row,
          filePath: saved.path,
          at,
          advisorId: options.advisorId,
        });
      } else if (row.bodyFact?.value) {
        if (
          row.bodyFact.sensitivity === 'restricted' &&
          !approvedRestricted.has(row.id)
        ) {
          throw new Error('Confirm this sensitive fact before saving it.');
        }
        const fact = await upsertFact(
          factInputForRow({
            proposal,
            row,
            advisorId: options.advisorId,
            at,
          })
        );
        await markRowCompleted({
          proposalId: proposal.proposalId,
          completion: { rowId: row.id, factId: fact.fact_id, completedAt: at },
        });
        factIds.push(fact.fact_id);
        markEmailReplyAccepted({
          proposal,
          row,
          factId: fact.fact_id,
          at,
          advisorId: options.advisorId,
        });
      } else {
        throw new Error('This email reply row has nothing safe to save.');
      }
    } catch (error) {
      errors.push(error instanceof Error ? error.message : String(error));
    }
  }

  const status = statusFor(errors, filePaths.length + factIds.length);
  await mustLogIntakeEmailReplyAudit(
    buildEmailReplyAuditEntry({
      proposal,
      phase: 'outcome',
      auditPairId,
      advisorId: options.advisorId,
      itemIds,
      status,
      filePaths,
      factIds,
      ...(errors[0] ? { error: errors.join('; ') } : {}),
    })
  );

  if (status === 'accepted') {
    await (options.setProposalStatus ?? emailReplyProposalSetStatus)(
      proposal.proposalId,
      'accepted'
    );
  }

  return { status, filePaths, factIds, errors };
}

function requireRequestSlug(requestId: string): string {
  const intake = useIntakeStore.getState().intakesById[requestId];
  if (!intake?.requestSlug) throw new Error('This email reply is not matched to a safe request folder.');
  return intake.requestSlug;
}

export async function dismissEmailReplyProposal(
  options: DismissEmailReplyProposalOptions
): Promise<void> {
  const proposal = await (options.getProposal ?? emailReplyProposalGetForAccept)(
    options.proposalId
  );
  const auditPairId = emailReplyAuditPairId(proposal.proposalId);
  const itemIds = proposal.items.map((row) => row.itemId);

  await mustLogIntakeEmailReplyAudit(
    buildEmailReplyAuditEntry({
      proposal,
      phase: 'intent',
      operation: 'dismiss',
      auditPairId,
      advisorId: options.advisorId,
      itemIds,
      status: 'intent',
    })
  );
  await (options.setProposalStatus ?? emailReplyProposalSetStatus)(
    proposal.proposalId,
    'dismissed'
  );
  await mustLogIntakeEmailReplyAudit(
    buildEmailReplyAuditEntry({
      proposal,
      phase: 'outcome',
      operation: 'dismiss',
      auditPairId,
      advisorId: options.advisorId,
      itemIds,
      status: 'dismissed',
    })
  );
}
