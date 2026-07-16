import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { createFirmTagStore, type LiveFirmTagPort } from './tagCatalog';
import { FirmTagError } from './contract';

const canonicalRecords = new Map<string, LiveCrmRecord[]>();

function recordsFor(workspaceRoot: string): LiveCrmRecord[] {
  return canonicalRecords.get(workspaceRoot) ?? [];
}

function livePort(workspaceRoot: string): LiveFirmTagPort {
  return {
    records: structuredClone(recordsFor(workspaceRoot)),
    workspaceRoot,
    error: null,
    save: vi.fn((record: LiveCrmRecord) => {
      const current = recordsFor(workspaceRoot);
      canonicalRecords.set(
        workspaceRoot,
        current.some((item) => item.id === record.id)
          ? current.map((item) => item.id === record.id ? structuredClone(record) : item)
          : [...current, structuredClone(record)],
      );
      return Promise.resolve(structuredClone(record));
    }),
    reload: vi.fn(() => Promise.resolve()),
  };
}

describe('firm tag live-record adapter', () => {
  beforeEach(() => {
    canonicalRecords.clear();
  });

  it('reads, changes, retires, and reloads an existing CRM tag without changing saved IDs', async () => {
    const workspace = '/firm-a';
    canonicalRecords.set(workspace, [
      {
        id: 'tag:existing', kind: 'tag', matterId: 'firm_home', name: 'Planning',
        color: '#2563eb', deleted: false,
      },
      {
        id: 'household:smith', kind: 'household', matterId: 'matter:smith',
        name: 'Smith household', tagIds: ['tag:existing'],
      },
    ]);

    const firstSession = createFirmTagStore(livePort(workspace));
    await expect(firstSession.list()).resolves.toEqual({
      version: 1,
      tags: [{ id: 'tag:existing', name: 'Planning', color: '#2563eb', status: 'active' }],
    });

    await firstSession.rename('tag:existing', 'Financial planning');
    await createFirmTagStore(livePort(workspace)).setColor('tag:existing', '#7e22ce');
    await createFirmTagStore(livePort(workspace)).retire('tag:existing');

    const reopenedSession = createFirmTagStore(livePort(workspace));
    await expect(reopenedSession.list()).resolves.toEqual({
      version: 1,
      tags: [{
        id: 'tag:existing', name: 'Financial planning', color: '#7e22ce', status: 'retired',
      }],
    });
    expect(recordsFor(workspace)).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: 'tag:existing', kind: 'tag', name: 'Financial planning', color: '#7e22ce', deleted: true,
      }),
      expect.objectContaining({ id: 'household:smith', tagIds: ['tag:existing'] }),
    ]));
  });

  it('creates a fully formed canonical CRM Tag record through the supplied live port', async () => {
    const workspace = '/firm-b';
    const port = livePort(workspace);
    const catalog = await createFirmTagStore(port).create({ name: 'Priority', color: '#DC2626' });

    expect(catalog.tags[0]).toMatchObject({ name: 'Priority', color: '#dc2626', status: 'active' });
    const saved = recordsFor(workspace).find((record) => record.kind === 'tag');
    expect(saved).toMatchObject({
      kind: 'tag', matterId: 'firm_home', name: 'Priority', color: '#dc2626', deleted: false,
      createdBy: { userId: 'local-user', kind: 'user' },
      updatedBy: { userId: 'local-user', kind: 'user' },
      source: { origin: 'user', sources: [] }, externalRefs: [], schemaVersion: 1,
    });
  });

  it('uses stable failures and never turns an unavailable workspace into an empty catalog', async () => {
    const store = createFirmTagStore({
      records: [], workspaceRoot: null, error: null,
      save: vi.fn(), reload: vi.fn(),
    });

    expect(store.errorCode).toBe('workspace_unavailable');
    await expect(store.list()).rejects.toMatchObject<FirmTagError>({ code: 'workspace_unavailable' });
    await expect(store.create({ name: '  ', color: '#2563eb' }))
      .rejects.toMatchObject<FirmTagError>({ code: 'workspace_unavailable' });
  });

  it('normalizes only six-digit hex colors and safely falls back from invalid legacy CSS', async () => {
    const workspace = '/firm-c';
    canonicalRecords.set(workspace, [{
      id: 'tag:legacy', kind: 'tag', matterId: 'firm_home', name: 'Legacy',
      color: 'url(https://bad.example)', deleted: false,
    }]);
    const store = createFirmTagStore(livePort(workspace));

    await expect(store.list()).resolves.toMatchObject({
      tags: [{ id: 'tag:legacy', color: '#475569' }],
    });
    await expect(store.setColor('tag:legacy', 'red' as `#${string}`))
      .rejects.toMatchObject<FirmTagError>({ code: 'invalid_color' });
  });
});
