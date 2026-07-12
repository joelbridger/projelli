import { useEffect } from 'react';
import { isTauri } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';

import type { Provider } from '@/platform/providers/Provider';
import { sendPreparedStructuredWithEgressAudit } from './intakeAiPreparedSend';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { EMAIL_REPLY_AI_CLASSIFICATION_SETTING_KEY } from '@/platform/settings/schema';

import {
  MAIL_SYNC_EVENT,
  mailGetMessage,
  mailListMessages,
  type MailListItem,
  type MailListPage,
  type MailSyncProgress,
  type MailView,
} from '@/platform/utils/mail-commands';

import {
  matchEmailReply,
  type EmailReplyIntakeState,
} from './emailReplyMatcher';
import type {
  EmailReplyCandidate,
  EmailReplyMailInput,
  EmailReplyQuarantine,
} from './emailReplyTypes';
import { useIntakeStore, type IntakeChecklistState } from './intakeStore';
import {
  classifyEmailReplyCandidate,
  sanitizeEmailReplyBodyForClassification,
  summarizeEmailReplyConfidence,
} from './emailReplyClassifier';
import {
  emailReplyProposalSave,
  emailReplyQuarantineSave,
  stableEmailReplyId,
  type EmailReplyProposalItem,
} from './emailReplyProposalStore';
import { logIntakeEmailReplyAudit } from './emailReplyAudit';

export interface EmailReplyIngestionDeps {
  listMessages?: typeof mailListMessages;
  getMessage?: typeof mailGetMessage;
  saveProposal?: typeof emailReplyProposalSave;
  saveQuarantine?: typeof emailReplyQuarantineSave;
  resolveEmailProvider?: () => Promise<EmailReplyClassificationProvider>;
  now?: Date;
  limit?: number;
}

export interface EmailReplyClassificationProvider {
  provider: Provider;
  providerId: string;
  assuredAvailable: boolean;
}

const EMAIL_REPLY_CONFIDENCE_SCHEMA = {
  type: 'object' as const,
  properties: {
    confidence: {
      type: 'string' as const,
      description: 'One of high, medium, or low.',
    },
    reasoning: {
      type: 'string' as const,
      description: 'A short explanation based only on the supplied email and open-item list.',
    },
  },
  required: ['confidence'],
};

function mailInputFromMessage(item: MailListItem, view: MailView): EmailReplyMailInput {
  return {
    id: view.id || item.id,
    provider: view.provider ?? item.provider,
    account: view.account ?? item.account,
    receivedDateTime: view.date ?? item.receivedDateTime,
    from: view.from || item.fromName,
    fromAddr: item.fromAddr || view.from,
    authResult: view.authResult,
    threadId: view.threadId,
    hasAttachments: view.hasAttachments,
    attachmentsUnsupported: view.attachmentsUnsupported,
    attachments: view.attachments,
  };
}

function openItemsForCandidate(
  candidate: EmailReplyCandidate
): IntakeChecklistState[] {
  const intake = useIntakeStore.getState().intakesById[candidate.matchedRequestId];
  if (!intake) return [];
  const targetIds = new Set(candidate.targetOpenItemIds);
  return intake.items.filter((item) => targetIds.has(item.itemId));
}

function fallbackRows(openItems: IntakeChecklistState[]): EmailReplyProposalItem[] {
  const item = openItems[0];
  if (!item) return [];
  return [
    {
      id: `review-${item.itemId}`,
      kind: 'body_fact',
      itemId: item.itemId,
      label: item.label,
      confidence: 'low',
      reasoning: 'This authenticated email belongs to this open request, but the item match is not clear.',
      checkedByDefault: false,
    },
  ];
}

