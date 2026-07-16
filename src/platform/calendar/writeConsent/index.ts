/**
 * Calendar write consent — the public doorway (`@/platform/calendar/writeConsent`).
 *
 * This is deliberately NOT re-exported from `@/platform/calendar`. The calendar
 * foundation (P0-Q Part A) is local-first and imports no OAuth module; keeping
 * write consent behind its own index means an ordinary calendar consumer cannot
 * reach a consent path even by accident.
 *
 * What a consumer gets:
 *
 * - `requestCalendarWriteConsent` — the only way a read grant becomes a write
 *   grant. Verifies the provider's granted scopes, commits only on proof, and
 *   leaves the working read grant untouched on every other ending.
 * - `assertCalendarWriteAllowed` — the gate a provider writer calls before it
 *   touches a calendar.
 * - `writeConsentScopeRequest` / `normalizeGrantedScopes` /
 *   `evaluateGrantedCapability` — the pure scope rules, exported so the native
 *   port and its tests agree with this contract rather than restating it.
 * - the types describing a grant, a consent attempt, and a safe receipt.
 *
 * What no consumer can get: a token, a refresh token, a consent URL, a PKCE
 * verifier, or a provider error string. None of those are representable in the
 * exported shapes. See `types.ts` for why that is structural rather than a rule
 * someone has to remember.
 *
 * Paved path for extending this: `./SKILL.md`.
 */
export {
  evaluateGrantedCapability,
  normalizeGrantedScopes,
  writeConsentScopeRequest,
} from './scopeEvaluation';

export { assertCalendarWriteAllowed, requestCalendarWriteConsent } from './upgrade';

export type {
  CalendarConsentAttempt,
  CalendarConsentFailureReason,
  CalendarConsentPort,
  CalendarGrant,
  CalendarGrantCapability,
  CalendarWriteConsentInput,
  CalendarWriteConsentOutcome,
  CalendarWriteConsentReceipt,
  CalendarWriteConsentResult,
  CalendarWriteProviderId,
  StagedGrantRef,
} from './types';
