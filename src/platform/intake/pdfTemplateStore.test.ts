import { afterEach, describe, expect, it } from 'vitest';

import { assertSafePdfImportSource } from './pdfTemplates/pdfInspector';
import { sha256Hex } from './pdfTemplates/receipt';
import {
  deletePdfTemplateArtifact,
  readPdfTemplateArtifact,
  writePdfTemplateArtifact,
} from './pdfTemplateArtifacts';
import { usePdfTemplateStore } from './pdfTemplateStore';
import type { PdfTemplateDescriptor } from './pdfTemplates/templateContract';

const source = new TextEncoder().encode(
  '%PDF-1.4\n1 0 obj << /Type /Catalog >> endobj\n%%EOF'
);

async function descriptor(
  version = 1,
  fields: PdfTemplateDescriptor['fields'] = {
    full_name: {
      kind: 'acroform',
      field_id: 'full_name',
      acroform_field: 'Full.Name',
      pdf_field_type: 'text',
    },
  }
): Promise<PdfTemplateDescriptor> {
  return {
    templateId: 'template_store_0001',
    version,
    kind: 'acroform',
    sourceSha256: await sha256Hex(source),
    sourceArtifactRef: 'sealed-artifact:storeartifact0001',
    outputFileStem: 'contact-information',
    maxOutputBytes: 1024 * 1024,
    fields,
  };
}

afterEach(async () => {
  await usePdfTemplateStore.getState().resetForTests();
  localStorage.clear();
});

describe('pdf template library', () => {
  it('keeps browser artifacts in memory without writing sensitive data to localStorage', async () => {
    const templateId = 'template_artifact_0001';
    const sensitiveArtifact = JSON.stringify({
      templateId,
      sourceBytes: '%PDF-1.4 sensitive source bytes',
      fieldName: 'Full.Name',
      sourceSha256: 'sensitive-source-hash',
    });
    const storageBeforeWrite = Object.keys(localStorage).map((key) => [
      key,
      localStorage.getItem(key),
    ]);

    await writePdfTemplateArtifact(templateId, sensitiveArtifact);

    expect(await readPdfTemplateArtifact(templateId)).toBe(sensitiveArtifact);
    expect(Object.keys(localStorage).map((key) => [key, localStorage.getItem(key)])).toEqual(storageBeforeWrite);
    const storedValues = Object.keys(localStorage)
      .map((key) => localStorage.getItem(key))
      .join('\n');
    expect(storedValues).not.toContain(templateId);
    expect(storedValues).not.toContain('%PDF-1.4 sensitive source bytes');
    expect(storedValues).not.toContain('Full.Name');
    expect(storedValues).not.toContain('sensitive-source-hash');
    await deletePdfTemplateArtifact(templateId);
    expect(await readPdfTemplateArtifact(templateId)).toBeNull();
  });

  it('keeps sensitive bytes, hashes, maps, and values out of persisted library metadata', async () => {
    const value = await descriptor();
    await usePdfTemplateStore
      .getState()
      .importDraft({
        templateId: value.templateId,
        label: 'Contact information update',
        descriptor: value,
        sourceBytes: source,
      });
    const persisted = JSON.stringify(
      usePdfTemplateStore.getState().templatesById
    );
    expect(persisted).not.toContain(value.sourceSha256);
    expect(persisted).not.toContain('Full.Name');
    expect(persisted).not.toContain('Avery Chen');
    expect(persisted).not.toContain('http');
  });

  it('round-trips a large source through the browser memory shelf and clears it during test reset', async () => {
    // This test hashes/round-trips a 400KB source and has flaked on the
    // default 5000ms timeout under a loaded full-suite run (passes in ~2s
    // standalone). Generous per-test timeout only; no other tests changed.
    const largeSource = new Uint8Array(400 * 1024);
    largeSource.fill(0x61);
    largeSource.set(source.slice(0, 12));
    const value = await descriptor();
    value.sourceSha256 = await sha256Hex(largeSource);

    await usePdfTemplateStore.getState().importDraft({
      templateId: value.templateId,
      label: 'Large custodian form',
      descriptor: value,
      sourceBytes: largeSource,
    });

    expect(
      await usePdfTemplateStore.getState().loadSourceBytes(value.templateId, 1)
    ).toEqual(largeSource);
    expect(
      Object.keys(localStorage).some((key) =>
        key.includes('intake.pdf-template-artifact')
      )
    ).toBe(false);
    const persistedValues = Object.keys(localStorage)
      .map((key) => localStorage.getItem(key))
      .join('\n');
    expect(persistedValues).not.toContain(new TextDecoder().decode(largeSource));
    expect(persistedValues).not.toContain('Full.Name');
    expect(persistedValues).not.toContain(value.sourceSha256);

    await usePdfTemplateStore.getState().resetForTests();
    expect(
      await usePdfTemplateStore.getState().loadSourceBytes(value.templateId, 1)
    ).toBeNull();
  }, 20000);

  it('never accepts a website address as a local template source', async () => {
    const value = await descriptor();
    await expect(
      usePdfTemplateStore.getState().importDraft({
        templateId: value.templateId,
        label: 'Contact information update',
        descriptor: {
          ...value,
          sourceArtifactRef: 'https://custodian.example/form.pdf',
        },
        sourceBytes: source,
      })
    ).rejects.toThrow(/local sealed artifact/i);
  });

  it('approves an immutable version and forks a new version for a mapping correction', async () => {
    const original = await descriptor();
    const store = usePdfTemplateStore.getState();
    await store.importDraft({
      templateId: original.templateId,
      label: 'Contact update',
      descriptor: original,
      sourceBytes: source,
    });
    await store.approveVersion(original.templateId, 1);
    const revised = await store.updateDraft(original.templateId, {
      ...original,
      fields: {
        preferred_name: {
          kind: 'acroform',
          field_id: 'preferred_name',
          acroform_field: 'Preferred.Name',
          pdf_field_type: 'text',
        },
      },
    });
    expect(revised.version).toBe(2);
    expect(
      (await store.loadDescriptor(original.templateId, 1))?.fields
    ).toEqual(original.fields);
    expect(
      usePdfTemplateStore.getState().templatesById[original.templateId]
        ?.versions
    ).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ version: 1, status: 'approved' }),
        expect.objectContaining({ version: 2, status: 'draft' }),
      ])
    );
  });

  it('requires a new pinned hash when source bytes change', async () => {
    const original = await descriptor();
    const store = usePdfTemplateStore.getState();
    await store.importDraft({
      templateId: original.templateId,
      label: 'Contact update',
      descriptor: original,
      sourceBytes: source,
    });
    const changed = new TextEncoder().encode('%PDF-1.4\nchanged\n%%EOF');
    await expect(
      store.updateDraft(
        original.templateId,
        { ...original, sourceSha256: await sha256Hex(changed) },
        changed
      )
    ).resolves.toMatchObject({
      version: 2,
      sourceSha256: await sha256Hex(changed),
    });
  });

  it.each([
    ['active content', '%PDF-1.4\n/JavaScript (bad)\n%%EOF'],
    ['external link', '%PDF-1.4\n/URI (https://example.invalid)\n%%EOF'],
    ['dynamic XFA', '%PDF-1.4\n/XFA true\n%%EOF'],
    ['password protection', '%PDF-1.4\n/Encrypt 1 0 R\n%%EOF'],
    ['signature widget', '%PDF-1.4\n/FT /Sig\n%%EOF'],
  ])('rejects %s before import', (_name, contents) => {
    expect(() => {
      assertSafePdfImportSource(new TextEncoder().encode(contents));
    }).toThrow();
  });
});
