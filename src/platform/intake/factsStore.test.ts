import { beforeEach, describe, expect, it } from 'vitest';

import {
  clearInMemoryFactsForTests,
  intakeFactList,
  intakeFactReveal,
  intakeFactUpsert,
} from './factsStore';
import { useIntakeStore } from './intakeStore';

describe('factsStore browser accessor', () => {
  beforeEach(() => {
    clearInMemoryFactsForTests();
    useIntakeStore.getState().resetForTests();
  });

  it('returns masked restricted values and keeps ordinary intake state value-free', async () => {
    const fact = await intakeFactUpsert({
      fact_id: 'fact-ssn',
      matter_id: 'matter-1',
      subject: 'primary',
      kind: 'ssn',
      value: { t: 'string', v: '123-45-6789' },
      sensitivity: 'restricted',
      provenance: {
        channel: 'manual',
        entered_by: 'advisor-1',
        at: '2026-07-10T00:00:00.000Z',
      },
      verification: 'advisor_confirmed',
    });

    useIntakeStore.getState().upsertIntake({
      intakeId: 'intake-1',
      matterId: 'matter-1',
      clientFirstName: 'Sarah',
      firmName: 'North Star',
      status: 'active',
      link: 'https://forms.example.test/i/intake-1#secret',
      expiresAt: '2026-08-09T00:00:00.000Z',
      checklistVersion: 1,
      items: [{
        itemId: 'ssn',
        label: 'Social Security number',
        state: 'received',
        provenance: { channel: 'manual', label: 'manual', at: '2026-07-10T00:00:00.000Z' },
        factId: fact.fact_id,
      }],
      receivedItems: [],
      flags: [],
      knownSessionIds: [],
    });

    const listed = await intakeFactList('matter-1');
    expect(listed[0]?.display_value).toBe('•••-••-6789');
    expect(JSON.stringify(useIntakeStore.getState().intakesById)).not.toContain('123-45-6789');
    expect(JSON.stringify(useIntakeStore.getState().intakesById)).not.toContain('6789');

    const revealed = await intakeFactReveal('matter-1', 'fact-ssn');
    expect(revealed.value).toEqual({ t: 'string', v: '123-45-6789' });
  });
});
