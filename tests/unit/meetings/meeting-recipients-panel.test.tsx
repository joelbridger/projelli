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
