/**
 * Lantern 3.0 — audit "defense file" provenance events.
 *
 * These pin that the new structured AuditEvents are emitted AT THEIR ACTION
 * POINTS in the chat send path (via the `onAuditLog` callback). The audit log
 * is the legal ICP's defense file, so the provenance must be provable:
 *
 *   1. A workspace-aware send logs `retrieval_executed` with the active matter
 *      scope, the hit count, and the top score.
 *   2. The same send logs `scope_active` for the active matter.
 *   3. A default send logs `privilege_evaluated` with `excluded: true`
 *      (privileged sources are held back unless the user opts them in).
 *   4. Every AI send logs `egress` with the resolved destination
 *      (provider-direct for a cloud BYOK send).
 *   5. Each verified citation logs `citation_verified` with its verdict.
 *
 * Seams are mocked exactly like matter-chat-scope.test.tsx (MemoryService,
 * providers, ragVerifyCitation) so we exercise the real wiring.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { act, render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { MutableRefObject } from 'react';

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  sendMessage: vi.fn(),
  sendMessageStreaming: vi.fn(),
  verifyCitations: vi.fn(),
  verifyCitation: vi.fn(),
  streamingEnabled: { value: false },
}));

vi.mock('@/platform/rag/MemoryService', async (orig) => {
  const real = await orig<typeof import('@/platform/rag/MemoryService')>();
  return {
    ...real,
    MemoryService: { ...real.MemoryService, retrieve: mocks.retrieve },
    isMemoryEnabled: () => true,
  };
});

vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const real = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return { ...real, ragVerifyCitation: mocks.verifyCitation };
});

vi.mock('@/platform/rag/workspaceCommand', async (orig) => {
  const real = await orig<typeof import('@/platform/rag/workspaceCommand')>();
  return {
    ...real,
    verifyCitations: mocks.verifyCitations,
  };
});

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    get sendMessageStreaming() {
      return mocks.streamingEnabled.value ? mocks.sendMessageStreaming : undefined;
    }
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    get sendMessageStreaming() {
      return mocks.streamingEnabled.value ? mocks.sendMessageStreaming : undefined;
    }
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    get sendMessageStreaming() {
      return mocks.streamingEnabled.value ? mocks.sendMessageStreaming : undefined;
    }
    getMetadata() { return { model: 'stub' }; }
  },
}));

vi.mock('@/features/ask/ChatCostChip', () => ({ ChatCostChip: () => null }));

import { AIChatViewer } from '@/features/ask/AIChatViewer';
import type { AIChatFile } from '@/platform/types/ai';
import type { FSBackend, FileStat } from '@/platform/fs/types';
import type { WorkspaceService } from '@/platform/fs/WorkspaceService';
import type { AuditEntry } from '@/platform/types/audit';
import { useAIChatStore } from '@/platform/state/aiChatStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import {
  issueAllMattersScopeSelection,
  issueMatterScopeSelection,
  requestClearClientSelection,
  requestMatterScopeSelection,
  useClientContextStore,
} from '@/platform/client-context';
import { setDevFlagOverride } from '@/platform/flags/router';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { CONFIDENTIALITY_CHOICE_MADE_KEY } from '@/platform/privacy/resolvePersonalEgressDefault';
import { SECRET_SCRUB_FIXTURES } from '@/platform/privacy/promptPreparation.fixtures';

type LoggedEntry = Omit<AuditEntry, 'id' | 'timestamp'>;

/** Filter logged entries down to one provenance event type. */
function eventsOfType(entries: LoggedEntry[], type: string): LoggedEntry[] {
  return entries.filter((e) => (e.metadata as Record<string, unknown>)['auditEventType'] === type);
}

const chat: AIChatFile = {
  id: 'audit-provenance-test',
  title: 'Audit Provenance',
  created: new Date().toISOString(),
  updated: new Date().toISOString(),
  messages: [],
  provider: 'anthropic',
  model: 'stub',
};

const apiKey = [{ provider: 'anthropic', key: 'stub-key', isValid: true }];

