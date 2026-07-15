import { describe, expect, it } from 'vitest';
import type { LiveCrmRecord } from '@/platform/crm/liveRecords';
import { filterFormActivity, selectFormActivity } from './selectors';

const records: readonly LiveCrmRecord[] = [
  {
    id: 'form-1',
    kind: 'intakeLink',
    name: 'Annual review',
    matterId: 'firm_home',
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
    payload: { values: { full_name: 'Avery Chen' } },
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
    payload: { values: { email: 'advisor@example.com' } },
    matchingDecisions: {},
  },
  { id: 'malformed', kind: 'intakeSubmission', intakeLinkId: 'form-1' },
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
        submitterLabel: 'advisor@example.com',
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

  it('keeps the persisted live-record order and filters after a restart-style rehydrate', () => {
    const persisted = JSON.parse(JSON.stringify(records)) as LiveCrmRecord[];
    const afterRestart = selectFormActivity(persisted);

    expect(afterRestart.map((entry) => entry.id)).toEqual([
      'submission-new',
      'submission-old',
    ]);
    expect(filterFormActivity(afterRestart, '', 'created', 'client-facing')).toEqual([
      expect.objectContaining({ id: 'submission-new' }),
    ]);
  });
});
