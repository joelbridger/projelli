/**
 * The provider write port and its boundary.
 *
 * A provider write leaves the device, so two things must be true and neither can
 * be assumed from a `.d.ts`: the call goes through a registered egress operation,
 * and everything that comes back is untrusted until validated here. The port is
 * the transport seam the native layer (or the synthetic bench) implements; the
 * interpreters below are where an untrusted response becomes a small, closed set
 * of trusted outcomes.
 *
 * What can never cross this boundary: a token, a consent URL, a PKCE verifier, a
 * client id, or a provider error string. Only an opaque event id and an opaque
 * version string are read out of a response; a rejection is mapped to a closed
 * failure code and the provider's own message is dropped, exactly as the consent
 * contract drops it. That is why `interpret*` take `unknown` and return a union
 * with no free-text field.
 */
import type {
  CalendarWriteFailureReason,
  CalendarWriteProviderId,
} from './types';

/**
 * A provider-agnostic write request. The adapter builds it from a proposal; the
 * port turns it into an actual HTTPS call through the operation named by
 * `operationId`. The body is provider-specific but carries no secret — an
 * idempotency token, an event title, times, and location only.
 */
export interface ProviderWriteRequest {
  /** The registered egress operation this call must go through. */
  readonly operationId: string;
  readonly provider: CalendarWriteProviderId;
  readonly method: 'create' | 'update';
  /** Stable across retries; presented to the provider so a replay dedupes. */
  readonly idempotencyKey: string;
  readonly targetCalendarId: string;
  /** Update only: the provider event being rescheduled. */
  readonly targetEventId?: string;
  /** Update only: the version the reschedule was decided against (If-Match). */
  readonly expectedVersion?: string;
  readonly body: Readonly<Record<string, unknown>>;
}

export interface ProviderVerifyQuery {
  readonly operationId: string;
  readonly provider: CalendarWriteProviderId;
  readonly idempotencyKey: string;
  readonly targetCalendarId: string;
  readonly targetEventId?: string;
}

/**
 * The transport seam. A conforming implementation performs the call and returns
 * a response envelope; a non-conforming one returns anything at all, which is
 * why the return type is `unknown` and every caller validates.
 */
export interface CalendarWriteProviderPort {
  submitWrite(request: ProviderWriteRequest): Promise<unknown>;
  verifyWrite(query: ProviderVerifyQuery): Promise<unknown>;
}

/** The trusted outcome of a submit, after boundary validation. */
export type VerifiedWriteResult =
  | {
      readonly outcome: 'written';
      readonly providerEventId: string;
      readonly providerVersion: string;
    }
  | { readonly outcome: 'stale' }
  | { readonly outcome: 'ambiguous' }
  | { readonly outcome: 'failed'; readonly reason: CalendarWriteFailureReason };

/** The trusted outcome of a verify/reconcile, after boundary validation. */
export type VerifiedReconcileResult =
  | {
      readonly outcome: 'present';
      readonly providerEventId: string;
      readonly providerVersion: string;
    }
  | { readonly outcome: 'absent' }
  | { readonly outcome: 'ambiguous' }
  | { readonly outcome: 'failed'; readonly reason: CalendarWriteFailureReason };

const FAILURE_REASONS: ReadonlySet<string> = new Set<CalendarWriteFailureReason>([
  'network_unavailable',
  'provider_rejected',
  'timeout',
  'conflict',
  'internal',
]);

/**
 * The transport-level classification a conforming port reports. Anything else is
 * treated as `internal` — a value the contract never defined must not be read as
 * a success.
 */
type Transport =
  | 'ok'
  | 'conflict'
  | 'timeout'
  | 'network_error'
  | 'rejected'
  | 'not_found';

function readTransport(value: unknown): Transport | undefined {
  return value === 'ok' ||
    value === 'conflict' ||
    value === 'timeout' ||
    value === 'network_error' ||
    value === 'rejected' ||
    value === 'not_found'
    ? value
    : undefined;
}

