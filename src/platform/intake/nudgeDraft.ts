import type { OnboardingRow } from './onboardingModel';
import type { IntakeRecord } from './intakeStore';
import type { OnboardingConfig } from './nudgeTypes';
import { reconstructAdvisorIntakeLink } from './advisorIntakeLink';
import { renderWelcomeJourneyEmail } from '@/platform/intake/welcomeJourneyDefaults';

export interface NudgeDraftConfig extends OnboardingConfig {
  now?: Date;
  advisorFirstName?: string;
  advisorPhone?: string;
  advisorCalendarLink?: string;
  intakeLink?: string;
}

export interface BuiltNudgeDraft {
  subject: string;
  bodyText: string;
  bodyHtml: string;
  to: string[];
  missingItemIds: string[];
  missingItemLabels: string[];
  sequence: number;
  basedOnAt: string;
  intakeLink: string;
}

type TemplateKind = 'gentle' | 'helpful' | 'call';

// TODO(W5b-followup): connect the other approved milestone starters in
// WELCOME_JOURNEY_EMAILS to their board events. They already use this draft
// shape and the existing advisor-approval rail; this lane wires welcome and
// stalled-item reminders without adding a second send path.

export const NUDGE_LINK_UNAVAILABLE_ERROR =
  'Regenerate the onboarding link before saving a nudge. The app could not rebuild a working client link.';

function cleanLine(value: string | undefined, fallback = ''): string {
  return (value ?? fallback).replace(/\s+/g, ' ').trim();
}

function nudgeLinkUnavailableError(): Error {
  return new Error(NUDGE_LINK_UNAVAILABLE_ERROR);
}

function missingList(labels: string[]): string {
  return labels.map((label) => `- ${label}`).join('\n');
}

function chooseTemplate(sequence: number, suggestCall: boolean): TemplateKind {
  if (suggestCall || sequence >= 3) return 'call';
  if (sequence === 2) return 'helpful';
  return 'gentle';
}

function templateSubject(kind: TemplateKind, firmName: string): string {
  switch (kind) {
    case 'helpful':
      return 'Here is your onboarding link again';
    case 'call':
      return 'Want help finishing your onboarding?';
    case 'gentle':
    default:
      return `A few onboarding items for ${firmName}`;
  }
}

function renderApprovedReminder(input: {
  clientFirstName: string;
  advisorFirstName: string;
  supportFirstName: string;
  firmName: string;
  missingItemLabels: string[];
  intakeLink: string;
}): { subject: string; body: string } {
  return renderWelcomeJourneyEmail('gentle_reminder', {
    client_first_name: input.clientFirstName,
    advisor_first_name: input.advisorFirstName,
    support_first_name: input.supportFirstName,
    firm_name: input.firmName,
    missing_items_sentence: input.missingItemLabels.join(', '),
    secure_link: input.intakeLink,
  });
}

function renderCallBody(input: {
  clientFirstName: string;
  advisorFirstName: string;
  primaryMissingItem: string;
  intakeLink: string;
  advisorPhone: string;
  advisorCalendarLink: string;
}): string {
  const callLine = input.advisorPhone
    ? `If it would be easier, reply here or call me at ${input.advisorPhone}, and we can walk through it together.`
    : 'If it would be easier, reply here and we can walk through it together.';
  const calendarLine = input.advisorCalendarLink
    ? `You can also book a call here:\n\n${input.advisorCalendarLink}\n\n`
    : '';

  return [
    `Hi ${input.clientFirstName},`,
    '',
    `It looks like ${input.primaryMissingItem} is still getting in the way. That is normal for client paperwork.`,
    '',
    callLine,
    calendarLine ? '' : undefined,
    calendarLine.trimEnd() || undefined,
    `Your link is still here if you prefer to finish it yourself:`,
    '',
    input.intakeLink,
    '',
    'Best,',
    '',
    input.advisorFirstName,
  ].filter((line): line is string => line !== undefined).join('\n');
}

function renderBody(kind: TemplateKind, input: {
  clientFirstName: string;
  advisorFirstName: string;
  firmName: string;
  missingItemLabels: string[];
  primaryMissingItem: string;
  intakeLink: string;
  advisorPhone: string;
  advisorCalendarLink: string;
}): string {
  if (kind === 'helpful') {
    return [
      `Hi ${input.clientFirstName},`,
      '',
      'Just putting your onboarding link back at the top of your inbox:',
      '',
      input.intakeLink,
      '',
      `The main item still open is ${input.primaryMissingItem}. If you are unsure about it, a rough answer or the closest document you have is useful. We can clean it up together.`,
      '',
      'Thanks,',
      '',
      input.advisorFirstName,
    ].join('\n');
  }

  if (kind === 'call') {
    return renderCallBody(input);
  }

  return [
    `Hi ${input.clientFirstName},`,
    '',
    'I hope you are doing well. I saw a few onboarding items are still open:',
    '',
    missingList(input.missingItemLabels),
    '',
    'Whenever you are ready, you can use the same link to keep going:',
    '',
    input.intakeLink,
    '',
    'If anything on the list is hard to find, that is okay. Send what you have, and we can help with the rest.',
    '',
    'Best,',
    '',
    input.advisorFirstName,
  ].join('\n');
}

