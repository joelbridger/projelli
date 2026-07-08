/**
 * QA-53 (P0, cross-client leak) — EmailViewer stale-async guards.
 *
 * Filing email A to a client, or "Draft with AI" on email A, kicks off async
 * work. If the user opens email B before it returns, the late callback uses
 * setMessage(prev => ...) / setReplyDraft against the CURRENT message (B) —
 * marking B filed to A's chosen client, or dropping A's draft into B's reply
 * box. Both must be dropped once the viewer has moved to a different message.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, waitFor, act, fireEvent } from '@testing-library/react';

const mockMailGetMessage = vi.fn();
const mockMailGetAttachment = vi.fn();
const mockMailRetagMessageMatter = vi.fn();
const mockMailSend = vi.fn();

vi.mock('@/platform/utils/mail-commands', () => ({
  get mailGetMessage() { return mockMailGetMessage; },
  get mailGetAttachment() { return mockMailGetAttachment; },
  get mailRetagMessageMatter() { return mockMailRetagMessageMatter; },
  get mailSend() { return mockMailSend; },
}));

vi.mock('@/platform/matter/matterStore', () => ({
  useMatters: vi.fn(() => [
    { id: 'm1', name: 'Client A Matter', client: 'A', folderPaths: [], createdAt: '' },
  ]),
  useActiveMatter: vi.fn(() => null),
}));

vi.mock('@/platform/firm/privilegeStore', () => ({
  usePrivilegeStore: vi.fn(() => vi.fn()),
  usePrivilegeForSource: vi.fn(() => 'none'),
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: vi.fn((m: { name: string }) => m.name),
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (k: string) => k }),
}));

const mockResolveEmailProvider = vi.fn();
vi.mock('@/features/email/resolveEmailProvider', () => ({
  resolveEmailProvider: (...args: unknown[]) => mockResolveEmailProvider(...args),
  buildProviderAsync: vi.fn(),
}));

vi.mock('@/platform/utils/fileDrop', () => ({
  deriveFilenameFromMessage: vi.fn(() => 'reply-draft.md'),
}));

import { EmailViewer } from '@/features/email/EmailViewer';
import type { MailView } from '@/platform/utils/mail-commands';

type Deferred<T> = { promise: Promise<T>; resolve: (v: T) => void };
function deferred<T>(): Deferred<T> {
  let resolve!: (v: T) => void;
  const promise = new Promise<T>((r) => { resolve = r; });
  return { promise, resolve };
}

function msg(id: string, overrides: Partial<MailView> = {}): MailView {
  return {
    id,
    subject: `Subject ${id}`,
    from: `Sender ${id} <s${id}@x.com>`,
    to: ['me@firm.com'],
    cc: [],
    date: '2026-05-01T14:30:00Z',
    provider: 'm365',
    account: 'default',
    body: `Body of ${id}`,
    hasAttachments: false,
    attachments: [],
    matterId: null,
    ...overrides,
  } as MailView;
}

beforeEach(() => {
  mockMailGetMessage.mockReset();
  mockMailRetagMessageMatter.mockReset();
  mockResolveEmailProvider.mockReset();
  mockMailGetMessage.mockImplementation((sid: string) =>
    Promise.resolve(sid === 'mail:A' ? msg('A') : msg('B')),
  );
});

async function openFilingPicker() {
  const trigger = screen.getByTestId('email-file-to-matter').querySelector('button');
  expect(trigger).not.toBeNull();
  fireEvent.click(trigger!);
  await screen.findByTestId('file-to-matter-btn-m1');
}

async function openReplyComposer() {
  fireEvent.click(screen.getByTestId('reply-open-btn'));
  await screen.findByTestId('reply-draft-textarea');
}

describe('EmailViewer — QA-53 stale-async cross-client isolation', () => {
  it('does not mark email B filed to the client chosen while viewing email A', async () => {
    const retag = deferred<void>();
    mockMailRetagMessageMatter.mockReturnValue(retag.promise);

    const { rerender } = render(<EmailViewer sourceId="mail:A" />);
    await waitFor(() => { expect(screen.getByText('Subject A')).toBeTruthy(); });

    // Start filing email A to client m1.
    await openFilingPicker();
    fireEvent.click(screen.getByTestId('file-to-matter-btn-m1'));

    // Switch to email B before the retag returns.
    rerender(<EmailViewer sourceId="mail:B" />);
    await waitFor(() => { expect(screen.getByText('Subject B')).toBeTruthy(); });

    // The retag for A resolves LATE.
    await act(async () => {
      retag.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    // Email B must NOT show as filed (its matterId must not be stamped from A's action).
    expect(screen.queryByTestId('email-filed-matter')).toBeNull();
  });

  it('does not drop email A\'s AI draft into email B\'s reply box', async () => {
    const send = deferred<{ content: string }>();
    mockResolveEmailProvider.mockResolvedValue({
      provider: {
        sendMessage: () => send.promise,
        getMetadata: () => ({ model: 'test-model', providerId: 'ollama' }),
      },
      providerId: 'ollama',
      assuredAvailable: false,
    });

    const { rerender } = render(<EmailViewer sourceId="mail:A" />);
    await waitFor(() => { expect(screen.getByText('Subject A')).toBeTruthy(); });

    // Start "Draft with AI" on email A.
    fireEvent.click(screen.getByTestId('reply-draft-ai-btn'));

    // Switch to email B before the draft returns.
    rerender(<EmailViewer sourceId="mail:B" />);
    await waitFor(() => { expect(screen.getByText('Subject B')).toBeTruthy(); });

    // The AI reply for A resolves LATE.
    await act(async () => {
      send.resolve({ content: "PRIVILEGED DRAFT ABOUT CLIENT A'S CASE" });
      await Promise.resolve();
      await Promise.resolve();
    });

    // Email B's reply box must not contain the draft generated for email A.
    await openReplyComposer();
    const textarea = screen.getByTestId('reply-draft-textarea') as HTMLTextAreaElement;
    expect(textarea.value).not.toContain("CLIENT A'S CASE");
  });
});