/**
 * The identity fields differ by provider (`@odata.etag` vs `etag`), so the
 * adapter passes the two field names. Only these two strings are ever read out
 * of a body; nothing else — including any `error`/`message` field — is touched.
 */
export interface ProviderIdentityFields {
  readonly idField: string;
  readonly versionField: string;
}

function readSafeIdentity(
  body: unknown,
  fields: ProviderIdentityFields,
): { id: string; version: string } | undefined {
  if (!body || typeof body !== 'object') return undefined;
  const record = body as Record<string, unknown>;
  const id = record[fields.idField];
  const version = record[fields.versionField];
  if (typeof id !== 'string' || id.length === 0) return undefined;
  if (typeof version !== 'string' || version.length === 0) return undefined;
  return { id, version };
}

function coerceFailure(value: unknown): CalendarWriteFailureReason {
  return typeof value === 'string' && FAILURE_REASONS.has(value)
    ? (value as CalendarWriteFailureReason)
    : 'internal';
}

/**
 * Validate a submit response. Unclear or unrecognized outcomes fail closed:
 * `ambiguous` (→ verify_pending) when the write MIGHT have landed but cannot be
 * confirmed, `failed` when it definitely did not. Never `written` without a
 * real id and version read from the body.
 */
export function interpretWriteResponse(
  raw: unknown,
  fields: ProviderIdentityFields,
): VerifiedWriteResult {
  if (!raw || typeof raw !== 'object') {
    // No usable envelope at all — the call's fate is unknown, so we must not
    // claim success and must not claim clean failure. Verify before anything.
    return { outcome: 'ambiguous' };
  }
  const envelope = raw as { transport?: unknown; body?: unknown; reason?: unknown };
  const transport = readTransport(envelope.transport);

  switch (transport) {
    case 'ok': {
      const identity = readSafeIdentity(envelope.body, fields);
      // A 2xx with no readable id/version means we cannot prove the write; treat
      // it as ambiguous so it is verified rather than assumed done.
      return identity
        ? { outcome: 'written', providerEventId: identity.id, providerVersion: identity.version }
        : { outcome: 'ambiguous' };
    }
    case 'conflict':
      return { outcome: 'stale' };
    case 'timeout':
      return { outcome: 'ambiguous' };
    case 'network_error':
      return { outcome: 'failed', reason: 'network_unavailable' };
    case 'rejected':
      // The provider said no. Its message is dropped; only the coerced code
      // survives, so a consent URL echoed in an error cannot reach a receipt.
      return { outcome: 'failed', reason: coerceFailure(envelope.reason) };
    case 'not_found':
    case undefined:
    default:
      // `not_found` has no meaning for a submit, and an unrecognized transport
      // is not a success. Verify rather than assume.
      return { outcome: 'ambiguous' };
  }
}

/**
 * Validate a verify/reconcile response. `present` means the earlier write is
 * durable on the provider (confirm, do not re-fire). `absent` means it is safe
 * to re-submit with the same idempotency key. Anything unclear stays ambiguous.
 */
export function interpretReconcileResponse(
  raw: unknown,
  fields: ProviderIdentityFields,
): VerifiedReconcileResult {
  if (!raw || typeof raw !== 'object') {
    return { outcome: 'ambiguous' };
  }
  const envelope = raw as { transport?: unknown; body?: unknown; reason?: unknown };
  const transport = readTransport(envelope.transport);

  switch (transport) {
    case 'ok': {
      const identity = readSafeIdentity(envelope.body, fields);
      return identity
        ? { outcome: 'present', providerEventId: identity.id, providerVersion: identity.version }
        : { outcome: 'ambiguous' };
    }
    case 'not_found':
      return { outcome: 'absent' };
    case 'timeout':
      return { outcome: 'ambiguous' };
    case 'network_error':
      return { outcome: 'failed', reason: 'network_unavailable' };
    case 'rejected':
      return { outcome: 'failed', reason: coerceFailure(envelope.reason) };
    case 'conflict':
    case undefined:
    default:
      return { outcome: 'ambiguous' };
  }
}
