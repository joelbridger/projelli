/**
 * BUG-01 regression: exercise Ask from a seeded search index all the way to the
 * cloud provider prompt. Retrieval is deliberately NOT mocked here. The only
 * fake at the product boundary is Anthropic, so no client data leaves the test.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';
import sampleWorkspace from '@/web-demo/sample-workspace-advisor.json';
import { installDemoRetrieval } from '@/web-demo/demoRetrieval';
import {
  resetRetrievalBackend,
  resetMemoryEnabledReader,
} from '@/platform/rag/MemoryService';
import { useAIChatStore } from '@/platform/state/aiChatStore';

const h = vi.hoisted(() => ({
  cloudSend: vi.fn<(question: string, options: { systemPrompt?: string }) => Promise<unknown>>(),
  capturedCloudPrompt: '',
}));

vi.mock('@/i18n', () => ({ default: { t: (key: string) => key } }));

vi.mock('@/platform/client-context', () => ({
  useSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
  readSelectionOperationDecision: () => ({ kind: 'all-matters', client: null }),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null,
  SAMPLE_MATTER_ID: 'matter_sample_garcia_v_meridian',
}));

vi.mock('@/platform/fs/workspaceStore', () => {
  const state = { rootPath: '/workspace', rootGeneration: 0 };
  const useWorkspaceStore = (selector: (value: typeof state) => unknown) => selector(state);
  useWorkspaceStore.getState = () => state;
  return { useWorkspaceStore };
});

vi.mock('@/platform/profile/professionStore', () => ({
  useProfessionStore: (selector: (state: { profession: string }) => unknown) =>
    selector({ profession: 'advisor' }),
  getProfession: () => 'advisor',
}));

vi.mock('@/platform/rag/matterResolver', () => ({ matterLabel: () => 'all clients' }));
vi.mock('@/platform/matter/samples/sampleMatterDemo', () => ({
  getDemoAnswerForWorkspace: () => null,
  getDemoQuestions: () => ['q1', 'q2', 'q3', 'q4'],
}));
vi.mock('@/platform/privacy/ui/EgressIndicator', () => ({ EgressIndicator: () => null }));
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => 'direct',
  useConfidentialityMode: () => 'direct',
}));
vi.mock('@/platform/privacy/localOnlyGuard', async (loadOriginal) => {
  const original = await loadOriginal<typeof import('@/platform/privacy/localOnlyGuard')>();
  return { ...original, assertCloudGenerationAllowed: vi.fn() };
});
vi.mock('@/features/crm-ask/retrieval', () => ({ retrieveCrmAskHits: async () => [] }));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    sendMessageStreaming = undefined;
    sendMessage(question: string, options: { systemPrompt?: string }) {
      h.capturedCloudPrompt = options.systemPrompt ?? '';
      return h.cloudSend(question, options);
    }
    getMetadata() { return { model: 'claude-bug01-test' }; }
  },
}));
vi.mock('@/platform/providers/OpenAIProvider', () => ({ OpenAIProvider: class {} }));
vi.mock('@/platform/providers/GeminiProvider', () => ({ GeminiProvider: class {} }));
vi.mock('@/platform/providers/OllamaProvider', () => ({ OllamaProvider: class {} }));
vi.mock('@/platform/providers/resolveLocalProvider', () => ({
  resolveLocalGenerationProvider: async () => null,
  resolveAvailableLocalGenerationProvider: async () => null,
}));
vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: (provider: string) => Promise.resolve(provider === 'anthropic' ? 'sk-ant-test' : null),
      hasKey: (provider: string) => Promise.resolve(provider === 'anthropic'),
    };
  }),
}));

import { Ask } from '@/features/ask/Ask';

describe('BUG-01 cloud retrieval reaches the provider prompt', () => {
  beforeEach(() => {
    localStorage.clear();
    // The final cloud-send guard reads the persisted choice directly and fails
    // closed when it is absent. Seed the real store shape used by a user who
    // selected Cloud AI during onboarding.
    localStorage.setItem(
      'lantern:settings',
      JSON.stringify({ state: { values: { confidentialityMode: 'direct' } }, version: 16 }),
    );
    useAIChatStore.getState().clearAllSessions();
    h.cloudSend.mockReset();
    h.capturedCloudPrompt = '';
    installDemoRetrieval(sampleWorkspace.files, '/workspace');
    h.cloudSend.mockResolvedValue({
      content:
        '[[BLOCK:FILES]]\nThe old 401(k) names Jessica Reyes ' +
        '[Beneficiary Designations.pdf paragraph 4].',
      usage: { inputTokens: 10, outputTokens: 10 },
      cost: 0.001,
      model: 'claude-bug01-test',
    });
  });

  afterEach(() => {
    resetRetrievalBackend();
    resetMemoryEnabledReader();
    useAIChatStore.getState().clearAllSessions();
    localStorage.clear();
  });

  it('blocks the hidden empty cloud send, then sends real seeded hits after permission', async () => {
    const audit: unknown[] = [];
    render(<Ask onAuditLog={(entry) => audit.push(entry)} />);

    // The escape hatch must be visible on the main Ask screen. Before BUG-01 it
    // was hidden inside Answer settings, so advisors never knew retrieval was off.
    expect(await screen.findByTestId('chat-file-access-consent')).toHaveAttribute(
      'data-state',
      'unasked',
    );

    const question = "Who is named on Marcus's old 401(k)?";
    fireEvent.change(screen.getByTestId('ask-composer-input'), { target: { value: question } });
    fireEvent.click(screen.getByTestId('ask-composer-submit'));

    // An unanswered permission question must never degrade into a confident,
    // context-free cloud answer. The typed question stays ready to retry.
    await waitFor(() => expect(screen.getByTestId('ask-composer-input')).toHaveValue(question));
    expect(h.cloudSend).not.toHaveBeenCalled();

    fireEvent.click(screen.getByTestId('chat-file-access-allow'));
    await waitFor(() =>
      expect(screen.getByTestId('chat-file-access-consent')).toHaveAttribute('data-state', 'granted'),
    );
    fireEvent.click(screen.getByTestId('ask-composer-submit'));

    await waitFor(() => expect(h.cloudSend).toHaveBeenCalledTimes(1));
    expect(h.capturedCloudPrompt).toContain('Jessica Reyes');
    expect(h.capturedCloudPrompt).toContain('Beneficiary Designations.pdf');
    await waitFor(() => {
      const saved = useAIChatStore.getState().sessions['ask-global::/workspace'];
      const answer = [...(saved?.messages ?? [])]
        .reverse()
        .find((message) => message.role === 'assistant');
      expect(answer?.askCitations).toHaveLength(1);
    });
    expect(audit).toContainEqual(
      expect.objectContaining({
        metadata: expect.objectContaining({ fileToolsEnabled: true }),
      }),
    );
  });
});
