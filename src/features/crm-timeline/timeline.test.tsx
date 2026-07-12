import { describe, expect, it } from 'vitest';
import '@testing-library/jest-dom/vitest';
import { fireEvent, render, screen } from '@testing-library/react';
import { HouseholdTimeline } from './HouseholdTimeline';
import { buildHouseholdTimeline } from './buildTimeline';

const household = {
  id: 'household-1',
  matterId: 'matter-1',
  notes: [{ id: 'note-1', body: 'Called Dana about the review.', createdAt: '2026-07-09T10:00:00.000Z' }],
  facts: [{ id: 'fact-1', label: 'Risk tolerance', value: 'Balanced', asOf: '2026-07-08T12:00:00.000Z', sources: [{ id: 'doc-1', label: 'Review notes' }] }],
};

const records = [
  { id: 'task-1', kind: 'task', householdRef: { kind: 'household', id: 'household-1' }, status: 'done', title: 'Send review packet', completedAt: '2026-07-10T09:00:00.000Z', completedBy: 'Maya' },
  { id: 'activity-1', kind: 'activityEvent', householdId: 'household-1', at: '2026-07-11T08:00:00.000Z', actor: { display: 'Priya' }, summary: 'Annual review was scheduled.', targetRef: { kind: 'meeting', id: 'meeting-1', label: 'Annual review' } },
  { id: 'email-1', kind: 'email', matterId: 'matter-1', title: 'Review packet sent', createdAt: '2026-07-11T09:00:00.000Z', actor: { display: 'Maya' } },
  { id: 'other-task', kind: 'task', householdRef: { kind: 'household', id: 'household-2' }, status: 'done', title: 'Do not show', completedAt: '2026-07-11T10:00:00.000Z' },
];

describe('household timeline', () => {
  it('merges saved client history in date order without copying linked records', () => {
    const timeline = buildHouseholdTimeline(household, records);
    expect(timeline.map((entry) => entry.type)).toEqual(['email', 'activity', 'task', 'note', 'fact']);
    expect(timeline.some((entry) => entry.summary.includes('Do not show'))).toBe(false);
    expect(timeline.find((entry) => entry.type === 'activity')?.provenance).toContainEqual({ kind: 'meeting', id: 'meeting-1', label: 'Annual review' });
  });

  it('filters the readable feed and exposes each source for verification', () => {
    render(<HouseholdTimeline household={household} records={records} freshness={{ kind: 'live' }} />);
    expect(screen.getByText('Up to date')).toBeInTheDocument();
    expect(screen.getByText('Review packet sent')).toBeInTheDocument();
    expect(screen.getByTestId('crm-timeline-source-document-doc-1')).toHaveTextContent('Open Review notes');
    fireEvent.click(screen.getByTestId('crm-timeline-source-document-doc-1'));
    expect(screen.getByTestId('crm-timeline-source-detail')).toHaveTextContent('document / doc-1');
    fireEvent.change(screen.getByTestId('crm-timeline-type'), { target: { value: 'task' } });
    expect(screen.getByText('Completed task: Send review packet')).toBeInTheDocument();
    expect(screen.queryByText('Review packet sent')).not.toBeInTheDocument();
    fireEvent.change(screen.getByTestId('crm-timeline-from'), { target: { value: '2026-07-11' } });
    expect(screen.getByText('No history matches these filters')).toBeInTheDocument();
  });
});
