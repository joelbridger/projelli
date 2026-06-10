/**
 * Keepance 3.0 — audit "defense file" provenance events.
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

const mocks = vi.hoisted(() => ({
  retrieve: vi.fn(),
  sendMessage: vi.fn(),
  verifyCitation: vi.fn(),
}));

vi.mock('@/modules/memory/MemoryService', async (orig) => {
  const real = await orig<typeof import('@/modules/memory/MemoryService')>();
  return {
    ...real,
    MemoryService: { ...real.MemoryService, retrieve: mocks.retrieve },
    isMemoryEnabled: () => true,
  };
});

vi.mock('@/utils/tauri-commands', async (orig) => {
  const real = await orig<typeof import('@/utils/tauri-commands')>();
  return { ...real, ragVerifyCitation: mocks.verifyCitation };
});

vi.mock('@/modules/models/ClaudeProvider', () => ({
  ClaudeProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/modules/models/OpenAIProvider', () => ({
  OpenAIProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));
vi.mock('@/modules/models/GeminiProvider', () => ({
  GeminiProvider: class {
    setTools() {}
    sendMessage = mocks.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'stub' }; }
  },
}));

vi.mock('@/components/ai/ChatCostChip', () => ({ ChatCostChip: () => null }));

import { AIChatViewer } from '@/components/ai/AIChatViewer';
import type { AIChatFile } from '@/types/ai';
import type { AuditEntry } from '@/types/audit';
import { useAIChatStore } from '@/stores/aiChatStore';
import { useMatterStore } from '@/stores/matterStore';
import { useSettingsStore } from '@/stores/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/modules/privacy/egress';

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

function seedMatter() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  const m = useMatterStore.getState().createMatter({
    name: 'Acme v. Beta',
    client: 'Acme Corp',
    folderPaths: ['/ws/Acme'],
  });
  useMatterStore.getState().setActiveMatter(m.id);
  return m;
}

async function sendWorkspaceMessage(onAuditLog: (e: LoggedEntry) => void) {
  render(<AIChatViewer chatData={chat} apiKeys={apiKey} onAuditLog={onAuditLog} />);
  act(() => fireEvent.click(screen.getByTestId('ask-workspace-toggle')));
  const textarea = screen.getByTestId('chat-input') as HTMLTextAreaElement;
  act(() => fireEvent.change(textarea, { target: { value: 'pricing?' } }));
  act(() => fireEvent.click(screen.getByTestId('chat-send-button')));
  await waitFor(() => expect(mocks.sendMessage).toHaveBeenCalled());
}

describe('Keepance 3.0 audit provenance events', () => {
  beforeEach(() => {
    mocks.retrieve.mockReset();
    mocks.sendMessage.mockReset();
    mocks.verifyCitation.mockReset();
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
    useMatterStore.setState({ matters: [], activeMatterId: null });
    // Default confidentiality mode = direct (cloud BYOK).
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');

    mocks.sendMessage.mockResolvedValue({
      content: 'Priced at $49 [pricing.md paragraph 3].',
      usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
      cost: 0.0001,
      model: 'stub',
    });
    mocks.verifyCitation.mockResolvedValue({ verdict: 'verified' });
  });

  afterEach(() => {
    useAIChatStore.setState({ sessions: {}, dailyCosts: {}, askWorkspaceMode: {} });
    useMatterStore.setState({ matters: [], activeMatterId: null });
  });

  it('logs retrieval_executed with the active matter scope, hit count, and top score', async () => {
    const m = seedMatter();
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
    const m = seedMatter();
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
    const m = seedMatter();
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
    const m = seedMatter();
    // Supply a real result so data is sent to the provider and egress is logged.
    mocks.retrieve.mockResolvedValue([
      { path: 'Acme/pricing.md', chunkText: 'Premium tier priced at $49.', score: 0.88, paragraphIndex: 2, id: 'chunk-e', matterId: m.id, sourceId: '/ws/Acme/pricing.md' },
    ]);

    const logged: LoggedEntry[] = [];
    await sendWorkspaceMessage((e) => logged.push(e));

    const egress = eventsOfType(logged, 'egress');
    expect(egress).toHaveLength(1);
    const payload = egress[0]!.metadata as Record<string, unknown>;
    expect(payload['destination']).toBe('provider-direct');
    expect(payload['provider']).toBe('anthropic');
    expect(payload['mode']).toBe('direct');
    expect(payload['dataLeaves']).toBe(true);
  });

  it('logs citation_verified with the verdict for each checked citation', async () => {
    const m = seedMatter();
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
