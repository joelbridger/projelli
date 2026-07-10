import { mailGetMessage, mailPersistAttachment } from '@/platform/utils/mail-commands';

import {
  buildEmailReplyAuditEntry,
  emailReplyAuditPairId,
  mustLogIntakeEmailReplyAudit,
} from './emailReplyAudit';
import {
  getEmailQuarantine,
  setEmailQuarantineStatus,
  type EmailReplyQuarantine,
} from './emailQuarantineStore';
import {
  emailReplyAttachmentDestination,
} from './emailReplyAccept';
import { useIntakeStore, type IntakeRecord } from './intakeStore';

export interface ManualFileQuarantinedEmailOptions {
  quarantineId: string;
  targetMatterId: string;
  targetRequestId: string;
  targetItemId: string;
  attachmentId: string;
  advisorId: string;
  /** The UI must require the advisor to open the original message first. */
  reviewed: boolean;
  now?: Date;
  getQuarantine?: (quarantineId: string) => Promise<EmailReplyQuarantine>;
  getMessage?: typeof mailGetMessage;
  persistAttachment?: typeof mailPersistAttachment;
  setStatus?: typeof setEmailQuarantineStatus;
}

export interface ManualFileQuarantinedEmailResult {
  filePath: string;
  status: 'manual_filed';
}

export interface DismissQuarantinedEmailOptions {
  quarantineId: string;
  advisorId: string;
  getQuarantine?: (quarantineId: string) => Promise<EmailReplyQuarantine>;
  setStatus?: typeof setEmailQuarantineStatus;
}

function requireOpenTarget(input: {
  matterId: string;
  requestId: string;
  itemId: string;
}): { intake: IntakeRecord; item: IntakeRecord['items'][number] } {
  const intake = useIntakeStore.getState().intakesById[input.requestId];
  if (!intake || intake.matterId !== input.matterId || intake.status !== 'active') {
    throw new Error('Choose a real active client and onboarding request.');
  }
  const item = intake.items.find((candidate) => candidate.itemId === input.itemId);
  if (!item || !['not_started', 'needs_followup'].includes(item.state)) {
    throw new Error('Choose a real open onboarding item.');
  }
  return { intake, item };
}

function quarantineAuditEntry(input: {
  quarantine: EmailReplyQuarantine;
  phase: 'intent' | 'outcome';
  operation: 'manual_file' | 'dismiss';
  auditPairId: string;
  advisorId: string;
  itemIds: string[];
  status: 'intent' | 'manual_filed' | 'dismissed' | 'failed';
  filePaths?: string[];
  error?: string;
}) {
  const base = buildEmailReplyAuditEntry({
    proposal: {
      proposalId: input.quarantine.quarantineId,
      messageId: input.quarantine.messageId,
      provider: input.quarantine.provider,
      account: input.quarantine.account,
      matchedMatterId: input.quarantine.matchedMatterId ?? '',
      matchedRequestId: input.quarantine.matchedRequestId ?? '',
    },
    phase: input.phase,
    operation: input.operation === 'dismiss' ? 'dismiss' : 'accept',
    auditPairId: input.auditPairId,
    advisorId: input.advisorId,
    itemIds: input.itemIds,
    status: input.status === 'manual_filed' ? 'accepted' : input.status,
    ...(input.filePaths ? { filePaths: input.filePaths } : {}),
    ...(input.error ? { error: input.error } : {}),
  });
  return {
    ...base,
    description:
      input.operation === 'manual_file'
        ? input.phase === 'intent'
          ? 'Manual filing of quarantined email started. The advisor MANUALLY confirmed this message. Channel: email reply.'
          : `Manual filing of quarantined email finished with status ${input.status}. The advisor MANUALLY confirmed this message. Channel: email reply.`
        : input.phase === 'intent'
          ? 'Quarantined email dismissal started. The advisor marked it as not intake material. Channel: email reply.'
          : 'Quarantined email dismissed as not intake material. Channel: email reply.',
    metadata: {
      ...base.metadata,
      quarantineId: input.quarantine.quarantineId,
      operation: input.operation,
      manualConfirmation: input.operation === 'manual_file',
    },
  };
}

