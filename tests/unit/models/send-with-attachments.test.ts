/**
 * Stream A1 — Send-path wiring tests.
 *
 * Verifies that when attachmentBytes are passed to sendMessage /
 * sendMessageStreaming, each provider includes the correct image content
 * block in the outgoing API envelope.
 *
 * We mock globalThis.fetch to capture request bodies without hitting real
 * APIs. Each test asserts on what was actually sent to fetch(), not just on
 * the provider's internal state.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';
import { OllamaProvider } from '@/platform/providers/OllamaProvider';
import { MockProvider } from '@/platform/providers/MockProvider';
import type { ChatAttachment } from '@/platform/types/ai';
import { useDirectModeForTests } from '../../helpers/cloudModeForTests';

// These tests send via real cloud providers — opt into a non-private mode so the
// fail-closed cloud-send guard lets the send through.
useDirectModeForTests();

// Minimal 1x1 PNG bytes (enough that base64 isn't empty)
const PNG_BYTES = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const PNG_BASE64 = btoa(String.fromCharCode(...PNG_BYTES));

const imageAtt: ChatAttachment = {
  id: 'abc123',
  type: 'image',
  mimeType: 'image/png',
  fileName: 'test.png',
  pathInWorkspace: 'media/2026-04/chat-image-abc123.png',
  byteSize: PNG_BYTES.length,
  metadata: {},
};

const attachmentBytes = [{ att: imageAtt, bytes: PNG_BYTES }];

/** Build a stub Response that makeRequest / sendMessage will accept. */
function makeJsonResponse(body: unknown, ok = true): Response {
  const json = JSON.stringify(body);
  return new Response(json, {
    status: ok ? 200 : 400,
    headers: { 'content-type': 'application/json' },
  });
}

// ─────────────────────────────────────────────────────────
// ClaudeProvider
// ─────────────────────────────────────────────────────────

describe('ClaudeProvider sendMessage with attachmentBytes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Stub import.meta.env.DEV so getAnthropicBaseUrl doesn't try the proxy
    // (it would hit the real server in test environment).
    // ClaudeProvider uses getCorsSafeFetch which resolves to globalThis.fetch.
    fetchMock.mockResolvedValue(
      makeJsonResponse({
        id: 'msg_test',
        type: 'message',
        role: 'assistant',
        content: [{ type: 'text', text: 'I see the image.' }],
        model: 'claude-3-5-sonnet-20241022',
        stop_reason: 'end_turn',
        usage: { input_tokens: 100, output_tokens: 20 },
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks an unscannable image before the cloud request', async () => {
    const provider = new ClaudeProvider({ apiKey: 'test-key', model: 'claude-3-5-sonnet-20241022' });

    await expect(provider.sendMessage('Describe this image.', { attachmentBytes }))
      .rejects.toThrow('unscannable_attachment');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to plain string content when no attachmentBytes provided', async () => {
    const provider = new ClaudeProvider({ apiKey: 'test-key', model: 'claude-3-5-sonnet-20241022' });

    await provider.sendMessage('Hello', {});

    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    // No attachments → content stays as a plain string
    expect(body.messages[0].content).toBe('Hello');
  });
});

describe('ClaudeProvider sendMessageStreaming with attachmentBytes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Build a minimal SSE stream with message_start + content_block_delta + message_delta
    const sseLines = [
      'data: {"type":"message_start","message":{"usage":{"input_tokens":50}}}',
      'data: {"type":"content_block_delta","delta":{"type":"text_delta","text":"ok"}}',
      'data: {"type":"message_delta","delta":{"stop_reason":"end_turn"},"usage":{"output_tokens":5}}',
      'data: [DONE]',
      '',
    ].join('\n');

    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(sseLines));
        controller.close();
      },
    });
    const response = new Response(readable, { status: 200 });
    fetchMock.mockResolvedValue(response);
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks an unscannable image before the streaming cloud request', async () => {
    const provider = new ClaudeProvider({ apiKey: 'test-key', model: 'claude-3-5-sonnet-20241022' });

    await expect(provider.sendMessageStreaming('Describe this image.', {
      onChunk: () => {},
      attachmentBytes,
    })).rejects.toThrow('unscannable_attachment');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────
// OpenAIProvider
// ─────────────────────────────────────────────────────────

describe('OpenAIProvider sendMessage with attachmentBytes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValue(
      makeJsonResponse({
        id: 'chatcmpl-test',
        object: 'chat.completion',
        created: 1700000000,
        model: 'gpt-4o',
        choices: [
          {
            index: 0,
            message: { role: 'assistant', content: 'I see the image.' },
            finish_reason: 'stop',
          },
        ],
        usage: { prompt_tokens: 80, completion_tokens: 10, total_tokens: 90 },
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks an unscannable image before the cloud request', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

    await expect(provider.sendMessage('What do you see?', { attachmentBytes }))
      .rejects.toThrow('unscannable_attachment');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('falls back to plain string content when no attachmentBytes provided', async () => {
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

    await provider.sendMessage('Hello', {});

    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg.content).toBe('Hello');
  });
});

