/**
 * Phase A — Local-only race guard for the at-a-glance summary (auto-runs and
 * sends a client's context to the AI, so it is a high-risk egress path).
 *
 * buildResolvedProviderForGlance checks the mode only at its START, then awaits
 * keychain reads. This test simulates the user flipping to Local-only DURING
 * those awaits — a CLOUD provider gets resolved — and asserts the
 * immediately-before-send guard blocks the send so the client's context never
 * reaches the cloud.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';

const getKeyMock = vi.hoisted(() => vi.fn());
const claudeSend = vi.hoisted(() => vi.fn(async () => ({ content: '{}', usage: {}, cost: 0 })));
const ollamaSend = vi.hoisted(() => vi.fn(async () => ({ content: '{}', usage: {}, cost: 0 })));
const retrieveMock = vi.hoisted(() => vi.fn());

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: { retrieve: retrieveMock },
  isMemoryEnabled: () => true,
}));
vi.mock('@/platform/rag/workspaceCommand', () => ({
  DEFAULT_WORKSPACE_TOP_K: 6,
  buildWorkspaceContextBlock: () => '<ctx/>',
}));
vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: getKeyMock,
      hasKey: async (p: string) => Boolean(await getKeyMock(p)),
    };
  }),
}));
vi.mock('@/platform/providers/ClaudeProvider', () => ({
  // Must be a class (not an arrow) so `new ClaudeProvider()` works.
  ClaudeProvider: class {
    sendMessage = claudeSend;
    getMetadata() { return { model: 'claude-x', providerId: 'anthropic' }; }
  },
}));
vi.mock('@/platform/providers/OllamaProvider', () => ({
  OllamaProvider: class {
    sendMessage = ollamaSend;
    getMetadata() { return { model: 'ollama-x', providerId: 'ollama' }; }
  },
}));
// Firm context so the personal-install confidentiality-choice gate is a no-op —
// isolates the test to the LOCAL-ONLY race guard, not the choice gate.
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: { getState: () => ({ session: { activated: true } }) },
}));

import { generateMatterAtAGlance } from '@/platform/matter/matterAtAGlance';

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
  getKeyMock.mockReset();
  claudeSend.mockClear();
  ollamaSend.mockClear();
  retrieveMock.mockReset();
  retrieveMock.mockResolvedValue([
    { path: '/a.docx', chunkText: 'fact', score: 0.9, paragraphIndex: 0, id: '/a.docx#0', sourceId: '/a.docx', matterId: 'm1' },
  ]);
});

describe('generateMatterAtAGlance — Local-only race guard', () => {
  it('does NOT send to the cloud when the mode flips to Local-only mid-resolve', async () => {
    // Start NOT in Local-only so a cloud provider gets resolved...
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
    // ...then flip to Local-only DURING the keychain reads (the race window).
    getKeyMock.mockImplementation(async (p: string) => {
      useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
      return p === 'anthropic' ? 'sk-ant-test' : null;
    });

    await expect(generateMatterAtAGlance('m1')).rejects.toThrow(/Local AI only/i);
    // The load-bearing privacy assertion: the cloud provider was never sent to.
    expect(claudeSend).not.toHaveBeenCalled();
    expect(ollamaSend).not.toHaveBeenCalled();
  });

  it('runs locally (no cloud send) when Local-only is on the whole time', async () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    getKeyMock.mockResolvedValue('sk-ant-test'); // a cloud key exists but must be ignored
    await generateMatterAtAGlance('m1');
    // Local-only resolves to the on-device model and sends there, never the cloud.
    expect(claudeSend).not.toHaveBeenCalled();
    expect(ollamaSend).toHaveBeenCalledTimes(1);
  });
});
