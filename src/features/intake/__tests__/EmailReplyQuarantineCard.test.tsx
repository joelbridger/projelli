import { fireEvent, render, screen } from '@testing-library/react';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/features/email/EmailViewer', () => ({ EmailViewer: () => <div /> }));
vi.mock('@/platform/intake/emailReplyQuarantineManualFile', () => ({
  dismissQuarantinedEmail: vi.fn(), manualFileQuarantinedEmail: vi.fn(),
}));

import { EmailReplyQuarantineCard } from '../EmailReplyQuarantineCard';
import { useIntakeStore } from '@/platform/intake/intakeStore';

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
    render(<EmailReplyQuarantineCard matterId="matter-1" advisorId="advisor-1" onResolved={() => {}} quarantine={{
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
    expect(screen.queryByRole('checkbox')).toBeNull();
  });

  it('starts with no destination selected, even after the advisor opens the message', async () => {
    render(<EmailReplyQuarantineCard matterId="matter-1" advisorId="advisor-1" onResolved={() => {}} loadMessage={async () => ({ attachmentsUnsupported: false, attachments: [{ id: 'a1', name: 'secret-file.pdf', filename: 'secret-file.pdf', kind: 'file' }] } as never)} quarantine={{
      quarantineId: 'quarantine-1', messageId: 'message-1', provider: 'm365', account: 'advisor@example.com', received: null,
      sender: 'client@example.com', authResult: { dkim: 'fail', spf: 'fail', dmarc: 'fail', aligned: false, source: 'graph' },
      threadId: null, reason: 'auth_failed', matchedMatterId: 'matter-1', matchedRequestId: 'intake-1', status: 'pending', createdAt: 'now', updatedAt: 'now',
    }} />);
    fireEvent.click(screen.getByRole('button', { name: 'Open original email' }));
    expect(await screen.findByTestId('email-reply-quarantine-review')).toBeTruthy();
    expect((screen.getByLabelText('Client') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Onboarding request') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Open item') as HTMLSelectElement).value).toBe('');
    expect((screen.getByLabelText('Attachment') as HTMLSelectElement).value).toBe('');
  });
});
