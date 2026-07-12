import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import '@testing-library/jest-dom/vitest';
import { describe, expect, it, vi } from 'vitest';
import { CrmActivitySurface } from './CrmActivitySurface';

const save = vi.fn().mockResolvedValue(undefined);
let records: Record<string, unknown>[] = [];

vi.mock('@/platform/crm/useLiveCrmRecords', () => ({
  useLiveCrmRecords: () => ({ records, save, error: null, workspaceRoot: '/tmp/test', sharedMatterId: 'firm_home' }),
}));

vi.mock('./notificationRuntime', () => ({ sendFirmMention: vi.fn().mockResolvedValue(true), pullFirmInbox: vi.fn().mockResolvedValue(false) }));

describe('CrmActivitySurface', () => {
  it('shows dated activity, describes the relay truth, and saves a mention as durable CRM records', async () => {
    records = [
      { id: 'member-maya', kind: 'firmDirectoryEntry', userId: 'maya', displayName: 'Maya', active: true },
      { id: 'activity-1', kind: 'activityEvent', at: '2026-07-12T10:00:00.000Z', summary: 'Maya assigned a review task.', targetRef: { kind: 'task', id: 'task-1' } },
      { id: 'notification-1', kind: 'notificationEnvelope', recipientUserId: 'maya', type: 'task_assigned', createdAt: '2026-07-12T10:01:00.000Z', opaqueId: 'abc123', ciphertextBand: '1 KiB', targetRef: { kind: 'task', id: 'task-1' } },
    ];
    save.mockClear();
    render(<CrmActivitySurface />);
    expect(screen.getByTestId('crm-firm-activity-feed')).toHaveTextContent('Maya assigned a review task.');
    expect(screen.getByTestId('crm-notification-inbox')).toHaveTextContent(/notification details stay private/i);
    fireEvent.change(screen.getByTestId('crm-activity-note-body'), { target: { value: 'Please check the annual review.' } });
    fireEvent.click(screen.getByTestId('crm-activity-mention-maya'));
    expect(screen.getByTestId('crm-activity-mention-review')).toHaveTextContent('Maya');
    fireEvent.click(screen.getByTestId('crm-activity-note-save'));
    await waitFor(() => expect(save).toHaveBeenCalledTimes(3));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'note', audience: 'internal', body: 'Please check the annual review.', mentions: [expect.objectContaining({ notifyState: 'sent' })] }));
    expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'activityEvent', verb: 'note.created' }));
  });

  it('has plain empty states', () => {
    records = [];
    render(<CrmActivitySurface />);
    expect(screen.getByTestId('crm-firm-activity-feed')).toHaveTextContent('No firm activity yet');
    expect(screen.getByTestId('crm-notification-inbox')).toHaveTextContent('No notifications yet');
  });

  it('adds and removes a saved emoji reaction, while showing the people who reacted', async () => {
    records = [
      { id: 'member-maya', kind: 'firmDirectoryEntry', userId: 'maya', displayName: 'Maya', active: true },
      { id: 'member-oliver', kind: 'firmDirectoryEntry', userId: 'oliver', displayName: 'Oliver', active: true },
      { id: 'activity-1', kind: 'activityEvent', matterId: 'firm_home', at: '2026-07-12T10:00:00.000Z', summary: 'Maya completed a review task.' },
      { id: 'reaction-oliver', kind: 'activityReaction', activityId: 'activity-1', userId: 'oliver', displayName: 'Oliver', emoji: '👍', active: true },
    ];
    save.mockClear();
    const { rerender } = render(<CrmActivitySurface />);

    const like = screen.getByTestId('crm-activity-reaction-like-activity-1');
    expect(like).toHaveTextContent('👍 1');
    expect(like).toHaveAttribute('title', 'Like: Oliver');
    fireEvent.click(like);
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ kind: 'activityReaction', activityId: 'activity-1', userId: 'maya', displayName: 'Maya', emoji: '👍', active: true })));

    records = [...records, { id: 'activity-reaction:activity-1:maya:128077', kind: 'activityReaction', activityId: 'activity-1', userId: 'maya', displayName: 'Maya', emoji: '👍', active: true }];
    rerender(<CrmActivitySurface />);
    save.mockClear();
    fireEvent.click(screen.getByTestId('crm-activity-reaction-like-activity-1'));
    await waitFor(() => expect(save).toHaveBeenCalledWith(expect.objectContaining({ id: 'activity-reaction:activity-1:maya:128077', kind: 'activityReaction', active: false })));
  });
});
