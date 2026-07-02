/**
 * matterAtAGlance.test.ts
 *
 * Tests for the matter at-a-glance generator: retrieval scope + prompt,
 * JSON parsing, empty-result guards, and abort handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock send function so ClaudeProvider factory can reference it
const { mockSendMessage, keychainKeys } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(async () => ({
    content: JSON.stringify({
      openIssues: ['Lease dispute unresolved'],
      deadlines: ['Response due July 1'],
      upcomingDates: ['July 1 response deadline [Lease_Agreement.docx paragraph 2]'],
      nextActions: ['Request title search'],
    }),
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    cost: 0,
    model: 'claude-3-haiku-20240307',
  })),
  keychainKeys: {
    anthropic: 'test-api-key' as string | null,
    openai: null as string | null,
    google: null as string | null,
  },
}));

// ── MemoryService mock ───────────────────────────────────────────────────────
vi.mock('@/platform/rag/MemoryService', () => ({
  MemoryService: {
    retrieve: vi.fn(async () => []),
  },
  isMemoryEnabled: vi.fn(() => true),
}));

// ── workspaceCommand mock ─────────────────────────────────────────────────────
vi.mock('@/platform/rag/workspaceCommand', () => ({
  buildWorkspaceContextBlock: vi.fn((hits: unknown[]) =>
    hits.length === 0 ? '' : '<workspace_context>mock context</workspace_context>',
  ),
}));

// ── KeychainService mock ──────────────────────────────────────────────────────
vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: class {
    async getKey(provider: string) {
      return keychainKeys[provider as keyof typeof keychainKeys] ?? null;
    }
    async hasKey(provider: string) {
      return Boolean(await this.getKey(provider));
    }
  },
}));

// ── Provider mocks ────────────────────────────────────────────────────────────
vi.mock('@/platform/providers/ClaudeProvider', () => {
  const send = mockSendMessage;
  return {
    ClaudeProvider: class {
      private readonly model: string | undefined;
      constructor(config: { model?: string }) { this.model = config.model; }
      sendMessage(...args: Parameters<typeof send>) { return send(...args); }
      structuredOutput() { return Promise.resolve({}); }
      getMetadata() { return { model: this.model ?? 'claude-default' }; }
      formatAttachmentForRequest() { return {}; }
      supportsAttachment() { return true; }
    },
  };
});

vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    private readonly model: string | undefined;
    constructor(config: { model?: string }) { this.model = config.model; }
    sendMessage() { return Promise.resolve({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'gpt-4o-mini' }); }
    structuredOutput() { return Promise.resolve({}); }
    getMetadata() { return { model: this.model ?? 'openai-default' }; }
    formatAttachmentForRequest() { return {}; }
    supportsAttachment() { return true; }
  },
}));

vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    private readonly model: string | undefined;
    constructor(config: { model?: string }) { this.model = config.model; }
    sendMessage() { return Promise.resolve({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'gemini-pro' }); }
    structuredOutput() { return Promise.resolve({}); }
    getMetadata() { return { model: this.model ?? 'gemini-default' }; }
    formatAttachmentForRequest() { return {}; }
    supportsAttachment() { return true; }
  },
}));

vi.mock('@/platform/providers/OllamaProvider', () => ({
  OllamaProvider: class {
    sendMessage() { return Promise.resolve({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'llama3' }); }
    structuredOutput() { return Promise.resolve({}); }
    getMetadata() { return { model: 'llama3' }; }
    formatAttachmentForRequest() { return {}; }
    supportsAttachment() { return true; }
  },
}));

// Confidentiality mode — controllable for the Local-only enforcement test (A1).
const cmode = vi.hoisted(() => {
  let _mode = 'direct';
  return {
    // Getter/setter: assigning `mode` drives BOTH the mocked getConfidentialityMode
    // AND the raw persisted localStorage value the fail-closed cloud-send guard reads.
    get mode() { return _mode; },
    set mode(m: string) {
      _mode = m;
      try {
        localStorage.setItem(
          'lantern:settings',
          JSON.stringify({ state: { values: { confidentialityMode: m } }, version: 1 }),
        );
      } catch {
        /* localStorage unavailable */
      }
    },
  };
});
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => cmode.mode,
}));

