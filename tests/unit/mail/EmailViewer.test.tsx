/**
 * EmailViewer (Lantern 3.0) — the read-only mail viewer.
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
const mockSetPrivilege = vi.fn();

vi.mock('@/platform/utils/mail-commands', () => ({
  get mailGetMessage() { return mockMailGetMessage; },
  get mailGetAttachment() { return mockMailGetAttachment; },
  get mailRetagMessageMatter() { return mockMailRetagMessageMatter; },
  get mailSend() { return mockMailSend; },
}));

vi.mock('@/platform/matter/matterStore', () => ({
  useMatters: vi.fn(() => [
    { id: 'm1', name: 'Acme v. Beta', client: 'Acme', folderPaths: [], createdAt: '' },
  ]),
  useActiveMatter: vi.fn(() => null),
}));

vi.mock('@/platform/firm/privilegeStore', () => ({
  usePrivilegeStore: vi.fn(() => mockSetPrivilege),
  usePrivilegeForSource: vi.fn(() => 'none'),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

// Stub i18n so we don't need the full provider
vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

// Stub provider building so Draft with AI doesn't hit real APIs
vi.mock('@/platform/providers/KeychainService', () => ({
  createKeychainService: vi.fn(() => ({
    getKey: vi.fn(async () => null),
    hasKey: vi.fn(async () => false),
  })),
}));

vi.mock('@/platform/providers/OllamaProvider', () => ({
  OllamaProvider: vi.fn().mockImplementation(() => ({
    sendMessage: vi.fn(async () => ({ content: 'Draft reply here.' })),
    getMetadata: vi.fn(() => ({ model: 'llama3.1:8b' })),
  })),
}));

vi.mock('@/platform/providers/resolveLocalProvider', () => ({
  resolveLocalGenerationProvider: vi.fn(async () => ({
    provider: {
      sendMessage: vi.fn(async () => ({ content: 'Draft reply here.' })),
      getMetadata: vi.fn(() => ({ model: 'llama3.1:8b' })),
    },
    providerId: 'ollama',
    model: 'llama3.1:8b',
  })),
}));

vi.mock('@/platform/utils/fileDrop', () => ({
  deriveFilenameFromMessage: vi.fn(() => 'reply-draft.md'),
}));

import { EmailViewer, stripResidualTags, parseRecipients } from '@/features/email/EmailViewer';
import type { MailView } from '@/platform/utils/mail-commands';

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

async function openFilingPicker() {
  const trigger = screen.getByTestId('email-file-to-matter').querySelector('button');
  expect(trigger).not.toBeNull();
  fireEvent.click(trigger!);
  await screen.findByTestId('email-file-matter-search');
}

async function openSensitivityMenu() {
  const trigger = screen.getByTestId('email-privilege-control').querySelector('button');
  expect(trigger).not.toBeNull();
  fireEvent.pointerDown(trigger!, { button: 0, ctrlKey: false });
  fireEvent.click(trigger!);
  await act(async () => {
    await Promise.resolve();
  });
  await screen.findByTestId('email-privilege-option-attorney-client');
}

async function openReplyComposer() {
  fireEvent.click(screen.getByTestId('reply-open-btn'));
  await screen.findByTestId('reply-to-input');
}

async function openReplyActions() {
  const trigger = screen.getByTestId('reply-more-actions');
  fireEvent.pointerDown(trigger, { button: 0, ctrlKey: false });
  fireEvent.click(trigger);
  await act(async () => {
    await Promise.resolve();
  });
  await screen.findByTestId('reply-mailto-link');
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
    expect(err).toHaveTextContent('mail.viewer.open-error-title');
    // The raw message id must NOT appear in user-facing copy (fix: no id leak).
    expect(err).not.toHaveTextContent('id:');
    expect(err).toHaveTextContent('message not found');
  });

  it('keeps sensitivity and file-to-matter actions available when the message body cannot load', async () => {
    mockMailGetMessage.mockRejectedValue(new Error('message not found'));
    mockMailRetagMessageMatter.mockResolvedValue(undefined);

    render(<EmailViewer sourceId="mail:missing" />);

    await screen.findByTestId('email-viewer-error');
    expect(screen.getByTestId('email-privilege-control')).toBeInTheDocument();
    expect(screen.getByTestId('email-file-to-matter')).toBeInTheDocument();

    await openSensitivityMenu();
    fireEvent.click(screen.getByTestId('email-privilege-option-attorney-client'));
    expect(mockSetPrivilege).toHaveBeenCalledWith('mail:missing', 'attorney-client');

    await openFilingPicker();
    await act(async () => {
      fireEvent.click(screen.getByTestId('file-to-matter-btn-m1'));
    });

    await waitFor(() => expect(mockMailRetagMessageMatter).toHaveBeenCalledWith('missing', 'm1'));
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
    await openFilingPicker();
    // Matter button exists
    expect(screen.getByTestId('file-to-matter-btn-m1')).toBeInTheDocument();
    expect(screen.getByTestId('file-to-matter-btn-m1')).toHaveTextContent('Acme v. Beta');
  });

  // -------------------------------------------------------------------------
  // BUG-013 — the viewer must show which matter an email is filed to on reopen.
  // -------------------------------------------------------------------------

  it('shows which matter the email is filed to when matterId is set (and marks that button current)', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: 'm1' }));
    render(<EmailViewer sourceId="mail:AAMk-xyz" />);
    const filed = await screen.findByTestId('email-filed-matter');
    expect(filed).toHaveTextContent(/Acme v\. Beta/);
    await openFilingPicker();
    // The currently-filed matter's button is marked selected; others are not.
    expect(screen.getByTestId('file-to-matter-btn-m1')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows no filed indicator when the email is not filed to any matter', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: null }));
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-file-to-matter');
    expect(screen.queryByTestId('email-filed-matter')).not.toBeInTheDocument();
    await openFilingPicker();
    expect(screen.getByTestId('file-to-matter-btn-m1')).toHaveAttribute('aria-pressed', 'false');
  });

  it('reflects the filed matter immediately after filing, not via a transient flag', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: null }));
    mockMailRetagMessageMatter.mockResolvedValue({ filedCount: 1, searchRepairPending: false });
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-file-to-matter');
    await openFilingPicker();

    await act(async () => {
      fireEvent.click(screen.getByTestId('file-to-matter-btn-m1'));
    });
    await waitFor(() => expect(mockMailRetagMessageMatter).toHaveBeenCalledWith('AAMk-xyz', 'm1'));

    // The persistent filed indicator now shows and the button is marked current.
    expect(await screen.findByTestId('email-filed-matter')).toHaveTextContent(/Acme v\. Beta/);
    expect(screen.queryByTestId('email-file-search-repair-pending')).not.toBeInTheDocument();
    await openFilingPicker();
    expect(screen.getByTestId('file-to-matter-btn-m1')).toHaveAttribute('aria-pressed', 'true');
  });

  it('honestly says when filing worked but search repair is still pending', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: null }));
    mockMailRetagMessageMatter.mockResolvedValue({ filedCount: 1, searchRepairPending: true });
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-file-to-matter');
    await openFilingPicker();

    fireEvent.click(screen.getByTestId('file-to-matter-btn-m1'));

    expect(await screen.findByTestId('email-filed-matter')).toHaveTextContent(/Acme v\. Beta/);
    expect(await screen.findByTestId('email-file-result')).toHaveTextContent('mail.viewer.filed-success');
    expect(await screen.findByTestId('email-file-search-repair-pending')).toHaveTextContent(
      /Search is updating\. This email will not appear in search results until it is ready/,
    );
    await openFilingPicker();
    expect(screen.getByTestId('file-to-matter-btn-m1')).toHaveAttribute('aria-pressed', 'true');
  });

  it('shows the reply area with Draft with AI and mailto link', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');
    expect(screen.getByTestId('reply-draft-ai-btn')).toBeInTheDocument();
    await openReplyActions();
    const mailtoLink = screen.getByTestId('reply-mailto-link');
    expect(mailtoLink).toHaveAttribute('href', expect.stringContaining('mailto:'));
    expect(mailtoLink).toHaveAttribute('href', expect.stringContaining('mail.viewer.reply-subject-prefix'));
  });

  it('sends a reply via mailSend with the right args including inReplyToId', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    mockMailSend.mockResolvedValue('sent-id');

    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');
    await openReplyComposer();

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
    await openReplyComposer();

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
