/**
 * Outlook (Microsoft Graph) write adapter.
 *
 * Idempotency: Graph events carry a `transactionId` that the service uses to
 * dedupe a replayed create — the same key on a retry returns the original event
 * instead of a second one. A reschedule is a PATCH guarded by `If-Match` on the
 * event's ETag, so a stale version is rejected by the service (412) rather than
 * silently overwriting a newer change.
 *
 * The body carries only advisor-authored event text and times. No token, no
 * consent URL, no client id — none of those are ever assembled here.
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

const OPERATION_ID = 'calendar-write-microsoft';
const IDENTITY: ProviderIdentityFields = { idField: 'id', versionField: '@odata.etag' };

function graphEventBody(proposal: CalendarWriteProposal): Record<string, unknown> {
  const { event } = proposal;
  return {
    subject: event.title,
    isAllDay: event.allDay,
    start: { dateTime: event.startUtc, timeZone: 'UTC' },
    end: { dateTime: event.endUtc, timeZone: 'UTC' },
    ...(event.notes !== null ? { body: { contentType: 'text', content: event.notes } } : {}),
    ...(event.location !== null ? { location: { displayName: event.location } } : {}),
  };
}

export const outlookWriteAdapter: CalendarWriteProviderAdapter = {
  provider: 'outlook',
  egressOperationId: OPERATION_ID,
  identityFields: IDENTITY,

  buildWriteRequest(proposal: CalendarWriteProposal): ProviderWriteRequest {
    const base = graphEventBody(proposal);
    if (proposal.kind === 'create') {
      return {
        operationId: OPERATION_ID,
        provider: 'outlook',
        method: 'create',
        idempotencyKey: proposal.idempotencyKey,
        targetCalendarId: proposal.targetCalendarId,
        // Graph dedupes a replayed create on transactionId.
        body: { ...base, transactionId: proposal.idempotencyKey },
      };
    }
    return {
      operationId: OPERATION_ID,
      provider: 'outlook',
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
    const targetEventId = proposal.target?.providerEventId ?? proposal.confirmed?.providerEventId;
    return {
      operationId: OPERATION_ID,
      provider: 'outlook',
      idempotencyKey: proposal.idempotencyKey,
      targetCalendarId: proposal.targetCalendarId,
      ...(targetEventId !== undefined ? { targetEventId } : {}),
    };
  },

  interpretWrite(raw: unknown): VerifiedWriteResult {
    return interpretWriteResponse(raw, IDENTITY);
  },

  interpretReconcile(raw: unknown): VerifiedReconcileResult {
    return interpretReconcileResponse(raw, IDENTITY);
  },
};
