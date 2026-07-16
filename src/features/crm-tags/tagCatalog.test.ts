import { beforeEach, describe, expect, it } from 'vitest';
import { createFirmTagStore } from './index';

describe('firm tag catalog persistence', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saves and reloads created, renamed, recolored, and retired tags without changing their IDs', () => {
    const firstAppSession = createFirmTagStore();
    const created = firstAppSession.create({ name: 'Planning', color: 'blue' });
    const tagId = created.tags[0]?.id;
    if (!tagId) throw new Error('Expected a newly created tag.');

    firstAppSession.rename(tagId, 'Financial planning');
    firstAppSession.setColor(tagId, 'purple');
    firstAppSession.retire(tagId);

    // A new store models a fresh app session reading browser-profile storage.
    const reloadedAppSession = createFirmTagStore();
    expect(reloadedAppSession.list()).toEqual({
      version: 1,
      tags: [
        {
          id: tagId,
          name: 'Financial planning',
          color: 'purple',
          status: 'retired',
        },
      ],
    });
    expect(tagId).toBe('planning');
  });

  it('keeps the public contract consumer-shaped and rejects duplicate names', () => {
    const store = createFirmTagStore();
    store.create({ name: 'Compliance', color: 'red' });
    expect(() => store.create({ name: ' compliance ', color: 'blue' })).toThrow(
      'already in use'
    );
    expect(store.list().tags[0]).toEqual({
      id: 'compliance',
      name: 'Compliance',
      color: 'red',
      status: 'active',
    });
  });
});
