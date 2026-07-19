import {
  mailConnectedAccounts,
  mailSaveDraft,
  type ConnectedAccount,
} from '@/platform/utils/mail-commands';

export interface OutlookDraftIdentity {
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
}

export interface OutlookFollowUpDraft {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface SaveOutlookFollowUpDraftInput extends OutlookDraftIdentity {
  readonly account: ConnectedAccount;
  readonly draft: OutlookFollowUpDraft;
}

function requiredIdentity(identity: OutlookDraftIdentity): boolean {
  return Boolean(
    identity.meetingId.trim() &&
    identity.householdRef.trim() &&
    identity.matterId.trim()
  );
}

export function parseFollowUpRecipients(raw: string): string[] {
  return raw
    .split(/[,;]/)
    .map((recipient) => recipient.trim())
    .filter(Boolean);
}

/** Escape and paragraphize the advisor-edited plain text for Outlook. */
export function followUpDraftBodyToHtml(text: string): string {
  const escaped = text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
  return escaped
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${paragraph.replace(/\n/g, '<br/>')}</p>`)
    .join('\n');
}

/** Read mailbox identities only; no meeting or recap content is inspected. */
export async function loadOutlookDraftAccounts(): Promise<ConnectedAccount[]> {
  const accounts = await mailConnectedAccounts();
  return accounts.filter((account) => account.provider === 'm365');
}

/**
 * The only external capability granted to the meeting follow-up surface.
 * This adapter creates one Outlook draft and has no delivery or AI capability.
 */
export async function saveOutlookFollowUpDraft(
  input: SaveOutlookFollowUpDraftInput
): Promise<string> {
  const recipients = parseFollowUpRecipients(input.draft.to);
  if (
    !requiredIdentity(input) ||
    input.account.provider !== 'm365' ||
    recipients.length === 0 ||
    input.draft.body.trim() === ''
  ) {
    throw new Error('A complete Outlook follow-up draft is required.');
  }

  return mailSaveDraft(
    `m365:${input.account.account}`,
    recipients,
    input.draft.subject,
    followUpDraftBodyToHtml(input.draft.body)
  );
}
