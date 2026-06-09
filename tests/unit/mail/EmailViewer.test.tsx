/**
 * EmailViewer (Keepance 3.0) — the read-only mail viewer.
 *
 * Verifies that:
 *   - it fetches the message by id and renders from / to / cc / subject / date,
 *   - the body is rendered as TEXT (no HTML executes) and residual tags are
 *     stripped defensively,
 *   - the attachments list shows when the message has attachments,
 *   - a fetch failure shows a friendly error instead of crashing.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor } from '@testing-library/react';

const mockMailGetMessage = vi.fn();

vi.mock('@/utils/mail-commands', () => ({
  get mailGetMessage() {
    return mockMailGetMessage;
  },
}));

import { EmailViewer, stripResidualTags } from '@/components/mail/EmailViewer';
import type { MailView } from '@/utils/mail-commands';

function sampleMessage(overrides: Partial<MailView> = {}): MailView {
  return {
    id: 'AAMk-xyz',
    subject: 'Closing date',
    from: 'Pat H <pat@hender.com>',
    to: ['Me <me@firm.com>', 'legal@firm.com'],
    cc: ['Boss <boss@firm.com>'],
    date: '2026-05-01T14:30:00Z',
    provider: 'm365',
    body: 'Confirming May 14. The closing is at 10am.',
    hasAttachments: false,
    attachments: [],
    ...overrides,
  };
}

describe('EmailViewer', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('fetches by id and renders the message fields', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    render(<EmailViewer sourceId="mail:AAMk-xyz" />);

    // It calls the command with the source id (mail: prefix tolerated by backend).
    await waitFor(() => expect(mockMailGetMessage).toHaveBeenCalledWith('mail:AAMk-xyz'));

    expect(await screen.findByTestId('email-viewer-subject')).toHaveTextContent('Closing date');
    expect(screen.getByTestId('email-viewer-from')).toHaveTextContent('Pat H <pat@hender.com>');
    expect(screen.getByTestId('email-viewer-to')).toHaveTextContent('Me <me@firm.com>, legal@firm.com');
    expect(screen.getByTestId('email-viewer-cc')).toHaveTextContent('Boss <boss@firm.com>');
    expect(screen.getByTestId('email-viewer-body')).toHaveTextContent(
      'Confirming May 14. The closing is at 10am.',
    );
  });

  it('renders the body as text and strips any residual tags (no HTML executes)', async () => {
    mockMailGetMessage.mockResolvedValue(
      sampleMessage({
        body: 'Hello <img src=x onerror="alert(1)"> there <b>bold</b>',
      }),
    );
    const { container } = render(<EmailViewer sourceId="AAMk-xyz" />);

    const body = await screen.findByTestId('email-viewer-body');
    // The dangerous markup must NOT be present as elements...
    expect(container.querySelector('img')).toBeNull();
    expect(body.querySelector('b')).toBeNull();
    // ...and the residual tags are stripped from the visible text.
    expect(body.textContent).toContain('Hello');
    expect(body.textContent).toContain('there');
    expect(body.textContent).toContain('bold');
    expect(body.textContent).not.toContain('onerror');
    expect(body.textContent).not.toContain('<img');
  });

  it('shows an attachments row when the message has attachments', async () => {
    mockMailGetMessage.mockResolvedValue(
      sampleMessage({ hasAttachments: true, attachments: [{ name: 'contract.pdf' }] }),
    );
    render(<EmailViewer sourceId="AAMk-xyz" />);
    const att = await screen.findByTestId('email-viewer-attachments');
    expect(att).toHaveTextContent('contract.pdf');
  });

  it('shows a friendly error when the message cannot be opened', async () => {
    mockMailGetMessage.mockRejectedValue(new Error('message not found'));
    render(<EmailViewer sourceId="mail:missing" />);
    const err = await screen.findByTestId('email-viewer-error');
    expect(err).toHaveTextContent('could not be opened');
    // The (trimmed) id is surfaced to help debugging.
    expect(err).toHaveTextContent('missing');
  });

  it('stripResidualTags removes angle-bracket markup but keeps text', () => {
    expect(stripResidualTags('a <b>x</b> c')).toBe('a x c');
    expect(stripResidualTags('no tags here')).toBe('no tags here');
    expect(stripResidualTags('<script>evil()</script>safe')).toBe('evil()safe');
  });
});