function makeWorkspaceRef() {
  const files = new Map<string, ArrayBuffer>();
  const backend: FSBackend = {
    read: vi.fn(async () => ''),
    readBinary: vi.fn(async (path: string) => files.get(path) ?? new ArrayBuffer(0)),
    write: vi.fn(async () => undefined),
    writeBinary: vi.fn(async (path: string, content: ArrayBuffer) => {
      files.set(path, content);
    }),
    exists: vi.fn(async () => true),
    delete: vi.fn(async () => undefined),
    move: vi.fn(async () => undefined),
    copy: vi.fn(async () => undefined),
    rename: vi.fn(async () => undefined),
    mkdir: vi.fn(async () => undefined),
    list: vi.fn(async () => []),
    stat: vi.fn(async (path: string): Promise<FileStat> => ({
      path,
      name: path.split('/').pop() ?? path,
      type: 'file',
      size: 0,
      modifiedAt: new Date(),
      createdAt: new Date(),
      isSymlink: false,
    })),
    isSymlink: vi.fn(async () => false),
    resolveSymlink: vi.fn(async (path: string) => path),
    getRootPath: vi.fn(() => '/ws'),
    setRootPath: vi.fn(async () => undefined),
  };
  return {
    current: {
      getBackend: () => backend,
    },
  } as unknown as MutableRefObject<WorkspaceService | null>;
}

async function seedMatter() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  const m = useMatterStore.getState().createMatter({
    name: 'Acme v. Beta',
    client: 'Acme Corp',
    folderPaths: ['/ws/Acme'],
  });
  await requestMatterScopeSelection(issueMatterScopeSelection(m.id));
  await waitFor(() => {
    expect(useMatterStore.getState().activeMatterId).toBe(m.id);
    expect(useClientContextStore.getState().followerStatus).toBe('converged');
  });
  return m;
}

async function sendWorkspaceMessage(
  onAuditLog: (e: LoggedEntry) => void,
  chatData: AIChatFile = chat,
) {
  render(<AIChatViewer chatData={chatData} apiKeys={apiKey} onAuditLog={onAuditLog} />);
  act(() => fireEvent.click(screen.getByTestId('ask-workspace-toggle')));
  const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
  act(() => fireEvent.change(textarea, { target: { value: 'pricing?' } }));
  act(() => fireEvent.click(screen.getByTestId('chat-send-button')));
  await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
}

