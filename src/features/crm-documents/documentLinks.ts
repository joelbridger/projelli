import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import type { EntityRef } from '@/platform/crm/types';
import type { HouseholdRecord } from '@/features/crm-clients/adapters';
import {
  validateContactRef,
  type ContactKind,
  type ContactRef,
} from '@/features/crm-contacts';
import { PathValidator } from '@/platform/fs';
import { resolveWorkspaceMatterId } from '@/platform/rag/matterResolver';
import { UNASSIGNED_MATTER_ID, type Matter } from '@/platform/types/matter';
import type { FileNode } from '@/platform/types/workspace';

export type WorkspaceDocumentRef = EntityRef & {
  kind: 'document';
  /** Workspace-relative identity; never an arbitrary operating-system path. */
  id: string;
  /** Current file-tree label, suitable for display. */
  label: string;
};

export type WorkspaceDocumentRefErrorCode =
  | 'malformed'
  | 'unsafe_path'
  | 'not_found'
  | 'unsupported'
  | 'wrong_matter'
  | 'duplicate';

export class WorkspaceDocumentRefError extends Error {
  readonly code: WorkspaceDocumentRefErrorCode;

  constructor(code: WorkspaceDocumentRefErrorCode, message?: string) {
    super(message ?? code);
    this.name = 'WorkspaceDocumentRefError';
    this.code = code;
  }
}

export interface ResolveWorkspaceDocumentRefInput {
  path: string;
  workspaceRoot: string;
  fileTree: readonly FileNode[];
  matters: readonly Matter[];
  targetMatterId?: string | null;
  existing?: unknown;
}

type LinkedDocumentBase = {
  ref: EntityRef;
  targetId: string;
  targetLabel: string;
  linkedAt?: string;
};

export type LinkedDocument = LinkedDocumentBase & (
  | { target: ContactKind; contactRef: ContactRef }
  | { target: 'note' | 'task'; contactRef?: never }
);

/** Public record-file link. The file stays Documents-owned. */
export interface ContactFileLink {
  contactRef: ContactRef;
  documentRef: WorkspaceDocumentRef;
}

const CLIENT_DOCUMENT_EXTENSIONS = new Set([
  'pdf',
  'doc',
  'docx',
  'xls',
  'xlsx',
  'csv',
  'ppt',
  'pptx',
  'rtf',
  'txt',
  'png',
  'jpg',
  'jpeg',
  'gif',
  'webp',
  'tif',
  'tiff',
  'heic',
  'eml',
  'msg',
]);

const GENERATED_MEETING_DOCUMENTS = new Set(['meeting.json', 'transcript.json']);

function allFiles(nodes: readonly FileNode[]): FileNode[] {
  return nodes.flatMap((node) => node.type === 'file' ? [node] : allFiles(node.children ?? []));
}

