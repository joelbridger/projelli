import { describe, expect, it } from 'vitest';

import { ingestWealthboxCustomFieldsForAsk, mountWealthboxDepth } from './runtime';

describe('Wealthbox depth mount', () => {
  it('hands custom-field sources to the installed Ask ingestion bridge', async () => {
    const seen: string[] = [];
    mountWealthboxDepth({
      ingestAskSources: (sources) => {
        seen.push(...sources.map((source) => source.sourceId));
        return Promise.resolve();
      },
    });

    await ingestWealthboxCustomFieldsForAsk([{
      sourceId: 'crm:wealthbox:custom-field:1:2', recordId: '1', text: 'Risk: medium', fieldId: 2, fieldName: 'Risk', documentType: 'Contact', fieldType: 'text_field',
    }]);

    expect(seen).toEqual(['crm:wealthbox:custom-field:1:2']);
  });
});
