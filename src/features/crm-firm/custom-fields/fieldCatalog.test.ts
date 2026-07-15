import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  defineField,
  renameField,
  reorderFields,
  retireField,
  validateFieldCatalogField,
} from './fieldCatalog';
import { createLiveFieldCatalogPersistence } from './fieldCatalogPersistence';

function persistedStore(initial: readonly LiveCrmRecord[] = []) {
  const records = new Map(initial.map((record) => [record.id, record]));
  return {
    get records() {
      return [...records.values()];
    },
    save(record: LiveCrmRecord) {
      records.set(record.id, structuredClone(record));
      return Promise.resolve();
    },
    read(id: string) {
      return records.get(id);
    },
  };
}

describe('firm custom-field catalog contract', () => {
  it('keeps the public contract small and rejects malformed choice fields', () => {
    expect(() =>
      { validateFieldCatalogField({
        id: 'risk-band',
        name: 'Risk band',
        kind: 'select',
        options: [],
        appliesTo: ['household'],
        retired: false,
      }); }
    ).toThrow('Choice fields need at least one option.');
    expect(() =>
      { validateFieldCatalogField({
        id: 'risk-band',
        name: 'Risk band',
        kind: 'text',
        options: ['not allowed'],
        appliesTo: ['household'],
        retired: false,
      }); }
    ).toThrow('Only choice fields can have options.');
  });

  it('persists define, rename, reorder, and retire through a reload without rewriting a saved value', async () => {
    const savedValue = {
      id: 'household-foster',
      kind: 'household',
      customFields: {
        'risk-band': { value: 'Balanced', updatedAt: '2026-07-15T00:00:00.000Z' },
      },
    } satisfies LiveCrmRecord;
    const storedDefinition = {
      id: 'custom-field:risk-band',
      kind: 'customFieldDef',
      key: 'risk-band',
      label: 'Risk band',
      fieldType: 'enum',
      options: ['Conservative', 'Balanced', 'Growth'],
      appliesTo: ['household'],
      required: false,
      order: 0,
      archived: false,
      createdAt: '2026-07-15T00:00:00.000Z',
      updatedAt: '2026-07-15T00:00:00.000Z',
    } satisfies LiveCrmRecord;
    const store = persistedStore([savedValue, storedDefinition]);
    const firstSession = createLiveFieldCatalogPersistence(store);
    let catalog = await firstSession.load();
    catalog = defineField(catalog, 'service-note', {
      name: 'Service note',
      kind: 'text',
      appliesTo: ['person'],
    });
    await firstSession.save(catalog);

    const afterCreate = await createLiveFieldCatalogPersistence(store).load();
    expect(afterCreate.fields.map((field) => field.id)).toEqual([
      'risk-band',
      'service-note',
    ]);

    const renamed = renameField(afterCreate, 'risk-band', 'Investor risk band');
    const reordered = reorderFields(renamed, ['service-note', 'risk-band']);
    const retired = retireField(reordered, 'risk-band');
    await createLiveFieldCatalogPersistence(store).save(retired);

    const afterReload = await createLiveFieldCatalogPersistence(store).load();
    expect(afterReload.fields).toEqual([
      expect.objectContaining({ id: 'service-note', name: 'Service note', retired: false }),
      expect.objectContaining({ id: 'risk-band', name: 'Investor risk band', retired: true }),
    ]);
    expect(store.read('custom-field:risk-band')).toEqual(
      expect.objectContaining({
        id: 'custom-field:risk-band',
        key: 'risk-band',
        label: 'Investor risk band',
      })
    );
    expect(store.read('household-foster')).toEqual(savedValue);
  });
});
