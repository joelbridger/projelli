import { describe, expect, it, vi } from 'vitest';
import {
  adaptLegacyHouseholdRecord,
  createContactRecordStore,
  projectDirectoryContacts,
  type ContactCreateInput,
} from '@/features/crm-contacts';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

function livePort(seed: readonly LiveCrmRecord[] = []) {
  let records = [...seed];
  const save = vi.fn(async (document: LiveCrmRecord) => {
    const saved = {
      ...document,
      createdAt: document.createdAt ?? '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    };
    records = records.some((record) => record.id === saved.id)
      ? records.map((record) => record.id === saved.id ? saved : record)
      : [...records, saved];
    return saved;
  });
  return {
    get records() { return records; },
    save,
    reload: vi.fn(async () => {}),
    sharedMatterId: 'matter-1',
  };
}

const inputs: readonly ContactCreateInput[] = [
  { kind: 'household', matterId: 'matter-1', name: 'Chen household' },
  { kind: 'person', matterId: 'matter-1', firstName: 'Maya', lastName: 'Chen' },
  { kind: 'organization', matterId: 'matter-1', name: 'Lee Legal' },
  { kind: 'trust', matterId: 'matter-1', name: 'Chen Family Trust' },
];

describe('four-kind contact foundation', () => {
  it('creates, reloads, and resolves every durable contact kind through the public store', async () => {
    const live = livePort();
    const store = createContactRecordStore(live);
    const created = await Promise.all(inputs.map((input) => store.create(input)));
    expect(created.map((contact) => contact.kind)).toEqual(['household', 'person', 'organization', 'trust']);
    expect(live.reload).toHaveBeenCalledTimes(4);

    const fresh = createContactRecordStore(live);
    for (const contact of created) {
      const resolved = await fresh.resolve({ kind: contact.kind, id: contact.id, matterId: 'matter-1' });
      expect(resolved?.contact.kind).toBe(contact.kind);
      expect(resolved?.title).toBe(contact.displayName);
    }
  });

  it('keeps imported organization/trust kinds and unknown data on an ordinary update', async () => {
    const live = livePort([
      { id: 'organization:lee', kind: 'organization', matterId: 'matter-1', name: 'Lee Legal', importerPayload: { untouched: true }, extensionData: { 'import.note': 'keep' } },
      { id: 'trust:chen', kind: 'trust', matterId: 'matter-1', name: 'Chen Trust', importerPayload: { untouched: true } },
    ]);
    const store = createContactRecordStore(live);
    const saved = await store.update('organization:lee', { lifecycle: 'Active' });
    expect(saved.kind).toBe('organization');
    expect(live.records.find((record) => record.id === saved.id)).toMatchObject({ kind: 'organization', importerPayload: { untouched: true }, extensionData: { 'import.note': 'keep' } });
    expect(projectDirectoryContacts(live.records).filter((contact) => contact.kind === 'organization' || contact.kind === 'trust')).toHaveLength(2);
  });

  it('uses the household contact-link list as the only relationship source and rejects duplicate links', async () => {
    const live = livePort();
    const store = createContactRecordStore(live);
    const household = await store.create(inputs[0]!);
    const person = await store.create(inputs[1]!);
    await store.linkContact(
      { kind: 'household', id: household.id, matterId: household.matterId },
      { kind: 'person', id: person.id, matterId: person.matterId },
      'Primary contact',
    );
    const fresh = createContactRecordStore(live);
    expect(await fresh.listRelated({ kind: 'household', id: household.id, matterId: household.matterId })).toMatchObject([{ ref: { id: person.id, kind: 'person' }, role: 'Primary contact' }]);
    await expect(fresh.linkContact({ kind: 'household', id: household.id, matterId: household.matterId }, { kind: 'person', id: person.id, matterId: person.matterId })).rejects.toThrow('already linked');
    expect(live.records.find((record) => record.id === person.id)).not.toHaveProperty('householdIds');
  });

  it('keeps legacy embedded people read-only while truthfully projecting organization and trust', () => {
    const projections = adaptLegacyHouseholdRecord({
      id: 'household:legacy', name: 'Legacy household', lifecycle: 'Active', primaryAdvisor: 'Unassigned', ownership: 'mine', serviceTier: 'Standard', syncState: 'live', facts: [], accounts: [], notes: [],
      members: [{ id: 'legacy:org', name: 'Lee Legal', personType: 'organization', roles: [], relatedHouseholds: 1 }],
      externalParties: [{ id: 'legacy:trust', name: 'Chen Trust', personType: 'trust', roles: [], relatedHouseholds: 1 }],
    });
    expect(projections.map((projection) => projection.kind)).toEqual(['organization', 'trust']);
  });
});
