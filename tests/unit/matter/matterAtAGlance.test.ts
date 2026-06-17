/**
 * matterAtAGlance.test.ts
 *
 * Tests for the matter at-a-glance generator: retrieval scope + prompt,
 * JSON parsing, empty-result guards, and abort handling.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// Hoist mock send function so ClaudeProvider factory can reference it
const { mockSendMessage } = vi.hoisted(() => ({
  mockSendMessage: vi.fn(async () => ({
    content: JSON.stringify({
      openIssues: ['Lease dispute unresolved'],
      deadlines: ['Response due July 1'],
      nextActions: ['Request title search'],
    }),
    usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
    cost: 0,
    model: 'claude-3-haiku-20240307',
  })),
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
      if (provider === 'anthropic') return 'test-api-key';
      return null;
    }
  },
}));

// ── Provider mocks ────────────────────────────────────────────────────────────
vi.mock('@/platform/providers/ClaudeProvider', () => {
  const send = mockSendMessage;
  return {
    ClaudeProvider: class {
      sendMessage(...args: Parameters<typeof send>) { return send(...args); }
      structuredOutput() { return Promise.resolve({}); }
      getMetadata() { return { model: 'claude-3-haiku-20240307' }; }
      formatAttachmentForRequest() { return {}; }
      supportsAttachment() { return true; }
    },
  };
});

vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    sendMessage() { return Promise.resolve({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'gpt-4o-mini' }); }
    structuredOutput() { return Promise.resolve({}); }
    getMetadata() { return { model: 'gpt-4o-mini' }; }
    formatAttachmentForRequest() { return {}; }
    supportsAttachment() { return true; }
  },
}));

vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    sendMessage() { return Promise.resolve({ content: '', usage: { inputTokens: 0, outputTokens: 0, totalTokens: 0 }, cost: 0, model: 'gemini-pro' }); }
    structuredOutput() { return Promise.resolve({}); }
    getMetadata() { return { model: 'gemini-pro' }; }
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

// Import after mocks
import { generateMatterAtAGlance, hasCloudKeyForGlance, buildProviderForGlance } from '@/features/matters/logic/matterAtAGlance';
import { MemoryService, isMemoryEnabled } from '@/platform/rag/MemoryService';
import { buildWorkspaceContextBlock } from '@/platform/rag/workspaceCommand';

const mockRetrieve = vi.mocked(MemoryService.retrieve);
const mockIsMemoryEnabled = vi.mocked(isMemoryEnabled);
const mockBuildContext = vi.mocked(buildWorkspaceContextBlock);

// Fake hits
const fakeHits = [
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
        nextActions: ['Request title search'],
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: 0,
      model: 'claude-3-haiku-20240307',
    });
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
      'open issues deadlines next actions',
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
    expect(result.nextActions).toEqual(['Request title search']);
  });

  it('strips markdown fences before parsing', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    mockSendMessage.mockResolvedValue({
      content: '```json\n{"openIssues":["issue"],"deadlines":[],"nextActions":[]}\n```',
      usage: { inputTokens: 5, outputTokens: 10, totalTokens: 15 },
      cost: 0,
      model: 'claude-3-haiku-20240307',
    });
    const result = await generateMatterAtAGlance('matter_test_123');
    expect(result.openIssues).toEqual(['issue']);
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
    expect(result.nextActions).toEqual([]);
  });

  it('clamps each category to 3 items', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    mockSendMessage.mockResolvedValue({
      content: JSON.stringify({
        openIssues: ['a', 'b', 'c', 'd'],
        deadlines: ['e', 'f', 'g', 'h'],
        nextActions: ['i', 'j', 'k', 'l'],
      }),
      usage: { inputTokens: 10, outputTokens: 20, totalTokens: 30 },
      cost: 0,
      model: 'claude-3-haiku-20240307',
    });
    const result = await generateMatterAtAGlance('matter_test_123');
    expect(result.openIssues).toHaveLength(3);
    expect(result.deadlines).toHaveLength(3);
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
    expect(result.nextActions).toEqual([]);
  });

  it('includes a generatedAt ISO timestamp', async () => {
    mockRetrieve.mockResolvedValue(fakeHits);
    const result = await generateMatterAtAGlance('matter_test_123');
    expect(() => new Date(result.generatedAt)).not.toThrow();
    expect(result.generatedAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
  });
});

describe('hasCloudKeyForGlance', () => {
  it('returns true when an anthropic key exists', async () => {
    const result = await hasCloudKeyForGlance();
    expect(result).toBe(true);
  });
});

describe('buildProviderForGlance', () => {
  it('returns a provider instance', async () => {
    const provider = await buildProviderForGlance();
    expect(provider).toBeDefined();
    expect(typeof provider.sendMessage).toBe('function');
  });
});
