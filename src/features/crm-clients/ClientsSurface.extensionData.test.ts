import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { householdFromRecord } from './ClientsSurface';

describe('CRM household extension-data hydration', () => {
  it('carries every persisted extension bag through verbatim after a restart', () => {
    const extensionData = {
      'compliance-dates.written-agreements': {
        advisoryAgreementSignedOn: '2017-01-18',
      },
      'another-extension.value': { retained: true },
    };
    const record: LiveCrmRecord = {
      id: 'household:restart',
      kind: 'household',
      name: 'Restart household',
      extensionData,
    };

    expect(householdFromRecord(record, 'live').extensionData).toEqual(
      extensionData
    );
  });
});
