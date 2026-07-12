import {
  emailAddressMatch,
  isLikelyLookalikeAddress,
  parseEmailAddress,
} from './emailAddressMatch';
import { emailAuthResult, normalizeMailAuthResult } from './emailAuthResult';
import { emailThreadMatches } from './emailThreadMatch';
import type {
  IntakeChecklistState,
  IntakeRecord,
  IntakeStatus,
} from './intakeStore';
import type {
  EmailReplyCandidate,
  EmailReplyMailInput,
  EmailReplyMatchResult,
  EmailReplyMessageRef,
  EmailReplyQuarantine,
  EmailReplyQuarantineReason,
} from './emailReplyTypes';

export interface EmailReplyIntakeState {
  intakesById: Record<string, IntakeRecord>;
}

const OPEN_ITEM_STATES = new Set<IntakeChecklistState['state']>([
  'not_started',
  'needs_followup',
]);

function allIntakes(intakeState: EmailReplyIntakeState): IntakeRecord[] {
  return Object.values(intakeState.intakesById);
}

function messageRef(
  mail: EmailReplyMailInput,
  sender: string
): EmailReplyMessageRef {
  return {
    messageId: mail.id,
    provider: mail.provider ?? '',
    account: mail.account ?? '',
    received: mail.receivedDateTime ?? mail.date ?? null,
    sender,
    authResult: normalizeMailAuthResult(mail.authResult),
    threadId: mail.threadId ?? null,
  };
}

function quarantine(
  mail: EmailReplyMailInput,
  sender: string,
  reason: EmailReplyQuarantineReason,
  intake?: IntakeRecord
): EmailReplyQuarantine {
  return {
    ...messageRef(mail, sender),
    kind: 'quarantine',
    reason,
    ...(intake
      ? { matchedMatterId: intake.matterId, matchedRequestId: intake.intakeId }
      : {}),
  };
}

function statusIsActive(status: IntakeStatus): boolean {
  return status === 'active';
}

function isExpired(intake: IntakeRecord, now: Date): boolean {
  const expiresAt = new Date(intake.expiresAt).getTime();
  return Number.isFinite(expiresAt) && expiresAt <= now.getTime();
}

function isActiveIntake(intake: IntakeRecord, now: Date): boolean {
  return statusIsActive(intake.status) && !isExpired(intake, now);
}

function openItems(intake: IntakeRecord): IntakeChecklistState[] {
  return intake.items.filter((item) => OPEN_ITEM_STATES.has(item.state));
}

function hasAcceptedItems(intake: IntakeRecord): boolean {
  return intake.items.some((item) => item.state === 'accepted');
}

function attachmentMetadataMissing(mail: EmailReplyMailInput): boolean {
  if (!mail.hasAttachments) return false;
  if (mail.attachmentsUnsupported) return true;
  return (mail.attachments ?? []).length === 0;
}

function uniqueThreadMatch(
  mail: EmailReplyMailInput,
  intakes: IntakeRecord[]
): IntakeRecord | null | 'ambiguous' {
  const matches = intakes.filter((intake) =>
    emailThreadMatches(mail.threadId, intake)
  );
  if (matches.length === 1) return matches[0] ?? null;
  if (matches.length > 1) return 'ambiguous';
  return null;
}

function senderMatches(
  mail: EmailReplyMailInput,
  intake: IntakeRecord
): boolean {
  return emailAddressMatch(
    mail.fromAddr ?? mail.from ?? '',
    intake.clientEmail ?? ''
  );
}

function senderLooksLikeKnownClient(
  mail: EmailReplyMailInput,
  intakes: IntakeRecord[]
): boolean {
  const rawSender = mail.fromAddr ?? mail.from ?? '';
  return intakes.some((intake) =>
    isLikelyLookalikeAddress(rawSender, intake.clientEmail ?? '')
  );
}

function candidateFor(
  mail: EmailReplyMailInput,
  sender: string,
  intake: IntakeRecord
): EmailReplyCandidate {
  const targetOpenItemIds = openItems(intake).map((item) => item.itemId);
  return {
    ...messageRef(mail, sender),
    kind: 'candidate',
    matchedMatterId: intake.matterId,
    matchedRequestId: intake.intakeId,
    targetOpenItemIds,
    confidenceEligible: true,
    attachments: mail.attachments ?? [],
  };
}

export function matchEmailReply(
  mail: EmailReplyMailInput,
  intakeState: EmailReplyIntakeState,
  now: Date
): EmailReplyMatchResult {
  // W3-LANE1-DETERMINISTIC-GATE
  const parsedSender = parseEmailAddress(mail.fromAddr ?? mail.from ?? '');
  const intakes = allIntakes(intakeState);

  if (!parsedSender) {
    return senderLooksLikeKnownClient(mail, intakes)
      ? quarantine(mail, '', 'lookalike')
      : { kind: 'ignore' };
  }

  const sender = parsedSender.normalized;
  const matchedBySender = intakes.filter((intake) =>
    senderMatches(mail, intake)
  );

  if (matchedBySender.length === 0) {
    return senderLooksLikeKnownClient(mail, intakes)
      ? quarantine(mail, sender, 'lookalike')
      : { kind: 'ignore' };
  }

  const authGate = emailAuthResult(mail.authResult);
  if (authGate.quarantine) {
    return quarantine(mail, sender, 'auth_failed', matchedBySender[0]);
  }

  const activeMatches = matchedBySender.filter((intake) =>
    isActiveIntake(intake, now)
  );
  if (activeMatches.length === 0) {
    return quarantine(mail, sender, 'inactive_request', matchedBySender[0]);
  }

  if (attachmentMetadataMissing(mail)) {
    return quarantine(
      mail,
      sender,
      'attachment_metadata_missing',
      activeMatches[0]
    );
  }

  let selected: IntakeRecord;
  if (activeMatches.length === 1) {
    const only = activeMatches[0];
    if (!only) return { kind: 'ignore' };
    selected = only;
  } else {
    const distinctMatters = new Set(
      activeMatches.map((intake) => intake.matterId)
    );
    const threadMatch = uniqueThreadMatch(mail, activeMatches);
    if (threadMatch === 'ambiguous') {
      return quarantine(mail, sender, 'ambiguous_request', activeMatches[0]);
    }
    if (threadMatch) {
      selected = threadMatch;
    } else if (distinctMatters.size > 1) {
      return quarantine(mail, sender, 'ambiguous_sender', activeMatches[0]);
    } else {
      return quarantine(mail, sender, 'ambiguous_request', activeMatches[0]);
    }
  }

  const targets = openItems(selected);
  if (targets.length > 0) {
    return candidateFor(mail, sender, selected);
  }

  if (hasAcceptedItems(selected)) {
    return quarantine(mail, sender, 'accepted_item_update', selected);
  }

  return { kind: 'ignore' };
}
