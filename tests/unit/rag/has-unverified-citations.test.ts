/**
 * BUG-065 (residual c) — the chat answer's "unverified citations" warning banner
 * must fire whenever the answer contains ANY citation that isn't PROVEN: a source
 * that failed verification, OR a citation that resolves to no retrieved source at
 * all (a fabricated locator). Previously it only fired on a verified:false source.
 */
import { describe, it, expect } from 'vitest';
import { hasUnverifiedCitations } from '@/platform/rag/workspaceCommand';
import type { WorkspaceSource } from '@/platform/types/ai';

const src = (over: Partial<WorkspaceSource>): WorkspaceSource => ({
  path: 'notes/pricing.md',
  chunkText: 'Premium tier priced at $49',
  paragraphIndex: 3,
  id: 'cid-1',
  matterId: 'matter-A',
  ...over,
} as WorkspaceSource);

describe('hasUnverifiedCitations', () => {
  it('is false when every citation resolves to a verified source', () => {
    expect(hasUnverifiedCitations('See [pricing.md paragraph 3].', [src({ verified: true })])).toBe(false);
  });

  it('is true when a cited source failed verification (verified:false)', () => {
    expect(hasUnverifiedCitations('See [pricing.md paragraph 3].', [src({ verified: false })])).toBe(true);
  });

  it('is true when a cited source was never verified (verified:undefined)', () => {
    expect(hasUnverifiedCitations('See [pricing.md paragraph 3].', [src({})])).toBe(true);
  });

  it('is true for a FABRICATED citation that resolves to no source', () => {
    expect(hasUnverifiedCitations('See [made-up.md paragraph 9].', [src({ verified: true })])).toBe(true);
  });

  it('is true when one of several citations is unproven', () => {
    const sources = [src({ verified: true }), src({ path: 'b.md', paragraphIndex: 1, id: 'cid-2', verified: false })];
    expect(hasUnverifiedCitations('A [pricing.md paragraph 3] and B [b.md paragraph 1].', sources)).toBe(true);
  });

  it('is false when there are no citations at all', () => {
    expect(hasUnverifiedCitations('A plain answer with no citations.', [src({ verified: true })])).toBe(false);
  });
});
