import type { MailAuthResult } from './emailReplyTypes';
import { MISSING_MAIL_AUTH_RESULT } from './emailReplyTypes';

export interface EmailAuthGateResult {
  authenticated: boolean;
  quarantine: boolean;
}

export function normalizeMailAuthResult(
  authResult?: MailAuthResult | null
): MailAuthResult {
  return authResult ?? MISSING_MAIL_AUTH_RESULT;
}

export function emailAuthResult(
  authResult?: MailAuthResult | null
): EmailAuthGateResult {
  const auth = normalizeMailAuthResult(authResult);
  const authenticated =
    auth.dmarc === 'pass' &&
    auth.aligned &&
    (auth.dkim === 'pass' || auth.spf === 'pass');
  return {
    authenticated,
    quarantine: !authenticated,
  };
}
