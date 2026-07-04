/**
 * Task 13 — state-by-state recording-consent guidance (US). This is
 * GUIDANCE, not legal advice: an advisor should confirm their own state's
 * rules with counsel. The list is the standard all-party-consent set.
 */

export const disclaimer =
  "This is general guidance, not legal advice. Confirm your state's recording-consent rules with your own counsel.";

export const TWO_PARTY_STATES: ReadonlySet<string> = new Set([
  'CA', 'CT', 'DE', 'FL', 'IL', 'MD', 'MA', 'MI', 'MT', 'NV', 'NH', 'OR', 'PA', 'VT', 'WA',
]);

/** The 50 states + DC — used only to tell "known one-party state" apart from
 *  an unrecognized/invalid code, which must fall back to the safe default
 *  rather than be assumed one-party. */
const KNOWN_STATES: ReadonlySet<string> = new Set([
  'AL', 'AK', 'AZ', 'AR', 'CA', 'CO', 'CT', 'DE', 'FL', 'GA', 'HI', 'ID', 'IL', 'IN', 'IA',
  'KS', 'KY', 'LA', 'ME', 'MD', 'MA', 'MI', 'MN', 'MS', 'MO', 'MT', 'NE', 'NV', 'NH', 'NJ',
  'NM', 'NY', 'NC', 'ND', 'OH', 'OK', 'OR', 'PA', 'RI', 'SC', 'SD', 'TN', 'TX', 'UT', 'VT',
  'VA', 'WA', 'WV', 'WI', 'WY', 'DC',
]);

/** Unknown/null/invalid state codes default to 'two-party' — the safe default. */
export function consentModeFor(stateCode: string | null): 'one-party' | 'two-party' {
  if (!stateCode || !KNOWN_STATES.has(stateCode)) return 'two-party';
  return TWO_PARTY_STATES.has(stateCode) ? 'two-party' : 'one-party';
}