// The personal-install choice gate (Task 1.3) lives in localOnlyGuard.
// Stub assertCloudGenerationAllowed as a no-op here — these tests focus on
// provider selection logic, not the confidentiality gate.
vi.mock('@/platform/privacy/localOnlyGuard', async (orig) => {
  const real = await orig<typeof import('@/platform/privacy/localOnlyGuard')>();
  return {
    ...real,
    assertCloudGenerationAllowed: vi.fn(),
  };
});

// Import after mocks
import {
  deriveMatterHubUpcomingItems,
  generateMatterAtAGlance,
  hasCloudKeyForGlance,
  buildProviderForGlance,
  stripAtAGlanceCitationMarkers,
} from '@/platform/matter/matterAtAGlance';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';
import type { AuditEntry } from '@/platform/types/audit';
import type { RagHit } from '@/platform/utils/tauri-commands';

const mockRetrieve = vi.mocked(MemoryService.retrieve);
const mockIsMemoryEnabled = vi.mocked(isMemoryEnabled);
const mockBuildContext = vi.mocked(buildWorkspaceContextBlock);

// Fake hits
const fakeHits: RagHit[] = [
  {
    path: 'Lease_Agreement.docx',
    chunkText: 'The tenant disputes habitability.',
    score: 0.9,
    paragraphIndex: 2,
    sourceType: 'docx',
    matterId: 'matter_test_123',
  },
];

