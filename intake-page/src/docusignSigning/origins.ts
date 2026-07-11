/** The static page DocuSign may return to after the signing ceremony. */
export const DOCUSIGN_RETURN_PATH = '/docusign-signing-return';
export const DOCUSIGN_RETURN_EVENT_PARAM = 'event';

export const DOCUSIGN_CEREMONY_OUTCOMES = [
  'signing_complete',
  'cancel',
  'decline',
  'ttl_expired',
  'exception',
] as const;

export type DocusignCeremonyOutcome = (typeof DOCUSIGN_CEREMONY_OUTCOMES)[number];

/**
 * This is deliberately calculated from the running public page. It gives
 * postMessage an exact scheme, host, and port, rather than a wildcard.
 */
export function appOrigin(): string {
  const origin = window.location.origin;
  if (!origin || origin === 'null') throw new Error('This signing return page needs a secure web address.');
  return origin;
}

export function isDocusignCeremonyOutcome(value: unknown): value is DocusignCeremonyOutcome {
  return typeof value === 'string' && (DOCUSIGN_CEREMONY_OUTCOMES as readonly string[]).includes(value);
}

export function isDocusignReturnPath(pathname: string): boolean {
  return pathname === DOCUSIGN_RETURN_PATH;
}
