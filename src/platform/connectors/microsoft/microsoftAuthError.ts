/**
 * Maps the raw Microsoft OAuth/Graph sentinel error strings the Rust backend
 * surfaces verbatim through Tauri's invoke() rejection (mail/connect.rs,
 * onedrive/commands.rs, mail/graph.rs) to one honest, plain-language message.
 *
 * These strings were never meant for a screen — `scope_upgrade_required`,
 * `invalid_grant`, `refresh failed: ...`, and `not connected` are internal
 * TokenOutcome/anyhow sentinels for "the stored Microsoft sign-in no longer
 * works", but MailConnect and OneDriveConnect used to render them raw next to
 * "Mail/OneDrive sync ran into a problem:". Shared here so both connectors
 * (and any future one) agree on what counts as an expired sign-in and show
 * the exact same plain copy.
 */

const MICROSOFT_SIGNIN_EXPIRED_PATTERNS = [
  'invalid_grant',
  'scope_upgrade_required',
  'refresh failed',
  'not connected',
];

export const MICROSOFT_SIGNIN_EXPIRED_MESSAGE =
  'Your Microsoft sign-in expired. Click Reconnect.';

/** True when `raw` is one of the known "the stored Microsoft token is dead"
 *  sentinels rather than some other sync failure (network, permissions, etc.). */
export function isMicrosoftSignInExpiredError(raw: string): boolean {
  const lower = raw.toLowerCase();
  return MICROSOFT_SIGNIN_EXPIRED_PATTERNS.some((pattern) => lower.includes(pattern));
}
