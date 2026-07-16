import { useMemo } from 'react';
import { useLiveCrmRecords } from '@/platform/crm/useLiveCrmRecords';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import {
  contactInputDocument,
  contactRecordFromDocument,
  displayNameFor,
  toRecordRef,
  validateContactLinks,
  validateContactPatch,
  validateContactRef,
} from './model';
import type {
  ContactCreateInput,
  ContactDirectoryProjection,
  ContactPatch,
  ContactPrintProjection,
  ContactRecord,
  ContactRef,
  RecordScreenProjection,
  RelatedContactProjection,
  RelatedContactSummaryProjection,
} from './types';

type LivePort = Pick<ReturnType<typeof useLiveCrmRecords>, 'records' | 'save' | 'reload' | 'sharedMatterId'>;

function asDocument(record: LiveCrmRecord): Readonly<Record<string, unknown>> {
  return record as Readonly<Record<string, unknown>>;
}

function activeContactRecords(records: readonly LiveCrmRecord[]): readonly ContactRecord[] {
  return records.flatMap((record) => record['deleted'] === true ? [] : [contactRecordFromDocument(asDocument(record))]).filter((record): record is ContactRecord => record !== null);
}

function assertSameMatter(reference: ContactRef, record: ContactRecord): void {
  if (reference.matterId !== record.matterId || reference.kind !== record.kind || reference.id !== record.id) {
    throw new Error('Contact reference is missing, deleted, wrong kind, or from another workspace.');
  }
}

function recordFor(records: readonly LiveCrmRecord[], id: string): ContactRecord | null {
  return activeContactRecords(records).find((record) => record.id === id) ?? null;
}

function activityFor(records: readonly LiveCrmRecord[], contact: ContactRecord): string | undefined {
  let latest: string | undefined;
  for (const record of records) {
    if (record.kind !== 'activityEvent' || typeof record['at'] !== 'string') continue;
    const target = record['targetRef'];
    if (!target || typeof target !== 'object' || Array.isArray(target)) continue;
    const ref = target as Record<string, unknown>;
    if (ref['id'] === contact.id && ref['kind'] === contact.kind && (!ref['matterId'] || ref['matterId'] === contact.matterId)) {
      if (!latest || record['at'] > latest) latest = record['at'];
    }
  }
  return latest;
}

export function projectDirectoryContacts(records: readonly LiveCrmRecord[]): readonly ContactDirectoryProjection[] {
  return activeContactRecords(records).map((contact): ContactDirectoryProjection => {
    const lastActivityAt = activityFor(records, contact);
    return {
    id: contact.id,
    kind: contact.kind,
    matterId: contact.matterId,
    displayName: contact.displayName,
    lifecycle: contact.lifecycle,
    ...(contact.ownerMemberId ? { ownerMemberId: contact.ownerMemberId } : {}),
    ...(contact.primaryAdvisor ? { primaryAdvisor: contact.primaryAdvisor, ownerDisplay: contact.primaryAdvisor } : {}),
    tagIds: [...contact.tagIds],
    ...(contact.createdAt ? { createdAt: contact.createdAt } : {}),
    ...(contact.updatedAt ? { updatedAt: contact.updatedAt } : {}),
    contextRefs: [...contact.contextRefs],
    ...(contact.extensionData ? { extensionData: contact.extensionData } : {}),
    ref: toRecordRef(contact),
    status: contact.lifecycle,
      ...(lastActivityAt ? { lastActivityAt } : {}),
    };
  });
}

export interface ContactRecordStore {
  readonly records: readonly ContactRecord[];
  listDirectory(): readonly ContactDirectoryProjection[];
  get(id: string): Promise<ContactRecord | null>;
  resolve(ref: ContactRef): Promise<RecordScreenProjection | null>;
  create(input: ContactCreateInput): Promise<ContactRecord>;
  update(id: string, patch: ContactPatch): Promise<ContactRecord>;
  linkContact(household: ContactRef, contact: ContactRef, role?: string): Promise<ContactRecord>;
  unlinkContact(household: ContactRef, contact: ContactRef): Promise<ContactRecord>;
  listRelated(ref: ContactRef): Promise<readonly RelatedContactProjection[]>;
}

/**
 * Creates the one public async contact route. It intentionally accepts the live
 * hook only here; consumers receive typed records and never a raw writer.
 */
