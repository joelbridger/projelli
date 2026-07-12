import { describe, expect, it } from 'vitest';
import { UNTOUCHED, type HlcStamp, type ProposalRecord, type RawArchiveEntry } from './index';

describe('CRM core shared types', () => {
  it('keeps the frozen workflow and archive discriminators available', () => {
    const stamp: HlcStamp = { wallMillis: 1, logicalCounter: 0, actorId: 'advisor', operationId: 'op-1' };
    const raw: RawArchiveEntry = {
      rawRecordId: 'raw-1', requestPath: '/contacts', captureLayerVersion: 'v1',
      fixtureCorpusIdentity: 'synthetic-v1', capturedAt: '2026-01-01T00:00:00Z',
      responseSha256: 'abc', byteLength: 3, typedOutcome: 'landed', resultingExternalRefs: [],
    };
    expect(stamp.logicalCounter).toBe(0);
    expect(raw.typedOutcome).toBe('landed');
    expect(UNTOUCHED).toBe('todo');
    const proposalKind: ProposalRecord['proposalKind'] = 'communication_draft';
    expect(proposalKind).toBe('communication_draft');
  });
});
