import { afterEach, describe, expect, it, vi } from 'vitest';

const getFieldObjects = vi.hoisted(() => vi.fn());
const destroy = vi.hoisted(() => vi.fn());

vi.mock('pdfjs-dist', () => ({
  getDocument: vi.fn(() => ({
    promise: Promise.resolve({ numPages: 1, getFieldObjects }),
    destroy,
  })),
}));

import { inspectPdfTemplate } from './pdfInspector';

afterEach(() => {
  getFieldObjects.mockReset();
  destroy.mockReset();
});

describe('inspectPdfTemplate', () => {
  it('recognizes PDF.js getFieldObjects widgets by their real type property', async () => {
    getFieldObjects.mockResolvedValue({
      client_name: [{ type: 'text' }],
      consent: [{ type: 'checkbox' }],
      delivery: [{ type: 'radiobutton', items: [{ exportValue: 'mail', displayValue: 'Mail' }, { exportValue: 'email', displayValue: 'Email' }] }],
      state: [{ type: 'combobox', items: [{ exportValue: 'ca', displayValue: 'California' }, { exportValue: 'ny', displayValue: 'New York' }] }],
      action: [{ type: 'button' }],
    });

    const inspection = await inspectPdfTemplate(new TextEncoder().encode('%PDF-1.4\n%%EOF'));

    expect(inspection).toEqual({
      kind: 'acroform',
      pageCount: 1,
      fields: [
        { name: 'client_name', type: 'text' },
        { name: 'consent', type: 'checkbox' },
        { name: 'delivery', type: 'radio', options: [{ value: 'mail', label: 'Mail' }, { value: 'email', label: 'Email' }] },
        { name: 'state', type: 'select', options: [{ value: 'ca', label: 'California' }, { value: 'ny', label: 'New York' }] },
      ],
    });
    expect(destroy).toHaveBeenCalledTimes(1);
  });
});
