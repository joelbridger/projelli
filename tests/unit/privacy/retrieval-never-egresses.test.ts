/**
 * Regression lock: local retrieval/search/citation NEVER depends on the
 * cloud-generation choice gate.
 *
 * Invariant: MemoryService.retrieve goes through the local Tauri RAG command
 * only. It must NOT call assertCloudGenerationAllowed, must NOT construct any
 * cloud LLM provider, and must return retrieved hits successfully even when
 * choiceMade=false (the state that blocks cloud generation).
 *
 * This test proves the separation is enforced at the only entry point that
 * matters: MemoryService.retrieve itself.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ─── Shared mutable state (hoisted so vi.mock factories can close over it) ───

const h = vi.hoisted(() => ({
  choiceMade: false,
  firmActivated: false,
  cloudProviderConstructed: false,
  cloudSendCalled: false,
}));

// ─── Core privacy mocks (personal install, no choice made) ───────────────────

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => 'direct',
}));

vi.mock('@/platform/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      getSetting: (key: string) => {
        if (key === 'confidentialityChoiceMade') return h.choiceMade;
        if (key === 'confidentialityMode') return 'direct';
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

// ─── Cloud provider mocks: track construction + calls ────────────────────────
// Using the same pattern as cloud-generation-gated-paths.test.ts.

vi.mock('@/platform/providers/ClaudeProvider', () => {
  class ClaudeProvider {
    constructor() {
      h.cloudProviderConstructed = true;
    }
    sendMessage = vi.fn(async () => {
      h.cloudSendCalled = true;
      return { content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'claude-3' };
    });
    structuredOutput = vi.fn(async () => {
      h.cloudSendCalled = true;
      return {};
    });
    getMetadata() { return { name: 'Claude', model: 'claude-3', provider: 'anthropic' }; }
  }
  return {
    ClaudeProvider,
    createClaudeProvider: () => { h.cloudProviderConstructed = true; return new ClaudeProvider(); },
  };
});

vi.mock('@/platform/providers/OpenAIProvider', () => {
  class OpenAIProvider {
    constructor() {
      h.cloudProviderConstructed = true;
    }
    sendMessage = vi.fn(async () => {
      h.cloudSendCalled = true;
      return { content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'gpt-4o' };
    });
    structuredOutput = vi.fn(async () => {
      h.cloudSendCalled = true;
      return {};
    });
    getMetadata() { return { name: 'OpenAI', model: 'gpt-4o', provider: 'openai' }; }
  }
  return {
    OpenAIProvider,
    createOpenAIProvider: () => { h.cloudProviderConstructed = true; return new OpenAIProvider(); },
  };
});

vi.mock('@/platform/providers/GeminiProvider', () => {
  class GeminiProvider {
    constructor() {
      h.cloudProviderConstructed = true;
    }
    sendMessage = vi.fn(async () => {
      h.cloudSendCalled = true;
      return { content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'gemini-pro' };
    });
    structuredOutput = vi.fn(async () => {
      h.cloudSendCalled = true;
      return {};
    });
    getMetadata() { return { name: 'Gemini', model: 'gemini-pro', provider: 'google' }; }
  }
  return {
    GeminiProvider,
    createGeminiProvider: () => { h.cloudProviderConstructed = true; return new GeminiProvider(); },
  };
});

// ─── Local Tauri RAG command mock ─────────────────────────────────────────────
// Mock the underlying Tauri command layer so MemoryService.retrieve can run
// without native desktop deps. Return a realistic hit so we can assert the
// result came through cleanly.

const MOCK_HITS = [
  {
    path: 'matters/acme-v-rival/deposition-prep.docx',
    chunkText: 'The defendant admitted liability on page 47.',
    score: 0.91,
    paragraphIndex: 3,
    sourceType: 'docx' as const,
    matterId: 'matter-acme',
  },
  {
    path: 'matters/acme-v-rival/exhibits/exhibit-A.md',
    chunkText: 'Contract dated March 15, 2024.',
    score: 0.85,
    paragraphIndex: 0,
    sourceType: 'md' as const,
    matterId: 'matter-acme',
  },
];

vi.mock('@/platform/utils/tauri-commands', () => ({
  ragRetrieve: vi.fn(async () => MOCK_HITS),
  ragIndexFile: vi.fn(async () => {}),
  ragIndexWorkspace: vi.fn(async () => {}),
  ragCancelIndexing: vi.fn(async () => {}),
  ragDeletePath: vi.fn(async () => {}),
  ragSetWorkspace: vi.fn(async () => {}),
  ragRetagMatter: vi.fn(async () => 0),
  ragRetagPrivilege: vi.fn(async () => 0),
  ragIndexPdfChunks: vi.fn(async () => 0),
}));

// ─── Imports under test (after all mocks are in place) ───────────────────────

import * as tauri from '@/platform/utils/tauri-commands';
import {
  MemoryService,
  setMemoryEnabledReader,
  resetMemoryEnabledReader,
} from '@/platform/rag/MemoryService';

// ─── Helpers ─────────────────────────────────────────────────────────────────

function resetState() {
  h.choiceMade = false;
  h.firmActivated = false;
  h.cloudProviderConstructed = false;
  h.cloudSendCalled = false;
}

// ═════════════════════════════════════════════════════════════════════════════
// Core invariant: retrieval works when choiceMade=false (generation is blocked)
// ═════════════════════════════════════════════════════════════════════════════

describe('retrieval-never-egresses: personal install, choiceMade=false', () => {
  beforeEach(() => {
    resetState();
    resetMemoryEnabledReader();
    setMemoryEnabledReader(() => true);
    vi.clearAllMocks();
    // Re-set the mock so clearAllMocks does not remove its return value.
    (tauri.ragRetrieve as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_HITS);
  });

  afterEach(() => {
    resetMemoryEnabledReader();
  });

  it('returns retrieved hits successfully even though choiceMade=false', async () => {
    // This is THE core assertion: retrieval must not throw ConfidentialityChoiceRequiredError
    // and must return the local RAG results unchanged.
    const hits = await MemoryService.retrieve('liability admission', 5);
    expect(hits).toHaveLength(2);
    expect(hits[0]?.chunkText).toBe('The defendant admitted liability on page 47.');
    expect(hits[1]?.chunkText).toBe('Contract dated March 15, 2024.');
  });

  it('routes to the local Tauri command, not a cloud LLM', async () => {
    await MemoryService.retrieve('contract terms', 5);
    expect(tauri.ragRetrieve).toHaveBeenCalledTimes(1);
    expect(h.cloudProviderConstructed).toBe(false);
    expect(h.cloudSendCalled).toBe(false);
  });

  it('passes the query and topK to ragRetrieve with the default allMatters scope', async () => {
    await MemoryService.retrieve('deposition deadline', 10);
    expect(tauri.ragRetrieve).toHaveBeenCalledWith(
      'deposition deadline',
      10,
      { kind: 'allMatters' },
      false,
      undefined,
    );
  });

  it('passes an explicit matter scope through to ragRetrieve unchanged', async () => {
    await MemoryService.retrieve('motion to compel', 3, { kind: 'matter', matterId: 'matter-acme' });
    expect(tauri.ragRetrieve).toHaveBeenCalledWith(
      'motion to compel',
      3,
      { kind: 'matter', matterId: 'matter-acme' },
      false,
      undefined,
    );
  });

  it('never constructs ClaudeProvider, OpenAIProvider, or GeminiProvider during retrieval', async () => {
    await MemoryService.retrieve('privilege log', 5);
    expect(h.cloudProviderConstructed).toBe(false);
  });

  it('never calls cloud provider sendMessage or structuredOutput during retrieval', async () => {
    await MemoryService.retrieve('witness list', 5);
    expect(h.cloudSendCalled).toBe(false);
  });

  it('works with includePrivileged=true (still local, still not gated)', async () => {
    // Privileged-include is a local RAG filter flag, not a cloud path.
    await MemoryService.retrieve('privileged memo', 5, { kind: 'allMatters' }, true);
    expect(tauri.ragRetrieve).toHaveBeenCalledWith(
      'privileged memo',
      5,
      { kind: 'allMatters' },
      true,
      undefined,
    );
    expect(h.cloudProviderConstructed).toBe(false);
  });

  it('works with a perSourceCap (still local, still not gated)', async () => {
    await MemoryService.retrieve('exhibit list', 5, { kind: 'allMatters' }, false, 2);
    expect(tauri.ragRetrieve).toHaveBeenCalledWith(
      'exhibit list',
      5,
      { kind: 'allMatters' },
      false,
      2,
    );
    expect(h.cloudProviderConstructed).toBe(false);
  });

  it('short-circuits to [] for an empty query without touching any provider', async () => {
    const hits = await MemoryService.retrieve('   ', 5);
    expect(hits).toEqual([]);
    expect(tauri.ragRetrieve).not.toHaveBeenCalled();
    expect(h.cloudProviderConstructed).toBe(false);
  });

  it('short-circuits to [] when topK<=0 without touching any provider', async () => {
    const hits = await MemoryService.retrieve('contract', 0);
    expect(hits).toEqual([]);
    expect(tauri.ragRetrieve).not.toHaveBeenCalled();
    expect(h.cloudProviderConstructed).toBe(false);
  });
});

// ═════════════════════════════════════════════════════════════════════════════
// Same invariant holds across install types (firm, choice-made personal)
// ═════════════════════════════════════════════════════════════════════════════

describe('retrieval-never-egresses: invariant holds regardless of install type', () => {
  beforeEach(() => {
    resetState();
    resetMemoryEnabledReader();
    setMemoryEnabledReader(() => true);
    vi.clearAllMocks();
    (tauri.ragRetrieve as ReturnType<typeof vi.fn>).mockResolvedValue(MOCK_HITS);
  });

  afterEach(() => {
    resetMemoryEnabledReader();
  });

  it('retrieval still goes local when choiceMade=true (personal, cloud gen allowed)', async () => {
    h.choiceMade = true;
    const hits = await MemoryService.retrieve('summary judgment', 5);
    expect(hits).toHaveLength(2);
    expect(tauri.ragRetrieve).toHaveBeenCalledTimes(1);
    expect(h.cloudProviderConstructed).toBe(false);
  });

  it('retrieval still goes local on a firm install (cloud gen allowed for firms)', async () => {
    h.firmActivated = true;
    const hits = await MemoryService.retrieve('billing entries', 5);
    expect(hits).toHaveLength(2);
    expect(tauri.ragRetrieve).toHaveBeenCalledTimes(1);
    expect(h.cloudProviderConstructed).toBe(false);
  });
});
