import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FirmTagCatalog } from '@/features/crm-tags';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  createWorkflowAuthoringStore,
  type LiveWorkflowAuthoringPort,
} from './templateStore';

const records = new Map<string, LiveCrmRecord[]>();

const catalog: FirmTagCatalog = {
  version: 1,
  tags: [
    {
      id: 'tag:planning',
      name: 'Planning',
      color: '#2563eb',
      status: 'active',
    },
    { id: 'tag:retired', name: 'Legacy', color: '#475569', status: 'retired' },
  ],
};

function port(workspaceRoot: string): LiveWorkflowAuthoringPort {
  return {
    records: structuredClone(records.get(workspaceRoot) ?? []),
    workspaceRoot,
    error: null,
    save: vi.fn((record: LiveCrmRecord) => {
      const current = records.get(workspaceRoot) ?? [];
      records.set(
        workspaceRoot,
        current.some((item) => item.id === record.id)
          ? current.map((item) =>
              item.id === record.id ? structuredClone(record) : item
            )
          : [...current, structuredClone(record)]
      );
      return Promise.resolve(structuredClone(record));
    }),
    reload: vi.fn(() => Promise.resolve()),
  };
}

describe('workflow authoring live-record adapter', () => {
  beforeEach(() => {
    records.clear();
  });

  it('persists and reloads a tagged template with stable ordered step identities', async () => {
    const workspace = '/firm-a';
    const firstPort = port(workspace);
    const first = createWorkflowAuthoringStore(firstPort, catalog);
    const created = await first.create({
      title: 'Annual review',
      tagIds: ['tag:planning'],
      steps: [
        { title: 'Prepare', tagIds: ['tag:planning'] },
        { title: 'Meet', tagIds: [] },
      ],
    });

    const reloaded = createWorkflowAuthoringStore(port(workspace), catalog);
    await expect(reloaded.get(created.id)).resolves.toEqual(created);
    expect(created.steps.map((step) => step.position)).toEqual([0, 1]);

    await expect(
      reloaded.update({
        ...created,
        tagIds: ['tag:retired'],
        steps: created.steps,
      })
    ).rejects.toMatchObject({ code: 'invalid_tag' });
    await expect(
      createWorkflowAuthoringStore(port(workspace), catalog).get(created.id)
    ).resolves.toEqual(created);
  });

  it('requires a persisted published template before it can start', async () => {
    const store = createWorkflowAuthoringStore(port('/firm-b'), catalog);
    const created = await store.create({ title: 'Welcome' });
    await expect(
      store.start(created.id, 'household:one')
    ).rejects.toMatchObject({ code: 'template_not_published' });
    const published = await store.publish(created.id);
    await expect(
      store.start(published.id, 'household:one')
    ).resolves.toMatchObject({
      templateId: published.id,
      householdId: 'household:one',
    });
  });
});
