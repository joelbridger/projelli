import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

const canonicalRecords = vi.hoisted(() => new Map<string, LiveCrmRecord[]>());
const loadLiveCrmRecords = vi.hoisted(() => vi.fn());
const saveLiveCrmRecord = vi.hoisted(() => vi.fn());

vi.mock('@/platform/crm/liveRecords', () => ({
  loadLiveCrmRecords,
  saveLiveCrmRecord,
}));

import { createFirmTagStore } from './index';

function recordsFor(workspaceRoot: string): LiveCrmRecord[] {
  return canonicalRecords.get(workspaceRoot) ?? [];
}

describe('firm tags use canonical CRM records', () => {
  beforeEach(() => {
    canonicalRecords.clear();
    loadLiveCrmRecords.mockReset();
    saveLiveCrmRecord.mockReset();
    loadLiveCrmRecords.mockImplementation((workspaceRoot: string) =>
      Promise.resolve(structuredClone(recordsFor(workspaceRoot)))
    );
    saveLiveCrmRecord.mockImplementation(
      (workspaceRoot: string, record: LiveCrmRecord) => {
        const current = recordsFor(workspaceRoot);
        const next = current.some((item) => item.id === record.id)
          ? current.map((item) =>
              item.id === record.id ? structuredClone(record) : item
            )
          : [...current, structuredClone(record)];
        canonicalRecords.set(workspaceRoot, next);
        return Promise.resolve(structuredClone(record));
      }
    );
  });

  it('reads, changes, retires, and reloads the existing CRM tag without changing saved IDs', async () => {
    const workspace = '/firm-a';
    canonicalRecords.set(workspace, [
      {
        id: 'tag:existing',
        kind: 'tag',
        matterId: 'firm_home',
        name: 'Planning',
        color: '#2563eb',
        deleted: false,
      },
      {
        id: 'household:smith',
        kind: 'household',
        matterId: 'matter:smith',
        name: 'Smith household',
        tagIds: ['tag:existing'],
      },
    ]);

    const firstAppSession = createFirmTagStore(workspace);
    await expect(firstAppSession.list()).resolves.toEqual({
      version: 1,
      tags: [
        {
          id: 'tag:existing',
          name: 'Planning',
          color: '#2563eb',
          status: 'active',
        },
      ],
    });

    await firstAppSession.rename('tag:existing', 'Financial planning');
    await firstAppSession.setColor('tag:existing', '#7e22ce');
    await firstAppSession.retire('tag:existing');

    const reloadedAppSession = createFirmTagStore(workspace);
    await expect(reloadedAppSession.list()).resolves.toEqual({
      version: 1,
      tags: [
        {
          id: 'tag:existing',
          name: 'Financial planning',
          color: '#7e22ce',
          status: 'retired',
        },
      ],
    });
    expect(recordsFor(workspace)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          id: 'tag:existing',
          kind: 'tag',
          name: 'Financial planning',
          color: '#7e22ce',
          deleted: true,
        }),
        expect.objectContaining({
          id: 'household:smith',
          tagIds: ['tag:existing'],
        }),
      ])
    );
    expect(loadLiveCrmRecords).toHaveBeenCalledWith(workspace);
    expect(saveLiveCrmRecord).toHaveBeenCalledWith(
      workspace,
      expect.objectContaining({ id: 'tag:existing', kind: 'tag' })
    );
  });

  it('creates a canonical CRM tag record instead of browser-profile data', async () => {
    const workspace = '/firm-b';
    const store = createFirmTagStore(workspace);

    const catalog = await store.create({ name: 'Priority', color: '#dc2626' });

    const created = catalog.tags[0];
    expect(created?.id).toMatch(/^tag:/);
    expect(created).toMatchObject({
      name: 'Priority',
      color: '#dc2626',
      status: 'active',
    });
    const saved = recordsFor(workspace).find((record) => record.kind === 'tag');
    expect(saved?.id).toMatch(/^tag:/);
    expect(saved).toMatchObject({
      kind: 'tag',
      matterId: 'firm_home',
      name: 'Priority',
      color: '#dc2626',
      deleted: false,
    });
  });
});
