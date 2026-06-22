/**
 * Task 1.3 FIX — Behavioral tests: every cloud-generation path is gated
 * before reaching a cloud AI provider on a personal install with no choice made.
 *
 * Strategy: For each path, verify the gate throws (or returns null) when
 * choiceMade=false on a personal install before any provider is constructed or
 * any network call is made. Also verify the gate is a no-op when choiceMade=true
 * (personal) or isFirm=true.
 *
 * Paths covered:
 *   1. matter at-a-glance (buildProviderForGlance / generateMatterAtAGlance)
 *   2. email "Draft with AI" (buildProviderAsync in EmailViewer)
 *   3. inline AI edit (resolveInlineEditProvider — returns null, not throws)
 *   4. word redline, workflow generation, chat compression, auto fact-extraction:
 *      tested via the gate function itself (assertCloudGenerationAllowed), since
 *      those paths live in hooks/components that are impractical to mount in
 *      a pure unit test. The gate is the shared enforcement mechanism.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ConfidentialityChoiceRequiredError } from '@/platform/privacy/localOnlyGuard';

// ─── Shared mutable state (hoisted above vi.mock factories) ──────────────────

const h = vi.hoisted(() => ({
  mode: 'direct' as string,
  choiceMade: false,
  firmActivated: false,
  anthropicKey: null as string | null,
  openaiKey: null as string | null,
  googleKey: null as string | null,
  sendMessageCalled: false,
}));

// ─── Core privacy mocks ───────────────────────────────────────────────────────

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => h.mode,
}));

vi.mock('@/platform/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      getSetting: (key: string) => {
        if (key === 'confidentialityChoiceMade') return h.choiceMade;
        if (key === 'confidentialityMode') return h.mode;
        return undefined;
      },
    }),
  },
}));

vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: {
    getState: () => ({
      session: h.firmActivated ? { activated: true } : null,
    }),
  },
}));

// ─── Cloud provider mocks — classes defined INSIDE factory (vi.mock hoists) ──

vi.mock('@/platform/providers/ClaudeProvider', () => {
  class ClaudeProvider {
    sendMessage = vi.fn(async () => { h.sendMessageCalled = true; return { content: '{}', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'claude-3' }; });
    structuredOutput = vi.fn(async () => { h.sendMessageCalled = true; return {}; });
    getMetadata() { return { name: 'Claude', model: 'claude-3', provider: 'anthropic' }; }
    isConfigured() { return true; }
    formatAttachmentForRequest() { return {}; }
    supportsAttachment() { return false; }
  }
  return {
    ClaudeProvider,
    createClaudeProvider: (_opts: object) => new ClaudeProvider(),
  };
});

vi.mock('@/platform/providers/OpenAIProvider', () => {
  class OpenAIProvider {
    sendMessage = vi.fn(async () => { h.sendMessageCalled = true; return { content: '{}', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'gpt-4o' }; });
    structuredOutput = vi.fn(async () => { h.sendMessageCalled = true; return {}; });
    getMetadata() { return { name: 'OpenAI', model: 'gpt-4o', provider: 'openai' }; }
    isConfigured() { return true; }
    formatAttachmentForRequest() { return {}; }
    supportsAttachment() { return false; }
  }
  return {
    OpenAIProvider,
    createOpenAIProvider: (_opts: object) => new OpenAIProvider(),
  };
});

vi.mock('@/platform/providers/GeminiProvider', () => {
  class GeminiProvider {
    sendMessage = vi.fn(async () => { h.sendMessageCalled = true; return { content: '{}', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'gemini-pro' }; });
    structuredOutput = vi.fn(async () => { h.sendMessageCalled = true; return {}; });
    getMetadata() { return { name: 'Gemini', model: 'gemini-pro', provider: 'google' }; }
    isConfigured() { return true; }
    formatAttachmentForRequest() { return {}; }
    supportsAttachment() { return false; }
  }
  return {
    GeminiProvider,
    createGeminiProvider: (_opts: object) => new GeminiProvider(),
  };
});

vi.mock('@/platform/providers/OllamaProvider', () => {
  class OllamaProvider {
    sendMessage = vi.fn(async () => ({ content: '{}', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'llama3' }));
    structuredOutput = vi.fn(async () => ({}));
    getMetadata() { return { name: 'Ollama', model: 'llama3', provider: 'ollama' }; }
    isConfigured() { return true; }
    formatAttachmentForRequest() { return {}; }
    supportsAttachment() { return false; }
  }
  return {
    OllamaProvider,
    OLLAMA_DEFAULT_MODEL: 'llama3:latest',
    detectOllama: vi.fn(async () => ({ reachable: true, models: ['llama3:latest'] })),
  };
});

// ─── Keychain mock ────────────────────────────────────────────────────────────

vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: class {
    async getKey(provider: string) {
      if (provider === 'anthropic') return h.anthropicKey;
      if (provider === 'openai') return h.openaiKey;
      if (provider === 'google') return h.googleKey;
      return null;
    }
  },
  createKeychainService: () => ({
    async getKey(provider: string) {
      if (provider === 'anthropic') return h.anthropicKey;
      if (provider === 'openai') return h.openaiKey;
      if (provider === 'google') return h.googleKey;
      return null;
    },
  }),
}));

// ─── RAG / MemoryService mock (for matter at-a-glance) ───────────────────────

vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: {
    retrieve: vi.fn(async () => [
      { path: 'case-notes.docx', chunkText: 'Deadline: June 30.', score: 0.9, paragraphIndex: 0, sourceType: 'docx', matterId: 'matter-1' },
    ]),
  },
  isMemoryEnabled: vi.fn(() => true),
}));

vi.mock('@/platform/rag/workspaceCommand', () => ({
  buildWorkspaceContextBlock: vi.fn(() => '<workspace_context>mock</workspace_context>'),
}));

// ─── Imports under test (after mocks) ────────────────────────────────────────

import { buildProviderForGlance, generateMatterAtAGlance } from '@/platform/matter/matterAtAGlance';
import { buildProviderAsync } from '@/features/email/EmailViewer';
import { resolveInlineEditProvider } from '@/app/shell/layout/resolveInlineEditProvider';
import { assertCloudGenerationAllowed } from '@/platform/privacy/localOnlyGuard';

// ─── Helpers ──────────────────────────────────────────────────────────────────

function resetState() {
  h.mode = 'direct';
  h.choiceMade = false;
  h.firmActivated = false;
  h.anthropicKey = null;
  h.openaiKey = null;
  h.googleKey = null;
  h.sendMessageCalled = false;
}

// ═══════════════════════════════════════════════════════════════════════════════
// 1. Matter at-a-glance — buildProviderForGlance
// ═══════════════════════════════════════════════════════════════════════════════

describe('matter at-a-glance — cloud gated on personal install without choice', () => {
  beforeEach(resetState);
  afterEach(() => vi.clearAllMocks());

  it('throws ConfidentialityChoiceRequiredError when choiceMade=false (no cloud keys)', async () => {
    // Gate fires before key lookup — even with no keys, the gate must throw
    await expect(buildProviderForGlance()).rejects.toThrow(ConfidentialityChoiceRequiredError);
  });

  it('throws when choiceMade=false and cloud key is available — no cloud provider constructed', async () => {
    h.anthropicKey = 'sk-test-key';
    await expect(buildProviderForGlance()).rejects.toThrow(ConfidentialityChoiceRequiredError);
    // The gate fires before new ClaudeProvider(...) so sendMessage is never reached
    expect(h.sendMessageCalled).toBe(false);
  });

  it('ALLOWS cloud generation on personal install once choice is made', async () => {
    h.choiceMade = true;
    h.anthropicKey = 'sk-test-key';
    const provider = await buildProviderForGlance();
    expect(provider).toBeDefined();
    expect(provider.getMetadata().name).toMatch(/Claude/i);
  });

  it('ALLOWS Ollama fallback on personal install once choice is made (no cloud keys)', async () => {
    h.choiceMade = true;
    const provider = await buildProviderForGlance();
    expect(provider).toBeDefined();
    expect(provider.getMetadata().model).toBe('llama3');
  });

  it('ALLOWS cloud generation on a firm install even when choiceMade=false', async () => {
    h.firmActivated = true;
    h.choiceMade = false;
    h.anthropicKey = 'sk-test-key';
    const provider = await buildProviderForGlance();
    expect(provider).toBeDefined();
    expect(provider.getMetadata().name).toMatch(/Claude/i);
  });

  it('Local-only mode returns Ollama before the gate fires (no gate for local)', async () => {
    h.mode = 'local-only';
    const provider = await buildProviderForGlance();
    expect(provider.getMetadata().model).toBe('llama3');
  });

  it('generateMatterAtAGlance does NOT reach cloud AI when choiceMade=false', async () => {
    h.anthropicKey = 'sk-test-key';
    await expect(generateMatterAtAGlance('matter-1')).rejects.toThrow(
      ConfidentialityChoiceRequiredError,
    );
    expect(h.sendMessageCalled).toBe(false);
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 2. Email "Draft with AI" — buildProviderAsync (exported for testing)
// ═══════════════════════════════════════════════════════════════════════════════

describe('email Draft-with-AI — cloud gated on personal install without choice', () => {
  beforeEach(resetState);
  afterEach(() => vi.clearAllMocks());

  it('throws ConfidentialityChoiceRequiredError when choiceMade=false', async () => {
    await expect(buildProviderAsync()).rejects.toThrow(ConfidentialityChoiceRequiredError);
  });

  it('throws even when a cloud key is present — gate fires before key lookup', async () => {
    h.anthropicKey = 'sk-test-key';
    await expect(buildProviderAsync()).rejects.toThrow(ConfidentialityChoiceRequiredError);
    expect(h.sendMessageCalled).toBe(false);
  });

  it('ALLOWS cloud generation on personal install once choice is made', async () => {
    h.choiceMade = true;
    h.anthropicKey = 'sk-test-key';
    const provider = await buildProviderAsync();
    expect(provider).toBeDefined();
  });

  it('ALLOWS cloud generation on firm install regardless of choiceMade', async () => {
    h.firmActivated = true;
    h.choiceMade = false;
    h.anthropicKey = 'sk-test-key';
    const provider = await buildProviderAsync();
    expect(provider).toBeDefined();
  });

  it('Local-only mode returns Ollama before the gate fires', async () => {
    h.mode = 'local-only';
    const provider = await buildProviderAsync();
    expect(provider.getMetadata().model).toBe('llama3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 3. Inline AI edit — resolveInlineEditProvider (returns null, not throws)
// ═══════════════════════════════════════════════════════════════════════════════

describe('inline AI edit — cloud gated on personal install without choice', () => {
  beforeEach(resetState);
  afterEach(() => vi.clearAllMocks());

  it('returns null (clean no-op) when choiceMade=false and anthropic provider is resolved', () => {
    const result = resolveInlineEditProvider({
      provider: 'anthropic',
      apiKeys: [{ provider: 'anthropic', key: 'sk-test', isValid: true }],
    });
    expect(result).toBeNull();
  });

  it('returns null for openai when choiceMade=false', () => {
    const result = resolveInlineEditProvider({
      provider: 'openai',
      apiKeys: [{ provider: 'openai', key: 'sk-test', isValid: true }],
    });
    expect(result).toBeNull();
  });

  it('returns null for google when choiceMade=false', () => {
    const result = resolveInlineEditProvider({
      provider: 'google',
      apiKeys: [{ provider: 'google', key: 'key-test', isValid: true }],
    });
    expect(result).toBeNull();
  });

  it('returns a provider when choiceMade=true (personal install, choice made)', () => {
    h.choiceMade = true;
    const result = resolveInlineEditProvider({
      provider: 'anthropic',
      apiKeys: [{ provider: 'anthropic', key: 'sk-test', isValid: true }],
    });
    expect(result).not.toBeNull();
  });

  it('returns a provider for firm install even when choiceMade=false', () => {
    h.firmActivated = true;
    const result = resolveInlineEditProvider({
      provider: 'anthropic',
      apiKeys: [{ provider: 'anthropic', key: 'sk-test', isValid: true }],
    });
    expect(result).not.toBeNull();
  });

  it('ALWAYS allows local (Ollama) provider regardless of choice', () => {
    h.choiceMade = false;
    const result = resolveInlineEditProvider({
      provider: 'ollama',
      apiKeys: [],
    });
    expect(result).not.toBeNull();
    expect(result?.getMetadata().model).toBe('llama3');
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 4. Gate function correctness — shared by redline, workflow, compression,
//    and auto fact-extraction paths (all call assertCloudGenerationAllowed)
//
// These paths live in hooks/components that are impractical to fully mount in
// a unit test without React/Tauri infrastructure. We verify the gate function
// itself enforces the invariant, since each of those sites now calls it directly.
// ═══════════════════════════════════════════════════════════════════════════════

describe('assertCloudGenerationAllowed — gate used by redline, workflow, compression, fact-extraction', () => {
  beforeEach(resetState);

  it('throws ConfidentialityChoiceRequiredError for personal install without choice', () => {
    expect(() => assertCloudGenerationAllowed()).toThrow(ConfidentialityChoiceRequiredError);
  });

  it('throws for any named cloud provider (anthropic, openai, google)', () => {
    expect(() => assertCloudGenerationAllowed('anthropic')).toThrow(ConfidentialityChoiceRequiredError);
    expect(() => assertCloudGenerationAllowed('openai')).toThrow(ConfidentialityChoiceRequiredError);
    expect(() => assertCloudGenerationAllowed('google')).toThrow(ConfidentialityChoiceRequiredError);
  });

  it('is a no-op for local (ollama) — local generation is never gated', () => {
    expect(() => assertCloudGenerationAllowed('ollama')).not.toThrow();
  });

  it('is a no-op once choice is made on a personal install (direct mode)', () => {
    h.choiceMade = true;
    expect(() => assertCloudGenerationAllowed()).not.toThrow();
    expect(() => assertCloudGenerationAllowed('anthropic')).not.toThrow();
  });

  it('is a no-op for firm installs regardless of choiceMade', () => {
    h.firmActivated = true;
    h.choiceMade = false;
    expect(() => assertCloudGenerationAllowed()).not.toThrow();
  });
});

// ═══════════════════════════════════════════════════════════════════════════════
// 5. Robustness: choiceMade must be strictly === true (not just truthy)
//    (localOnlyGuard.ts:97 was changed from Boolean(...) to === true)
// ═══════════════════════════════════════════════════════════════════════════════

describe('robustness — strict === true check on choiceMade', () => {
  beforeEach(resetState);
  afterEach(() => vi.clearAllMocks());

  it('boolean false is not a valid choice — gate throws', () => {
    h.choiceMade = false;
    expect(() => assertCloudGenerationAllowed()).toThrow(ConfidentialityChoiceRequiredError);
  });

  it('boolean true is the only valid choice — gate passes', () => {
    h.choiceMade = true;
    expect(() => assertCloudGenerationAllowed()).not.toThrow();
  });
});
