/**
 * Fix 3 (connect-flow demo hardening): Ask must keep the persistent key-status
 * markers (keyVerification.ts) honest —
 *   - a successful cloud send marks the resolved provider VERIFIED, so a new
 *     chat prefers it (mirrors ApiKeyManager's "Check" button and the
 *     Wizard's on-save verification).
 *   - a 401/403 auth rejection from the provider marks it INVALID, so a new
 *     chat never defaults back to a dead key.
 *
 * Before this fix, Ask never called markKeyVerified/markKeyInvalid at all —
 * a stale/expired key looked exactly as good as a fresh one to the provider
 * resolver until the user opened Settings and clicked "Check" manually.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import type { RagHit } from '@/platform/utils/tauri-commands';

const h = vi.hoisted(() => ({
  retrieve: vi.fn<(...a: unknown[]) => Promise<unknown[]>>(),
  sendMessage: vi.fn(),
}));

vi.mock('@/i18n', () => ({ default: { t: (k: string) => k } }));

vi.mock('@/platform/matter/matterStore', () => ({
  useActiveMatter: () => null,
  SAMPLE_MATTER_ID: 'matter_sample_garcia_v_meridian',
}));

vi.mock('@/platform/fs/workspaceStore', () => {
  const wsState = { rootPath: '/workspace' };
  const useWorkspaceStore = (selector: (s: { rootPath: string | null }) => unknown) => selector(wsState);
  useWorkspaceStore.getState = () => wsState;
  return { useWorkspaceStore };
});

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
  const sessions: Record<string, unknown> = {};
  const hook = (selector: (s: unknown) => unknown) =>
    selector({
      initSession: vi.fn(),
      setSessionWorkspaceRoot: () => undefined,
      addMessage: vi.fn(),
      sessions,
    });
  hook.getState = () => ({
    initSession: vi.fn(),
    setSessionWorkspaceRoot: () => undefined,
    addMessage: vi.fn(),
    sessions,
  });
  return {
    useAIChatStore: hook,
    useFileAccessConsent: () => ({ state: 'granted', grantedScope: { kind: 'allMatters' } }),
    getFileAccessConsent: () => ({ state: 'granted', grantedScope: { kind: 'allMatters' } }),
  };
});

import { Ask } from '@/features/ask/Ask';
import { isKeyVerified, isKeyInvalid, clearKeyStatus } from '@/platform/providers/keyVerification';

async function askQuestion() {
  render(<Ask onAuditLog={() => undefined} />);
  fireEvent.change(screen.getByTestId('ask-composer-input'), {
    target: { value: 'When does the client want to retire?' },
  });
  fireEvent.click(screen.getByRole('button', { name: /^Ask$/i }));
}

describe('Ask keeps key-verification markers honest on send', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    // Clear ONLY the key-verification markers this suite asserts on. A full
    // localStorage.clear() would also wipe the global test-setup default
    // (tests/setup.ts) that marks the persisted confidentiality mode
    // 'direct' — the fail-closed cloud-send guard reads that raw key
    // directly, so losing it would block every send in this file with
    // LocalOnlyEgressError.
    clearKeyStatus('anthropic');
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
  });

  it('marks the provider VERIFIED after a successful send', async () => {
    h.sendMessage.mockResolvedValue({
      content: 'The client wants to retire in 2032 [client-note.docx paragraph 4].',
      usage: { inputTokens: 11, outputTokens: 7, totalTokens: 18 },
      cost: 0.0002,
      model: 'claude-audit-stub',
    });

    expect(isKeyVerified('anthropic')).toBe(false);
    await askQuestion();
    await waitFor(() => expect(h.sendMessage).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(isKeyVerified('anthropic')).toBe(true));
    expect(isKeyInvalid('anthropic')).toBe(false);
  });

  it('marks the provider INVALID after a 401 auth rejection', async () => {
    h.sendMessage.mockRejectedValue(new Error('401 Unauthorized: invalid_api_key'));

    await askQuestion();
    await waitFor(() => expect(h.sendMessage).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(isKeyInvalid('anthropic')).toBe(true));
    expect(isKeyVerified('anthropic')).toBe(false);
  });

  it('marks the provider INVALID after a 403 rejection (disabled/revoked/permission-denied key)', async () => {
    h.sendMessage.mockRejectedValue(new Error('403 Forbidden: PERMISSION_DENIED'));

    await askQuestion();
    await waitFor(() => expect(h.sendMessage).toHaveBeenCalledTimes(1));

    await waitFor(() => expect(isKeyInvalid('anthropic')).toBe(true));
    expect(isKeyVerified('anthropic')).toBe(false);
  });

  it('does NOT mark the provider invalid on a non-auth failure (e.g. a rate limit)', async () => {
    h.sendMessage.mockRejectedValue(new Error('429 rate limited'));

    await askQuestion();
    await waitFor(() => expect(h.sendMessage).toHaveBeenCalledTimes(1));

    // Give any (incorrect) marking a chance to land before asserting absence.
    await waitFor(() => expect(screen.getByTestId('ask-composer-input')).toBeInTheDocument());
    expect(isKeyInvalid('anthropic')).toBe(false);
    expect(isKeyVerified('anthropic')).toBe(false);
  });
});
