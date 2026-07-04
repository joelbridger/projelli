// R6 (Tier B trust guard) — whole-practice pre-send truth.
//
// A "whole practice" Ask compresses a short summary from EVERY client and, in
// cloud mode, ships all of them to the AI provider in one request. That's "a
// little of all my clients at once," which the "summaries only" scope pill
// makes sound smaller, not bigger. So before that send leaves in cloud mode we
// surface one honest confirm naming the real client count and the real
// provider. Local-only mode (nothing leaves the machine) never asks, and an
// advisor may choose to remember their answer — but the default is to ask.
import { isLocalProvider, providerDisplayName } from '@/platform/privacy/egress';

export interface WholePracticeSendDecision {
  /** True when a cloud send should be confirmed with the advisor first. */
  needsConfirm: boolean;
  /** How many clients' summaries would actually leave (0 => nothing sends). */
  clientCount: number;
  /** The real provider name to show, or null when it isn't resolved yet. */
  providerName: string | null;
}

export function decideWholePracticeSend(opts: {
  /** The provider the send will use (the same id the egress indicator shows), or null while resolving. */
  provider: string | null;
  /** Clients whose summaries would be sent (buildBookFactsDigest(...).clients.length). */
  clientCount: number;
  /** The advisor's remembered "don't ask again" choice. */
  remembered: boolean;
}): WholePracticeSendDecision {
  const { provider, clientCount, remembered } = opts;
  const local = provider !== null && isLocalProvider(provider);
  const providerName = provider !== null && !local ? providerDisplayName(provider) : null;
  // Nothing leaves the machine when there are no clients to send, when the
  // provider is local, or when the advisor already chose to skip the prompt.
  const needsConfirm = clientCount > 0 && !local && !remembered;
  return { needsConfirm, clientCount, providerName };
}

/** localStorage key for the advisor's remembered whole-practice send choice. */
export const REMEMBERED_WHOLE_PRACTICE_KEY = 'kp-whole-practice-send-remembered';

export function getRememberedWholePracticeConsent(): boolean {
  try {
    return localStorage.getItem(REMEMBERED_WHOLE_PRACTICE_KEY) === '1';
  } catch {
    return false;
  }
}

export function setRememberedWholePracticeConsent(remembered: boolean): void {
  try {
    if (remembered) localStorage.setItem(REMEMBERED_WHOLE_PRACTICE_KEY, '1');
    else localStorage.removeItem(REMEMBERED_WHOLE_PRACTICE_KEY);
  } catch {
    /* private mode / no storage — falls back to always-ask, the safe default */
  }
}
