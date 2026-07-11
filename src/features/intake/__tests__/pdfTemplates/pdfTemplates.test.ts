import { describe, expect, it, vi } from 'vitest';

import { assertSendableRequest } from '@/platform/intake/createIntake';
import { assertPrefillLegal, type FormRequest, type PdfTemplateDescriptor } from '@/platform/intake/types';
import { assertDryFillPreview, buildDryFillPreviewSnapshot, drawOverlayDryFill, overlayField } from '../../pdfTemplates/TemplateLibraryPanel';
import { createPdfFillDraftItem } from '../../pdfTemplates/requestComposerPdf';

const template: PdfTemplateDescriptor = {
  templateId: 'template_golden_001', version: 1, kind: 'overlay', sourceSha256: '531a82ecb7a8dd2bef553b4bcadd33e57c06b001005e27101f6c1d12a88cc5e6',
  sourceArtifactRef: 'sealed-artifact:goldenartifact0001', outputFileStem: 'contact-information', maxOutputBytes: 1024 * 1024,
  fields: {
    full_name: { kind: 'overlay', field_id: 'full_name', pdf_field_type: 'text', page: 1, rect: { x: 0.1, y: 0.1, width: 0.4, height: 0.08 }, font: { family: 'Helvetica', size: 10 }, alignment: 'left', overflow: 'wrap' },
    birth_date: { kind: 'overlay', field_id: 'birth_date', pdf_field_type: 'date', page: 1, rect: { x: 0.1, y: 0.2, width: 0.2, height: 0.05 }, font: { family: 'Helvetica', size: 10 }, alignment: 'left', overflow: 'stop' },
    annual_income: { kind: 'overlay', field_id: 'annual_income', pdf_field_type: 'money', page: 1, rect: { x: 0.1, y: 0.3, width: 0.2, height: 0.05 }, font: { family: 'Helvetica', size: 10 }, alignment: 'right', overflow: 'stop' },
    consent: { kind: 'overlay', field_id: 'consent', pdf_field_type: 'checkbox', page: 1, rect: { x: 0.1, y: 0.4, width: 0.04, height: 0.04 }, font: { family: 'Helvetica', size: 10 }, alignment: 'left', overflow: 'stop' },
    delivery: { kind: 'overlay', field_id: 'delivery', pdf_field_type: 'radio', options: [{ value: 'mail', label: 'Mail' }, { value: 'email', label: 'Email' }], page: 1, rect: { x: 0.1, y: 0.5, width: 0.2, height: 0.05 }, font: { family: 'Helvetica', size: 10 }, alignment: 'left', overflow: 'stop' },
    state: { kind: 'overlay', field_id: 'state', pdf_field_type: 'select', options: [{ value: 'ca', label: 'California' }, { value: 'ny', label: 'New York' }], page: 1, rect: { x: 0.1, y: 0.6, width: 0.2, height: 0.05 }, font: { family: 'Helvetica', size: 10 }, alignment: 'left', overflow: 'stop' },
  },
};

describe('PDF template composer and golden dry fill', () => {
  it('adds an approved template as a value snapshot that is sendable', async () => {
    const item = await createPdfFillDraftItem(template, new TextEncoder().encode('golden-source-pdf'));
    template.fields.full_name = { ...template.fields.full_name, rect: { x: 0.8, y: 0.1, width: 0.1, height: 0.05 } };
    expect(item.template.fields.full_name).not.toEqual(template.fields.full_name);
    const request: FormRequest = { request_id: 'intake_1', schema_version: 1, matter_id: 'matter_1', kind: 'standing', items: [item] };
    expect(() => assertSendableRequest(request.items)).not.toThrow();
  });

  it('keeps signatures blocked and refuses restricted visible prefills', () => {
    expect(() => assertSendableRequest([{ t: 'signature', item_id: 'signature', label: 'Sign', help_text: '', required: true, subject: 'household', grade: 'docusign' }])).toThrow();
    expect(() => assertPrefillLegal({ field_id: 'ssn', fact_kind: 'ssn', sensitivity: 'restricted', mode: 'visible_prefill', value_page_ciphertext: 'never' } as never)).toThrow();
  });

  it('matches the reviewed synthetic golden layout and catches a shifted or missing field', () => {
    assertDryFillPreview(template);
    const golden = buildDryFillPreviewSnapshot(template);
    expect(golden).toContain('"field":"annual_income"');
    expect(golden).toContain('"value":"$12,500.00"');
    const shifted = structuredClone(template);
    shifted.fields.annual_income = { ...shifted.fields.annual_income, rect: { x: 0.7, y: 0.3, width: 0.2, height: 0.05 } };
    delete shifted.fields.state;
    expect(buildDryFillPreviewSnapshot(shifted)).not.toBe(golden);
    expect(buildDryFillPreviewSnapshot(shifted)).not.toContain('"field":"state"');
  });

  it('creates distinct overlay fields and keeps their editable geometry', () => {
    const first = overlayField(1);
    const second = {
      ...overlayField(2),
      page: 2,
      rect: { x: 0.58, y: 0.42, width: 0.31, height: 0.08 },
    };

    expect(first.kind).toBe('overlay');
    expect(second.kind).toBe('overlay');
    expect(second.page).toBe(2);
    expect(second.rect).toEqual({ x: 0.58, y: 0.42, width: 0.31, height: 0.08 });
    expect(second.rect).not.toEqual(first.rect);
  });

  it('draws the overlay dry-fill sample at its real normalized canvas position', () => {
    const entry = {
      ...overlayField(1),
      rect: { x: 0.2, y: 0.3, width: 0.5, height: 0.1 },
      overflow: 'stop' as const,
    };
    if (entry.kind !== 'overlay') throw new Error('Expected overlay field.');
    const context = {
      save: vi.fn(), beginPath: vi.fn(), rect: vi.fn(), clip: vi.fn(), restore: vi.fn(),
      measureText: vi.fn(() => ({ width: 20 })), fillText: vi.fn(),
    } as unknown as CanvasRenderingContext2D;

    drawOverlayDryFill(context, entry, 1_000, 500);

    expect(context.rect).toHaveBeenCalledWith(200, 150, 500, 50);
    expect(context.fillText).toHaveBeenCalledWith('A fitting answer', 200, 150, 500);
  });
});