async function enqueueCandidate(
  candidate: EmailReplyCandidate,
  view: MailView,
  deps: Pick<EmailReplyIngestionDeps, 'saveProposal' | 'resolveEmailProvider'> & {
    saveProposal: typeof emailReplyProposalSave;
  }
): Promise<void> {
  const openItems = openItemsForCandidate(candidate);
  // Email bodies are untrusted data. The deterministic matcher is always local.
  // A firm must explicitly opt in before any email text is offered to a model.
  const bodyText = sanitizeEmailReplyBodyForClassification(view.body);
  const aiClassificationEnabled = useSettingsStore
    .getState()
    .getSetting<boolean>(EMAIL_REPLY_AI_CLASSIFICATION_SETTING_KEY);
  let modelConfidence:
    | ((prompt: string) => Promise<unknown>)
    | undefined;
  if (aiClassificationEnabled && bodyText && deps.resolveEmailProvider) {
    try {
      const resolved = await deps.resolveEmailProvider();
      modelConfidence = async (prompt) => {
        try {
          return await sendPreparedStructuredWithEgressAudit({
            provider: resolved.provider,
            providerId: resolved.providerId,
            model: resolved.provider.getMetadata().model,
            assuredAvailable: resolved.assuredAvailable,
            scope: { kind: 'matter', matterId: candidate.matchedMatterId },
            onAuditLog: (entry) => {
              void logIntakeEmailReplyAudit(entry);
            },
            surface: 'intake_email_reply_confidence',
            prompt,
            background: true,
            options: {
              schema: EMAIL_REPLY_CONFIDENCE_SCHEMA,
              temperature: 0,
              maxTokens: 180,
            },
            modelCall: () => ({
              action: 'model_call',
              description: 'Classified the confidence of an email reply.',
              model: resolved.provider.getMetadata().model,
              inputs: {
                matterId: candidate.matchedMatterId,
                requestId: candidate.matchedRequestId,
                classifier: 'email_reply_confidence',
              },
              outputs: { result: 'confidence_label' },
              userDecision: 'auto',
              metadata: {
                feature: 'email_reply_confidence',
                bodySanitized: true,
              },
              provider: resolved.providerId,
            }),
          });
        } catch {
          return null;
        }
      };
    } catch {
      // A mailbox reply must remain reviewable even without a configured model.
      modelConfidence = undefined;
    }
  }
  const classified = await classifyEmailReplyCandidate({
    candidate,
    openItems,
    bodyText,
    ...(modelConfidence ? { modelConfidence } : {}),
  });
  const items = classified.length > 0 ? classified : fallbackRows(openItems);
  if (items.length === 0) return;
  await deps.saveProposal({
    proposalId: stableEmailReplyId('proposal', candidate),
    messageId: candidate.messageId,
    provider: candidate.provider,
    account: candidate.account,
    received: candidate.received,
    sender: candidate.sender,
    authResult: candidate.authResult,
    threadId: candidate.threadId,
    matchedMatterId: candidate.matchedMatterId,
    matchedRequestId: candidate.matchedRequestId,
    targetOpenItemIds: candidate.targetOpenItemIds,
    attachmentRefs: candidate.attachments,
    items,
    confidence: summarizeEmailReplyConfidence(items),
  });
}

async function enqueueQuarantine(
  quarantine: EmailReplyQuarantine,
  deps: Required<Pick<EmailReplyIngestionDeps, 'saveQuarantine'>>
): Promise<void> {
  await deps.saveQuarantine({
    quarantineId: stableEmailReplyId('quarantine', quarantine),
    messageId: quarantine.messageId,
    provider: quarantine.provider,
    account: quarantine.account,
    received: quarantine.received,
    sender: quarantine.sender,
    authResult: quarantine.authResult,
    threadId: quarantine.threadId,
    reason: quarantine.reason,
    ...(quarantine.matchedMatterId
      ? { matchedMatterId: quarantine.matchedMatterId }
      : {}),
    ...(quarantine.matchedRequestId
      ? { matchedRequestId: quarantine.matchedRequestId }
      : {}),
  });
}

export async function processEmailReplyMessages(
  deps: EmailReplyIngestionDeps = {}
): Promise<void> {
  const listMessages = deps.listMessages ?? mailListMessages;
  const getMessage = deps.getMessage ?? mailGetMessage;
  const saveProposal = deps.saveProposal ?? emailReplyProposalSave;
  const saveQuarantine = deps.saveQuarantine ?? emailReplyQuarantineSave;
  const now = deps.now ?? new Date();
  const page: MailListPage = await listMessages({
    sortBy: 'date',
    sortDesc: true,
    limit: deps.limit ?? 200,
    offset: 0,
  });
  const intakeState: EmailReplyIntakeState = {
    intakesById: useIntakeStore.getState().intakesById,
  };
  if (Object.keys(intakeState.intakesById).length === 0) return;

  for (const item of page.items) {
    try {
      const view = await getMessage(item.id);
      const result = matchEmailReply(mailInputFromMessage(item, view), intakeState, now);
      if (result.kind === 'candidate') {
        await enqueueCandidate(result, view, {
          saveProposal,
          ...(deps.resolveEmailProvider
            ? { resolveEmailProvider: deps.resolveEmailProvider }
            : {}),
        });
      } else if (result.kind === 'quarantine') {
        await enqueueQuarantine(result, { saveQuarantine });
      }
    } catch (error) {
      console.warn('[useEmailReplyIngestion] Could not process synced mail:', error);
    }
  }
}

export function useEmailReplyIngestion(
  { resolveEmailProvider }: Pick<EmailReplyIngestionDeps, 'resolveEmailProvider'> = {}
): void {
  useEffect(() => {
    if (!isTauri()) return;
    let running = false;
    let disposed = false;
    const run = (): void => {
      if (running || disposed) return;
      running = true;
      void processEmailReplyMessages(
        resolveEmailProvider ? { resolveEmailProvider } : {}
      )
        .catch((error: unknown) => {
          console.warn('[useEmailReplyIngestion] Email reply ingestion failed:', error);
        })
        .finally(() => {
          running = false;
        });
    };
    let unlisten: (() => void) | undefined;
    listen<MailSyncProgress>(MAIL_SYNC_EVENT, (event) => {
      if (event.payload.status === 'done') run();
    })
      .then((un) => {
        if (disposed) un();
        else unlisten = un;
      })
      .catch((error: unknown) => {
        console.warn('[useEmailReplyIngestion] Could not listen for mail sync:', error);
      });
    window.addEventListener('focus', run);
    return () => {
      disposed = true;
      window.removeEventListener('focus', run);
      if (unlisten) unlisten();
    };
  }, [resolveEmailProvider]);
}
