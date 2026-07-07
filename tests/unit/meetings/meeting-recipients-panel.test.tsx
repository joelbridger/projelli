import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import { describe, expect, it, vi } from 'vitest';
import { MeetingRecipientsPanel } from '@/features/meetings/MeetingRecipientsPanel';
import type { MeetingMeta } from '@/features/meetings/meetingStore';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const openedMeta: MeetingMeta = {
  matterId: 'matter-1',
  startedAt: '2026-07-07T12:00:00.000Z',
  consent: { mode: 'one-party', confirmedBy: 'user', confirmedAt: '2026-07-07T12:00:00.000Z' },
};

describe('MeetingRecipientsPanel', () => {
  it('shows everyone from the invite as included by default', () => {
    render(
      <MeetingRecipientsPanel
        matterId="matter-1"
        meetingDir="/ws/Hendricks/Meetings/one"
        meta={{
          ...openedMeta,
          calendarEvent: {
            id: 'event-1',
            title: 'Annual review',
            startUtc: '2026-07-07T12:00:00.000Z',
            endUtc: '2026-07-07T13:00:00.000Z',
            attendees: [
              { email: 'alex@example.com', name: 'Alex Hendricks' },
              { email: 'sam@example.com', name: 'Sam Hendricks' },
            ],
          },
        }}
        matter={null}
        workspaceService={null}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByTestId('meeting-recipient-auto-list')).toBeInTheDocument();
    expect(screen.getByTestId('meeting-recipient-person-alex@example.com')).toBeChecked();
    expect(screen.getByTestId('meeting-recipient-person-artifact-notes-alex@example.com')).toBeChecked();
    expect(screen.getByTestId('meeting-recipient-person-artifact-audio-sam@example.com')).toBeChecked();
  });

  it('falls back to the manual picker when the meeting has no calendar attendees', () => {
    render(
      <MeetingRecipientsPanel
        matterId="matter-1"
        meetingDir="/ws/Hendricks/Meetings/one"
        meta={openedMeta}
        matter={null}
        workspaceService={null}
        onSaved={vi.fn()}
      />,
    );

    expect(screen.getByTestId('meeting-recipient-manual-picker')).toBeInTheDocument();
    expect(screen.queryByTestId('meeting-recipient-auto-list')).not.toBeInTheDocument();
  });

  it('preserves meeting fields added after the panel opened when saving recipients', async () => {
    const files = new Map<string, string>();
    files.set('/ws/Hendricks/Meetings/one/meeting.json', JSON.stringify({
      ...openedMeta,
      durationMs: 1_500_000,
      typeId: 'annual-review',
    }));
    const ws = {
      readFile: vi.fn(async (path: string) => files.get(path) ?? ''),
      writeFile: vi.fn(async (path: string, content: string) => {
        files.set(path, content);
      }),
    };
    const onSaved = vi.fn();

    render(
      <MeetingRecipientsPanel
        matterId="matter-1"
        meetingDir="/ws/Hendricks/Meetings/one"
        meta={openedMeta}
        matter={null}
        workspaceService={ws as never}
        onSaved={onSaved}
      />,
    );

    fireEvent.change(screen.getByTestId('meeting-recipient-input-summary'), {
      target: { value: 'client@example.com' },
    });
    fireEvent.click(screen.getByTestId('meeting-recipient-add-summary'));
    fireEvent.click(screen.getByTestId('meeting-recipients-save'));

    await waitFor(() => expect(onSaved).toHaveBeenCalled());

    const savedMeta = onSaved.mock.calls[0]?.[0] as MeetingMeta;
    expect(savedMeta.durationMs).toBe(1_500_000);
    expect(savedMeta.typeId).toBe('annual-review');

    const diskMeta = JSON.parse(files.get('/ws/Hendricks/Meetings/one/meeting.json') ?? '{}') as MeetingMeta;
    expect(diskMeta.durationMs).toBe(1_500_000);
    expect(diskMeta.typeId).toBe('annual-review');
    expect(diskMeta.deliveryPlan?.artifacts.summary).toEqual([
      { email: 'client@example.com', source: 'manual' },
    ]);
  });
});
