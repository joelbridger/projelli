/** If a case fails, the bug is in Task CRDT doc shape — do NOT weaken it. */
import { describe, it } from 'vitest';

// WAVE-PENDING: B1/B3 — CRM Task document shape and lossless cursor client.
describe.skip('Task CRDT convergence (WAVE-PENDING: B1/B3)', () => {
  it('converges byte-identically for 1,000 generated fixed update permutations (fast-check; no Math.random)', () => {});
  it('is idempotent when an immutable update blob is delivered twice', () => {});
  it('preserves disjoint offline Task field edits after bidirectional sync', () => {});
  it('resolves same-field offline edits deterministically and byte-identically regardless of sync order', () => {});
  it('ignores a matching subscribe-to-watermark duplicate and reaches Live', () => {});
  it('treats an old cursor with a mismatched immutable blob identity as corruption', () => {});
});