function portablePath(path: string): string {
  return path.replace(/\\/g, '/').replace(/^\.\//, '').replace(/\/{2,}/g, '/');
}

function documentPathKey(path: string, workspaceRoot: string): string {
  return /^[a-zA-Z]:[\\/]/.test(workspaceRoot) ? path.toLocaleLowerCase() : path;
}

function displayName(path: string): string {
  return portablePath(path).split('/').pop() ?? path;
}

function relativePath(validator: PathValidator, path: string): string {
  const validated = validator.validatePath(path);
  const relative = portablePath(validator.getRelativePath(validated));
  if (!relative || relative === '.') throw new WorkspaceDocumentRefError('malformed');
  return relative;
}

function validPortableDocumentRef(value: unknown): WorkspaceDocumentRef | null {
  if (!value || typeof value !== 'object') return null;
  const ref = value as Partial<EntityRef>;
  if (ref.kind !== 'document' || typeof ref.id !== 'string' || !ref.id.trim()) return null;
  const id = portablePath(ref.id.trim());
  const segments = id.split('/');
  if (!id || id.startsWith('/') || /^[a-zA-Z]:\//.test(id) || segments.includes('..') || segments.includes('.')) return null;
  const label = typeof ref.label === 'string' && ref.label.trim() ? ref.label : displayName(id);
  return {
    kind: 'document',
    id,
    label,
    ...(typeof ref.matterId === 'string' && ref.matterId ? { matterId: ref.matterId } : {}),
  };
}

export function linkWorkspaceDocumentToContact(
  contactRef: ContactRef,
  documentRef: WorkspaceDocumentRef,
): ContactFileLink {
  const contact = validateContactRef(contactRef);
  const document = validPortableDocumentRef(documentRef);
  if (!document) throw new WorkspaceDocumentRefError('malformed');
  if (document.matterId && document.matterId !== contact.matterId) {
    throw new WorkspaceDocumentRefError('wrong_matter');
  }
  return { contactRef: contact, documentRef: document };
}

/** Stable document-only view over a mixed CRM relation list. */
export function listWorkspaceDocumentRefs(value: unknown): WorkspaceDocumentRef[] {
  if (!Array.isArray(value)) return [];
  const byPath = new Map<string, WorkspaceDocumentRef>();
  for (const candidate of value) {
    const ref = validPortableDocumentRef(candidate);
    if (ref && !byPath.has(ref.id)) byPath.set(ref.id, ref);
  }
  return [...byPath.values()];
}

/**
 * Resolve a current workspace-tree file to the one portable CRM pointer shape.
 * This does not read, copy, upload, move, or otherwise mutate the source file.
 */
export function resolveWorkspaceDocumentRef(input: ResolveWorkspaceDocumentRefInput): WorkspaceDocumentRef {
  if (!input.workspaceRoot.trim() || !input.path.trim()) {
    throw new WorkspaceDocumentRefError('malformed');
  }
  const validator = new PathValidator(input.workspaceRoot);
  let requestedPath: string;
  try {
    requestedPath = relativePath(validator, input.path);
  } catch (error: unknown) {
    if (error instanceof WorkspaceDocumentRefError) throw error;
    throw new WorkspaceDocumentRefError('unsafe_path');
  }
  const file = allFiles(input.fileTree).find((candidate) => {
    try {
      return documentPathKey(relativePath(validator, candidate.path), input.workspaceRoot) ===
        documentPathKey(requestedPath, input.workspaceRoot);
    } catch {
      return false;
    }
  });
  if (!file) throw new WorkspaceDocumentRefError('not_found');
  if (!isPlausibleClientDocument(file.name)) throw new WorkspaceDocumentRefError('unsupported');
  const owningMatterId = resolveWorkspaceMatterId(file.path, input.workspaceRoot, [...input.matters]);
  if (input.targetMatterId && owningMatterId !== input.targetMatterId) {
    throw new WorkspaceDocumentRefError('wrong_matter');
  }
  const existingValues: unknown[] = Array.isArray(input.existing) ? input.existing : [];
  const existingPaths = new Set(existingValues.flatMap((candidate) => {
    if (!candidate || typeof candidate !== 'object') return [];
    const ref = candidate as Record<string, unknown>;
    if (ref['kind'] !== 'document' || typeof ref['id'] !== 'string') return [];
    try {
      return [documentPathKey(relativePath(validator, ref['id']), input.workspaceRoot)];
    } catch {
      return [];
    }
  }));
  if (existingPaths.has(documentPathKey(requestedPath, input.workspaceRoot))) {
    throw new WorkspaceDocumentRefError('duplicate');
  }
  return {
    kind: 'document',
    id: requestedPath,
    label: file.name,
    ...(owningMatterId !== UNASSIGNED_MATTER_ID ? { matterId: owningMatterId } : {}),
  };
}

/** Adds one validated pointer to a mixed relation list and rejects duplicates. */
export function addWorkspaceDocumentRef(existing: unknown, ref: WorkspaceDocumentRef): EntityRef[] {
  const clean = validPortableDocumentRef(ref);
  if (!clean || !isPlausibleClientDocument(clean.id)) throw new WorkspaceDocumentRefError('malformed');
  const current = Array.isArray(existing)
    ? existing.filter((candidate): candidate is EntityRef => Boolean(candidate) && typeof candidate === 'object' && typeof (candidate as Partial<EntityRef>).kind === 'string' && typeof (candidate as Partial<EntityRef>).id === 'string')
    : [];
  if (listWorkspaceDocumentRefs(current).some((candidate) => candidate.id === clean.id)) {
    throw new WorkspaceDocumentRefError('duplicate');
  }
  return [...current, clean];
}

/** Removes only the named document pointer; other CRM relations remain untouched. */
export function removeWorkspaceDocumentRef(existing: unknown, documentPath: string): EntityRef[] {
  const path = portablePath(documentPath);
  return (Array.isArray(existing) ? existing : []).filter((candidate) => {
    const ref = validPortableDocumentRef(candidate);
    return !ref || ref.id !== path;
  }) as EntityRef[];
}

export function isPlausibleClientDocument(pathOrName: string): boolean {
  const name = pathOrName.split(/[\\/]/).pop()?.toLowerCase() ?? '';
  if (GENERATED_MEETING_DOCUMENTS.has(name)) return true;
  const dot = name.lastIndexOf('.');
  return dot > 0 && CLIENT_DOCUMENT_EXTENSIONS.has(name.slice(dot + 1));
}

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
  const matterId = household.id;
  refs(household.contextRefs).forEach((ref) => entries.push({ ref, target: 'household', contactRef: { kind: 'household', id: household.id, matterId, label: household.name }, targetId: household.id, targetLabel: household.name }));
  [...household.members, ...household.externalParties].forEach((person) => {
    refs(person.contextRefs).forEach((ref) => entries.push({ ref, target: person.personType, contactRef: { kind: person.personType, id: person.id, matterId, label: person.name }, targetId: person.id, targetLabel: person.name }));
  });
  household.notes.forEach((note) => {
    refs(note.links).forEach((ref) => entries.push({ ref, target: 'note', targetId: note.id, targetLabel: note.body.slice(0, 60) || 'Untitled note', ...((note.updatedAt ?? note.createdAt) ? { linkedAt: note.updatedAt ?? note.createdAt } : {}) }));
  });
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
