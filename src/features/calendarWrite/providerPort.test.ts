import { describe, expect, it } from 'vitest';
import {
  interpretReconcileResponse,
  interpretWriteResponse,
  type ProviderIdentityFields,
} from './providerPort';

const GRAPH: ProviderIdentityFields = { idField: 'id', versionField: '@odata.etag' };

describe('interpretWriteResponse', () => {
  it('reads only the id and version out of an ok body', () => {
    const result = interpretWriteResponse(
      {
        transport: 'ok',
        body: {
          id: 'evt-9',
          '@odata.etag': 'W/"7"',
          // hostile extras that must be ignored:
          access_token: 'SECRET',
          error: 'https://login.microsoftonline.com/authorize?client_id=abc&state=xyz',
        },
      },
      GRAPH,
    );
    expect(result).toEqual({ outcome: 'written', providerEventId: 'evt-9', providerVersion: 'W/"7"' });
  });

  it('maps a conflict transport to stale (never overwrites)', () => {
    expect(interpretWriteResponse({ transport: 'conflict' }, GRAPH)).toEqual({ outcome: 'stale' });
  });

  it('maps a timeout to ambiguous (verify, do not assume)', () => {
    expect(interpretWriteResponse({ transport: 'timeout' }, GRAPH)).toEqual({ outcome: 'ambiguous' });
  });

  it('maps a network error to a closed failure code', () => {
    expect(interpretWriteResponse({ transport: 'network_error' }, GRAPH)).toEqual({
      outcome: 'failed',
      reason: 'network_unavailable',
    });
  });

  it('drops provider error text on rejection, coercing the reason', () => {
    const result = interpretWriteResponse(
      { transport: 'rejected', reason: 'https://login.microsoftonline.com/authorize?client_id=SECRET' },
      GRAPH,
    );
    expect(result).toEqual({ outcome: 'failed', reason: 'internal' });
  });

  it('keeps a recognized failure code on rejection', () => {
    expect(interpretWriteResponse({ transport: 'rejected', reason: 'provider_rejected' }, GRAPH)).toEqual({
      outcome: 'failed',
      reason: 'provider_rejected',
    });
  });

  it('treats an ok body without a usable id/version as ambiguous (never claims written)', () => {
    expect(interpretWriteResponse({ transport: 'ok', body: {} }, GRAPH)).toEqual({ outcome: 'ambiguous' });
    expect(interpretWriteResponse({ transport: 'ok', body: { id: '', '@odata.etag': 'x' } }, GRAPH)).toEqual({
      outcome: 'ambiguous',
    });
    expect(interpretWriteResponse({ transport: 'ok', body: { id: 5, '@odata.etag': 'x' } }, GRAPH)).toEqual({
      outcome: 'ambiguous',
    });
  });

  it('treats junk / unknown transports as ambiguous, never written', () => {
    expect(interpretWriteResponse(null, GRAPH)).toEqual({ outcome: 'ambiguous' });
    expect(interpretWriteResponse('ok', GRAPH)).toEqual({ outcome: 'ambiguous' });
    expect(interpretWriteResponse({ transport: 'wat' }, GRAPH)).toEqual({ outcome: 'ambiguous' });
    expect(interpretWriteResponse({ transport: 'not_found' }, GRAPH)).toEqual({ outcome: 'ambiguous' });
  });
});

describe('interpretReconcileResponse', () => {
  it('reports present with id/version when the event is found', () => {
    expect(
      interpretReconcileResponse({ transport: 'ok', body: { id: 'evt-1', '@odata.etag': 'W/"3"' } }, GRAPH),
    ).toEqual({ outcome: 'present', providerEventId: 'evt-1', providerVersion: 'W/"3"' });
  });

  it('reports absent on not_found (safe to re-submit with same key)', () => {
    expect(interpretReconcileResponse({ transport: 'not_found' }, GRAPH)).toEqual({ outcome: 'absent' });
  });

  it('stays ambiguous on timeout or junk', () => {
    expect(interpretReconcileResponse({ transport: 'timeout' }, GRAPH)).toEqual({ outcome: 'ambiguous' });
    expect(interpretReconcileResponse(undefined, GRAPH)).toEqual({ outcome: 'ambiguous' });
    expect(interpretReconcileResponse({ transport: 'ok', body: null }, GRAPH)).toEqual({ outcome: 'ambiguous' });
  });
});
