/**
 * Google Calendar write adapter.
 *
 * Idempotency: Google Calendar `events.insert` accepts a client-assigned event
 * `id`. Reusing the same id on a retry makes the insert a no-op on the second
 * try (the service reports the id already exists) instead of creating a
 * duplicate. Our idempotency key is a 32-char hex string, which is a valid
 * base32hex event id, so the key IS the id. A reschedule is a PATCH guarded by
 * `If-Match` on the ETag, so a stale version is rejected (412) not overwritten.
 *
 * The body carries only advisor-authored event text and times.
 */
import type { CalendarWriteProposal } from '../types';
import type {
  ProviderIdentityFields,
  ProviderVerifyQuery,
  ProviderWriteRequest,
  VerifiedReconcileResult,
  VerifiedWriteResult,
} from '../providerPort';
import { interpretReconcileResponse, interpretWriteResponse } from '../providerPort';
import type { CalendarWriteProviderAdapter } from './types';

const OPERATION_ID = 'calendar-write-google';
const IDENTITY: ProviderIdentityFields = { idField: 'id', versionField: 'etag' };

function googleEventBody(proposal: CalendarWriteProposal): Record<string, unknown> {
  const { event } = proposal;
  // An all-day event uses date (not dateTime); take the calendar date in UTC.
  const timing = event.allDay
    ? { start: { date: event.startUtc.slice(0, 10) }, end: { date: event.endUtc.slice(0, 10) } }
    : {
        start: { dateTime: event.startUtc, timeZone: 'UTC' },
        end: { dateTime: event.endUtc, timeZone: 'UTC' },
      };
  return {
    summary: event.title,
    ...timing,
    ...(event.notes !== null ? { description: event.notes } : {}),
    ...(event.location !== null ? { location: event.location } : {}),
  };
}

export const googleWriteAdapter: CalendarWriteProviderAdapter = {
  provider: 'google',
  egressOperationId: OPERATION_ID,
  identityFields: IDENTITY,

  buildWriteRequest(proposal: CalendarWriteProposal): ProviderWriteRequest {
    const base = googleEventBody(proposal);
    if (proposal.kind === 'create') {
      return {
        operationId: OPERATION_ID,
        provider: 'google',
        method: 'create',
        idempotencyKey: proposal.idempotencyKey,
        targetCalendarId: proposal.targetCalendarId,
        // The key is a valid base32hex event id; assigning it makes insert
        // idempotent.
        body: { ...base, id: proposal.idempotencyKey },
      };
    }
    return {
      operationId: OPERATION_ID,
      provider: 'google',
      method: 'update',
      idempotencyKey: proposal.idempotencyKey,
      targetCalendarId: proposal.targetCalendarId,
      ...(proposal.target
        ? { targetEventId: proposal.target.providerEventId, expectedVersion: proposal.target.expectedVersion }
        : {}),
      body: base,
    };
  },

  buildVerifyQuery(proposal: CalendarWriteProposal): ProviderVerifyQuery {
    return {
      operationId: OPERATION_ID,
      provider: 'google',
      idempotencyKey: proposal.idempotencyKey,
      targetCalendarId: proposal.targetCalendarId,
      // For a create, the assigned id equals the idempotency key; for an update,
      // it is the target event. Either way we can look the event up.
      targetEventId:
        proposal.target?.providerEventId ??
        proposal.confirmed?.providerEventId ??
        proposal.idempotencyKey,
    };
  },

  interpretWrite(raw: unknown): VerifiedWriteResult {
    return interpretWriteResponse(raw, IDENTITY);
  },

  interpretReconcile(raw: unknown): VerifiedReconcileResult {
    return interpretReconcileResponse(raw, IDENTITY);
  },
};
