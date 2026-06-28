/**
 * Ask audit logging.
 *
 * The full Search surface must write real AI activity into the same Activity
 * Log as the chat-file viewer. This guards the demo bug where Search hit
 * OpenAI, but the Activity Log stayed empty.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { AuditEntry } from '@/platform/types/audit';
import type { RagHit } from '@/platform/utils/tauri-commands';

const h = vi.hoisted(() => ({
  retrieve: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(),
  sendMessage: vi.fn(),
  initSession: vi.fn(),
  addMessage: vi.fn(),
  sessions: {} as Record<string, unknown>,
}));

vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }));

vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null,
  SAMPLE_MATTER_ID: 'matter_sample_garcia_v_meridian',
}));

vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (selector: (s: { rootPath: string | null }) => unknown) =>
    selector({ rootPath: '/workspace' }),
}));

vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: (selector: (s: { profession: string }) => unknown) =>
    selector({ profession: 'advisor' }),
  getProfession: () => 'advisor',
}));

vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: unknown) => String(m),
}));

vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: vi.fn().mockReturnValue(null),
  getDemoQuestions: vi.fn().mockReturnValue(['q1', 'q2', 'q3', 'q4']),
}));

vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({
  EgressIndicator: () => null,
}));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => 'direct',
  useConfidentialityMode: () => 'direct',
}));

vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
  };
});

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: (...args: unknown[]) => h.retrieve(...args) },
  isMemoryEnabled: () => true,
}));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    sendMessage = h.sendMessage;
    sendMessageStreaming = undefined;
    getMetadata() { return { model: 'claude-audit-stub' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: class {} }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: class {} }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: class {} }));

vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: (p: string) => Promise.resolve(p === 'anthropic' ? 'sk-ant-test' : null),
      hasKey: (p: string) => Promise.resolve(p === 'anthropic'),
    };
  }),
}));

vi.mock('@/platform/state/aiChatStore', () => {
  const hook = (selector: (s: unknown) => unknown) =>
    selector({
      initSession: h.initSession,
      setSessionWorkspaceRoot: () => undefined,
      addMessage: h.addMessage,
      sessions: h.sessions,
    });
  hook.getState = () => ({
    initSession: h.initSession,
    setSessionWorkspaceRoot: () => undefined,
    addMessage: h.addMessage,
    sessions: h.sessions,
  });
  return { useAIChatStore: hook };
});

import { Ask } from '@/features/ask/Ask';

type LoggedEntry = Omit<AuditEntry, 'id' | 'timestamp'>;

function eventsOfType(entries: LoggedEntry[], type: string): LoggedEntry[] {
  return entries.filter((e) => e.metadata['auditEventType'] === type);
}

describe('Ask audit logging', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    h.sessions = {};
    h.retrieve.mockResolvedValue([
      {
        path: '/workspace/client-note.docx',
        chunkText: 'The client wants to retire in 2032.',
        score: 0.94,
        paragraphIndex: 4,
        id: 'chunk-client-note',
        sourceType: 'docx',
      } as RagHit,
    ]);
    h.sendMessage.mockResolvedValue({
      content: 'The client wants to retire in 2032 [client-note.docx paragraph 4].',
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      cost: 0.0002,
      model: 'claude-audit-stub',
    });
  });

  it('logs retrieval, egress, and model_call for a successful Ask request', async () => {
    const logged: LoggedEntry[] = [];
    render(<Ask onAuditLog={(entry) => logged.push(entry)} />);

    fireEvent.change(screen.getByTestId('ask-composer-input'), {
      target: { value: 'When does the client want to retire?' },
    });
    fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));

    await waitFor(() => expect(h.sendMessage).toHaveBeenCalledTimes(1));

    expect(eventsOfType(logged, 'scope_active')).toHaveLength(1);
    expect(eventsOfType(logged, 'privilege_evaluated')).toHaveLength(1);
    expect(eventsOfType(logged, 'retrieval_executed')).toHaveLength(1);
    expect(eventsOfType(logged, 'egress')).toHaveLength(1);
    expect(logged.filter((entry) => entry.action === 'model_call')).toHaveLength(1);

    const egress = eventsOfType(logged, 'egress')[0]!;
    expect(egress.description).toContain('AI request sent');
    expect(egress.model).toBe('claude-audit-stub');
    expect(egress.metadata).toMatchObject({
      provider: 'anthropic',
      model: 'claude-audit-stub',
      destination: 'provider-direct',
      dataLeaves: true,
      scope: { kind: 'allMatters' },
    });

    const modelCall = logged.find((entry) => entry.action === 'model_call')!;
    expect(modelCall.tokensIn).toBe(11);
    expect(modelCall.tokensOut).toBe(7);
    expect(modelCall.costUsd).toBe(0.0002);
    expect(modelCall.provider).toBe('anthropic');
  });
});
