/**
 * EmailViewer (Keepance 3.0) — the read-only mail viewer.
 *
 * Verifies that:
 *   - it fetches the message by id and renders from / to / cc / subject / date,
 *   - the body is rendered as TEXT (no HTML executes) and residual tags are
 *     stripped defensively,
 *   - the attachments list shows when the message has attachments (clickable buttons),
 *   - a fetch failure shows a friendly error instead of crashing,
 *   - file-to-matter section renders with matter buttons,
 *   - reply area renders with Draft with AI and mailto link.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

const mockMailGetMessage = vi.fn();
const mockMailGetAttachment = vi.fn();
const mockMailRetagMessageMatter = vi.fn();
const mockMailSend = vi.fn();

vi.mock('@/utils/mail-commands', () => ({
  get mailGetMessage() { return mockMailGetMessage; },
  get mailGetAttachment() { return mockMailGetAttachment; },
  get mailRetagMessageMatter() { return mockMailRetagMessageMatter; },
  get mailSend() { return mockMailSend; },
}));

vi.mock('@/stores/matterStore', () => ({
  useMatters: vi.fn(() => [
    { id: 'm1', name: 'Acme v. Beta', client: 'Acme', folderPaths: [], createdAt: '' },
  ]),
  useActiveMatter: vi.fn(() => null),
}));

vi.mock('@/stores/privilegeStore', () => ({
  usePrivilegeStore: vi.fn(() => vi.fn()),
  usePrivilegeForSource: vi.fn(() => 'none'),
}));

vi.mock('@/modules/memory/matterResolver', () => ({
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

// Stub i18n so we don't need the full provider
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Stub provider building so Draft with AI doesn't hit real APIs
vi.mock('@/modules/models/KeychainService', () => ({
  createKeychainService: vi.fn(() => ({ getKey: vi.fn(async () => null) })),
}));

vi.mock('@/modules/models/OllamaProvider', () => ({
  OllamaProvider: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn(async () => ({ content: 'Draft reply here.' })),
  })),
}));

vi.mock('@/utils/fileDrop', () => ({
  deriveFilenameFromMessage: vi.fn(() => 'reply-draft.md'),
}));

import { EmailViewer, stripResidualTags, parseRecipients } from '@/components/mail/EmailViewer';
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
    account: 'default',
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

  it('shows an attachments row with clickable download buttons when the message has attachments', async () => {
    mockMailGetMessage.mockResolvedValue(
      sampleMessage({
        hasAttachments: true,
        attachments: [{ id: 'att-1', name: 'contract.pdf' }],
      }),
    );
    render(<EmailViewer sourceId="AAMk-xyz" />);
    const att = await screen.findByTestId('email-viewer-attachments');
    expect(att).toHaveTextContent('contract.pdf');
    // Download button is present
    expect(screen.getByTestId('attachment-download-att-1')).toBeInTheDocument();
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

  it('shows the file-to-matter section with matter buttons', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-file-to-matter');
    // Matter button exists
    expect(screen.getByTestId('file-to-matter-btn-m1')).toBeInTheDocument();
    expect(screen.getByTestId('file-to-matter-btn-m1')).toHaveTextContent('Acme v. Beta');
  });

  it('shows the reply area with Draft with AI and mailto link', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');
    expect(screen.getByTestId('reply-draft-ai-btn')).toBeInTheDocument();
    const mailtoLink = screen.getByTestId('reply-mailto-link');
    expect(mailtoLink).toHaveAttribute('href', expect.stringContaining('mailto:'));
    expect(mailtoLink).toHaveAttribute('href', expect.stringContaining('Re%3A'));
  });

  it('sends a reply via mailSend with the right args including inReplyToId', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    mockMailSend.mockResolvedValue('sent-id');

    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    // Fill To field (the useEffect initializes it to 'pat@hender.com' from sampleMessage from address)
    fireEvent.change(screen.getByTestId('reply-to-input'), { target: { value: 'pat@hender.com' } });

    // Fill Subject
    fireEvent.change(screen.getByTestId('reply-subject-input'), { target: { value: 'Re: Closing date' } });

    // Fill body
    fireEvent.change(screen.getByTestId('reply-draft-textarea'), { target: { value: 'Thanks for confirming.' } });

    // Click Send
    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-send-btn'));
    });

    await waitFor(() => expect(mockMailSend).toHaveBeenCalled());

    expect(mockMailSend).toHaveBeenCalledWith(
      'm365',
      'default',
      ['pat@hender.com'],
      [],
      [],
      'Re: Closing date',
      'Thanks for confirming.',
      'AAMk-xyz',
    );

    expect(await screen.findByTestId('reply-send-success')).toBeInTheDocument();
  });

  it('renders scope_upgrade_required notice when mailSend rejects with that message', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    mockMailSend.mockRejectedValue(new Error('scope_upgrade_required'));

    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    fireEvent.change(screen.getByTestId('reply-to-input'), { target: { value: 'pat@hender.com' } });
    fireEvent.change(screen.getByTestId('reply-draft-textarea'), { target: { value: 'Hello.' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-send-btn'));
    });

    expect(await screen.findByTestId('reply-scope-upgrade')).toBeInTheDocument();
  });

  it('parseRecipients splits on comma and semicolon and trims', () => {
    expect(parseRecipients('a@a.com, b@b.com')).toEqual(['a@a.com', 'b@b.com']);
    expect(parseRecipients('a@a.com;b@b.com; c@c.com')).toEqual(['a@a.com', 'b@b.com', 'c@c.com']);
    expect(parseRecipients('')).toEqual([]);
    expect(parseRecipients('  single@x.com  ')).toEqual(['single@x.com']);
  });
});
