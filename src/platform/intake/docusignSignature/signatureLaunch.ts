export interface SignatureLaunchRecord {
  requestId: string;
  signatureItemId: string;
  recipientViewUrl: string;
  issuedAt: string;
  expiresAt: string;
  consumed: boolean;
}

/** DocuSign recipient-view URLs are short-lived and one-use; never issue one for more than 30 minutes. */
export const MAX_SIGNATURE_LAUNCH_TTL_MS = 30 * 60 * 1000;

function validDate(value: string): number | null {
  const timestamp = Date.parse(value);
  return Number.isNaN(timestamp) ? null : timestamp;
}

/** Throws before any attempt to open a stale or previously consumed ceremony URL. */
export function assertSignatureLaunchUsable(launch: SignatureLaunchRecord, nowIso: string): void {
  if (!launch || typeof launch !== 'object') throw new Error('Signature launch record is required.');
  if (typeof launch.consumed !== 'boolean') throw new Error('Signature launch consumed must be boolean.');
  if (typeof launch.requestId !== 'string' || !launch.requestId.trim()) throw new Error('Signature launch requestId is required.');
  if (typeof launch.signatureItemId !== 'string' || !launch.signatureItemId.trim()) throw new Error('Signature launch signatureItemId is required.');
  if (typeof launch.recipientViewUrl !== 'string' || !launch.recipientViewUrl.trim()) throw new Error('Signature launch recipientViewUrl is required.');
  const issuedAt = validDate(launch.issuedAt);
  const expiresAt = validDate(launch.expiresAt);
  const now = validDate(nowIso);
  if (issuedAt === null || expiresAt === null || now === null) throw new Error('Signature launch timestamps must be valid ISO timestamps.');
  if (expiresAt <= issuedAt) throw new Error('Signature launch expiry must be after issuance.');
  if (expiresAt - issuedAt > MAX_SIGNATURE_LAUNCH_TTL_MS) throw new Error('Signature launch expiry exceeds the maximum TTL.');
  if (launch.consumed) throw new Error('Signature launch has already been consumed.');
  if (expiresAt <= now) throw new Error('Signature launch has expired.');
}
