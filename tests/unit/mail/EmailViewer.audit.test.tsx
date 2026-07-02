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

const mockGetKey = vi.fn(async (_provider: string): Promise<string | null> => null);
vi.mock('@/platform/providers/KeychainService', () => ({
  createKeychainService: vi.fn(() => ({
    getKey: mockGetKey,
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

// EmailViewer builds every cloud provider through the shared front-door
// factory (fix F2.2) — createProvider({ provider, apiKey, model?, assured? }).
// This mock captures the opts (esp. `provider`/`assured`) so tests can prove
// the ACTUAL route the provider was built with, not just the app's
// confidentiality-mode setting.
const createProviderMock = vi.fn((opts: { provider: string; apiKey?: string; model?: string; assured?: unknown }) => ({
  sendMessage: vi.fn(async () => ({ content: 'Cloud draft.' })),
  getMetadata: vi.fn(() => ({ model: opts.model ?? 'claude-haiku-4-5-20251001' })), // no providerId — real cloud providers never set one
  __opts: opts,
}));
vi.mock('@/platform/providers/providerFactory', () => ({
  createProvider: (opts: { provider: string; apiKey?: string; model?: string; assured?: unknown }) => createProviderMock(opts),
}));

const mockResolveAssuredRoute = vi.fn((_provider: string, _model: string, _stream?: boolean): unknown => undefined);
vi.mock('@/platform/firm/resolveAssuredRoute', () => ({
  resolveAssuredRoute: (provider: string, model: string, stream?: boolean) => mockResolveAssuredRoute(provider, model, stream),
}));

vi.mock('@/platform/utils/fileDrop', () => ({
  deriveFilenameFromMessage: vi.fn(() => 'reply-draft.md'),
}));

import { EmailViewer, setEmailAuditEmitter } from '@/features/email/EmailViewer';
import type { MailView } from '@/platform/utils/mail-commands';
import type { AuditEntry } from '@/platform/types/audit';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { CONFIDENTIALITY_CHOICE_MADE_KEY } from '@/platform/privacy/resolvePersonalEgressDefault';

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

describe('EmailViewer — AI-draft audit records the ACTUAL assured route (independent reviewer catch)', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    setEmailAuditEmitter(emitterSpy);
    useSettingsStore.setState({ values: {} });
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'assured');
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_CHOICE_MADE_KEY, true);
    mockGetKey.mockImplementation(async (provider: string) => (provider === 'anthropic' ? 'sk-ant-test' : null));
  });
  afterEach(() => {
    setEmailAuditEmitter(null);
    useSettingsStore.setState({ values: {} });
  });

  it('logs destination "assured-proxy" (and constructs the provider with the route) when the firm actually has one configured', async () => {
    mockResolveAssuredRoute.mockReturnValue({
      provider: 'anthropic',
      model: 'claude-haiku-4-5-20251001',
      accessToken: 'ACCESS',
      seatToken: 'SEAT',
      stream: true,
    });
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: null }));
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-draft-ai-btn'));
    });

    await waitFor(() => expect(emitterSpy).toHaveBeenCalled());
    const entry = emitterSpy.mock.calls[0]![0];
    expect(entry.metadata['mode']).toBe('assured');
    expect(entry.metadata['destination']).toBe('assured-proxy');
    expect(entry.metadata['dataLeaves']).toBe(true);

    // The provider actually used the resolved route, not a plain BYOK call.
    expect(createProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'anthropic', assured: expect.objectContaining({ accessToken: 'ACCESS' }) }),
    );
    // Independent reviewer catch (P1): Draft with AI always calls the
    // non-streaming sendMessage(), so the route must be resolved as
    // non-streaming — otherwise the proxy sets X-Stream:1 and (for Gemini
    // especially) routes to the streaming endpoint while this code expects JSON.
    expect(mockResolveAssuredRoute).toHaveBeenCalledWith('anthropic', expect.any(String), false);
  });

  it('routes through assured with NO personal key at all (independent reviewer catch, P2) — never falls through to the local model', async () => {
    mockGetKey.mockResolvedValue(null); // no personal key for ANY provider
    mockResolveAssuredRoute.mockImplementation((provider: string) =>
      provider === 'anthropic'
        ? { provider: 'anthropic', model: 'claude-haiku-4-5-20251001', accessToken: 'ACCESS', seatToken: 'SEAT', stream: false }
        : undefined,
    );
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: null }));
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-draft-ai-btn'));
    });

    await waitFor(() => expect(emitterSpy).toHaveBeenCalled());
    const entry = emitterSpy.mock.calls[0]![0];
    // The whole point of Assured is a firm-managed key the user never pastes
    // in — this must NOT silently fall back to the local model just because
    // no personal key is configured.
    expect(entry.metadata['provider']).toBe('anthropic');
    expect(entry.metadata['destination']).toBe('assured-proxy');
    expect(createProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'anthropic', apiKey: '', assured: expect.objectContaining({ accessToken: 'ACCESS' }) }),
    );
  });

  it('logs destination "provider-direct" (honest BYOK fallback) when assured mode is selected but the firm has no managed key yet', async () => {
    mockResolveAssuredRoute.mockReturnValue(undefined); // no managed key / no live firm session
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: null }));
    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-draft-ai-btn'));
    });

    await waitFor(() => expect(emitterSpy).toHaveBeenCalled());
    const entry = emitterSpy.mock.calls[0]![0];
    // Mode still reflects the app-wide SETTING (matches Ask/Chat/redline
    // convention) but destination is the honest reality of what happened.
    expect(entry.metadata['mode']).toBe('assured');
    expect(entry.metadata['destination']).toBe('provider-direct');
    expect(entry.metadata['dataLeaves']).toBe(true);

    expect(createProviderMock).toHaveBeenLastCalledWith(
      expect.objectContaining({ provider: 'anthropic' }),
    );
    expect(createProviderMock).toHaveBeenLastCalledWith(
      expect.not.objectContaining({ assured: expect.anything() }),
    );
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

  it('scopes the email.send row to the filed matter (independent reviewer catch: replies were invisible in the client Activity view)', async () => {
    mockMailGetMessage.mockResolvedValue(sampleMessage({ matterId: 'm1' }));
    mockMailSend.mockResolvedValue('sent-id');

    render(<EmailViewer sourceId="AAMk-xyz" />);
    await screen.findByTestId('email-reply-area');
    fireEvent.change(screen.getByTestId('reply-to-input'), { target: { value: 'pat@hender.com' } });
    fireEvent.change(screen.getByTestId('reply-draft-textarea'), { target: { value: 'Thanks.' } });

    await act(async () => {
      fireEvent.click(screen.getByTestId('reply-send-btn'));
    });

    await waitFor(() => expect(mockMailSend).toHaveBeenCalled());
    const entry = emitterSpy.mock.calls.find((c) => c[0]!.action === 'email.send')![0]!;
    expect(entry.metadata['scope']).toEqual({ kind: 'matter', matterId: 'm1', matterName: 'Acme v. Beta' });
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