export function createContactRecordStore(live: LivePort): ContactRecordStore {
  const records = activeContactRecords(live.records);
  const saveAndReload = async (document: Record<string, unknown>): Promise<ContactRecord> => {
    const saved = await live.save(document as LiveCrmRecord);
    await live.reload();
    const contact = contactRecordFromDocument(asDocument(saved));
    if (!contact) throw new Error('Saved record is not a valid contact.');
    return contact;
  };
  const requireHousehold = (ref: ContactRef): ContactRecord => {
    const checked = validateContactRef(ref);
    if (checked.kind !== 'household') throw new Error('Only a household owns durable contact links.');
    const household = recordFor(live.records, checked.id);
    if (!household) throw new Error('Household contact is missing or deleted.');
    assertSameMatter(checked, household);
    return household;
  };
  const requireContact = (ref: ContactRef): ContactRecord => {
    const checked = validateContactRef(ref);
    const contact = recordFor(live.records, checked.id);
    if (!contact) throw new Error('Contact is missing or deleted.');
    assertSameMatter(checked, contact);
    return contact;
  };
  return {
    records,
    listDirectory: () => projectDirectoryContacts(live.records),
    async get(id) {
      return recordFor(live.records, id);
    },
    async resolve(ref) {
      try {
        const contact = requireContact(ref);
        return { ref: toRecordRef(contact), contact, title: contact.displayName };
      } catch {
        return null;
      }
    },
    async create(input) {
      const id = `${input.kind}:${crypto.randomUUID()}`;
      return saveAndReload(contactInputDocument(input, id));
    },
    async update(id, patch) {
      validateContactPatch(patch);
      const current = recordFor(live.records, id);
      if (!current) throw new Error('Contact is missing or deleted.');
      const next: Record<string, unknown> = {
        ...current.source,
        ...patch,
        id: current.id,
        kind: current.kind,
        matterId: current.matterId,
        ...(patch.tagIds ? { tagIds: [...patch.tagIds] } : {}),
        ...(patch.contextRefs ? { contextRefs: [...patch.contextRefs] } : {}),
        ...(patch.channels ? { channels: [...patch.channels] } : {}),
        ...(patch.extensionData ? { extensionData: { ...(current.extensionData ?? {}), ...patch.extensionData } } : {}),
      };
      if (!displayNameFor(next)) throw new Error('Contact identity is required.');
      return saveAndReload(next);
    },
    async linkContact(householdRef, contactRef, role) {
      const household = requireHousehold(householdRef);
      const contact = requireContact(contactRef);
      if (contact.kind === 'household') throw new Error('A household cannot link to itself as a contact.');
      if (contact.matterId !== household.matterId) throw new Error('Contacts from different workspaces cannot be linked.');
      const links = validateContactLinks(household.source['contactLinks']);
      if (links.some((link) => link.contactId === contact.id)) throw new Error('This contact is already linked to the household.');
      return saveAndReload({
        ...household.source,
        contactLinks: [...links, { contactId: contact.id, kind: contact.kind, ...(role?.trim() ? { role: role.trim() } : {}), label: contact.displayName }],
      });
    },
    async unlinkContact(householdRef, contactRef) {
      const household = requireHousehold(householdRef);
      const contact = requireContact(contactRef);
      if (contact.matterId !== household.matterId) throw new Error('Contacts from different workspaces cannot be unlinked.');
      const links = validateContactLinks(household.source['contactLinks']);
      if (!links.some((link) => link.contactId === contact.id)) throw new Error('This contact is not linked to the household.');
      return saveAndReload({ ...household.source, contactLinks: links.filter((link) => link.contactId !== contact.id) });
    },
    async listRelated(ref) {
      const contact = requireContact(ref);
      const contacts = activeContactRecords(live.records);
      const byId = new Map(contacts.map((candidate) => [candidate.id, candidate]));
      if (contact.kind === 'household') {
        return validateContactLinks(contact.source['contactLinks']).flatMap((link): RelatedContactProjection[] => {
          const related = byId.get(link.contactId);
          return related && related.kind === link.kind && related.matterId === contact.matterId
            ? [{ ref: toRecordRef(related), ...(link.role ? { role: link.role } : {}), label: related.displayName }]
            : [];
        });
      }
      return contacts.filter((candidate) => candidate.kind === 'household' && candidate.matterId === contact.matterId)
        .flatMap((household): RelatedContactProjection[] => validateContactLinks(household.source['contactLinks'])
          .filter((link) => link.contactId === contact.id && link.kind === contact.kind)
          .map((link) => ({ ref: toRecordRef(household), ...(link.role ? { role: link.role } : {}), label: household.displayName })));
    },
  };
}

/** Reactive reader over the current encrypted live-record snapshot. */
export function useContactRecordStore(): ContactRecordStore {
  const live = useLiveCrmRecords();
  return useMemo(() => createContactRecordStore(live), [live]);
}

export function projectRecordScreen(contact: ContactRecord): RecordScreenProjection {
  return { ref: toRecordRef(contact), contact, title: contact.displayName };
}

export function projectContactPrint(contact: ContactRecord): ContactPrintProjection {
  return { ref: toRecordRef(contact), title: contact.displayName, lifecycle: contact.lifecycle, ...(contact.primaryAdvisor ? { ownerDisplay: contact.primaryAdvisor } : {}), channels: contact.channels };
}

export function projectRelatedContactSummary(related: RelatedContactProjection): RelatedContactSummaryProjection {
  return { ...related, kind: related.ref.kind };
}