function markManuallyFiled(input: {
  intake: IntakeRecord;
  item: IntakeRecord['items'][number];
  filePath: string;
  at: string;
  advisorId: string;
}): void {
  const store = useIntakeStore.getState();
  const provenance = {
    channel: 'email_reply' as const,
    label: 'From quarantined email. MANUALLY confirmed by you.',
    at: input.at,
    enteredBy: input.advisorId,
    confirmedBy: input.advisorId,
    verification: 'advisor_confirmed' as const,
  };
  store.updateItem(input.intake.intakeId, {
    ...input.item,
    state: 'accepted',
    filePath: input.filePath,
    provenance,
  });
  store.addReceivedItem(input.intake.intakeId, {
    itemId: input.item.itemId,
    label: input.item.label,
    filePath: input.filePath,
    receivedAt: input.at,
    provenance,
  });
  store.setLastClientActivity(input.intake.intakeId, input.at);
}

export async function manualFileQuarantinedEmail(
  options: ManualFileQuarantinedEmailOptions
): Promise<ManualFileQuarantinedEmailResult> {
  if (!options.reviewed) {
    throw new Error('Open and review the original email before filing it.');
  }
  const quarantine = await (options.getQuarantine ?? getEmailQuarantine)(options.quarantineId);
  if (quarantine.status !== 'pending') {
    throw new Error('This quarantined email has already been resolved.');
  }
  const { intake, item } = requireOpenTarget({
    matterId: options.targetMatterId,
    requestId: options.targetRequestId,
    itemId: options.targetItemId,
  });
  const message = await (options.getMessage ?? mailGetMessage)(quarantine.messageId);
  const attachment = message.attachments.find((candidate) => candidate.id === options.attachmentId);
  if (!attachment || message.attachmentsUnsupported) {
    throw new Error('Choose an attachment that is available from the original email.');
  }

  const at = (options.now ?? new Date()).toISOString();
  const auditPairId = emailReplyAuditPairId(quarantine.quarantineId);
  await mustLogIntakeEmailReplyAudit(
    quarantineAuditEntry({
      quarantine,
      phase: 'intent',
      operation: 'manual_file',
      auditPairId,
      advisorId: options.advisorId,
      itemIds: [item.itemId],
      status: 'intent',
    })
  );

  try {
    const saved = await (options.persistAttachment ?? mailPersistAttachment)(
      quarantine.provider,
      quarantine.account,
      quarantine.messageId,
      attachment.id,
      emailReplyAttachmentDestination(quarantine.messageId),
      attachment.filename || attachment.name
    );
    markManuallyFiled({ intake, item, filePath: saved.path, at, advisorId: options.advisorId });
    await (options.setStatus ?? setEmailQuarantineStatus)(
      quarantine.quarantineId,
      'manual_filed'
    );
    await mustLogIntakeEmailReplyAudit(
      quarantineAuditEntry({
        quarantine,
        phase: 'outcome',
        operation: 'manual_file',
        auditPairId,
        advisorId: options.advisorId,
        itemIds: [item.itemId],
        status: 'manual_filed',
        filePaths: [saved.path],
      })
    );
    return { filePath: saved.path, status: 'manual_filed' };
  } catch (error) {
    const messageText = error instanceof Error ? error.message : String(error);
    await mustLogIntakeEmailReplyAudit(
      quarantineAuditEntry({
        quarantine,
        phase: 'outcome',
        operation: 'manual_file',
        auditPairId,
        advisorId: options.advisorId,
        itemIds: [item.itemId],
        status: 'failed',
        error: messageText,
      })
    );
    throw error;
  }
}

export async function dismissQuarantinedEmail(
  options: DismissQuarantinedEmailOptions
): Promise<void> {
  const quarantine = await (options.getQuarantine ?? getEmailQuarantine)(options.quarantineId);
  if (quarantine.status !== 'pending') {
    throw new Error('This quarantined email has already been resolved.');
  }
  const auditPairId = emailReplyAuditPairId(quarantine.quarantineId);
  await mustLogIntakeEmailReplyAudit(
    quarantineAuditEntry({
      quarantine,
      phase: 'intent',
      operation: 'dismiss',
      auditPairId,
      advisorId: options.advisorId,
      itemIds: [],
      status: 'intent',
    })
  );
  await (options.setStatus ?? setEmailQuarantineStatus)(quarantine.quarantineId, 'dismissed');
  await mustLogIntakeEmailReplyAudit(
    quarantineAuditEntry({
      quarantine,
      phase: 'outcome',
      operation: 'dismiss',
      auditPairId,
      advisorId: options.advisorId,
      itemIds: [],
      status: 'dismissed',
    })
  );
}
