import { describe, it } from 'vitest';

// WIRE-PENDING: relay eligibility, active-device acknowledgements, and wall/key rotation are not ports exposed by NotificationClient.
describe.skip('WorkflowInstance propagation delivery (WIRE-PENDING: relay retention seam)', () => {
  it('keeps approval notices after eight offline days until terminal plus every active-device acknowledgement', () => {});
  it('expires informational notices at seven days with a durable dead-letter marker', () => {});
  it('rejects new client-confidential sends to an ineligible seat without claiming retrospective withdrawal', () => {});
  it('delivers firm-operational notices to walled firm seats without client title, body, link, or key', () => {});
});
