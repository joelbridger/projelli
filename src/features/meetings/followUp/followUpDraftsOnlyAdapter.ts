import {
  mailConnectedAccounts,
  mailSaveDraft,
  type ConnectedAccount,
} from '@/platform/utils/mail-commands';

export interface ProviderDraftIdentity {
  readonly meetingId: string;
  readonly householdRef: string;
  readonly matterId: string;
}

export interface ProviderFollowUpDraft {
  readonly to: string;
  readonly subject: string;
  readonly body: string;
}

export interface SaveProviderFollowUpDraftInput extends ProviderDraftIdentity {
  readonly account: ConnectedAccount;
  readonly draft: ProviderFollowUpDraft;
}

export type FollowUpDraftProvider = 'm365' | 'gmail';

function requiredIdentity(identity: ProviderDraftIdentity): boolean {
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

/** Escape and paragraphize the advisor-edited plain text for a provider draft. */
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

/** Read usable mailbox identities only; no meeting or recap content is inspected. */
export type ProviderDraftAccount = ConnectedAccount & {
  readonly provider: FollowUpDraftProvider;
};

export async function loadProviderDraftAccounts(): Promise<ProviderDraftAccount[]> {
  const accounts = await mailConnectedAccounts();
  return accounts.filter(
    (account): account is ProviderDraftAccount =>
      account.provider === 'm365' || account.provider === 'gmail'
  );
}

/**
 * The only external capability granted to the meeting follow-up surface.
 * This adapter creates one provider draft and has no delivery or AI capability.
 */
export async function saveProviderFollowUpDraft(
  input: SaveProviderFollowUpDraftInput
): Promise<string> {
  const recipients = parseFollowUpRecipients(input.draft.to);
  if (
    !requiredIdentity(input) ||
    (input.account.provider !== 'm365' && input.account.provider !== 'gmail') ||
    recipients.length === 0 ||
    input.draft.body.trim() === ''
  ) {
    throw new Error('A complete provider follow-up draft is required.');
  }

  return mailSaveDraft(
    `${input.account.provider}:${input.account.account}`,
    recipients,
    input.draft.subject,
    followUpDraftBodyToHtml(input.draft.body)
  );
}

/**
 * `mailSaveDraft` returns only an opaque provider id, never a browser-safe
 * message URL. Open the provider's Drafts view rather than claiming an exact
 * message was opened.
 */
export function providerDraftsUrl(provider: FollowUpDraftProvider): string {
  return provider === 'gmail'
    ? 'https://mail.google.com/mail/u/0/#drafts'
    : 'https://outlook.office.com/mail/?path=/mail/drafts';
}
