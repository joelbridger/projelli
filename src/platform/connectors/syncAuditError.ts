// Sanitize a connector sync error into a short, PII-free CATEGORY for the
// durable audit log.
//
// The audit log is append-only and persisted, so — unlike the transient error
// we show the user on their own screen — it must never carry a raw provider
// message, response body, mailbox address, filename, or token (the same
// log-privacy bar as `util/http_log.rs` on the Rust side). This maps a raw
// error string to one of a small, fixed set of machine categories. The raw
// message is still fine to render live in the connector panel (it is the
// owner's own error, on the owner's own machine) — it just never gets stored.

export type SyncErrorCategory =
  | 'auth_expired'
  | 'permission_denied'
  | 'rate_limited'
  | 'network'
  | 'server_error'
  | 'not_connected'
  | 'cancelled'
  | 'unknown';

/**
 * Classify a raw connector error into a stored-safe category. Keyword-based and
 * deliberately conservative: anything unrecognized becomes `'unknown'` rather
 * than leaking the raw text. Case-insensitive.
 */
export function sanitizeSyncError(raw: unknown): SyncErrorCategory {
  // Only a string or an Error carries a usable message. Anything else (object,
  // number, null) has no meaningful text, so it classifies as 'unknown' — and we
  // never risk stringifying an object into the log.
  const message =
    typeof raw === 'string' ? raw : raw instanceof Error ? raw.message : '';
  const s = message.toLowerCase();

  // Order matters: check the most specific signals first.
  if (s.includes('cancel')) return 'cancelled';
  if (
    s.includes('scope_upgrade_required') ||
    s.includes('invalid_grant') ||
    s.includes('reconnect') ||
    s.includes('not connected') ||
    s.includes('not_connected')
  ) {
    // A missing/expired sign-in the user must re-authenticate.
    return s.includes('not connected') || s.includes('not_connected')
      ? 'not_connected'
      : 'auth_expired';
  }
  if (
    s.includes('401') ||
    s.includes('unauthorized') ||
    s.includes('token') ||
    s.includes('expired') ||
    s.includes('authentication')
  ) {
    return 'auth_expired';
  }
  if (
    s.includes('403') ||
    s.includes('forbidden') ||
    s.includes('permission') ||
    s.includes('access denied') ||
    s.includes('insufficient')
  ) {
    return 'permission_denied';
  }
  if (s.includes('429') || s.includes('rate limit') || s.includes('too many requests')) {
    return 'rate_limited';
  }
  if (
    s.includes('timeout') ||
    s.includes('timed out') ||
    s.includes('network') ||
    s.includes('connection') ||
    s.includes('dns') ||
    s.includes('offline') ||
    s.includes('unreachable') ||
    s.includes('econn')
  ) {
    return 'network';
  }
  if (
    s.includes('500') ||
    s.includes('502') ||
    s.includes('503') ||
    s.includes('504') ||
    s.includes('server error') ||
    s.includes('internal error')
  ) {
    return 'server_error';
  }
  return 'unknown';
}

/** Human-readable label for a category, for any non-log surface that wants it. */
export function syncErrorCategoryLabel(category: SyncErrorCategory): string {
  switch (category) {
    case 'auth_expired':
      return 'Sign-in expired';
    case 'permission_denied':
      return 'Permission denied';
    case 'rate_limited':
      return 'Rate limited';
    case 'network':
      return 'Network problem';
    case 'server_error':
      return 'Provider server error';
    case 'not_connected':
      return 'Not connected';
    case 'cancelled':
      return 'Cancelled';
    case 'unknown':
      return 'Unknown error';
  }
}
