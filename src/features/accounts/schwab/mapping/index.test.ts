import { describe, expect, it } from 'vitest';
import {
  buildSchwabProposal,
  schwabAccountTypes,
  schwabFieldMaps,
} from './index';
import type { SchwabHousehold } from './index';

const household: SchwabHousehold = {
  id: 'household-1',
  name: 'Mills family',
  facts: [],
  members: [
    {
      id: 'primary',
      name: 'Alex Mills',
      personType: 'person',
      roles: [],
      relatedHouseholds: 1,
      addresses: [
        {
          id: 'home',
          address: '1 Main',
          city: 'Austin',
          state: 'TX',
          zip: '78701',
          kind: 'home',
          primary: true,
        },
      ],
      emails: [
        {
          id: 'email',
          address: 'alex@example.test',
          kind: 'home',
          primary: true,
        },
      ],
      phones: [
        { id: 'phone', address: '555-0100', kind: 'mobile', primary: true },
      ],
    },
    {
      id: 'joint',
      name: 'Jo Mills',
      personType: 'person',
      roles: [],
      relatedHouseholds: 1,
    },
  ],
};

describe('Schwab mappings', () => {
  it('has all eight account maps', () => {
    expect(schwabAccountTypes).toHaveLength(8);
    for (const type of schwabAccountTypes)
      expect(schwabFieldMaps[type].length).toBeGreaterThan(0);
  });
  it('uses advisor-confirmed intake first and marks disagreements as conflicts', () => {
    const fields = buildSchwabProposal('individual', {
      household,
      facts: [
        {
          fact_id: 'ssn',
          matter_id: household.id,
          subject: 'primary',
          kind: 'ssn',
          sensitivity: 'restricted',
          display_value: '•••-••-1234',
          provenance: {
            channel: 'manual',
            entered_by: 'advisor',
            at: '2026-07-16',
          },
          verification: 'advisor_confirmed',
          status: 'active',
        },
        {
          fact_id: 'address',
          matter_id: household.id,
          subject: 'primary',
          kind: 'address',
          sensitivity: 'standard',
          display_value: '2 Elsewhere',
          provenance: {
            channel: 'manual',
            entered_by: 'advisor',
            at: '2026-07-16',
          },
          verification: 'advisor_confirmed',
          status: 'active',
        },
      ],
    });
    expect(fields.find((field) => field.key === 'ownerSsn')).toMatchObject({
      value: '•••-••-1234',
      source: 'advisor-intake',
      conflict: false,
    });
    expect(fields.find((field) => field.key === 'address')).toMatchObject({
      conflict: true,
      value: '',
    });
  });
  it('keeps the highest-priority source when every source agrees', () => {
    const agreedValue = '1980-01-01';
    const fields = buildSchwabProposal('individual', {
      household: {
        ...household,
        facts: [{ label: 'dob', value: agreedValue }],
      },
      facts: [
        {
          fact_id: 'advisor-dob',
          matter_id: household.id,
          subject: 'primary',
          kind: 'dob',
          sensitivity: 'confidential',
          display_value: agreedValue,
          provenance: {
            channel: 'manual',
            entered_by: 'advisor',
            at: '2026-07-16',
          },
          verification: 'advisor_confirmed',
          status: 'active',
        },
        {
          fact_id: 'verified-dob',
          matter_id: household.id,
          subject: 'primary',
          kind: 'dob',
          sensitivity: 'confidential',
          display_value: agreedValue,
          provenance: {
            channel: 'manual',
            entered_by: 'client',
            at: '2026-07-16',
          },
          verification: 'client_stated',
          status: 'active',
        },
      ],
      meetingSuggestions: { ownerDob: agreedValue },
    });
    expect(fields.find((field) => field.key === 'ownerDob')).toMatchObject({
      value: agreedValue,
      source: 'advisor-intake',
      conflict: false,
      candidates: [{ source: 'advisor-intake', sourceRef: 'advisor-dob' }],
    });
  });
  it('uses a decedent fact only for an inherited-IRA decedent field', () => {
    const fields = buildSchwabProposal('inherited-ira', {
      household,
      facts: [
        {
          fact_id: 'primary-dob',
          matter_id: household.id,
          subject: 'primary',
          kind: 'dob',
          sensitivity: 'confidential',
          display_value: '1980-01-01',
          provenance: {
            channel: 'manual',
            entered_by: 'advisor',
            at: '2026-07-16',
          },
          verification: 'advisor_confirmed',
          status: 'active',
        },
        {
          fact_id: 'decedent-dob',
          matter_id: household.id,
          subject: 'decedent',
          kind: 'dob',
          sensitivity: 'confidential',
          display_value: '1940-01-01',
          provenance: {
            channel: 'manual',
            entered_by: 'advisor',
            at: '2026-07-16',
          },
          verification: 'advisor_confirmed',
          status: 'active',
        },
      ],
    });
    expect(fields.find((field) => field.key === 'decedentDob')).toMatchObject({
      value: '1940-01-01',
      conflict: false,
    });
  });
});
