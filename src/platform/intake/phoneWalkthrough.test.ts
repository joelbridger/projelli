import { describe, expect, it } from 'vitest';

import {
  buildPhoneFactWrite,
  derivePhoneWalkthroughItems,
} from './phoneWalkthrough';
import type { IntakeChecklistState } from './intakeStore';
import type { RequestItem } from './types';

const items: RequestItem[] = [
  {
    t: 'typed_field', item_id: 'dob', label: 'Date of birth', help_text: '',
    required: true, subject: 'primary', fact_kind: 'dob', input: 'date',
  },
  {
    t: 'typed_field', item_id: 'ssn', label: 'Social Security number', help_text: '',
    required: true, subject: 'primary', fact_kind: 'ssn', input: 'ssn',
  },
  {
    t: 'guided_question', item_id: 'income', label: 'Income', help_text: '',
    required: true, subject: 'household', prompt: 'Annual income', response_format: 'money',
  },
  {
    t: 'guided_question', item_id: 'spending', label: 'Spending', help_text: '',
    required: true, subject: 'household', prompt: 'Monthly spending', response_format: 'range',
  },
];
const dob = items[0]!;
const ssn = items[1]!;
const income = items[2]!;
const spending = items[3]!;

describe('phone walkthrough model', () => {
  it('keeps checklist order and marks link-provided items done but replaceable', () => {
    const checklist: IntakeChecklistState[] = [
      { itemId: 'dob', label: 'Date of birth', state: 'not_started' },
      {
        itemId: 'ssn', label: 'Social Security number', state: 'received',
        provenance: { channel: 'intake_link', label: 'typed by client', at: '2026-07-10T12:00:00.000Z' },
      },
      { itemId: 'income', label: 'Income', state: 'not_started' },
      { itemId: 'spending', label: 'Spending', state: 'accepted' },
    ];

    expect(derivePhoneWalkthroughItems(items, checklist)).toMatchObject([
      { item: { item_id: 'dob' }, completed: false, canReplace: false },
      { item: { item_id: 'ssn' }, completed: true, canReplace: true, state: 'received' },
      { item: { item_id: 'income' }, completed: false, canReplace: false },
      { item: { item_id: 'spending' }, completed: true, canReplace: true, state: 'accepted' },
    ]);
  });

  it('builds correctly typed phone facts with advisor provenance', () => {
    const common = {
      matterId: 'matter-1', advisorId: 'advisor-7', at: '2026-07-10T12:00:00.000Z',
    };

    expect(buildPhoneFactWrite({ ...common, item: dob, answer: '1950-01-02' })).toMatchObject({
      kind: 'dob', sensitivity: 'confidential', value: { t: 'date', v: '1950-01-02' },
      provenance: { channel: 'phone_walkthrough', entered_by: 'advisor-7', at: common.at },
    });
    expect(buildPhoneFactWrite({ ...common, item: ssn, answer: '123456789' })).toMatchObject({
      kind: 'ssn', sensitivity: 'restricted', value: { t: 'string', v: '123456789' },
    });
    expect(buildPhoneFactWrite({ ...common, item: income, answer: '125,000' })).toMatchObject({
      kind: 'income_annual', sensitivity: 'confidential',
      value: { t: 'money', v: { amount: 125000, currency: 'USD' } },
    });
    expect(buildPhoneFactWrite({
      ...common, item: spending, answer: { min: '4000', max: '6000', currency: 'usd' },
    })).toMatchObject({
      kind: 'spending_monthly', sensitivity: 'confidential',
      value: { t: 'range', v: { min: 4000, max: 6000, currency: 'USD' } },
    });
  });

  it('marks SSN writes restricted so the facts store owns masking and secure storage', () => {
    const fact = buildPhoneFactWrite({
      matterId: 'matter-1', advisorId: 'advisor-7', at: '2026-07-10T12:00:00.000Z',
      item: ssn, answer: '123456789',
    });

    expect(fact.sensitivity).toBe('restricted');
    expect(fact.provenance.channel).toBe('phone_walkthrough');
  });
});
