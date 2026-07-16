import type { EntityRef } from '@/platform/crm/types';
import type {
  ContactChannel,
  ContactCreateInput,
  ContactKind,
  ContactLink,
  ContactPatch,
  ContactRecord,
  ContactRef,
  ContactTypeDefinition,
} from './types';

export const CONTACT_KINDS: readonly ContactKind[] = ['household', 'person', 'organization', 'trust'];

const stableId = /^[A-Za-z0-9][A-Za-z0-9:_-]*$/;

export function isContactKind(value: unknown): value is ContactKind {
  return typeof value === 'string' && (CONTACT_KINDS as readonly string[]).includes(value);
}

function requiredString(value: unknown, field: string): string {
  if (typeof value !== 'string' || !value.trim()) throw new Error(`${field} is required.`);
  return value.trim();
}

function assertStableId(value: unknown, field: string): string {
  const id = requiredString(value, field);
  if (!stableId.test(id)) throw new Error(`${field} must be a stable ID.`);
  return id;
}

function stringList(value: unknown, field: string): readonly string[] {
  if (value === undefined) return [];
  if (!Array.isArray(value) || value.some((item) => typeof item !== 'string' || !item.trim())) {
    throw new Error(`${field} must contain stable IDs.`);
  }
  const result = value.map((item) => item.trim());
  if (new Set(result).size !== result.length) throw new Error(`${field} cannot contain duplicates.`);
  return result;
}

export function validateContactChannels(value: unknown): readonly ContactChannel[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('channels must be an array.');
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('channel must be an object.');
    const channel = item as Record<string, unknown>;
    const id = assertStableId(channel['id'], 'channel.id');
    if (ids.has(id)) throw new Error('channels cannot contain duplicate IDs.');
    ids.add(id);
    return {
      id,
      address: requiredString(channel['address'], 'channel.address'),
      kind: requiredString(channel['kind'], 'channel.kind'),
      primary: Boolean(channel['primary']),
    };
  });
}

export function validateContactLinks(value: unknown): readonly ContactLink[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('contactLinks must be an array.');
  const ids = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('contact link must be an object.');
    const link = item as Record<string, unknown>;
    const contactId = assertStableId(link['contactId'], 'contactLinks.contactId');
    if (ids.has(contactId)) throw new Error('contactLinks cannot contain duplicate contact IDs.');
    ids.add(contactId);
    if (!isContactKind(link['kind'])) throw new Error('contactLinks.kind is invalid.');
    return {
      contactId,
      kind: link['kind'],
      ...(typeof link['role'] === 'string' && link['role'].trim() ? { role: link['role'].trim() } : {}),
      ...(typeof link['label'] === 'string' && link['label'].trim() ? { label: link['label'].trim() } : {}),
    };
  });
}

function validateRefs(value: unknown): readonly EntityRef[] {
  if (value === undefined) return [];
  if (!Array.isArray(value)) throw new Error('contextRefs must be an array.');
  const seen = new Set<string>();
  return value.map((item) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) throw new Error('contextRef must be an object.');
    const ref = item as Record<string, unknown>;
    const kind = requiredString(ref['kind'], 'contextRef.kind');
    const id = assertStableId(ref['id'], 'contextRef.id');
    const key = `${kind}:${id}`;
    if (seen.has(key)) throw new Error('contextRefs cannot contain duplicates.');
    seen.add(key);
    return { kind: kind as EntityRef['kind'], id, ...(typeof ref['matterId'] === 'string' ? { matterId: ref['matterId'] } : {}), ...(typeof ref['label'] === 'string' ? { label: ref['label'] } : {}) };
  });
}

function extensionData(value: unknown): Readonly<Record<string, unknown>> | undefined {
  if (value === undefined) return undefined;
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error('extensionData must be an object.');
  for (const key of Object.keys(value)) {
    if (!key.includes('.')) throw new Error('extensionData keys must be feature namespaced.');
  }
  return value as Readonly<Record<string, unknown>>;
}

export function displayNameFor(record: Record<string, unknown>): string {
  const name = typeof record['name'] === 'string' ? record['name'].trim() : '';
  if (name) return name;
  const fullName = [record['firstName'], record['lastName']].filter((part): part is string => typeof part === 'string' && Boolean(part.trim())).join(' ').trim();
  if (fullName) return fullName;
  return '';
}

export function validateContactCreate(input: ContactCreateInput): ContactCreateInput {
  if (!isContactKind(input.kind)) throw new Error('contact kind is invalid.');
  requiredString(input.matterId, 'matterId');
  if (input.kind === 'person') {
    if (!displayNameFor(input as Record<string, unknown>)) throw new Error('person identity is required.');
  } else {
    requiredString(input.name, `${input.kind}.name`);
  }
  stringList(input.tagIds, 'tagIds');
  extensionData(input.extensionData);
  return input;
}

