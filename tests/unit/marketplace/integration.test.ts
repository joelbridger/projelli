import { describe, it, expect } from 'vitest';
import { MarketplaceService } from '@/features/workflows/marketplace/svc';
import type { CatalogEntry } from '@/features/workflows/marketplace/svc';

describe('marketplace barrel exports', () => {
  it('exports MarketplaceService class', () => {
    expect(MarketplaceService).toBeDefined();
  });

  it('re-exports CatalogEntry type', () => {
    const e: CatalogEntry = {
      id: 'x', name: 'X', description: '', version: '1.0.0',
      author: { name: 'a' }, category: 'misc', tags: [],
      installUrl: '', manifestUrl: '', minKeepanceVersion: '2.0.0',
      publishedAt: '', updatedAt: '',
    };
    expect(e.id).toBe('x');
  });
});
