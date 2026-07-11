/** If a case fails, the bug is in Task CRDT doc shape — do NOT weaken it. */
import { describe, it } from 'vitest';

// WAVE-PENDING: B1/B3 — CRM Task document shape and merge implementation.
describe.skip('Task chaos: fixed-permutation commutativity and idempotency (WAVE-PENDING: B1/B3)', () => {
  it('has no Math.random and converges under every declared fixed permutation (fast-check, 1,000 runs)', () => {});
  it('does not duplicate state when every concurrent blob is replayed twice', () => {});
});
