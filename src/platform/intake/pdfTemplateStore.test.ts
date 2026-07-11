import { afterEach, describe, expect, it } from 'vitest';

import { assertSafePdfImportSource } from './pdfTemplates/pdfInspector';
import { sha256Hex } from './pdfTemplates/receipt';
import { usePdfTemplateStore } from './pdfTemplateStore';
import type { PdfTemplateDescriptor } from './pdfTemplates/templateContract';
import { KC_FALLBACK_PREFIX } from '@/config/identity';

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

  it('round-trips a large source through the encrypted artifact shelf', async () => {
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
    const stored = localStorage.getItem(
      `${KC_FALLBACK_PREFIX}intake.pdf-template-artifact::template_store_0001`
    );
    expect(stored).toBeTruthy();
    expect(stored).not.toContain(new TextDecoder().decode(largeSource));
    expect(stored).not.toContain(value.templateId);
    expect(stored).not.toContain('Full.Name');
    expect(stored).not.toContain(value.sourceSha256);
    // The old keychain-shaped shelf must never receive the full PDF.
    expect(
      Object.keys(localStorage).some((key) =>
        key.startsWith('lantern:keychain::')
      )
    ).toBe(false);
  });

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
