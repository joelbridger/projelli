import { describe, expect, it, vi } from 'vitest';
import {
  adaptLegacyHouseholdRecord,
  contactTypeAppliesTo,
  createContactRecordStore,
  projectDirectoryContacts,
  validateContactChannels,
  validateContactCreate,
  validateContactPatch,
  validateContactRef,
  validateContactTypeDefinition,
  type ContactCreateInput,
} from '@/features/crm-contacts';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';

function livePort(seed: readonly LiveCrmRecord[] = []) {
  let records = [...seed];
  const save = vi.fn((document: LiveCrmRecord) => {
    const saved = {
      ...document,
      createdAt: document.createdAt ?? '2026-07-16T00:00:00.000Z',
      updatedAt: '2026-07-16T00:00:00.000Z',
    };
    records = records.some((record) => record.id === saved.id)
      ? records.map((record) => record.id === saved.id ? saved : record)
      : [...records, saved];
    return Promise.resolve(saved);
  });
  return {
    get records() { return records; },
    save,
    reloadRecords: vi.fn(() => Promise.resolve(records)),
    sharedMatterId: 'matter-1',
  };
}

const householdInput: ContactCreateInput = { kind: 'household', matterId: 'matter-1', name: 'Chen household' };
const personInput: ContactCreateInput = { kind: 'person', matterId: 'matter-1', firstName: 'Maya', lastName: 'Chen' };
const organizationInput: ContactCreateInput = { kind: 'organization', matterId: 'matter-1', name: 'Lee Legal' };
const trustInput: ContactCreateInput = { kind: 'trust', matterId: 'matter-1', name: 'Chen Family Trust' };
const inputs: readonly ContactCreateInput[] = [householdInput, personInput, organizationInput, trustInput];

