/**
 * ContentIndex unit tests (UX-26).
 *
 * Exercises the MiniSearch wrapper used by the Search panel for full-text
 * content matching. The goal is to keep the query/snippet/replace behaviour
 * stable as we evolve the boost weights.
 */

import { describe, expect, it } from 'vitest';
import {
  createIndex,
  searchIndex,
  upsertDocument,
  removeDocument,
} from '../../src/platform/search/ContentIndex';

function seed() {
  const index = createIndex();
  index.addAll([
    {
      id: '/docs/plan.md',
      path: '/docs/plan.md',
      name: 'plan.md',
      content:
        'The quarterly plan covers onboarding, pricing, and growth experiments. Budget allocation below.',
    },
    {
      id: '/docs/budget.md',
      path: '/docs/budget.md',
      name: 'budget.md',
      content: 'Detailed budget breakdown with quarterly targets.',
    },
    {
      id: '/notes/readme.md',
      path: '/notes/readme.md',
      name: 'readme.md',
      content: 'This workspace stores plans and reviews.',
    },
  ]);
  return index;
}

describe('searchIndex', () => {
  it('returns empty for empty query', () => {
    const idx = seed();
    expect(searchIndex(idx, '')).toEqual([]);
    expect(searchIndex(idx, '   ')).toEqual([]);
  });

  it('matches terms in file content', () => {
    const idx = seed();
    const results = searchIndex(idx, 'onboarding');
    expect(results.length).toBeGreaterThan(0);
    expect(results[0]?.path).toBe('/docs/plan.md');
    expect(results[0]?.snippet).toContain('onboarding');
  });

  it('produces a snippet containing the matched term', () => {
    const idx = seed();
    const [first] = searchIndex(idx, 'budget');
    expect(first).toBeDefined();
    expect(first?.snippet.toLowerCase()).toContain('budget');
    expect(first?.matchedTerm.toLowerCase()).toContain('budget');
  });

  it('boosts filename hits above body-only hits', () => {
    const idx = seed();
    const results = searchIndex(idx, 'budget');
    // plan.md mentions "budget" in body, budget.md has it in name AND body.
    // Filename boost (2x) should promote budget.md above plan.md.
    expect(results[0]?.path).toBe('/docs/budget.md');
  });

  it('limits results to the requested ceiling', () => {
    const idx = seed();
    const results = searchIndex(idx, 'md', { limit: 2 });
    expect(results.length).toBeLessThanOrEqual(2);
  });
});

describe('upsertDocument / removeDocument', () => {
  it('upsert adds a new document', () => {
    const idx = createIndex();
    upsertDocument(idx, {
      id: '/new.md',
      path: '/new.md',
      name: 'new.md',
      content: 'hello world',
    });
    const results = searchIndex(idx, 'hello');
    expect(results.length).toBe(1);
    expect(results[0]?.path).toBe('/new.md');
  });

  it('upsert replaces an existing document', () => {
    const idx = seed();
    upsertDocument(idx, {
      id: '/docs/plan.md',
      path: '/docs/plan.md',
      name: 'plan.md',
      content: 'completely rewritten content about rockets',
    });
    // Old term no longer matches this doc.
    const stale = searchIndex(idx, 'onboarding');
    expect(stale.every((r) => r.path !== '/docs/plan.md')).toBe(true);
    // New term matches.
    const fresh = searchIndex(idx, 'rockets');
    expect(fresh[0]?.path).toBe('/docs/plan.md');
  });

  it('remove drops the document from the index', () => {
    const idx = seed();
    removeDocument(idx, '/docs/plan.md');
    const results = searchIndex(idx, 'onboarding');
    expect(results.every((r) => r.path !== '/docs/plan.md')).toBe(true);
  });

  it('remove on a non-existent id is a no-op', () => {
    const idx = seed();
    expect(() => removeDocument(idx, '/does/not/exist.md')).not.toThrow();
  });
});
