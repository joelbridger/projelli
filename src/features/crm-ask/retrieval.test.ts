import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchCrmRecords } = vi.hoisted(() => ({
  searchCrmRecords: vi.fn(),
}));
vi.mock('@/platform/crm/search', () => ({ searchCrmRecords }));

import {
  crmCitationPath,
  parseCrmCitationPath,
  retrieveCrmAskHits,
} from './retrieval';

describe('CRM Ask retrieval', () => {
  beforeEach(() => {
    searchCrmRecords.mockReset();
  });

  it('makes one stable, clickable citation location per CRM record', () => {
    const path = crmCitationPath({ entityKind: 'note', entityId: 'note:123' });
    expect(path).toBe('crm:note:note:123');
    expect(parseCrmCitationPath(path)).toEqual({
      entityKind: 'note',
      entityId: 'note:123',
    });
  });

  it('keeps a walled household out even if a backend result is accidentally mixed in', async () => {
    searchCrmRecords.mockResolvedValue([
      {
        entityId: 'note-a',
        entityKind: 'note',
        matterId: 'household-a',
        title: 'Allowed note',
        snippet: 'Retirement planning',
        content: '{"body":"Retirement planning"}',
      },
      {
        entityId: 'note-b',
        entityKind: 'note',
        matterId: 'household-b',
        title: 'Walled note',
        snippet: 'Never expose',
        content: '{"body":"Never expose"}',
      },
    ]);

    const hits = await retrieveCrmAskHits(
      '/tmp/lantern',
      'retirement',
      'household-a',
    );

    expect(searchCrmRecords).toHaveBeenCalledWith(
      '/tmp/lantern',
      'retirement',
      'household-a',
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      path: 'crm:note:note-a',
      matterId: 'household-a',
      sourceType: 'crm',
    });
    expect(hits[0]?.chunkText).not.toContain('Never expose');
  });
});
