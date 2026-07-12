import { describe, expect, it } from 'vitest';

import { buildCustomFieldAskSources, fetchCustomFieldRegistry, ingestCustomFieldsForAsk } from './customFieldIngestion';
import type { WealthboxDepthTransport } from './types';

describe('Wealthbox custom-field ingestion', () => {
  it('uses the proven registry path, page cap, and every returned page', async () => {
    const paths: string[] = [];
    const transport: WealthboxDepthTransport = {
      getJson: <T,>(path: string): Promise<T> => {
        paths.push(path);
        const page = new URLSearchParams(path.split('?')[1]).get('page');
        return Promise.resolve({
          meta: { page: Number(page), total_pages: 2 },
          custom_fields: [{
            id: Number(page), name: `Risk ${page ?? ''}`, document_type: 'Contact', field_type: 'text_field', metadata: {}, options: [],
          }],
        } as T);
      },
    };

    await expect(fetchCustomFieldRegistry(transport, 'Contact')).resolves.toMatchObject({ pagesRead: 2, definitions: [{ id: 1 }, { id: 2 }] });
    expect(paths).toEqual([
      '/categories/custom_fields?document_type=Contact&page=1&per_page=100',
      '/categories/custom_fields?document_type=Contact&page=2&per_page=100',
    ]);
  });

  it('keeps each populated inline custom-field value citable for Ask', () => {
    const result = buildCustomFieldAskSources([{
      id: 67405677,
      custom_fields: [{
        id: 516938, name: 'DEMO Risk Band', document_type: 'Contact', field_type: 'text_field', metadata: {}, value: 'DEMO Medium',
      }],
    }], [{
      id: 516938, name: 'DEMO Risk Band', document_type: 'Contact', field_type: 'text_field', metadata: {}, options: [],
    }]);

    expect(result.warnings).toEqual([]);
    expect(result.sources).toEqual([expect.objectContaining({
      sourceId: 'crm:wealthbox:custom-field:67405677:516938',
      text: 'Wealthbox custom field — DEMO Risk Band: DEMO Medium',
      fieldType: 'text_field',
    })]);
  });

  it('keeps an unregistered inline field visible and flags the divergence', () => {
    const result = buildCustomFieldAskSources([{
      id: 9,
      custom_fields: [{
        id: 3, name: 'Legacy field', document_type: 'Contact', field_type: 'text_field', metadata: {}, value: 'kept',
      }],
    }], []);

    expect(result.sources).toHaveLength(1);
    expect(result.warnings).toEqual(['Wealthbox field 3 on record 9 is not present in the imported registry.']);
  });

  it('delivers the citable sources to the Ask bridge after the registry read', async () => {
    const delivered: string[] = [];
    const transport: WealthboxDepthTransport = {
      getJson: <T,>(): Promise<T> => Promise.resolve({
        meta: { page: 1, total_pages: 1 },
        custom_fields: [{ id: 5, name: 'Service tier', document_type: 'Contact', field_type: 'text_field', metadata: {}, options: [] }],
      } as T),
    };

    await ingestCustomFieldsForAsk({
      transport,
      documentType: 'Contact',
      records: [{ id: 1, custom_fields: [{ id: 5, name: 'Service tier', document_type: 'Contact', field_type: 'text_field', metadata: {}, value: 'Gold' }] }],
      ingest: (sources) => {
        delivered.push(...sources.map((source) => source.text));
        return Promise.resolve();
      },
    });

    expect(delivered).toEqual(['Wealthbox custom field — Service tier: Gold']);
  });
});
