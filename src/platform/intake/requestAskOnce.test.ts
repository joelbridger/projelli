import { describe, expect, it } from 'vitest';

import {
  clearInMemoryFactsForTests,
  intakeFactMatchList,
  intakeFactUpsert,
  type FactMatchEntry,
} from './factsStore';
import { resolveAskOnce } from './requestAskOnce';
import type { RequestItem } from './types';

const typedIncome: RequestItem = {
  t: 'typed_field', item_id: 'income', label: 'Income', help_text: '', required: true,
  subject: 'household', fact_kind: 'income_annual', input: 'money',
};

const guidedSpending: RequestItem = {
  t: 'guided_question', item_id: 'spending', label: 'Spending', help_text: '', required: true,
  subject: 'household', prompt: 'Monthly spending?', response_format: 'range', fact_kind: 'spending_monthly',
};

describe('resolveAskOnce', () => {
  it('gets only value-free active match entries from the fact accessor', async () => {
    clearInMemoryFactsForTests();
    await intakeFactUpsert({
      matter_id: 'matter-1', subject: 'household', kind: 'income_annual',
      value: { t: 'money', v: { amount: 120000, currency: 'USD' } }, sensitivity: 'confidential',
      provenance: { channel: 'manual', entered_by: 'advisor-1', at: '2026-07-10T00:00:00.000Z' },
      verification: 'advisor_confirmed',
    });

    const matches = await intakeFactMatchList('matter-1');

    expect(matches).toEqual([{ subject: 'household', kind: 'income_annual', status: 'active' }]);
    expect(Object.keys(matches[0] ?? {}).sort()).toEqual(['kind', 'status', 'subject']);
    clearInMemoryFactsForTests();
  });

  it('suppresses matching typed and guided fact mappings', () => {
    const result = resolveAskOnce([typedIncome, guidedSpending], [
      { subject: 'household', kind: 'income_annual', status: 'active' },
      { subject: 'household', kind: 'spending_monthly', status: 'active' },
    ]);

    expect(result.visibleItems).toEqual([]);
    expect(result.suppressed).toEqual([
      { itemId: 'income', reason: 'already_on_file' },
      { itemId: 'spending', reason: 'already_on_file' },
    ]);
  });

  it('requires the same subject and ignores superseded matches', () => {
    const jointIncome = { ...typedIncome, subject: 'joint' };
    const differentSubject = resolveAskOnce([jointIncome], [
      { subject: 'primary', kind: 'income_annual', status: 'active' },
    ]);
    const superseded = resolveAskOnce([typedIncome], [
      { subject: 'household', kind: 'income_annual', status: 'superseded' },
    ]);

    expect(differentSubject.visibleItems).toEqual([jointIncome]);
    expect(differentSubject.suppressed).toEqual([]);
    expect(superseded.visibleItems).toEqual([typedIncome]);
    expect(superseded.suppressed).toEqual([]);
  });

  it('passes through items with no explicit fact kind and cannot leak an extra value field', () => {
    const upload: RequestItem = {
      t: 'doc_upload', item_id: 'license', label: 'License', help_text: '', required: true,
      subject: 'primary', expected_doc_types: ['drivers_license'],
    };
    const card: RequestItem = {
      t: 'readonly_card', item_id: 'notice', label: 'Notice', help_text: '', required: false,
      subject: 'primary', body: 'Read this.',
    };
    const matchWithExtraValue = {
      subject: 'primary', kind: 'drivers_license', status: 'active', value: 'must never escape',
    } as FactMatchEntry;
    const result = resolveAskOnce([upload, card], [matchWithExtraValue]);

    expect(result.visibleItems).toEqual([upload, card]);
    expect(result.suppressed).toEqual([]);
    expect(JSON.stringify(result)).not.toContain('must never escape');
  });
});
