import { describe, expect, it } from 'vitest';
import { computeReport, proposeReportFromQuestion } from './reportEngine';

const now = new Date('2026-07-12T12:00:00Z');
const records = [
  { id: 'hh-1', kind: 'household', name: 'Northcrest household', serviceTier: 'Gold', nextReviewDue: '2026-07-20' },
  { id: 'hh-2', kind: 'household', name: 'No fee household' },
  { id: 'a-1', kind: 'activityEvent', householdId: 'hh-1', at: '2026-07-10T12:00:00Z' },
  { id: 'p-1', kind: 'person', householdId: 'hh-1', firstName: 'Avery', lastName: 'Northcrest', birthDate: '1961-07-20' },
  { id: 'p-2', kind: 'person', householdId: 'hh-2', firstName: 'Riley', lastName: 'Retirement', birthDate: '1950-04-02' },
] as const;

describe('reportEngine', () => {
  it('calculates neglected households from saved activity, without sample rows', () => {
    const report = computeReport(records, 'no_contact_6mo', { entity: 'household', filters: [] }, now);
    expect(report.rows.map((row) => row.householdName)).toEqual(['No fee household']);
    expect(report.sourcesConsidered).toBe(5);
  });
  it('never invents a fee while showing missing fee data honestly', () => {
    const report = computeReport(records, 'attention_vs_fee', { entity: 'household', filters: [] }, now);
    expect(report.rows.find((row) => row.householdId === 'hh-2')?.values['fee']).toBe('No fee data recorded');
    expect(report.exclusions.join(' ')).toContain('No fee household');
  });
  it('uses birthday and review dates from records', () => {
    expect(computeReport(records, 'birthdays', { entity: 'person', filters: [] }, now).rows[0]?.values['person']).toBe('Avery Northcrest');
    expect(computeReport(records, 'review_due', { entity: 'household', filters: [] }, now).rows[0]?.householdId).toBe('hh-1');
    expect(computeReport(records, 'rmd_due', { entity: 'person', filters: [] }, now).rows[0]?.values['person']).toBe('Riley Retirement');
  });
  it('uses only the selected fields in a custom report and preserves its grouping value', () => {
    const report = computeReport(records, 'custom', {
      entity: 'household',
      filters: [{ field: 'serviceTier', op: 'eq', value: 'Gold' }],
      fields: ['serviceTier', 'activityCount'],
      groupBy: 'serviceTier',
    }, now);
    expect(report.rows).toHaveLength(1);
    expect(report.rows[0]?.values).toEqual({ serviceTier: 'Gold', activityCount: '1' });
    expect(report.rows[0]?.group).toBe('Gold');
  });
  it('only proposes a bounded report query from an Ask question', () => {
    const proposal = proposeReportFromQuestion('Who has not had contact recently?');
    expect(proposal.kind).toBe('no_contact_6mo');
    expect(proposal.query.filters).toEqual([]);
  });
  it('does not present saved recipes or earlier runs as client-record sources', () => {
    const report = computeReport([
      ...records,
      { id: 'saved-1', kind: 'savedReport', name: 'Follow-up list', reportKind: 'custom', query: { entity: 'household', filters: [] }, visibility: 'personal' },
      { id: 'run-1', kind: 'reportRun', reportKind: 'custom', query: { entity: 'household', filters: [] }, calculatedAt: now.toISOString(), sourcesConsidered: 5, resultCount: 2 },
    ], 'custom', { entity: 'household', filters: [] }, now);
    expect(report.sourcesConsidered).toBe(records.length);
  });
});
