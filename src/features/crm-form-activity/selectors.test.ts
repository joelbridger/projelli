import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { filterFormActivity, selectFormActivity } from './selectors';

const records: readonly LiveCrmRecord[] = [
  {
    id: 'form-1',
    kind: 'intakeLink',
    name: 'Annual review',
    matterId: 'firm_home',
    audience: 'client-facing',
    fields: {
      client_name: {
        id: 'client_name',
        label: 'Full name',
        kind: 'text',
        required: true,
      },
      client_email: {
        id: 'client_email',
        label: 'Email address',
        kind: 'email',
        required: true,
      },
      account_number: {
        id: 'account_number',
        label: 'Account number',
        kind: 'text',
        required: true,
      },
    },
    confirmationCopy: 'Thank you.',
    status: 'active',
  },
  {
    id: 'household-1',
    kind: 'household',
    name: 'Chen household',
    matterId: 'firm_home',
  },
  {
    id: 'submission-new',
    kind: 'intakeSubmission',
    matterId: 'firm_home',
    intakeLinkId: 'form-1',
    audience: 'client-facing',
    submittedAt: '2026-07-15T14:00:00Z',
    payload: { values: { client_name: 'Avery Chen' } },
    matchingDecisions: {
      earlier: {
        decision: 'match',
        decidedAt: '2026-07-15T14:01:00Z',
        householdRef: { id: 'household-1', label: 'Chen household' },
      },
      latest: {
        decision: 'create',
        decidedAt: '2026-07-15T14:02:00Z',
        householdRef: { id: 'household-1' },
      },
    },
  },
  {
    id: 'submission-old',
    kind: 'intakeSubmission',
    matterId: 'firm_home',
    intakeLinkId: 'missing-form',
    audience: 'internal',
    submittedAt: '2026-07-14T14:00:00Z',
    payload: { values: { client_email: 'advisor@example.com' } },
    matchingDecisions: {},
  },
  { id: 'malformed', kind: 'intakeSubmission', intakeLinkId: 'form-1' },
  {
    id: 'sensitive-only',
    kind: 'intakeSubmission',
    matterId: 'firm_home',
    intakeLinkId: 'form-1',
    audience: 'client-facing',
    submittedAt: '2026-07-13T14:00:00Z',
    payload: { values: { account_number: '001234567890' } },
    matchingDecisions: {},
  },
];

describe('form activity selectors', () => {
  it('uses only valid durable intake records, joins form and contact labels, and orders newest first', () => {
    expect(selectFormActivity(records)).toEqual([
      expect.objectContaining({
        id: 'submission-new',
        formName: 'Annual review',
        submitterLabel: 'Avery Chen',
        contact: { id: 'household-1', label: 'Chen household' },
        status: 'created',
      }),
      expect.objectContaining({
        id: 'submission-old',
        formName: 'missing-form',
        submitterLabel: null,
        contact: null,
        status: 'unmatched',
      }),
      expect.objectContaining({
        id: 'sensitive-only',
        submitterLabel: null,
        contact: null,
        status: 'unmatched',
      }),
    ]);
  });

  it('searches source, submitter, contact, and status without team-feed controls', () => {
    const entries = selectFormActivity(records);
    expect(filterFormActivity(entries, 'chen', 'all', 'all')).toHaveLength(1);
    expect(filterFormActivity(entries, '', 'unmatched', 'internal')).toEqual([
      expect.objectContaining({ id: 'submission-old' }),
    ]);
    expect(filterFormActivity(entries, 'created', 'created', 'all')).toEqual([
      expect.objectContaining({ id: 'submission-new' }),
    ]);
  });

  it('never uses a sensitive response as a submitter fallback', () => {
    const entry = selectFormActivity(records).find(
      (candidate) => candidate.id === 'sensitive-only'
    );
    expect(entry?.submitterLabel).toBeNull();
    expect(entry).not.toEqual(
      expect.objectContaining({ submitterLabel: '001234567890' })
    );
  });
});
