import { describe, expect, it } from 'vitest';
import {
  CONTACT_SOURCES_STORAGE_KEY,
  createContactSourceCatalogStore,
} from './catalog';
import { createContactSourceReference } from './contract';

function memoryStorage(): Pick<Storage, 'getItem' | 'setItem'> {
  const values = new Map<string, string>();
  return {
    getItem: (key) => values.get(key) ?? null,
    setItem: (key, value) => {
      values.set(key, value);
    },
  };
}

describe('contact source catalog persistence', () => {
  it('persists add, rename, reorder, deactivate, and retirement without rewriting a contact snapshot', () => {
    const storage = memoryStorage();
    const firstStore = createContactSourceCatalogStore(storage);
    const referral = firstStore.load().sources[0];
    expect(referral).toMatchObject({ id: 'referral', label: 'Referral' });
    if (referral === undefined)
      throw new Error('Expected the seeded referral source.');
    const existingContactSource = createContactSourceReference(referral);

    firstStore.add('Website', '2026-07-15T10:00:00.000Z');
    firstStore.rename(
      'referral',
      'Professional referral',
      '2026-07-15T10:01:00.000Z'
    );
    firstStore.reorder(['website', 'referral']);
    firstStore.setActive('website', false, '2026-07-15T10:02:00.000Z');
    firstStore.retire('referral', '2026-07-15T10:03:00.000Z');

    const freshStore = createContactSourceCatalogStore(storage);
    const restored = freshStore.load();
    expect(restored.sources).toEqual([
      expect.objectContaining({
        id: 'website',
        label: 'Website',
        status: 'inactive',
      }),
      expect.objectContaining({
        id: 'referral',
        label: 'Professional referral',
        historicalLabels: ['Referral', 'Professional referral'],
        status: 'retired',
        retiredAt: '2026-07-15T10:03:00.000Z',
      }),
    ]);
    expect(existingContactSource).toEqual({
      sourceId: 'referral',
      sourceLabel: 'Referral',
    });
    expect(storage.getItem(CONTACT_SOURCES_STORAGE_KEY)).toContain(
      'Professional referral'
    );
  });

  it('keeps labels and source ids stable when it rejects duplicate labels and malformed data', () => {
    const storage = memoryStorage();
    const store = createContactSourceCatalogStore(storage);
    expect(() => store.add(' referral ')).toThrow('already in use');
    storage.setItem(CONTACT_SOURCES_STORAGE_KEY, '{not-json');
    expect(createContactSourceCatalogStore(storage).load().sources).toEqual([
      expect.objectContaining({ id: 'referral', label: 'Referral' }),
    ]);
  });
});