export function nudgeBodyToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

function normalizedIncludes(body: string, value: string): boolean {
  return body.toLowerCase().includes(value.toLowerCase());
}

export function enforceNudgeBodyInvariants(bodyText: string, draft: BuiltNudgeDraft): string {
  const additions: string[] = [];
  const missingLabelsAbsent = draft.missingItemLabels.some(
    (label) => !normalizedIncludes(bodyText, label),
  );
  if (missingLabelsAbsent && draft.missingItemLabels.length > 0) {
    additions.push(`Still missing:\n${missingList(draft.missingItemLabels)}`);
  }
  if (draft.intakeLink && !normalizedIncludes(bodyText, draft.intakeLink)) {
    additions.push(`Onboarding link:\n${draft.intakeLink}`);
  }
  if (additions.length === 0) return bodyText.trim();
  return [bodyText.trim(), ...additions].filter(Boolean).join('\n\n');
}

export function missingItemIdsMatch(a: string[], b: string[]): boolean {
  if (a.length !== b.length) return false;
  const sortedA = [...a].sort();
  const sortedB = [...b].sort();
  return sortedA.every((value, index) => value === sortedB[index]);
}

export function assertNudgeDraftHasLink(draft: Pick<BuiltNudgeDraft, 'intakeLink'>): void {
  if (!cleanLine(draft.intakeLink, '')) throw nudgeLinkUnavailableError();
}

export async function resolveNudgeDraftIntakeLink(
  intake: Pick<IntakeRecord, 'intakeId' | 'link' | 'publicKeyRawB64'>,
  cfg: Pick<NudgeDraftConfig, 'intakeLink'> = {},
): Promise<string> {
  const existingLink = cleanLine(cfg.intakeLink ?? intake.link, '');
  if (existingLink) return existingLink;

  const publicKeyRawB64 = cleanLine(intake.publicKeyRawB64, '');
  if (!publicKeyRawB64) throw nudgeLinkUnavailableError();

  try {
    // LANE3-FIX-LINK-AND-AUDIT
    const reconstructedLink = await reconstructAdvisorIntakeLink({
      intakeId: intake.intakeId,
      publicKeyRawB64,
    });
    const cleanReconstructedLink = cleanLine(reconstructedLink, '');
    if (!cleanReconstructedLink) throw nudgeLinkUnavailableError();
    return cleanReconstructedLink;
  } catch {
    throw nudgeLinkUnavailableError();
  }
}

export async function buildNudgeDraftForIntake(
  row: OnboardingRow,
  intake: IntakeRecord,
  cfg: NudgeDraftConfig,
): Promise<BuiltNudgeDraft> {
  const intakeLink = await resolveNudgeDraftIntakeLink(intake, cfg);
  return buildNudgeDraft(row, intake, {
    ...cfg,
    intakeLink,
  });
}

export function buildNudgeDraft(
  row: OnboardingRow,
  intake: IntakeRecord,
  cfg: NudgeDraftConfig,
): BuiltNudgeDraft {
  const sequence = row.nudgeEligibility.nextSequence;
  const missingItemIds = [...row.missingItemIds];
  const missingItemLabels = row.missingItemLabels.map((label) => cleanLine(label)).filter(Boolean);
  const primaryMissingItem = missingItemLabels[0] ?? 'one onboarding item';
  const clientFirstName = cleanLine(intake.clientFirstName, 'there');
  const advisorFirstName = cleanLine(cfg.advisorFirstName, 'Your advisor');
  const firmName = cleanLine(intake.firmName, 'your advisory team');
  const intakeLink = cleanLine(cfg.intakeLink ?? intake.link, '');
  if (!intakeLink) throw nudgeLinkUnavailableError();
  const kind = chooseTemplate(sequence, row.nudgeEligibility.suggestCall);
  const approvedReminder = kind === 'gentle' ? renderApprovedReminder({
    clientFirstName,
    advisorFirstName,
    supportFirstName: advisorFirstName,
    firmName,
    missingItemLabels,
    intakeLink,
  }) : null;
  const subject = approvedReminder?.subject ?? templateSubject(kind, firmName);
  const bodyText = enforceNudgeBodyInvariants(approvedReminder?.body ?? renderBody(kind, {
    clientFirstName,
    advisorFirstName,
    firmName,
    missingItemLabels,
    primaryMissingItem,
    intakeLink,
    advisorPhone: cleanLine(cfg.advisorPhone, ''),
    advisorCalendarLink: cleanLine(cfg.advisorCalendarLink, ''),
  }), {
    subject,
    bodyText: '',
    bodyHtml: '',
    to: [],
    missingItemIds,
    missingItemLabels,
    sequence,
    basedOnAt: (cfg.now ?? new Date()).toISOString(),
    intakeLink,
  });

  return {
    subject,
    bodyText,
    bodyHtml: nudgeBodyToHtml(bodyText),
    to: intake.clientEmail?.trim() ? [intake.clientEmail.trim()] : [],
    missingItemIds,
    missingItemLabels,
    sequence,
    basedOnAt: (cfg.now ?? new Date()).toISOString(),
    intakeLink,
  };
}
