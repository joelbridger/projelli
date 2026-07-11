import { describe, expect, it } from 'vitest';

import { instantiateRequestBlueprint } from '@/platform/intake/blueprintFactory';
import { b64ToBytes } from '@/platform/intake/pageSeal';
import { sha256Hex } from '@/platform/intake/pdfTemplates/receipt';
import type { PdfTemplateDescriptor } from '@/platform/intake/types';
import { createPdfFillDraftItem } from './requestComposerPdf';

const sourceBytes = new TextEncoder().encode('bridge-source-pdf');

async function approvedTemplate(): Promise<PdfTemplateDescriptor> {
  return {
    templateId: 'template_bridge_001',
    version: 1,
    kind: 'acroform',
    sourceSha256: await sha256Hex(sourceBytes),
    sourceArtifactRef: 'sealed-artifact:bridgesourcepdf01',
    outputFileStem: 'bridge-form',
    maxOutputBytes: 1024 * 1024,
    fields: {
      household_name: {
        kind: 'acroform',
        field_id: 'household_name',
        acroform_field: 'Household.Name',
        pdf_field_type: 'text',
      },
    },
  };
}

describe('createPdfFillDraftItem', () => {
  it('attaches source bytes that round-trip through base64', async () => {
    const item = await createPdfFillDraftItem(await approvedTemplate(), sourceBytes);

    expect(item.sealed_source_pdf_b64).toBeDefined();
    expect(Array.from(b64ToBytes(item.sealed_source_pdf_b64 ?? ''))).toEqual(Array.from(sourceBytes));
  });

  it('rejects source bytes that do not match the approved hash', async () => {
    await expect(createPdfFillDraftItem(
      await approvedTemplate(),
      new TextEncoder().encode('different-source-pdf'),
    )).rejects.toThrow(/do not match the approved template hash/iu);
  });

  it('keeps attached source bytes when a blueprint becomes an issued request', async () => {
    const item = await createPdfFillDraftItem(await approvedTemplate(), sourceBytes);
    const request = instantiateRequestBlueprint({
      blueprint: {
        blueprintId: 'bridge-blueprint',
        schemaVersion: 1,
        label: 'Bridge PDF request',
        source: 'firm_saved',
        defaultKind: 'standing',
        items: [item],
      },
      requestId: 'request_bridge_001',
      matterId: 'matter_bridge_001',
    });

    expect(request.items[0]).toMatchObject({
      t: 'pdf_fill',
      sealed_source_pdf_b64: item.sealed_source_pdf_b64,
    });
  });
});
