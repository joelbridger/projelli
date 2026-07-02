import { describe, it, expect } from 'vitest';
import type { CatalogEntry, InstalledEntry, UpdateInfo } from '@/features/workflows/types/marketplace';

describe('CatalogEntry type', () => {
  it('accepts a fully-populated entry', () => {
    const e: CatalogEntry = {
      id: 'investor-update-v1',
      name: 'Monthly Investor Update',
      description: 'Template',
      version: '1.0.0',
      author: { name: 'Jane Doe' },
      category: 'investor',
      tags: ['monthly'],
      installUrl: 'https://example.com/x.tar.gz',
      manifestUrl: 'https://example.com/manifest.json',
      minAppVersion: '2.0.0',
      publishedAt: '2026-04-28T00:00:00Z',
      updatedAt: '2026-04-28T00:00:00Z',
    };
    expect(e.id).toBe('investor-update-v1');
  });

  it('InstalledEntry includes installedAt', () => {
    const e: InstalledEntry = {
      id: 'x',
      name: 'X',
      description: '',
      version: '1.0.0',
      author: { name: 'A' },
      category: 'misc',
      tags: [],
      installUrl: '',
      manifestUrl: '',
      minAppVersion: '2.0.0',
      publishedAt: '',
      updatedAt: '',
      installedAt: '2026-04-28T00:00:00Z',
      installedPath: '.keepance/templates/x',
      provenance: 'custom',
      manifestVersion: '1.0',
    };
    expect(e.installedAt).toBeDefined();
  });

  it('UpdateInfo carries old/new versions', () => {
    const u: UpdateInfo = {
      id: 'x',
      installedVersion: '1.0.0',
      latestVersion: '1.1.0',
    };
    expect(u.latestVersion).toBe('1.1.0');
  });
});