// ─────────────────────────────────────────────────────────
// GeminiProvider
// ─────────────────────────────────────────────────────────

describe('GeminiProvider sendMessage with attachmentBytes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValue(
      makeJsonResponse({
        candidates: [
          {
            content: { parts: [{ text: 'I see it.' }], role: 'model' },
            finishReason: 'STOP',
            index: 0,
          },
        ],
        usageMetadata: {
          promptTokenCount: 50,
          candidatesTokenCount: 10,
          totalTokenCount: 60,
        },
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('blocks an unscannable image before the cloud request', async () => {
    const provider = new GeminiProvider({ apiKey: 'test-key', model: 'gemini-1.5-pro' });

    await expect(provider.sendMessage('What is this?', { attachmentBytes }))
      .rejects.toThrow('unscannable_attachment');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

// ─────────────────────────────────────────────────────────
// OllamaProvider
// ─────────────────────────────────────────────────────────

describe('OllamaProvider sendMessage with attachmentBytes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    fetchMock.mockResolvedValue(
      makeJsonResponse({
        model: 'llava:7b',
        message: { role: 'assistant', content: 'I see the image.' },
        done: true,
        prompt_eval_count: 50,
        eval_count: 10,
        done_reason: 'stop',
      })
    );
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches images array at the message level (not inside content)', async () => {
    const provider = new OllamaProvider({ model: 'llava:7b' });

    await provider.sendMessage('What do you see?', { attachmentBytes });

    expect(fetchMock).toHaveBeenCalled();
    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    // The user message must have an `images` array with the base64 data
    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(userMsg).toBeDefined();
    expect(Array.isArray(userMsg.images)).toBe(true);
    expect(userMsg.images).toContain(PNG_BASE64);

    // The content field is still the plain text prompt
    expect(userMsg.content).toBe('What do you see?');
  });

  it('sends no images field when no attachmentBytes provided', async () => {
    const provider = new OllamaProvider({ model: 'llava:7b' });

    await provider.sendMessage('Hello', {});

    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    // Either no images key, or an empty array — both are acceptable
    const imgs = userMsg.images;
    expect(!imgs || imgs.length === 0).toBe(true);
  });
});

describe('OllamaProvider sendMessageStreaming with attachmentBytes', () => {
  let fetchMock: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    // Build a minimal NDJSON stream
    const ndjson = [
      JSON.stringify({ model: 'llava:7b', message: { role: 'assistant', content: 'ok' }, done: false }),
      JSON.stringify({ model: 'llava:7b', done: true, prompt_eval_count: 10, eval_count: 5, done_reason: 'stop' }),
      '',
    ].join('\n');

    const readable = new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(ndjson));
        controller.close();
      },
    });
    fetchMock.mockResolvedValue(new Response(readable, { status: 200 }));
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it('attaches images array at message level for streaming requests', async () => {
    const provider = new OllamaProvider({ model: 'llava:7b' });

    await provider.sendMessageStreaming('Describe this.', {
      onChunk: () => {},
      attachmentBytes,
    });

    const [_url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    const body = JSON.parse(init.body as string);

    const userMsg = body.messages.find((m: { role: string }) => m.role === 'user');
    expect(Array.isArray(userMsg.images)).toBe(true);
    expect(userMsg.images).toContain(PNG_BASE64);
  });
});

// ─────────────────────────────────────────────────────────
// MockProvider — records attachmentBytes
// ─────────────────────────────────────────────────────────

describe('MockProvider sendMessage with attachmentBytes — recording', () => {
  it('records attachment bytes passed via options', async () => {
    const provider = new MockProvider();

    await provider.sendMessage('Describe this.', { attachmentBytes });

    // MockProvider should record the last call's attachment payload
    const recorded = provider.getLastSendAttachments();
    expect(recorded).toBeDefined();
    expect(recorded).toHaveLength(1);
    expect(recorded![0]!.att.id).toBe('abc123');
    expect(recorded![0]!.bytes).toEqual(PNG_BYTES);
  });

  it('records null when no attachments provided', async () => {
    const provider = new MockProvider();

    await provider.sendMessage('Hello', {});

    expect(provider.getLastSendAttachments()).toBeNull();
  });

  it('also records streaming attachments', async () => {
    const provider = new MockProvider();

    await provider.sendMessageStreaming('Describe this.', {
      onChunk: () => {},
      attachmentBytes,
    });

    const recorded = provider.getLastSendAttachments();
    expect(recorded).toHaveLength(1);
    expect(recorded![0]!.att.mimeType).toBe('image/png');
  });
});
