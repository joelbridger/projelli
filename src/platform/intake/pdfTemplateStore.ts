import { create } from 'zustand';
import { persist } from 'zustand/middleware';

import type { PdfTemplateDescriptor } from './pdfTemplates/templateContract';
import { assertValidPdfTemplateDescriptor } from './pdfTemplates/templateValidation';
import { sha256Hex } from './pdfTemplates/receipt';
import {
  deletePdfTemplateArtifact,
  readPdfTemplateArtifact,
  writePdfTemplateArtifact,
} from './pdfTemplateArtifacts';

export const PDF_TEMPLATE_LIBRARY_STORAGE_KEY = 'lantern:intake-pdf-template-library';

export type PdfTemplateApprovalStatus = 'draft' | 'approved';

export interface PdfTemplateVersionMetadata {
  version: number;
  kind: PdfTemplateDescriptor['kind'];
  status: PdfTemplateApprovalStatus;
  createdAt: string;
  approvedAt?: string;
}

/** Safe to persist: it intentionally has no PDF bytes, hashes, map, or values. */
export interface PdfTemplateLibraryRecord {
  templateId: string;
  label: string;
  versions: PdfTemplateVersionMetadata[];
  createdAt: string;
  updatedAt: string;
}

interface SensitiveTemplateVersion {
  descriptor: PdfTemplateDescriptor;
  sourceBytesB64: string;
}

interface SensitiveTemplateRecord {
  versions: Record<string, SensitiveTemplateVersion>;
}

function isSensitiveTemplateRecord(value: unknown): value is SensitiveTemplateRecord {
  if (!value || typeof value !== 'object') return false;
  const versions = (value as { versions?: unknown }).versions;
  return Boolean(versions && typeof versions === 'object' && !Array.isArray(versions));
}

function isPdfTemplateLibraryRecord(value: unknown, templateId: string): value is PdfTemplateLibraryRecord {
  if (!value || typeof value !== 'object') return false;
  const record = value as {
    templateId?: unknown;
    label?: unknown;
    versions?: unknown;
    createdAt?: unknown;
    updatedAt?: unknown;
  };
  if (record.templateId !== templateId || typeof record.label !== 'string' ||
    !Array.isArray(record.versions) || typeof record.createdAt !== 'string' || typeof record.updatedAt !== 'string') return false;
  return record.versions.every((version) => {
    if (!version || typeof version !== 'object') return false;
    const candidate = version as { version?: unknown; status?: unknown };
    return Number.isInteger(candidate.version) &&
      (candidate.status === 'draft' || candidate.status === 'approved');
  });
}

interface PdfTemplateStoreState {
  templatesById: Record<string, PdfTemplateLibraryRecord>;
  importDraft: (input: { templateId: string; label: string; descriptor: PdfTemplateDescriptor; sourceBytes: Uint8Array }) => Promise<PdfTemplateDescriptor>;
  updateDraft: (templateId: string, descriptor: PdfTemplateDescriptor, sourceBytes?: Uint8Array) => Promise<PdfTemplateDescriptor>;
  approveVersion: (templateId: string, version: number) => Promise<PdfTemplateDescriptor>;
  getApprovedDescriptors: () => Promise<PdfTemplateDescriptor[]>;
  loadDescriptor: (templateId: string, version: number) => Promise<PdfTemplateDescriptor | null>;
  loadSourceBytes: (templateId: string, version: number) => Promise<Uint8Array | null>;
  resetForTests: () => Promise<void>;
}

export interface PersistedPdfTemplateLibraryState {
  templatesById: Record<string, PdfTemplateLibraryRecord>;
}

function cloneDescriptor(descriptor: PdfTemplateDescriptor): PdfTemplateDescriptor {
  return structuredClone(descriptor);
}

function b64(bytes: Uint8Array): string {
  let text = '';
  for (const byte of bytes) text += String.fromCharCode(byte);
  return btoa(text);
}

