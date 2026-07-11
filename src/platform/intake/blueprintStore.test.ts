import { afterEach, describe, expect, it } from 'vitest';

import { instantiateRequestBlueprint } from './blueprintFactory';
import {
  partializeBlueprintStateForPersistence,
  useBlueprintStore,
} from './blueprintStore';
import { NEW_HOUSEHOLD_BLUEPRINT } from './defaultBlueprints';
import { BlueprintValidationError } from './blueprintValidation';
import { createPdfFillDraftItem } from '@/features/intake/pdfTemplates/requestComposerPdf';
import { sha256Hex } from './pdfTemplates/receipt';
import type { PdfTemplateDescriptor, RequestItem } from './types';

const annualReviewItems: RequestItem[] = [
  {
    t: 'guided_question', item_id: 'income', label: 'Annual income', help_text: '', required: true,
    subject: 'household', prompt: 'What is your annual household income?', response_format: 'money', fact_kind: 'income_annual',
  },
];

afterEach(() => {
  useBlueprintStore.getState().resetForTests();
  localStorage.clear();
});

describe('blueprintStore', () => {
  it('keeps built-ins immutable through every exposed mutation path', () => {
    const store = useBlueprintStore.getState();

    expect(() => store.updateFirmBlueprint(NEW_HOUSEHOLD_BLUEPRINT.blueprintId, { label: 'Changed' }))
      .toThrow(BlueprintValidationError);
    expect(() => store.archiveFirmBlueprint(NEW_HOUSEHOLD_BLUEPRINT.blueprintId))
      .toThrow(BlueprintValidationError);
    expect(store.getBlueprint(NEW_HOUSEHOLD_BLUEPRINT.blueprintId)?.label).toBe('New household');
  });

  it('creates, edits, and archives a firm blueprint without changing a sent request snapshot', () => {
    const store = useBlueprintStore.getState();
    const created = store.createFirmBlueprint({
      blueprintId: 'annual-review', label: 'Annual review update', items: annualReviewItems,
    });
    const sentSnapshot = instantiateRequestBlueprint({
      blueprint: created, requestId: 'request-1', matterId: 'matter-1', kind: 'standing',
    });
    const edited = store.updateFirmBlueprint('annual-review', { label: 'Updated annual review' });
    const archived = store.archiveFirmBlueprint('annual-review');

    expect(edited.label).toBe('Updated annual review');
    expect(archived.archived).toBe(true);
    expect(store.getBlueprint('annual-review')?.archived).toBe(true);
    expect(store.listBlueprints().some((blueprint) => blueprint.blueprintId === 'annual-review')).toBe(false);
    expect(store.listBlueprints(true).some((blueprint) => blueprint.blueprintId === 'annual-review')).toBe(true);
    expect(sentSnapshot).toMatchObject({
      request_id: 'request-1',
      blueprint_ref: 'annual-review',
      items: [{ item_id: 'income', label: 'Annual income' }],
    });
  });

  it('persists only request structure and wording', () => {
    const store = useBlueprintStore.getState();
    store.createFirmBlueprint({
      blueprintId: 'annual-review', label: 'Annual review update', items: annualReviewItems,
    });

    const persisted = JSON.stringify(partializeBlueprintStateForPersistence(useBlueprintStore.getState()));
    expect(persisted).toContain('annual-review');
    expect(persisted).not.toMatch(/fact_id|display_value|provenance|matter_id|relay|ciphertext|link_secret/iu);
  });

  it('never saves an issued PDF source artifact in a reusable blueprint', async () => {
    const sourceBytes = new TextEncoder().encode('persisted-blueprint-source');
    const template: PdfTemplateDescriptor = {
      templateId: 'template_persist_001', version: 1, kind: 'acroform', sourceSha256: await sha256Hex(sourceBytes),
      sourceArtifactRef: 'sealed-artifact:persistedsource001', outputFileStem: 'persisted-form', maxOutputBytes: 1024 * 1024,
      fields: { name: { kind: 'acroform', field_id: 'name', acroform_field: 'Name', pdf_field_type: 'text' } },
    };
    const issuedItem = await createPdfFillDraftItem(template, sourceBytes);
    const stored = useBlueprintStore.getState().createFirmBlueprint({
      blueprintId: 'persisted-pdf', label: 'Persisted PDF', items: [issuedItem],
    });

    const storedItem = stored.items[0];
    expect(storedItem?.t).toBe('pdf_fill');
    expect(storedItem && 'sealed_source_pdf_b64' in storedItem).toBe(false);
    const persisted = partializeBlueprintStateForPersistence(useBlueprintStore.getState());
    expect(persisted.firmBlueprintsById['persisted-pdf']?.items[0]).not.toHaveProperty('sealed_source_pdf_b64');
  });

  it.each(['number', 'text', 'choice'] as const)(
    'rejects unsupported guided response format %s',
    (responseFormat) => {
      expect(() => useBlueprintStore.getState().createFirmBlueprint({
        blueprintId: `invalid-${responseFormat}`,
        label: 'Invalid blueprint',
        items: [{
          t: 'guided_question', item_id: 'question', label: 'Question', help_text: '', required: true,
          subject: 'primary', prompt: 'Question?', response_format: responseFormat,
        }],
      })).toThrow(/money or range/iu);
    },
  );
});
