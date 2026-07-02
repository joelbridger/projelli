/**
 * EmailViewer — audit gap fix (2026-07-01 security eval).
 *
 * The 2026-07-01 security eval found no durable audit record on the two paths
 * where a client's email content can leave the device (an AI draft) or leave
 * the firm (a sent reply). This file proves both paths now leave a record via
 * the SAME live audit emitter App.tsx registers for the rest of the app (see
 * `setEmailAuditEmitter`), and that the record NEVER carries the body,
 * subject, or any address — only provider/model/scope/message-id (draft) or
 * message-id/account/recipient-count (send).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
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
    { id: 'm1', name: 'Acme v. Beta', client: 'Acme', folderPaths: [], createdAt: '' },
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

vi.mock('@/platform/providers/KeychainService', () => ({
  createKeychainService: vi.fn(() => ({
    getKey: vi.fn(async () => null),
    hasKey: vi.fn(async () => false),
  })),
}));

vi.mock('@/platform/providers/OllamaProvider', () => ({
  // A real `function` (not an arrow) so `new OllamaProvider()` — how
  // resolveLocalGenerationProvider actually constructs it — works; arrow
  // functions aren't constructible and silently threw "not a constructor"
  // here since no prior test ever exercised the real Draft-with-AI path.
  OllamaProvider: vi.fn().mockImplementation(function OllamaProvider() {
    return {
      sendMessage: vi.fn(async () => ({ content: 'Draft reply here.' })),
      getMetadata: vi.fn(() => ({ model: 'llama3.1:8b' })), // no providerId — matches the real OllamaProvider/Claude/OpenAI/Gemini metadata shape
    };
  }),
}));

vi.mock('@/platform/utils/fileDrop', () => ({
  deriveFilenameFromMessage: vi.fn(() => 'reply-draft.md'),
}));

import { EmailViewer, setEmailAuditEmitter } from '@/features/email/EmailViewer';
import type { MailView } from '@/platform/utils/mail-commands';
import type { AuditEntry } from '@/platform/types/audit';

const emitterSpy = vi.fn((_entry: Omit<AuditEntry, 'id' | 'timestamp'>) => {});

function sampleMessage(overrides: Partial<MailView> = {}): MailView {
  return {
    id: 'AAMk-xyz',
    subject: 'Closing date — do not audit this',
    from: 'Pat H <pat@hender.com>',
    to: ['Me <me@firm.com>'],
    cc: [],
    date: '2026-05-01T14:30:00Z',
    provider: 'm365',
    account: 'default',
    body: 'Confirming May 14. Secret client detail: SSN 123-45-6789.',
    hasAttachments: false,
    attachments: [],
    ...overrides,
  };
}

describe('EmailViewer — AI-draft audit (egress)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEmailAuditEmitter(emitterSpy);
  });
  afterEach(() => {
    setEmailAuditEmitter(null);
  });

  it('logs an egress audit entry when Draft with AI is used, scoped to the filed matter, with no body/subject/address', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: 'm1' }));
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-draft-ai-btn'));
    });

    await waitFor(() => expect(emitterSpy).toHaveBeenCalled());

    const entry = emitterSpy.mock.calls[0]![0];
    expect(entry.action).toBe('egress');
    const metadata = entry.metadata;
    expect(metadata['messageId']).toBe('AAMk-xyz');
    // No cloud key configured -> falls back to the local engine. providerId
    // must come from the resolver (ollama), not the provider's own metadata.
    expect(metadata['provider']).toBe('ollama');
    expect(metadata['model']).toBe('llama3.1:8b');
    expect(metadata['scope']).toEqual({ kind: 'matter', matterId: 'm1', matterName: 'Acme v. Beta' });
    expect(metadata['dataLeaves']).toBe(false);

    // No email content anywhere in the logged entry.
    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('Closing date');
    expect(serialized).not.toContain('SSN');
    expect(serialized).not.toContain('pat@hender.com');
  });

  it('omits scope when the email is not filed to any matter', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: null }));
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-draft-ai-btn'));
    });

    await waitFor(() => expect(emitterSpy).toHaveBeenCalled());
    const entry = emitterSpy.mock.calls[0]![0];
    expect(entry.metadata['scope']).toBeUndefined();
  });

  it('still scopes by matterId (without a name) when the matter is filed but not in the current list (e.g. archived)', async () => {
    // 'm-archived' deliberately does NOT match the mocked useMatters() list (only 'm1').
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: 'm-archived' }));
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-draft-ai-btn'));
    });

    await waitFor(() => expect(emitterSpy).toHaveBeenCalled());
    const entry = emitterSpy.mock.calls[0]![0];
    expect(entry.metadata['scope']).toEqual({ kind: 'matter', matterId: 'm-archived' });
  });

  it('does nothing (never throws) when no emitter is registered', async () => {
    setEmailAuditEmitter(null);
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-draft-ai-btn'));
    });

    await screen.findByTestId('reply-draft-textarea');
    expect(emitterSpy).not.toHaveBeenCalled();
  });
});

describe('EmailViewer — outbound send audit', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEmailAuditEmitter(emitterSpy);
  });
  afterEach(() => {
    setEmailAuditEmitter(null);
  });

  it('logs an email.send audit entry with message id, account, and recipient count only', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    mockMailSend.mockResolvedValue('sent-id');

    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    fireEvent.change(screen.getByTestId('reply-to-input'), { target: { value: 'pat@hender.com' } });
    fireEvent.change(screen.getByTestId('reply-subject-input'), { target: { value: 'Re: Closing date' } });
    fireEvent.change(screen.getByTestId('reply-draft-textarea'), { target: { value: 'Thanks for confirming.' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-send-btn'));
    });

    await waitFor(() => expect(mockMailSend).toHaveBeenCalled());
    await waitFor(() => expect(emitterSpy).toHaveBeenCalledWith(
      expect.objectContaining({
        action: 'email.send',
        metadata: expect.objectContaining({ messageId: 'AAMk-xyz', account: 'default' }),
      }),
    ));

    const entry = emitterSpy.mock.calls.find((c) => c[0]!.action === 'email.send')![0]!;
    expect(entry.outputs['recipientCount']).toBe(1);

    const serialized = JSON.stringify(entry);
    expect(serialized).not.toContain('pat@hender.com');
    expect(serialized).not.toContain('Thanks for confirming');
    expect(serialized).not.toContain('Re: Closing date');
  });

  it('does not log email.send when mailSend fails', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage());
    mockMailSend.mockRejectedValue(new Error('network down'));

    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');
    fireEvent.change(screen.getByTestId('reply-to-input'), { target: { value: 'pat@hender.com' } });
    fireEvent.change(screen.getByTestId('reply-draft-textarea'), { target: { value: 'Hi.' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-send-btn'));
    });

    await screen.findByTestId('reply-send-error');
    expect(emitterSpy).not.toHaveBeenCalledWith(expect.objectContaining({ action: 'email.send' }));
  });
});
