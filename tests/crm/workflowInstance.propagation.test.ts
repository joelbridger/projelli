import { describe, it } from 'vitest';

// WAVE-PENDING: B3 — propagation engine, offer store, decision ledger, and transactional outbox.
describe.skip('WorkflowInstance propagation delivery (WAVE-PENDING: B3)', () => {
  it('keeps approval notices after eight offline days until terminal plus every active-device acknowledgement', () => {});
  it('expires informational notices at seven days with a durable dead-letter marker', () => {});
  it('rejects new client-confidential sends to an ineligible seat without claiming retrospective withdrawal', () => {});
  it('delivers firm-operational notices to walled firm seats without client title, body, link, or key', () => {});
});
