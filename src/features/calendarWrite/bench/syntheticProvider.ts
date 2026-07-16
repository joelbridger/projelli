/**
 * Synthetic provider — an in-memory stand-in for Microsoft Graph / Google
 * Calendar that lets the bench prove the write invariants without a network.
 *
 * It models the two things the invariants turn on: idempotency (a replay of the
 * same key returns the original event, never a second one) and optimistic
 * concurrency (an update whose expected version does not match the current one
 * is a conflict). It can also be told to time out, reject, drop the network, or
 * return a body laced with secrets — so the no-secret and verify_pending proofs
 * exercise a hostile port, not a friendly one.
 */
import type {
  CalendarWriteProviderPort,
  ProviderVerifyQuery,
  ProviderWriteRequest,
} from '../providerPort';
import type { CalendarWriteFailureReason } from '../types';

interface StoredEvent {
  id: string;
  etag: string;
  calendarId: string;
  key: string;
}

type Behaviour =
  | { kind: 'normal' }
  | { kind: 'timeout' }
  | { kind: 'network' }
  | { kind: 'reject'; reason?: string }
  | { kind: 'throw' }
  | { kind: 'silent-success' } // the write lands server-side, but the reply is lost (timeout)
  | { kind: 'hostile-ok' }; // 2xx, real id/etag, but body laced with secrets

/** A body a real provider error would carry; must never reach a receipt/store. */
export const SECRET_MARKERS = [
  'access_token',
  'refresh_token',
  'client_id',
  'code_verifier',
  'Bearer ',
  'login.microsoftonline.com/common/oauth2',
  'https://accounts.google.com/o/oauth2',
];

function versionField(provider: string): string {
  return provider === 'google' ? 'etag' : '@odata.etag';
}

function hostileExtras(): Record<string, unknown> {
  return {
    access_token: 'ya29.SECRET-ACCESS-TOKEN',
    refresh_token: '1//SECRET-REFRESH',
    error: 'invalid_grant',
    error_uri:
      'https://login.microsoftonline.com/common/oauth2/v2.0/authorize?client_id=SECRET&code_verifier=SECRET',
  };
}

export class SyntheticProvider implements CalendarWriteProviderPort {
  private events = new Map<string, StoredEvent>(); // by provider event id
  private byKey = new Map<string, string>(); // idempotency key -> event id
  private seq = 0;

  /** How many brand-new events were actually created. Duplicates never bump it. */
  createdCount = 0;
  submitCalls = 0;
  verifyCalls = 0;

  private nextSubmit: Behaviour = { kind: 'normal' };
  private nextVerify: Behaviour = { kind: 'normal' };

  submitBehaviour(b: Behaviour): void {
    this.nextSubmit = b;
  }
  verifyBehaviour(b: Behaviour): void {
    this.nextVerify = b;
  }

  /** Seed an existing provider event (e.g. the target of an update). */
  seedEvent(event: StoredEvent): void {
    this.events.set(event.id, event);
    if (event.key) this.byKey.set(event.key, event.id);
  }

  currentEtag(eventId: string): string | undefined {
    return this.events.get(eventId)?.etag;
  }

  private envelope(provider: string, ev: StoredEvent, hostile = false): unknown {
    return {
      transport: 'ok',
      body: {
        id: ev.id,
        [versionField(provider)]: ev.etag,
        ...(hostile ? hostileExtras() : {}),
      },
    };
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- models an async port synchronously; the interface is Promise-returning.
  async submitWrite(request: ProviderWriteRequest): Promise<unknown> {
    this.submitCalls += 1;
    const behaviour = this.nextSubmit;
    this.nextSubmit = { kind: 'normal' };

    if (behaviour.kind === 'throw') throw new Error('synthetic transport failure');
    if (behaviour.kind === 'timeout') return { transport: 'timeout' };
    if (behaviour.kind === 'network') return { transport: 'network_error' };
    if (behaviour.kind === 'reject') return { transport: 'rejected', reason: behaviour.reason };

    const silent = behaviour.kind === 'silent-success';

    if (request.method === 'update') {
      const targetId = request.targetEventId ?? '';
      const existing = this.events.get(targetId);
      if (!existing) return { transport: 'not_found' };
      // Optimistic concurrency: a mismatched If-Match is a conflict.
      if (request.expectedVersion !== existing.etag) return { transport: 'conflict' };
      const bumped: StoredEvent = { ...existing, etag: `v${String((this.seq += 1))}` };
      this.events.set(targetId, bumped);
      if (silent) return { transport: 'timeout' };
      return this.envelope(request.provider, bumped, behaviour.kind === 'hostile-ok');
    }

    // create: dedupe on the idempotency key.
    const existingId = this.byKey.get(request.idempotencyKey);
    const existing = existingId ? this.events.get(existingId) : undefined;
    if (existing) {
      if (silent) return { transport: 'timeout' };
      return this.envelope(request.provider, existing, behaviour.kind === 'hostile-ok');
    }
    const id =
      request.provider === 'google'
        ? request.idempotencyKey // client-assigned id == key
        : `ms-${String((this.seq += 1))}`;
    const ev: StoredEvent = { id, etag: `v${String((this.seq += 1))}`, calendarId: request.targetCalendarId, key: request.idempotencyKey };
    this.events.set(id, ev);
    this.byKey.set(request.idempotencyKey, id);
    this.createdCount += 1;
    // The write landed; the reply is lost. The orchestrator must NOT assume
    // failure and must NOT re-create — it must verify and find this event.
    if (silent) return { transport: 'timeout' };
    return this.envelope(request.provider, ev, behaviour.kind === 'hostile-ok');
  }

  // eslint-disable-next-line @typescript-eslint/require-await -- models an async port synchronously; the interface is Promise-returning.
  async verifyWrite(query: ProviderVerifyQuery): Promise<unknown> {
    this.verifyCalls += 1;
    const behaviour = this.nextVerify;
    this.nextVerify = { kind: 'normal' };

    if (behaviour.kind === 'throw') throw new Error('synthetic verify failure');
    if (behaviour.kind === 'timeout') return { transport: 'timeout' };
    if (behaviour.kind === 'network') return { transport: 'network_error' };
    if (behaviour.kind === 'reject') return { transport: 'rejected', reason: behaviour.reason };

    const eventId = this.byKey.get(query.idempotencyKey) ?? query.targetEventId ?? '';
    const ev = this.events.get(eventId);
    if (!ev) return { transport: 'not_found' };
    return this.envelope(query.provider, ev, behaviour.kind === 'hostile-ok');
  }
}

export type SyntheticFailure = CalendarWriteFailureReason;
