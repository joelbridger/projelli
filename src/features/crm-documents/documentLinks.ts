import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { EntityRef } from '@/platform/crm/types';
import type { HouseholdRecord } from '@/features/crm-clients/adapters';

export type LinkedDocument = {
  ref: EntityRef;
  target: 'household' | 'person' | 'note' | 'task';
  targetId: string;
  targetLabel: string;
  linkedAt?: string;
};

function refs(value: unknown): EntityRef[] {
  return Array.isArray(value)
    ? value.filter((item): item is EntityRef => Boolean(item) && typeof item === 'object' && (item as EntityRef).kind === 'document' && typeof (item as EntityRef).id === 'string')
    : [];
}

function hasHousehold(record: LiveCrmRecord, householdId: string): boolean {
  if (record['householdId'] === householdId) return true;
  const householdRef = record['householdRef'];
  if (householdRef && typeof householdRef === 'object' && (householdRef as { id?: unknown }).id === householdId) return true;
  return ['householdLinks', 'links', 'contextRefs'].some((key) => Array.isArray(record[key]) && record[key].some((item) => item && typeof item === 'object' && (item as { kind?: unknown; id?: unknown }).kind === 'household' && (item as { id?: unknown }).id === householdId));
}

/** The document itself stays in Documents. These are only pointers saved on CRM records. */
export function linkedDocumentsForHousehold(household: HouseholdRecord, records: readonly LiveCrmRecord[]): LinkedDocument[] {
  const entries: LinkedDocument[] = [];
  refs(household.contextRefs).forEach((ref) => entries.push({ ref, target: 'household', targetId: household.id, targetLabel: household.name }));
  [...household.members, ...household.externalParties].forEach((person) => refs(person.contextRefs).forEach((ref) => entries.push({ ref, target: 'person', targetId: person.id, targetLabel: person.name })));
  household.notes.forEach((note) => refs(note.links).forEach((ref) => entries.push({ ref, target: 'note', targetId: note.id, targetLabel: note.body.slice(0, 60) || 'Untitled note', ...((note.updatedAt ?? note.createdAt) ? { linkedAt: note.updatedAt ?? note.createdAt } : {}) })));
  records.forEach((record) => {
    if (!hasHousehold(record, household.id)) return;
    if (record.kind === 'task') refs(record['contextRefs']).forEach((ref) => entries.push({ ref, target: 'task', targetId: record.id, targetLabel: typeof record['title'] === 'string' ? record['title'] : 'Untitled task', ...(typeof record.updatedAt === 'string' ? { linkedAt: record.updatedAt } : {}) }));
    if (record.kind === 'note') refs(record['links']).forEach((ref) => entries.push({ ref, target: 'note', targetId: record.id, targetLabel: typeof record['title'] === 'string' ? record['title'] : typeof record['body'] === 'string' ? record['body'].slice(0, 60) : 'Untitled note', ...(typeof record.updatedAt === 'string' ? { linkedAt: record.updatedAt } : {}) }));
  });
  return [...new Map(entries.map((entry) => [`${entry.ref.id}:${entry.target}:${entry.targetId}`, entry])).values()];
}

export function addDocumentRef(existing: unknown, ref: EntityRef): EntityRef[] {
  const current = Array.isArray(existing) ? existing.filter((item): item is EntityRef => Boolean(item) && typeof item === 'object' && typeof (item as EntityRef).kind === 'string' && typeof (item as EntityRef).id === 'string') : [];
  return current.some((item) => item.kind === 'document' && item.id === ref.id) ? current : [...current, ref];
}

export function removeDocumentRef(existing: unknown, documentPath: string): EntityRef[] {
  return (Array.isArray(existing) ? existing : []).filter((item) => !(item && typeof item === 'object' && (item as EntityRef).kind === 'document' && (item as EntityRef).id === documentPath)) as EntityRef[];
}

export function recordBelongsToHousehold(record: LiveCrmRecord, householdId: string): boolean {
  return hasHousehold(record, householdId);
}
