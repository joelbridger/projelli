import type { MailListItem } from '@/platform/utils/mail-commands';

export type DropboxHousehold = {
  id: string;
  name: string;
};

function terms(value: string): readonly string[] {
  return value
    .toLocaleLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((term) => term.length > 1);
}

/**
 * Makes a cautious local suggestion from email metadata. It never files a
 * message by itself: the advisor chooses the household before anything is
 * saved. Message bodies stay in the encrypted mail store and are not read here.
 */
export function suggestDropboxHousehold(
  email: Pick<MailListItem, 'subject' | 'fromAddr' | 'fromName' | 'snippet'>,
  households: readonly DropboxHousehold[],
): string | undefined {
  const emailTerms = new Set(terms(`${email.subject} ${email.fromName} ${email.fromAddr} ${email.snippet}`));
  let best: { id: string; score: number } | undefined;
  for (const household of households) {
    const score = terms(household.name).reduce(
      (total, term) => total + (emailTerms.has(term) ? 1 : 0),
      0,
    );
    if (score > 0 && (!best || score > best.score)) best = { id: household.id, score };
  }
  return best?.id;
}
