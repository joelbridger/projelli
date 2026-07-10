import {
  composeMailAccountId,
  mailSaveDraft,
  type ConnectedAccount,
} from '@/platform/utils/mail-commands';
import type { BuiltNudgeDraft } from './nudgeDraft';
import {
  enforceNudgeBodyInvariants,
  nudgeBodyToHtml,
} from './nudgeDraft';
import type { IntakeRecord } from './intakeStore';
import { useIntakeStore } from './intakeStore';
import { logIntakeNudgeAudit } from './nudgeAudit';

export type NudgeMailAccount = Pick<ConnectedAccount, 'provider' | 'account' | 'label'>;

export interface SaveNudgeDraftInput {
  intake: IntakeRecord;
  draft: BuiltNudgeDraft;
  account: NudgeMailAccount;
  bodyText: string;
  now?: Date;
}

export interface RecordCallSuggestionInput {
  intake: IntakeRecord;
  draft: BuiltNudgeDraft;
  now?: Date;
}

function auditPairId(): string {
  const cryptoApi = globalThis.crypto as Crypto | undefined;
  if (cryptoApi?.randomUUID) return cryptoApi.randomUUID();
  return `intake-nudge-${Date.now().toString(36)}-${Math.random().toString(36).slice(2)}`;
}

function sanitizeError(error: unknown): string {
  const message = error instanceof Error ? error.message : String(error);
  if (!message.trim()) return 'Draft save failed.';
  return message.slice(0, 160);
}

function baseMetadata(input: {
  phase: 'intent' | 'outcome';
  auditPairId: string;
  intake: IntakeRecord;
  draft: BuiltNudgeDraft;
  account?: NudgeMailAccount;
}) {
  return {
    phase: input.phase,
    auditPairId: input.auditPairId,
    matterId: input.intake.matterId,
    requestId: input.intake.intakeId,
    sequence: input.draft.sequence,
    missingItemIds: input.draft.missingItemIds,
    ...(input.account ? {
      mailProvider: input.account.provider,
      account: input.account.account,
    } : {}),
  };
}

export async function saveNudgeDraftToMailbox(input: SaveNudgeDraftInput): Promise<{
  auditPairId: string;
  draftId: string;
}> {
  const pairId = auditPairId();
  const at = (input.now ?? new Date()).toISOString();
  const bodyText = enforceNudgeBodyInvariants(input.bodyText, input.draft);
  const bodyHtml = nudgeBodyToHtml(bodyText);

  logIntakeNudgeAudit({
    action: 'intake_nudge',
    description: 'Prepared an onboarding nudge draft for mailbox review.',
    model: undefined,
    inputs: {
      matterId: input.intake.matterId,
      requestId: input.intake.intakeId,
      sequence: input.draft.sequence,
      missingItemIds: input.draft.missingItemIds,
      mailProvider: input.account.provider,
      account: input.account.account,
    },
    outputs: {},
    userDecision: 'approved',
    metadata: baseMetadata({
      phase: 'intent',
      auditPairId: pairId,
      intake: input.intake,
      draft: input.draft,
      account: input.account,
    }),
  });

  try {
    // LANE3-NUDGE-DRAFT-ONLY
    const draftId = await mailSaveDraft(
      composeMailAccountId(input.account.provider, input.account.account),
      input.draft.to,
      input.draft.subject,
      bodyHtml,
    );
    logIntakeNudgeAudit({
      action: 'intake_nudge',
      description: 'Saved an onboarding nudge to mailbox Drafts.',
      model: undefined,
      inputs: {},
      outputs: {
        draftId,
        recipientCount: input.draft.to.length,
      },
      userDecision: 'approved',
      metadata: {
        ...baseMetadata({
          phase: 'outcome',
          auditPairId: pairId,
          intake: input.intake,
          draft: input.draft,
          account: input.account,
        }),
        status: 'saved',
        draftId,
        recipientCount: input.draft.to.length,
      },
    });
    useIntakeStore.getState().recordNudgeAttempt(input.intake.intakeId, {
      sequence: input.draft.sequence,
      at,
      missingItemIds: input.draft.missingItemIds,
      auditPairId: pairId,
      channel: 'email_draft',
    });
    return { auditPairId: pairId, draftId };
  } catch (error) {
    logIntakeNudgeAudit({
      action: 'intake_nudge',
      description: 'Failed to save an onboarding nudge draft.',
      model: undefined,
      inputs: {},
      outputs: {
        error: sanitizeError(error),
      },
      userDecision: 'approved',
      metadata: {
        ...baseMetadata({
          phase: 'outcome',
          auditPairId: pairId,
          intake: input.intake,
          draft: input.draft,
          account: input.account,
        }),
        status: 'failed',
      },
    });
    throw error;
  }
}

export function recordNudgeCallSuggestion(input: RecordCallSuggestionInput): string {
  const pairId = auditPairId();
  const at = (input.now ?? new Date()).toISOString();
  logIntakeNudgeAudit({
    action: 'intake_nudge',
    description: 'Prepared an onboarding call suggestion.',
    model: undefined,
    inputs: {
      matterId: input.intake.matterId,
      requestId: input.intake.intakeId,
      sequence: input.draft.sequence,
      missingItemIds: input.draft.missingItemIds,
    },
    outputs: {},
    userDecision: 'approved',
    metadata: baseMetadata({
      phase: 'intent',
      auditPairId: pairId,
      intake: input.intake,
      draft: input.draft,
    }),
  });
  logIntakeNudgeAudit({
    action: 'intake_nudge',
    description: 'Recorded that a call may help more than another note.',
    model: undefined,
    inputs: {},
    outputs: { channel: 'call_suggested' },
    userDecision: 'approved',
    metadata: {
      ...baseMetadata({
        phase: 'outcome',
        auditPairId: pairId,
        intake: input.intake,
        draft: input.draft,
      }),
      status: 'recorded',
      channel: 'call_suggested',
    },
  });
  useIntakeStore.getState().recordNudgeAttempt(input.intake.intakeId, {
    sequence: input.draft.sequence,
    at,
    missingItemIds: input.draft.missingItemIds,
    auditPairId: pairId,
    channel: 'call_suggested',
  });
  return pairId;
}