describe('four-kind contact foundation', () => {
  it('creates, reloads, and resolves every durable contact kind through the public store', async () => {
    const live = livePort();
    const store = createContactRecordStore(live);
    const created = await Promise.all(inputs.map((input) => store.create(input)));
    expect(created.map((contact) => contact.kind)).toEqual(['household', 'person', 'organization', 'trust']);
    expect(live.reloadRecords).toHaveBeenCalledTimes(4);

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
    const household = await store.create(householdInput);
    const person = await store.create(personInput);
    await store.linkContact(
      { kind: 'household', id: household.id, matterId: household.matterId },
      { kind: 'person', id: person.id, matterId: person.matterId },
      'Primary contact',
    );
    const fresh = createContactRecordStore(live);
    expect(await fresh.listRelated({ kind: 'household', id: household.id, matterId: household.matterId })).toMatchObject([{ ref: { id: person.id, kind: 'person' }, role: 'Primary contact' }]);
    await expect(fresh.linkContact({ kind: 'household', id: household.id, matterId: household.matterId }, { kind: 'person', id: person.id, matterId: person.matterId })).rejects.toThrow('already linked');
    expect(live.records.find((record) => record.id === person.id)).not.toHaveProperty('householdIds');

    expect(await fresh.listRelated({ kind: 'person', id: person.id, matterId: person.matterId })).toMatchObject([{ ref: { id: household.id, kind: 'household' } }]);
    await fresh.unlinkContact(
      { kind: 'household', id: household.id, matterId: household.matterId },
      { kind: 'person', id: person.id, matterId: person.matterId },
    );
    const afterUnlink = createContactRecordStore(live);
    expect(await afterUnlink.listRelated({ kind: 'household', id: household.id, matterId: household.matterId })).toEqual([]);
  });

  it('fails closed for missing, deleted, wrong-kind, wrong-workspace, and incompatible relationships', async () => {
    const deletedId = 'person:deleted';
    const live = livePort([{ id: deletedId, kind: 'person', matterId: 'matter-1', name: 'Deleted person', deleted: true }]);
    const store = createContactRecordStore(live);
    const household = await store.create(householdInput);
    const person = await store.create(personInput);
    const householdRef = { kind: 'household' as const, id: household.id, matterId: household.matterId };
    const personRef = { kind: 'person' as const, id: person.id, matterId: person.matterId };

    await expect(store.resolve({ ...personRef, kind: 'trust' })).resolves.toBeNull();
    await expect(store.resolve({ ...personRef, matterId: 'matter-2' })).resolves.toBeNull();
    await expect(store.resolve({ kind: 'person', id: 'person:missing', matterId: 'matter-1' })).resolves.toBeNull();
    await expect(store.resolve({ kind: 'person', id: deletedId, matterId: 'matter-1' })).resolves.toBeNull();
    await expect(store.linkContact(householdRef, { ...personRef, matterId: 'matter-2' })).rejects.toThrow();
    await expect(store.linkContact(householdRef, householdRef)).rejects.toThrow('cannot link');
    expect(await store.listRelated(householdRef)).toEqual([]);
  });

  it('rejects malformed identities, duplicate stable IDs, invalid channels, and invalid type applicability', () => {
    expect(() => validateContactCreate({ kind: 'person', matterId: 'matter-1' })).toThrow('identity');
    expect(() => validateContactCreate({ kind: 'trust', matterId: 'matter-1', name: ' ' })).toThrow('required');
    expect(() => validateContactCreate({ kind: 'household', matterId: 'matter-1', name: 'Valid', tagIds: ['tag:a', 'tag:a'] })).toThrow('duplicates');
    expect(() => validateContactChannels([{ id: 'bad id', kind: 'email', address: 'a@example.com', primary: true }])).toThrow('stable ID');
    expect(() => validateContactChannels([{ id: 'email:1', kind: 'email', address: 'a@example.com', primary: 'yes' }])).toThrow('boolean');
    expect(() => validateContactPatch({ contextRefs: [{ kind: 'lookalike', id: 'record:1' }] as never })).toThrow('kind');
    expect(() => validateContactRef({ kind: 'person', id: 'bad id', matterId: 'matter-1' })).toThrow('stable ID');
    expect(() => validateContactTypeDefinition({ id: 'client', label: 'Client', appliesTo: ['person', 'person'] })).toThrow('repeat');
    const clientType = validateContactTypeDefinition({ id: 'client', label: 'Client', appliesTo: ['household', 'person'] });
    expect(contactTypeAppliesTo(clientType, 'person')).toBe(true);
    expect(contactTypeAppliesTo(clientType, 'organization')).toBe(false);
  });

  it('preserves the durable kind and rejects person-only identity patches on organizations and trusts', async () => {
    const live = livePort();
    const store = createContactRecordStore(live);
    const organization = await store.create(organizationInput);
    const trust = await store.create(trustInput);
    await expect(store.update(organization.id, { firstName: 'Fake' })).rejects.toThrow('Only a person');
    await expect(store.update(trust.id, { lastName: 'Fake' })).rejects.toThrow('Only a person');
    expect(live.save).toHaveBeenCalledTimes(2);
  });

  it('keeps legacy embedded people read-only while truthfully projecting organization and trust', () => {
    const projections = adaptLegacyHouseholdRecord({
      id: 'household:legacy', name: 'Legacy household', lifecycle: 'Active', primaryAdvisor: 'Unassigned', ownership: 'mine', serviceTier: 'Standard', syncState: 'live', facts: [], accounts: [], notes: [],
      members: [{ id: 'legacy:org', name: 'Lee Legal', personType: 'organization', roles: [], relatedHouseholds: 1 }],
      externalParties: [{ id: 'legacy:trust', name: 'Chen Trust', personType: 'trust', roles: [], relatedHouseholds: 1 }],
    });
    expect(projections.map((projection) => projection.kind)).toEqual(['organization', 'trust']);
    expect(projections).toMatchObject([
      { id: 'legacy:org', name: 'Lee Legal', personType: 'organization', roles: [], relatedHouseholds: 1 },
      { id: 'legacy:trust', name: 'Chen Trust', personType: 'trust', roles: [], relatedHouseholds: 1 },
    ]);
  });
});