describe('Lantern 3.0 audit provenance events', () => {
  beforeEach(async () => {
    mocks.retrieve.mockReset();
    mocks.sendMessage.mockReset();
    mocks.sendMessageStreaming.mockReset();
    mocks.verifyCitations.mockReset();
    mocks.verifyCitation.mockReset();
    mocks.streamingEnabled.value = false;
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {}, fileAccessConsent: { 'audit-provenance-test': { state: 'granted', grantedScope: { kind: 'allMatters' } }, 'audit-provenance-default-model-test': { state: 'granted', grantedScope: { kind: 'allMatters' } } } }); // F2.5: ambient retrieval needs file-access consent
    useMatterStore.setState({ matters: [], activeMatterId: null });
    setDevFlagOverride('selection-authority-boot-gate', false);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', true);
    await requestMatterScopeSelection(issueAllMattersScopeSelection());
    // Default confidentiality mode = direct (cloud BYOK).
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
    // Mark the confidentiality choice as made so the Task 1.3 gate is a no-op
    // in these tests, which focus on audit provenance, not the choice gate itself.
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_CHOICE_MADE_KEY, true);

    mocks.sendMessage.mockResolvedValue({
      content: 'Priced at $49 [pricing.md paragraph 3].',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      cost: 0.0001,
      model: 'stub',
    });
    mocks.verifyCitation.mockResolvedValue({ verdict: 'verified' });
    mocks.verifyCitations.mockImplementation(
      async (_content: string, sources: unknown[], opts?: { onVerdict?: (id: string, verdict: string) => void }) => {
        for (const source of sources as Array<{ id?: string }>) {
          if (source.id) opts?.onVerdict?.(source.id, 'verified');
        }
        return sources;
      },
    );
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {}, fileAccessConsent: { 'audit-provenance-test': { state: 'granted', grantedScope: { kind: 'allMatters' } }, 'audit-provenance-default-model-test': { state: 'granted', grantedScope: { kind: 'allMatters' } } } }); // F2.5: ambient retrieval needs file-access consent
    useMatterStore.setState({ matters: [], activeMatterId: null });
    setDevFlagOverride('selection-authority-boot-gate', false);
    requestClearClientSelection();
    setDevFlagOverride('selection-authority-boot-gate', undefined);
  });

  it('logs retrieval_executed with the active matter scope, hit count, and top score', async () => {
    const m = await seedMatter();
    mocks.retrieve.mockResolvedValue([
      { path: 'Acme/pricing.md', chunkText: 'Premium tier priced at $49.', score: 0.91, paragraphIndex: 3, id: 'chunk-1', matterId: m.id, sourceId: '/ws/Acme/pricing.md' },
      { path: 'Acme/terms.md', chunkText: 'Net 30.', score: 0.72, paragraphIndex: 1, id: 'chunk-2', matterId: m.id, sourceId: '/ws/Acme/terms.md' },
    ]);

    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e));

    const retrieval = eventsOfType(logged, 'retrieval_executed');
    expect(retrieval).toHaveLength(1);
    const payload = retrieval[0]!.metadata as Record<string, unknown>;
    expect(payload['scope']).toEqual({ kind: 'matter', matterId: m.id, matterName: expect.stringContaining('Acme') });
    expect(payload['hitCount']).toBe(2);
    expect(payload['topScore']).toBeCloseTo(0.91);
    expect(retrieval[0]!.action).toBe('retrieval_executed');
  });

  it('logs scope_active for the active matter', async () => {
    const m = await seedMatter();
    mocks.retrieve.mockResolvedValue([
      { path: 'Acme/pricing.md', chunkText: 'x', score: 0.5, paragraphIndex: 0, id: 'c', matterId: m.id, sourceId: '/ws/Acme/pricing.md' },
    ]);

    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e));

    const scope = eventsOfType(logged, 'scope_active');
    expect(scope).toHaveLength(1);
    expect((scope[0]!.metadata as Record<string, unknown>)['scope']).toMatchObject({ kind: 'matter', matterId: m.id });
  });

  it('logs privilege_evaluated with excluded:true by default (privileged held back)', async () => {
    const m = await seedMatter();
    // Supply a real result so the turn proceeds through to sendMessage.
    // privilege_evaluated fires before the model call so it is logged
    // regardless, but the sendWorkspaceMessage helper waits on sendMessage.
    mocks.retrieve.mockResolvedValue([
      { path: 'Acme/pricing.md', chunkText: 'Premium tier.', score: 0.85, paragraphIndex: 1, id: 'chunk-p', matterId: m.id, sourceId: '/ws/Acme/pricing.md' },
    ]);

    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e));

    const priv = eventsOfType(logged, 'privilege_evaluated');
    expect(priv).toHaveLength(1);
    expect((priv[0]!.metadata as Record<string, unknown>)['excluded']).toBe(true);
  });

  it('logs all-matters scope when no matter is active', async () => {
    // no seedMatter — activeMatterId stays null.
    // Supply a real result so the turn proceeds (sendWorkspaceMessage waits on sendMessage).
    mocks.retrieve.mockResolvedValue([
      { path: 'general/notes.md', chunkText: 'Some note.', score: 0.7, paragraphIndex: 0, id: 'chunk-am' },
    ]);
    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e));

    const retrieval = eventsOfType(logged, 'retrieval_executed');
    expect(retrieval).toHaveLength(1);
    expect((retrieval[0]!.metadata as Record<string, unknown>)['scope']).toEqual({ kind: 'allMatters' });
    const scope = eventsOfType(logged, 'scope_active');
    expect((scope[0]!.metadata as Record<string, unknown>)['scope']).toEqual({ kind: 'allMatters' });
  });

  it('logs egress with the provider-direct destination for a cloud BYOK send', async () => {
    const m = await seedMatter();
    // Supply a real result so data is sent to the provider and egress is logged.
    mocks.retrieve.mockResolvedValue([
      { path: 'Acme/pricing.md', chunkText: 'Premium tier priced at $49.', score: 0.88, paragraphIndex: 2, id: 'chunk-e', matterId: m.id, sourceId: '/ws/Acme/pricing.md' },
    ]);

    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e));

    const egress = eventsOfType(logged, 'egress');
    // A1 fail-closed audit: every successful send now writes a durable
    // intent row BEFORE egress and an outcome row after — a pair.
    expect(egress).toHaveLength(2);
    expect(egress.map((e) => (e.metadata as Record<string, unknown>)['auditPhase'])).toEqual(['intent', 'outcome']);
    const payload = egress[0]!.metadata as Record<string, unknown>;
    expect(payload['destination']).toBe('provider-direct');
    expect(payload['provider']).toBe('anthropic');
    expect(payload['mode']).toBe('direct');
    expect(payload['dataLeaves']).toBe(true);
    // BUG-028: the egress event must record the model so the confidentiality
    // report names it instead of printing "unknown".
    expect(payload['model']).toBe('stub');
  });

  it('BUG-094 logs the provider resolved model when a chat has no explicit model', async () => {
    const m = await seedMatter();
    const chatWithoutModel: AIChatFile = {
      id: 'audit-provenance-default-model-test',
      title: 'Audit Provenance Default Model',
      created: new Date().toISOString(),
      updated: new Date().toISOString(),
      messages: [],
      provider: 'anthropic',
    };
    mocks.retrieve.mockResolvedValue([
      { path: 'Acme/pricing.md', chunkText: 'Premium tier priced at $49.', score: 0.88, paragraphIndex: 2, id: 'chunk-e', matterId: m.id, sourceId: '/ws/Acme/pricing.md' },
    ]);

    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e), chatWithoutModel);

    const egress = eventsOfType(logged, 'egress');
    expect(egress).toHaveLength(2); // intent + outcome pair (A1)
    expect(egress[0]?.model).toBe('stub');
    expect(egress[0]?.metadata).toMatchObject({ model: 'stub' });
    expect(egress[0]?.model).not.toBe('unknown');
  });

  it('logs egress with the active matter scope', async () => {
    const m = await seedMatter();
    mocks.retrieve.mockResolvedValue([
      { path: 'Acme/pricing.md', chunkText: 'Premium tier priced at $49.', score: 0.88, paragraphIndex: 2, id: 'chunk-e', matterId: m.id, sourceId: '/ws/Acme/pricing.md' },
    ]);

    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e));

    const egress = eventsOfType(logged, 'egress');
    expect(egress).toHaveLength(2); // intent + outcome pair (A1)
    const payload = egress[0]!.metadata as Record<string, unknown>;
    expect(payload['scope']).toMatchObject({ kind: 'matter', matterId: m.id });
  });

  it('logs attempted egress before send and failed egress when the provider send fails', async () => {
    mocks.retrieve.mockResolvedValue([]);
    mocks.sendMessage.mockRejectedValue(new Error('provider offline'));

    const logged: LoggedEntry[] = [];
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} onAuditLog={(e) => logged.push(e)} />);
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'send this' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
      expect(msgs.some((m) => m.role === 'assistant' && m.isError)).toBe(true);
    });

    expect(eventsOfType(logged, 'egress')).toHaveLength(1);
    expect(eventsOfType(logged, 'egress_failed')).toHaveLength(1);
  });

  it('keeps model_call and successful egress when local citation verification throws after provider success', async () => {
    const m = await seedMatter();
    mocks.retrieve.mockResolvedValue([
      { path: 'Acme/pricing.md', chunkText: 'Premium tier priced at $49.', score: 0.88, paragraphIndex: 2, id: 'chunk-e', matterId: m.id, sourceId: '/ws/Acme/pricing.md' },
    ]);
    mocks.verifyCitations.mockRejectedValue(new Error('local verifier crashed'));

    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e));
    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));

    expect(eventsOfType(logged, 'egress')).toHaveLength(2); // intent + outcome (A1)
    expect(logged.filter((e) => e.action === 'model_call')).toHaveLength(2); // intent + outcome (A1)
    expect(eventsOfType(logged, 'egress_failed')).toHaveLength(0);
  });

  it('logs a cancelled egress row when streaming is stopped after a chunk arrived', async () => {
    mocks.streamingEnabled.value = true;
    mocks.retrieve.mockResolvedValue([]);
    mocks.sendMessageStreaming.mockImplementation(
      (_prompt: string, opts: { onChunk: (chunk: string) => void; signal?: AbortSignal }) =>
        new Promise((_resolve, reject) => {
          opts.onChunk('partial');
          opts.signal?.addEventListener('abort', () => {
            reject(new DOMException('Aborted', 'AbortError'));
          });
        }),
    );

    const logged: LoggedEntry[] = [];
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} onAuditLog={(e) => logged.push(e)} />);
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'stream this' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(screen.getByTestId('chat-stop-button')).toBeTruthy());
    act(() => fireEvent.click(screen.getByTestId('chat-stop-button')));

    await waitFor(() => {
      const egress = eventsOfType(logged, 'egress');
      // A1: the durable intent row precedes the send; the cancelled row follows.
      expect(egress).toHaveLength(2);
      const statuses = egress.map((e) => (e.metadata as Record<string, unknown>)['status']);
      expect(statuses).toContain('cancelled');
    });
    // model_call intent row was durably written before the stream started.
    expect(logged.filter((e) => e.action === 'model_call')).toHaveLength(1);
    expect(eventsOfType(logged, 'egress_failed')).toHaveLength(0);
  });

  it('does not log egress when streaming is aborted before any chunk arrives', async () => {
    mocks.streamingEnabled.value = true;
    mocks.retrieve.mockResolvedValue([]);
    mocks.sendMessageStreaming.mockRejectedValue(new DOMException('Aborted', 'AbortError'));

    const logged: LoggedEntry[] = [];
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} onAuditLog={(e) => logged.push(e)} />);
    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: 'stop before send' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => expect(mocks.sendMessageStreaming).toHaveBeenCalledTimes(1));
    await waitFor(() => {
      const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
      expect(msgs.some((m) => m.role === 'assistant' && m.content.includes('Response stopped by user'))).toBe(true);
    });

    // A1 fail-closed: the durable INTENT row is written before the send and
    // stays even when the stream aborts before any chunk — that attempt
    // happened and must be auditable. No outcome/cancelled/failed row follows.
    const egress = eventsOfType(logged, 'egress');
    expect(egress).toHaveLength(1);
    expect((egress[0]!.metadata as Record<string, unknown>)['auditPhase']).toBe('intent');
    expect(eventsOfType(logged, 'egress_failed')).toHaveLength(0);
  });

  it('does not log successful egress when Local-only blocks a cloud chat', async () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    mocks.retrieve.mockResolvedValue([]);

    const logged: LoggedEntry[] = [];
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} onAuditLog={(e) => logged.push(e)} />);
    const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
    act(() => fireEvent.change(textarea, { target: { value: 'send this' } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));

    await waitFor(() => {
      const msgs = useAIChatStore.getState().sessions[chat.id]?.messages ?? [];
      expect(msgs.some((m) => m.role === 'assistant' && m.isError)).toBe(true);
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(eventsOfType(logged, 'egress')).toHaveLength(0);
    expect(eventsOfType(logged, 'egress_blocked')).toHaveLength(1);
  });

  it('blocks an unscannable attachment before any egress', async () => {
    const visionChat: AIChatFile = {
      ...chat,
      id: 'audit-attachment-success',
      model: 'claude-3-5-sonnet-20241022',
    };
    mocks.retrieve.mockResolvedValue([]);
    mocks.sendMessage.mockResolvedValue({
      content: 'Read it.',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      cost: 0.0001,
      model: 'stub',
    });
    const logged: LoggedEntry[] = [];
    const workspaceServiceRef = makeWorkspaceRef();

    render(
      <AIChatViewer
        chatData={visionChat}
        apiKeys={apiKey}
        workspaceServiceRef={workspaceServiceRef}
        rootPath="/ws"
        onAuditLog={(e) => logged.push(e)}
      />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'evidence.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(screen.getByTestId('attachment-tiles-strip')).toBeTruthy());

    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));
    await waitFor(() => {
      const msgs = useAIChatStore.getState().sessions[visionChat.id]?.messages ?? [];
      expect(msgs.some((m) => m.role === 'assistant' && m.isError)).toBe(true);
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(eventsOfType(logged, 'egress')).toHaveLength(0);
    expect(logged).toContainEqual(expect.objectContaining({
      action: 'prompt_preparation',
      metadata: expect.objectContaining({ decision: 'blocked' }),
    }));
    expect(eventsOfType(logged, 'egress_blocked')).toHaveLength(1);
  });

  it('shows the review, sends only a redacted chat copy, and records the finding', async () => {
    const logged: LoggedEntry[] = [];
    const evasions = `${SECRET_SCRUB_FIXTURES.folded}\n${SECRET_SCRUB_FIXTURES.markdown}`;
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} onAuditLog={(entry) => logged.push(entry)} />);

    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: evasions } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));
    await screen.findByText('Review private links');
    fireEvent.click(screen.getByRole('button', { name: 'Send redacted copy' }));

    await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalledTimes(1));
    expect(mocks.sendMessage.mock.calls[0]?.[0]).not.toContain('folded-');
    expect(mocks.sendMessage.mock.calls[0]?.[0]).not.toContain('secret-value');
    expect(mocks.sendMessage.mock.calls[0]?.[0]).not.toContain('#private-link');
    expect(logged).toContainEqual(expect.objectContaining({
      action: 'prompt_preparation',
      metadata: expect.objectContaining({
        decision: 'redacted_by_user',
        categories: expect.arrayContaining([
          expect.objectContaining({ kind: 'bearer_token', count: 1 }),
          expect.objectContaining({ kind: 'intake_link_secret', count: 1 }),
        ]),
      }),
    }));
  });

  it('does not send a chat request when the advisor cancels private-link review', async () => {
    render(<AIChatViewer chatData={chat} apiKeys={apiKey} />);

    act(() => fireEvent.change(screen.getByTestId('chat-input'), { target: { value: SECRET_SCRUB_FIXTURES.urls } }));
    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));
    await screen.findByText('Review private links');
    fireEvent.click(screen.getByRole('button', { name: 'Cancel' }));

    await waitFor(() => expect(mocks.sendMessage).not.toHaveBeenCalled());
  });

  it('does not log an attachment send when an unscannable attachment is blocked', async () => {
    const visionChat: AIChatFile = {
      ...chat,
      id: 'audit-attachment-failure',
      model: 'claude-3-5-sonnet-20241022',
    };
    mocks.retrieve.mockResolvedValue([]);
    mocks.sendMessage.mockRejectedValue(new Error('provider offline'));
    const logged: LoggedEntry[] = [];
    const workspaceServiceRef = makeWorkspaceRef();

    render(
      <AIChatViewer
        chatData={visionChat}
        apiKeys={apiKey}
        workspaceServiceRef={workspaceServiceRef}
        rootPath="/ws"
        onAuditLog={(e) => logged.push(e)}
      />,
    );
    const input = document.querySelector('input[type="file"]') as HTMLInputElement;
    const file = new File([new Uint8Array([137, 80, 78, 71])], 'evidence.png', { type: 'image/png' });
    await act(async () => {
      fireEvent.change(input, { target: { files: [file] } });
    });
    await waitFor(() => expect(screen.getByTestId('attachment-tiles-strip')).toBeTruthy());

    act(() => fireEvent.click(screen.getByTestId('chat-send-button')));
    await waitFor(() => {
      const msgs = useAIChatStore.getState().sessions[visionChat.id]?.messages ?? [];
      expect(msgs.some((m) => m.role === 'assistant' && m.isError)).toBe(true);
    });

    expect(mocks.sendMessage).not.toHaveBeenCalled();
    expect(eventsOfType(logged, 'egress')).toHaveLength(0);
    expect(eventsOfType(logged, 'attachment_sent_to_provider')).toHaveLength(0);
    expect(eventsOfType(logged, 'egress_failed')).toHaveLength(0);
    expect(eventsOfType(logged, 'egress_blocked')).toHaveLength(1);
  });

  it('logs citation_verified with the verdict for each checked citation', async () => {
    const m = await seedMatter();
    mocks.retrieve.mockResolvedValue([
      { path: 'Acme/pricing.md', chunkText: 'Premium tier priced at $49.', score: 0.9, paragraphIndex: 3, id: 'chunk-1', matterId: m.id, sourceId: '/ws/Acme/pricing.md' },
    ]);
    mocks.verifyCitation.mockResolvedValue({ verdict: 'verified' });

    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e));

    await waitFor(() => {
      expect(eventsOfType(logged, 'citation_verified').length).toBeGreaterThanOrEqual(1);
    });
    const cite = eventsOfType(logged, 'citation_verified')[0]!;
    expect((cite.metadata as Record<string, unknown>)['verdict']).toBe('verified');
    expect((cite.metadata as Record<string, unknown>)['citationId']).toBe('chunk-1');
  });
});