export function validateContactPatch(patch: ContactPatch): ContactPatch {
  if ('name' in patch && patch.name !== undefined) requiredString(patch.name, 'name');
  if ('firstName' in patch && patch.firstName !== undefined) requiredString(patch.firstName, 'firstName');
  if ('lastName' in patch && patch.lastName !== undefined) requiredString(patch.lastName, 'lastName');
  if ('lifecycle' in patch && patch.lifecycle !== undefined) requiredString(patch.lifecycle, 'lifecycle');
  stringList(patch.tagIds, 'tagIds');
  validateContactChannels(patch.channels);
  validateRefs(patch.contextRefs);
  extensionData(patch.extensionData);
  return patch;
}

export function contactInputDocument(input: ContactCreateInput, id: string): Record<string, unknown> {
  validateContactCreate(input);
  return {
    id: assertStableId(id, 'id'),
    kind: input.kind,
    matterId: requiredString(input.matterId, 'matterId'),
    ...(input.kind === 'person'
      ? { ...(input.firstName?.trim() ? { firstName: input.firstName.trim() } : {}), ...(input.lastName?.trim() ? { lastName: input.lastName.trim() } : {}), ...(input.name?.trim() ? { name: input.name.trim() } : {}) }
      : { name: input.name.trim() }),
    lifecycle: input.lifecycle?.trim() || 'Active',
    tagIds: [...stringList(input.tagIds, 'tagIds')],
    contactLinks: [],
    contextRefs: [],
    channels: [],
    ...(input.extensionData ? { extensionData: input.extensionData } : {}),
  };
}

export function contactRecordFromDocument(source: Readonly<Record<string, unknown>>): ContactRecord | null {
  if (!isContactKind(source['kind']) || typeof source['id'] !== 'string' || typeof source['matterId'] !== 'string') return null;
  const name = displayNameFor(source);
  if (!name) return null;
  const kind = source['kind'];
  const base = {
    id: source['id'],
    kind,
    matterId: source['matterId'],
    displayName: name,
    lifecycle: typeof source['lifecycle'] === 'string' && source['lifecycle'].trim() ? source['lifecycle'] : 'Active',
    ...(typeof source['ownerMemberId'] === 'string' ? { ownerMemberId: source['ownerMemberId'] } : {}),
    ...(typeof source['primaryAdvisor'] === 'string' ? { primaryAdvisor: source['primaryAdvisor'] } : {}),
    tagIds: Array.isArray(source['tagIds']) && source['tagIds'].every((value) => typeof value === 'string') ? source['tagIds'] : [],
    ...(typeof source['createdAt'] === 'string' ? { createdAt: source['createdAt'] } : {}),
    ...(typeof source['updatedAt'] === 'string' ? { updatedAt: source['updatedAt'] } : {}),
    contextRefs: Array.isArray(source['contextRefs']) ? source['contextRefs'] as readonly EntityRef[] : [],
    ...(source['extensionData'] && typeof source['extensionData'] === 'object' && !Array.isArray(source['extensionData']) ? { extensionData: source['extensionData'] as Readonly<Record<string, unknown>> } : {}),
    source,
    channels: Array.isArray(source['channels']) ? source['channels'] as readonly ContactChannel[] : [],
    contactLinks: Array.isArray(source['contactLinks']) ? source['contactLinks'] as readonly ContactLink[] : [],
  } as const;
  if (kind === 'household') return { ...base, kind, name };
  if (kind === 'person') return { ...base, kind, ...(typeof source['firstName'] === 'string' ? { firstName: source['firstName'] } : {}), ...(typeof source['lastName'] === 'string' ? { lastName: source['lastName'] } : {}), ...(typeof source['name'] === 'string' ? { name: source['name'] } : {}) };
  return { ...base, kind, name };
}

export function toRecordRef(contact: Pick<ContactRecord, 'id' | 'kind' | 'matterId' | 'displayName'>): ContactRef {
  return { id: contact.id, kind: contact.kind, matterId: contact.matterId, label: contact.displayName };
}

export function validateContactRef(ref: ContactRef): ContactRef {
  return { id: assertStableId(ref.id, 'ref.id'), kind: isContactKind(ref.kind) ? ref.kind : (() => { throw new Error('ref.kind is invalid.'); })(), matterId: requiredString(ref.matterId, 'ref.matterId'), ...(ref.label?.trim() ? { label: ref.label.trim() } : {}) };
}

export function validateContactTypeDefinition(value: ContactTypeDefinition): ContactTypeDefinition {
  requiredString(value.id, 'contact type id');
  requiredString(value.label, 'contact type label');
  if (!Array.isArray(value.appliesTo) || !value.appliesTo.length || value.appliesTo.some((kind) => !isContactKind(kind))) {
    throw new Error('contact type must apply to one or more contact kinds.');
  }
  return value;
}