function bytes(value: string): Uint8Array {
  const text = atob(value);
  return Uint8Array.from(text, (character) => character.charCodeAt(0));
}

async function writeSensitiveRecord(templateId: string, value: SensitiveTemplateRecord): Promise<void> {
  await writePdfTemplateArtifact(templateId, JSON.stringify(value));
}

async function readSensitiveRecord(templateId: string): Promise<SensitiveTemplateRecord | null> {
  try {
    const raw = await readPdfTemplateArtifact(templateId);
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    return isSensitiveTemplateRecord(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

async function clearSecret(templateId: string): Promise<void> {
  await deletePdfTemplateArtifact(templateId);
}

function metadata(descriptor: PdfTemplateDescriptor, status: PdfTemplateApprovalStatus, now: string): PdfTemplateVersionMetadata {
  return { version: descriptor.version, kind: descriptor.kind, status, createdAt: now, ...(status === 'approved' ? { approvedAt: now } : {}) };
}

function validTemplateId(value: string): void {
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{7,127}$/u.test(value)) throw new Error('Template id is not safe.');
}

/** Drafts may be incomplete maps, but their pinned source still has to be local and safe. */
function assertSafeDraftSource(descriptor: PdfTemplateDescriptor): void {
  validTemplateId(descriptor.templateId);
  if (!Number.isInteger(descriptor.version) || descriptor.version < 1) throw new Error('Template version is not valid.');
  if (!/^[a-f0-9]{64}$/u.test(descriptor.sourceSha256)) throw new Error('Template source hash is not valid.');
  if (!/^sealed-artifact:[A-Za-z0-9_-]{16,512}$/u.test(descriptor.sourceArtifactRef)) {
    throw new Error('Template source must be a local sealed artifact, not a website address.');
  }
}

export function partializePdfTemplateLibraryState(state: Pick<PdfTemplateStoreState, 'templatesById'>): PersistedPdfTemplateLibraryState {
  return { templatesById: structuredClone(state.templatesById) };
}

export function sanitizePersistedPdfTemplateLibraryState(value: unknown): PersistedPdfTemplateLibraryState {
  if (!value || typeof value !== 'object') return { templatesById: {} };
  const records = (value as { templatesById?: unknown }).templatesById;
  if (!records || typeof records !== 'object' || Array.isArray(records)) return { templatesById: {} };
  const kept = Object.entries(records).flatMap(([templateId, record]) => {
    if (!isPdfTemplateLibraryRecord(record, templateId)) return [];
    return [[templateId, structuredClone(record)] as const];
  });
  return { templatesById: Object.fromEntries(kept) };
}

export const usePdfTemplateStore = create<PdfTemplateStoreState>()(
  persist<PdfTemplateStoreState, [], [], PersistedPdfTemplateLibraryState>(
    (set, get) => ({
      templatesById: {},
      importDraft: async ({ templateId, label, descriptor, sourceBytes }) => {
        validTemplateId(templateId);
        if (!label.trim() || get().templatesById[templateId]) throw new Error('A template with this id already exists.');
        if (descriptor.templateId !== templateId || descriptor.version !== 1) throw new Error('New templates must start at version 1.');
        assertSafeDraftSource(descriptor);
        if (await sha256Hex(sourceBytes) !== descriptor.sourceSha256) throw new Error('Imported PDF bytes do not match the saved hash.');
        const now = new Date().toISOString();
        await writeSensitiveRecord(templateId, { versions: { '1': { descriptor: cloneDescriptor(descriptor), sourceBytesB64: b64(sourceBytes) } } });
        set((state) => ({ templatesById: { ...state.templatesById, [templateId]: { templateId, label: label.trim(), versions: [metadata(descriptor, 'draft', now)], createdAt: now, updatedAt: now } } }));
        return cloneDescriptor(descriptor);
      },
      updateDraft: async (templateId, descriptor, sourceBytes) => {
        const record = get().templatesById[templateId];
        if (!record || descriptor.templateId !== templateId) throw new Error('Template was not found.');
        assertSafeDraftSource(descriptor);
        const secret = await readSensitiveRecord(templateId);
        if (!secret) throw new Error('Template source is unavailable on this device.');
        const current = record.versions.find((candidate) => candidate.version === descriptor.version);
        const previousDescriptor = secret.versions[String(descriptor.version)]?.descriptor;
        // A new source hash is a distinct reviewed artifact even while a draft
        // is open. It must never replace the earlier pinned source in place.
        const mustFork = current?.status === 'approved' || !current || previousDescriptor?.sourceSha256 !== descriptor.sourceSha256;
        const nextVersion = mustFork ? Math.max(...record.versions.map((candidate) => candidate.version)) + 1 : descriptor.version;
        const prior = secret.versions[String(descriptor.version)] ?? secret.versions[String(Math.max(...record.versions.map((candidate) => candidate.version)))] ;
        const nextBytes = sourceBytes ?? (prior ? bytes(prior.sourceBytesB64) : null);
        if (!nextBytes) throw new Error('Template source is unavailable on this device.');
        const next = cloneDescriptor({ ...descriptor, version: nextVersion });
        if (await sha256Hex(nextBytes) !== next.sourceSha256) throw new Error('Template source does not match this version hash.');
        secret.versions[String(nextVersion)] = { descriptor: next, sourceBytesB64: b64(nextBytes) };
        await writeSensitiveRecord(templateId, secret);
        const now = new Date().toISOString();
        set((state) => ({ templatesById: { ...state.templatesById, [templateId]: { ...record, versions: [...record.versions.filter((candidate) => candidate.version !== nextVersion), metadata(next, 'draft', now)], updatedAt: now } } }));
        return cloneDescriptor(next);
      },
      approveVersion: async (templateId, version) => {
        const record = get().templatesById[templateId];
        const secret = await readSensitiveRecord(templateId);
        const stored = secret?.versions[String(version)];
        if (!record || !secret || !stored) throw new Error('Template version was not found.');
        assertValidPdfTemplateDescriptor(stored.descriptor);
        if (await sha256Hex(bytes(stored.sourceBytesB64)) !== stored.descriptor.sourceSha256) throw new Error('Template source no longer matches its approved hash.');
        const now = new Date().toISOString();
        set((state) => ({ templatesById: { ...state.templatesById, [templateId]: { ...record, versions: record.versions.map((candidate) => candidate.version === version ? { ...candidate, status: 'approved', approvedAt: now } : candidate), updatedAt: now } } }));
        return cloneDescriptor(stored.descriptor);
      },
      getApprovedDescriptors: async () => {
        const records = Object.values(get().templatesById);
        const result = await Promise.all(records.flatMap((record) => record.versions.filter((version) => version.status === 'approved').map(async (version) => get().loadDescriptor(record.templateId, version.version))));
        return result.filter((value): value is PdfTemplateDescriptor => value !== null).map(cloneDescriptor);
      },
      loadDescriptor: async (templateId, version) => {
        const status = get().templatesById[templateId]?.versions.find((candidate) => candidate.version === version);
        const stored = (await readSensitiveRecord(templateId))?.versions[String(version)];
        if (!status || !stored) return null;
        try { assertValidPdfTemplateDescriptor(stored.descriptor); return cloneDescriptor(stored.descriptor); } catch { return null; }
      },
      loadSourceBytes: async (templateId, version) => {
        const stored = (await readSensitiveRecord(templateId))?.versions[String(version)];
        return stored ? bytes(stored.sourceBytesB64) : null;
      },
      resetForTests: async () => {
        await Promise.all(Object.keys(get().templatesById).map(clearSecret));
        set({ templatesById: {} });
      },
    }),
    { name: PDF_TEMPLATE_LIBRARY_STORAGE_KEY, version: 1, partialize: partializePdfTemplateLibraryState, merge: (persisted, current) => ({ ...current, ...sanitizePersistedPdfTemplateLibraryState(persisted) }) },
  ),
);
