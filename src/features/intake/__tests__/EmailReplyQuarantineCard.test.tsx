import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/email/EmailViewer', () => ({ EmailViewer: () => <div /> }));
vi.mock('@/platform/intake/emailReplyQuarantineManualFile', () => ({
  dismissQuarantinedEmail: vi.fn(), manualFileQuarantinedEmail: vi.fn(),
}));

import { EmailReplyQuarantineCard } from '../EmailReplyQuarantineCard';
import { useIntakeStore } from '@/platform/intake/intakeStore';

function selectValue(label: string): string {
  const element = screen.getByLabelText(label);
  if (!(element instanceof HTMLSelectElement)) {
    throw new Error(`Expected ${label} to be a select.`);
  }
  return element.value;
}

describe('EmailReplyQuarantineCard', () => {
  beforeEach(() => {
    useIntakeStore.getState().resetForTests();
    useIntakeStore.getState().upsertIntake({
      intakeId: 'intake-1', matterId: 'matter-1', clientFirstName: 'Sarah', firmName: 'North Star', status: 'active',
      expiresAt: '2026-12-01T00:00:00.000Z', checklistVersion: 1,
      items: [{ itemId: 'license', label: "Driver's license", state: 'not_started' }], receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [],
    });
  });

  it('shows a loud non-E2EE warning without restricted data, file names, confidence, or a fast-path action', () => {
    render(<EmailReplyQuarantineCard advisorId="advisor-1" onResolved={() => {}} quarantine={{
      quarantineId: 'quarantine-1', messageId: 'message-1', provider: 'm365', account: 'advisor@example.com', received: null,
      sender: 'client@example.com', authResult: { dkim: 'fail', spf: 'fail', dmarc: 'fail', aligned: false, source: 'graph' },
      threadId: null, reason: 'auth_failed', matchedMatterId: 'matter-1', matchedRequestId: 'intake-1', status: 'pending', createdAt: 'now', updatedAt: 'now',
    }} />);
    expect(screen.getByText('This email did not prove it came from the client.')).toBeTruthy();
    expect(screen.getByTestId('email-reply-quarantine-non-e2ee-label').textContent).toContain('Not end-to-end encrypted');
    expect(screen.queryByText('123-45-6789')).toBeNull();
    expect(screen.queryByText('secret-file.pdf')).toBeNull();
    expect(screen.queryByText(/confidence/i)).toBeNull();
    expect(screen.queryByRole('button', { name: /accept all/i })).toBeNull();
    expect(screen.queryByRole('button', { name: /dismiss as not intake/i })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('lets manual review choose another active client, not only the display anchor', async () => {
    useIntakeStore.getState().upsertIntake({
      intakeId: 'intake-2', matterId: 'matter-2', clientFirstName: 'Alex', firmName: 'North Star', status: 'active',
      expiresAt: '2026-12-01T00:00:00.000Z', checklistVersion: 1,
      items: [{ itemId: 'income', label: 'Income', state: 'not_started' }], receivedItems: [], flags: [], knownSessionIds: [], knownSubmissionIds: [], nudges: [],
    });
    render(<EmailReplyQuarantineCard advisorId="advisor-1" onResolved={() => {}} loadMessage={() => Promise.resolve({ attachmentsUnsupported: false, attachments: [] } as never)} quarantine={{
      quarantineId: 'quarantine-1', messageId: 'message-1', provider: 'm365', account: 'advisor@example.com', received: null,
      sender: 'client@example.com', authResult: { dkim: 'fail', spf: 'fail', dmarc: 'fail', aligned: false, source: 'graph' },
      threadId: null, reason: 'ambiguous_sender', matchedMatterId: 'matter-1', matchedRequestId: 'intake-1', status: 'pending', createdAt: 'now', updatedAt: 'now',
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open original email' }));
    await screen.findByTestId('email-reply-quarantine-review');
    expect(screen.getByRole('option', { name: 'Alex' })).toBeTruthy();
  });

  it('starts with no destination selected, even after the advisor opens the message', async () => {
    render(<EmailReplyQuarantineCard advisorId="advisor-1" onResolved={() => {}} loadMessage={() => Promise.resolve({ attachmentsUnsupported: false, attachments: [{ id: 'a1', name: 'secret-file.pdf', filename: 'secret-file.pdf', kind: 'file' }] } as never)} quarantine={{
      quarantineId: 'quarantine-1', messageId: 'message-1', provider: 'm365', account: 'advisor@example.com', received: null,
      sender: 'client@example.com', authResult: { dkim: 'fail', spf: 'fail', dmarc: 'fail', aligned: false, source: 'graph' },
      threadId: null, reason: 'auth_failed', matchedMatterId: 'matter-1', matchedRequestId: 'intake-1', status: 'pending', createdAt: 'now', updatedAt: 'now',
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open original email' }));
    expect(await screen.findByTestId('email-reply-quarantine-review')).toBeTruthy();
    expect(selectValue('Client')).toBe('');
    expect(selectValue('Onboarding request')).toBe('');
    expect(selectValue('Open item')).toBe('');
    expect(selectValue('Attachment')).toBe('');
  });
});