describe('generateMatterAtAGlance', () => {
  beforeEach(() => {
    mockRetrieve.mockResolvedValue([]);
    mockIsMemoryEnabled.mockReturnValue(true);
    mockSendMessage.mockResolvedValue({
      content: JSON.stringify({
        openIssues: ['Lease dispute unresolved'],
        deadlines: ['Response due July 1'],
        upcomingDates: ['July 1 response deadline [Lease_Agreement.docx paragraph 2]'],
        nextActions: ['Request title search'],
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: 0,
      model: 'claude-3-haiku-20240307',
    });
    keychainKeys.anthropic = 'test-api-key';
    keychainKeys.openai = null;
    keychainKeys.google = null;
    localStorage.clear();
    cmode.mode = 'direct'; // persist 'direct' (post-clear) for the fail-closed guard
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it('throws when memory is disabled', async () => {
    mockIsMemoryEnabled.mockReturnValue(false);
    await expect(generateMatterAtAGlance('matter_test_123')).rejects.toThrow('Memory is disabled');
  });

  it('retrieves with the correct matter scope', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    await generateMatterAtAGlance('matter_abc');
    expect(mockRetrieve).toHaveBeenCalledWith(
      'open issues deadlines upcoming dates scheduled reviews meetings next actions',
      6,
      { kind: 'matter', matterId: 'matter_abc' },
      false,
    );
  });

  it('returns empty arrays when no content is indexed', async () => {
    mockRetrieve.mockResolvedValue([]);
    const result = await generateMatterAtAGlance('matter_test_123');
    expect(result.openIssues).toEqual([]);
    expect(result.deadlines).toEqual([]);
    expect(result.upcomingDates).toEqual([]);
    expect(result.nextActions).toEqual([]);
    expect(result.generatedAt).toBeTruthy();
  });

  it('calls buildWorkspaceContextBlock with the retrieved hits', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    await generateMatterAtAGlance('matter_test_123');
    expect(mockBuildContext).toHaveBeenCalledWith(fakeHits);
  });

  it('parses a valid JSON response into structured arrays', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    const result = await generateMatterAtAGlance('matter_test_123');
    expect(result.openIssues).toEqual(['Lease dispute unresolved']);
    expect(result.deadlines).toEqual(['Response due July 1']);
    expect(result.upcomingDates).toEqual(['July 1 response deadline']);
    expect(result.nextActions).toEqual(['Request title search']);
  });

  it('logs retrieval, egress, and model_call when an audit sink is provided', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    const logged: Array<Omit<AuditEntry, 'id' | 'timestamp'>> = [];

    await generateMatterAtAGlance('matter_test_123', {
      onAuditLog: (entry) => logged.push(entry),
    });

    expect(logged.filter((entry) => entry.metadata['auditEventType'] === 'retrieval_executed')).toHaveLength(1);
    expect(logged.filter((entry) => entry.metadata['auditEventType'] === 'egress')).toHaveLength(1);
    expect(logged.filter((entry) => entry.action === 'model_call')).toHaveLength(1);
    expect(logged.find((entry) => entry.action === 'model_call')).toMatchObject({
      model: 'claude-sonnet-4-6',
      provider: 'anthropic',
      tokensIn: 10,
      tokensOut: 20,
    });
  });

  it('strips markdown fences before parsing', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    mockSendMessage.mockResolvedValue({
      content: '```json\n{"openIssues":["issue"],"deadlines":[],"upcomingDates":["May board meeting [notes.docx paragraph 4]"],"nextActions":[]}\n```',
      usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      cost: 0,
      model: 'claude-3-haiku-20240307',
    });
    const result = await generateMatterAtAGlance('matter_test_123');
    expect(result.openIssues).toEqual(['issue']);
    expect(result.upcomingDates).toEqual(['May board meeting']);
  });

  it('strips raw citation markers from every display category', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    mockSendMessage.mockResolvedValue({
      content: JSON.stringify({
        openIssues: ['Cash-flow question remains open [2 page 6]'],
        deadlines: ['Review meeting on July 12 [3 p. 12]'],
        upcomingDates: ['RMD review due August 1 [plan.pdf paragraph 8]'],
        nextActions: ['Ask for updated beneficiary form [4]'],
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: 0,
      model: 'claude-3-haiku-20240307',
    });

    const result = await generateMatterAtAGlance('matter_test_123');

    expect(result.openIssues).toEqual(['Cash-flow question remains open']);
    expect(result.deadlines).toEqual(['Review meeting on July 12']);
    expect(result.upcomingDates).toEqual(['RMD review due August 1']);
    expect(result.nextActions).toEqual(['Ask for updated beneficiary form']);
  });

  it('returns empty arrays on malformed JSON response', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    mockSendMessage.mockResolvedValue({
      content: 'Not valid JSON at all.',
      usage: { inputTokens: 5, outputTokens: 5, totalTokens: 10 },
      cost: 0,
      model: 'claude-3-haiku-20240307',
    });
    const result = await generateMatterAtAGlance('matter_test_123');
    expect(result.openIssues).toEqual([]);
    expect(result.deadlines).toEqual([]);
    expect(result.upcomingDates).toEqual([]);
    expect(result.nextActions).toEqual([]);
  });

  it('clamps each category to 3 items', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    mockSendMessage.mockResolvedValue({
      content: JSON.stringify({
        openIssues: ['a', 'b', 'c', 'd'],
        deadlines: ['e', 'f', 'g', 'h'],
        upcomingDates: ['u1', 'u2', 'u3', 'u4'],
        nextActions: ['i', 'j', 'k', 'l'],
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: 0,
      model: 'claude-3-haiku-20240307',
    });
    const result = await generateMatterAtAGlance('matter_test_123');
    expect(result.openIssues).toHaveLength(3);
    expect(result.deadlines).toHaveLength(3);
    expect(result.upcomingDates).toHaveLength(3);
    expect(result.nextActions).toHaveLength(3);
  });

  it('returns empty result when aborted before response', async () => {
    const abort = new AbortController();
    // Make retrieve take a tick so we can abort before the provider call
    mockRetrieve.mockImplementation(async () => {
      abort.abort();
      return fakeHits;
    });
    const result = await generateMatterAtAGlance('matter_test_123', { signal: abort.signal });
    expect(result.openIssues).toEqual([]);
    expect(result.deadlines).toEqual([]);
    expect(result.upcomingDates).toEqual([]);
    expect(result.nextActions).toEqual([]);
  });

  it('includes a generatedAt ISO timestamp', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    const result = await generateMatterAtAGlance('matter_test_123');
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('matter hub at-a-glance display helpers', () => {
  it('strips page-style citation markers without removing normal bracketed words', () => {
    expect(stripAtAGlanceCitationMarkers('Follow up by Friday [2 page 6]')).toBe('Follow up by Friday');
    expect(stripAtAGlanceCitationMarkers('Review IPS [notes.docx paragraph 4]')).toBe('Review IPS');
    expect(stripAtAGlanceCitationMarkers('Keep [draft] label')).toBe('Keep [draft] label');
  });

  it('uses Client Map upcoming items before falling back to at-a-glance dates', () => {
    const result = {
      openIssues: [],
      deadlines: ['Fallback deadline on July 15 [2 page 6]'],
      upcomingDates: [],
      nextActions: [],
      generatedAt: '2026-06-24T00:00:00Z',
    };
    const map = {
      matterId: 'matter_test_123',
      sections: [
        {
          id: 'followups',
          kind: 'core' as const,
          key: 'followups',
          title: 'Follow-ups',
          items: [
            {
              id: 'u1',
              text: 'Annual review scheduled for July 8 [3 page 2]',
              origin: 'ai' as const,
              isAssumption: false,
              sources: [],
              updatedAt: '2026-06-24T00:00:00Z',
            },
          ],
        },
      ],
      completeness: { level: 'thin' as const, know: [], assuming: [], ask: [] },
      pendingUpdates: [],
      lastBuiltAt: '2026-06-24T00:00:00Z',
      lastSourceFingerprint: 'fp',
    };

    expect(deriveMatterHubUpcomingItems(result, map)).toEqual([
      'Annual review scheduled for July 8',
      'Fallback deadline on July 15',
    ]);
  });

  it('falls back to deadlines when the dedicated upcoming list is missing', () => {
    const result = {
      openIssues: [],
      deadlines: ['Tax estimate due September 15 [5 page 1]'],
      nextActions: [],
      generatedAt: '2026-06-24T00:00:00Z',
    };

    expect(deriveMatterHubUpcomingItems(result)).toEqual(['Tax estimate due September 15']);
  });
});

describe('hasCloudKeyForGlance', () => {
  it('returns true when an anthropic key exists', async () => {
    const result = await hasCloudKeyForGlance();
    expect(result).toBe(true);
  });
});

describe('buildProviderForGlance', () => {
  beforeEach(() => {
    cmode.mode = 'direct';
    keychainKeys.anthropic = 'test-api-key';
    keychainKeys.openai = null;
    keychainKeys.google = null;
    localStorage.clear();
    cmode.mode = 'direct'; // persist 'direct' (post-clear) for the fail-closed guard
  });
  afterEach(() => { cmode.mode = 'direct'; });

  it('returns a provider instance', async () => {
    const provider = await buildProviderForGlance();
    expect(provider).toBeDefined();
    expect(typeof provider.sendMessage).toBe('function');
  });

  it('uses the cloud provider when a key exists and NOT in local-only mode', async () => {
    cmode.mode = 'direct';
    const provider = await buildProviderForGlance();
    expect(provider.getMetadata().model).toBe('claude-sonnet-4-6');
  });

  it('honors the OpenAI default provider and model instead of Anthropic key order', async () => {
    cmode.mode = 'direct';
    keychainKeys.anthropic = 'stale-anthropic';
    keychainKeys.openai = 'valid-openai';
    localStorage.setItem('lantern_default_provider', 'openai');
    localStorage.setItem('lantern_default_model', 'gpt-4o');

    const provider = await buildProviderForGlance();

    expect(provider.getMetadata().model).toBe('gpt-4o');
  });

  it('forces the LOCAL model in local-only mode even with a cloud key (A1, privacy)', async () => {
    cmode.mode = 'local-only';
    const provider = await buildProviderForGlance();
    // The auto-running at-a-glance summary must never send matter context to the
    // cloud in Local-only mode.
    expect(provider.getMetadata().model).toBe('llama3');
  });
});
