/** If a case fails, the bug is in WorkflowInstance CRDT doc shape — do NOT weaken it. */
import { describe, it } from 'vitest';

// WAVE-PENDING: B1/B3 — WorkflowInstance document shape and merge implementation.
describe.skip('WorkflowInstance CRDT convergence (WAVE-PENDING: B1/B3)', () => {
  it('converges byte-identically for 1,000 generated fixed permutations (fast-check; no Math.random)', () => {});
  it('is idempotent for duplicate immutable update blobs', () => {});
  it('keeps disjoint offline progress and derived-field edits after sync', () => {});
  it('uses the deterministic same-field conflict rule regardless of delivery order', () => {});
  it('performs watermark duplicate triage without a false gap repair', () => {});
});
