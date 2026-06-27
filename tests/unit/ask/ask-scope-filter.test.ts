/**
 * Ask scope filter (email/documents) — Wave 2 email relocation.
 *
 * The Email pill in the Ask ScopeToggle restricts answers to imported email by
 * filtering retrieved RAG hits client-side: email hits are those tagged
 * source_type='mail' (or whose path/sourceId is a `mail:<id>`). These pure
 * helpers had no direct coverage; locking them protects the relocation.
 */
import { describe, it, expect } from 'vitest';
import { isMailHit, filterHitsByScope } from '@/features/ask/askHelpers';
import type { RagHit } from '@/platform/utils/tauri-commands';

function hit(partial: Partial<RagHit>): RagHit {
  return { path: 'doc.md', chunkText: 'x', score: 1, paragraphIndex: 0, ...partial };
}

describe('isMailHit', () => {
  it('is true when sourceType is mail', () => {
    expect(isMailHit(hit({ sourceType: 'mail', path: 'Inbox/whatever' }))).toBe(true);
  });
  it('is true when the path is a mail: id', () => {
    expect(isMailHit(hit({ path: 'mail:abc123' }))).toBe(true);
  });
  it('is true when the sourceId is a mail: id', () => {
    expect(isMailHit(hit({ path: 'somewhere', sourceId: 'mail:abc123' }))).toBe(true);
  });
  it('is false for an ordinary document hit', () => {
    expect(isMailHit(hit({ path: 'Contracts/lease.docx', sourceType: 'docx' }))).toBe(false);
  });
});

describe('filterHitsByScope', () => {
  const mail = hit({ path: 'mail:1', sourceType: 'mail' });
  const doc = hit({ path: 'Contracts/lease.docx', sourceType: 'docx' });
  const all = [mail, doc];

  it('email scope keeps only mail hits', () => {
    expect(filterHitsByScope(all, 'email')).toEqual([mail]);
  });
  it('documents scope drops mail hits', () => {
    expect(filterHitsByScope(all, 'documents')).toEqual([doc]);
  });
  it('this-matter and all-matters keep everything', () => {
    expect(filterHitsByScope(all, 'this-matter')).toEqual(all);
    expect(filterHitsByScope(all, 'all-matters')).toEqual(all);
  });
});
