import { beforeEach, describe, expect, it, vi } from 'vitest';

const { searchCrmRecords, loadLiveCrmRecords, firmState } = vi.hoisted(() => ({
  searchCrmRecords: vi.fn(),
  loadLiveCrmRecords: vi.fn(),
  firmState: { viewerId: 'advisor-owner' as string | null },
}));
vi.mock('@/platform/crm/search', () => ({ searchCrmRecords }));
vi.mock('@/platform/crm/liveRecords', () => ({ loadLiveCrmRecords }));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: { getState: () => ({ session: firmState.viewerId ? { userId: firmState.viewerId } : null }) },
}));

import {
  crmCitationPath,
  parseCrmCitationPath,
  retrieveCrmAskHits,
} from './retrieval';

describe('CRM Ask retrieval', () => {
  beforeEach(() => {
    searchCrmRecords.mockReset();
    loadLiveCrmRecords.mockReset().mockResolvedValue([]);
    firmState.viewerId = 'advisor-owner';
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
    loadLiveCrmRecords.mockResolvedValue([
      { id: 'note-a', kind: 'note', matterId: 'household-a' },
      { id: 'note-b', kind: 'note', matterId: 'household-b' },
    ]);
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
      ['note-a', 'note-b'],
    );
    expect(hits).toHaveLength(1);
    expect(hits[0]).toMatchObject({
      path: 'crm:note:note-a',
      matterId: 'household-a',
      sourceType: 'crm',
    });
    expect(hits[0]?.chunkText).not.toContain('Never expose');
  });

  it('drops an in-flight meeting-derived answer when the viewer loses access', async () => {
    const records = [
      { id: 'meeting-preferences', kind: 'meeting_foundation_preferences', visibilityPolicies: [{
        id: 'private-policy', mode: 'explicit-review', includedMemberIds: [],
        excludedMemberIds: ['advisor-excluded'],
      }] },
      { id: 'meeting-private', kind: 'meeting', matterId: 'household-a', ownerRef: 'advisor-owner', visibilityPolicyId: 'private-policy' },
      { id: 'private-note', kind: 'note', matterId: 'household-a', meetingId: 'meeting-private' },
    ];
    loadLiveCrmRecords.mockResolvedValue(records);
    searchCrmRecords.mockImplementationOnce(() => {
      firmState.viewerId = 'advisor-excluded';
      return Promise.resolve([{ entityId: 'private-note', entityKind: 'note', matterId: 'household-a', title: 'Private note', snippet: 'Do not expose', content: '{"body":"Do not expose"}' }]);
    });

    await expect(retrieveCrmAskHits('/tmp/lantern', 'private', 'household-a')).resolves.toEqual([]);
    expect(searchCrmRecords).toHaveBeenCalledWith(
      '/tmp/lantern', 'private', 'household-a',
      ['meeting-preferences', 'meeting-private', 'private-note'],
    );
  });

  it('fails soft when the encrypted CRM store cannot be opened', async () => {
    const onUnavailable = vi.fn();
    searchCrmRecords.mockRejectedValue(
      new Error(
        'The saved CRM records cannot be unlocked. Rebuild them from Wealthbox.',
      ),
    );

    await expect(
      retrieveCrmAskHits('/tmp/lantern', 'retirement', null, onUnavailable),
    ).resolves.toEqual([]);
    expect(onUnavailable).toHaveBeenCalledWith(
      expect.stringMatching(/file search still works.*contact support/i),
    );
    expect(onUnavailable.mock.calls[0]?.[0]).not.toMatch(/rebuild/i);
  });
});
