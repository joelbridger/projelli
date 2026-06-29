import { describe, expect, it, vi } from 'vitest';
import type { Matter } from '@/platform/types/matter';
import {
  buildWealthboxMatterMappings,
  findMatterForWealthboxContact,
} from '@/platform/wealthbox/wealthboxMatterSync';

function matter(patch: Partial<Matter> & Pick<Matter, 'id' | 'name' | 'client'>): Matter {
  return {
    folderPaths: [],
    createdAt: '2026-06-23T00:00:00.000Z',
    ...patch,
  };
}

describe('Wealthbox contact to matter mapping', () => {
  it('matches an existing matter by client name', () => {
    const existing = matter({ id: 'matter_a', name: 'Retirement Plan', client: 'Avery Stone' });
    const found = findMatterForWealthboxContact(
      { id: 'wb_1', name: '  avery   stone ', type: 'person' },
      [existing],
    );
    expect(found?.id).toBe('matter_a');
  });

  it('does not match archived or sample matters', () => {
    const sample = matter({
      id: 'matter_sample_garcia_v_meridian',
      name: 'Avery Stone',
      client: 'Avery Stone',
      isSample: true,
    });
    const archived = matter({
      id: 'matter_old',
      name: 'Avery Stone',
      client: 'Avery Stone',
      archived: true,
    });
    const found = findMatterForWealthboxContact(
      { id: 'wb_1', name: 'Avery Stone', type: 'person' },
      [sample, archived],
    );
    expect(found).toBeUndefined();
  });

  it('creates a new matter only when no name match exists', () => {
    const existing = matter({ id: 'matter_a', name: 'Stone Household', client: 'Stone Household' });
    const createMatter = vi.fn((input: { name: string; client: string }) =>
      matter({ id: `created_${input.name}`, name: input.name, client: input.client }),
    );
    const plans = buildWealthboxMatterMappings(
      [
        { id: 'wb_1', name: 'Stone Household', type: 'household' },
        { id: 'wb_2', name: 'Mira Lee', type: 'person' },
      ],
      [existing],
      createMatter,
    );

    expect(createMatter).toHaveBeenCalledTimes(1);
    expect(plans).toEqual([
      {
        mapping: { wealthboxContactId: 'wb_1', matterId: 'matter_a' },
        matterName: 'Stone Household',
        created: false,
      },
      {
        mapping: { wealthboxContactId: 'wb_2', matterId: 'created_Mira Lee' },
        matterName: 'Mira Lee',
        created: true,
      },
    ]);
  });
});
