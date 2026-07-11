import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const {
  getStatusMock,
  assertCloudSendAllowedMock,
  assertLocalOnlyAllowsExternalMock,
  isTauriMock,
} = vi.hoisted(() => ({
  getStatusMock: vi.fn(),
  assertCloudSendAllowedMock: vi.fn(),
  assertLocalOnlyAllowsExternalMock: vi.fn(),
  isTauriMock: vi.fn(),
}));

vi.mock('@tauri-apps/api/core', () => ({
  isTauri: isTauriMock,
}));

vi.mock('@/platform/privacy/offlineMode', () => ({
  getNetworkPolicyStatus: (): unknown => getStatusMock(),
  subscribeToOfflineModeChanges: (): (() => void) => () => undefined,
}));

vi.mock('@/platform/privacy/cloudSendGuard', () => ({
  assertCloudSendAllowed: (provider: string): unknown =>
    assertCloudSendAllowedMock(provider),
  isLocalOnlyModeFailClosed: (): boolean => false,
}));

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  assertLocalOnlyAllowsExternal: (operation: string): unknown =>
    assertLocalOnlyAllowsExternalMock(operation),
}));

// Production provider endpoints are absolute. The normal development proxy is
// intentionally not part of this boundary test because networkClient must see
// the real destination before it permits a request.
vi.mock('./fetchUtils', async (importOriginal) => {
  const actual = await importOriginal<typeof import('./fetchUtils')>();
  const bases = {
    anthropic: 'https://api.anthropic.com',
    openai: 'https://api.openai.com',
    google: 'https://generativelanguage.googleapis.com',
  } as const;
  return {
    ...actual,
    getProviderBaseUrl: (provider: keyof typeof bases): string =>
      bases[provider],
  };
});

import { ClaudeProvider } from './ClaudeProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';
import { validateApiKeyLive } from './apiKeyValidation';
import { clearModelCache, getModels } from './ModelListService';
import { AppLocalProvider } from './AppLocalProvider';
import { OllamaProvider } from './OllamaProvider';

function setOfflineMode(offlineMode: boolean): void {
  getStatusMock.mockResolvedValue({
    offlineMode,
    generation: offlineMode ? 2 : 1,
  });
}

function claudeResponse(): Response {
  return new Response(
    JSON.stringify({
      content: [{ type: 'text', text: 'Claude answered.' }],
      usage: { input_tokens: 1, output_tokens: 1 },
      model: 'claude-haiku-4-5-20251001',
      stop_reason: 'end_turn',
    }),
    { status: 200 }
  );
}

function openAiResponse(): Response {
  return new Response(
    JSON.stringify({
      choices: [
        { message: { content: 'OpenAI answered.' }, finish_reason: 'stop' },
      ],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
      model: 'gpt-4o-mini',
    }),
    { status: 200 }
  );
}

function geminiResponse(): Response {
  return new Response(
    JSON.stringify({
      candidates: [
        {
          content: { parts: [{ text: 'Gemini answered.' }] },
          finishReason: 'STOP',
        },
      ],
      usageMetadata: {
        promptTokenCount: 1,
        candidatesTokenCount: 1,
        totalTokenCount: 2,
      },
    }),
    { status: 200 }
  );
}

function localResponse(content = 'Local answered.'): Response {
  return new Response(
    JSON.stringify({
      model: 'local-model',
      choices: [{ message: { content }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    }),
    { status: 200 }
  );
}

beforeEach(() => {
  // This suite proves the desktop boundary. Browser dev mode is intentionally
  // covered separately in networkClient.test.ts, where isTauri() is false.
  isTauriMock.mockReturnValue(true);
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
  getStatusMock.mockReset();
  assertCloudSendAllowedMock.mockReset();
  assertLocalOnlyAllowsExternalMock.mockReset();
  localStorage.clear();
});

describe('cloud provider Offline Mode boundary', () => {
  it('stops all three cloud providers before any network call when Offline Mode is on', async () => {
    setOfflineMode(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    const attempts = [
      new ClaudeProvider({
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com',
        maxRetries: 1,
      }).sendMessage('Hello'),
      new OpenAIProvider({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        maxRetries: 1,
      }).sendMessage('Hello'),
      new GeminiProvider({
        apiKey: 'AIza-test',
        baseUrl: 'https://generativelanguage.googleapis.com',
        maxRetries: 0,
      }).sendMessage('Hello'),
    ];

    for (const attempt of attempts) {
      await expect(attempt).rejects.toMatchObject({
        code: 'OFFLINE_MODE_BLOCKED',
        message:
          'Offline Mode is on. Lantern cannot connect to the internet. Turn it off to use cloud AI.',
      });
    }
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('sends normally through the boundary when Offline Mode is off', async () => {
    setOfflineMode(false);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(claudeResponse())
      .mockResolvedValueOnce(openAiResponse())
      .mockResolvedValueOnce(geminiResponse());
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new ClaudeProvider({
        apiKey: 'sk-ant-test',
        baseUrl: 'https://api.anthropic.com',
        maxRetries: 1,
      }).sendMessage('Hello')
    ).resolves.toMatchObject({ content: 'Claude answered.' });
    await expect(
      new OpenAIProvider({
        apiKey: 'sk-test',
        baseUrl: 'https://api.openai.com',
        maxRetries: 1,
      }).sendMessage('Hello')
    ).resolves.toMatchObject({ content: 'OpenAI answered.' });
    await expect(
      new GeminiProvider({
        apiKey: 'AIza-test',
        baseUrl: 'https://generativelanguage.googleapis.com',
        maxRetries: 0,
      }).sendMessage('Hello')
    ).resolves.toMatchObject({ content: 'Gemini answered.' });

    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
});

describe('key checking and model lists', () => {
  it('uses the Offline Mode message only when the whole-app boundary blocks a key check', async () => {
    setOfflineMode(true);
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      validateApiKeyLive('anthropic', 'sk-ant-01234567890123456789')
    ).resolves.toMatchObject({
      outcome: 'network',
      message:
        'Offline Mode is on. Lantern cannot connect to the internet. Turn it off to use cloud AI.',
    });
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('checks a key and refreshes a model list normally when Offline Mode is off', async () => {
    setOfflineMode(false);
    const fetchMock = vi
      .fn()
      .mockResolvedValueOnce(new Response('{}', { status: 200 }))
      .mockResolvedValueOnce(
        new Response(JSON.stringify({ data: [{ id: 'gpt-4o-mini' }] }), {
          status: 200,
        })
      );
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      validateApiKeyLive('anthropic', 'sk-ant-01234567890123456789')
    ).resolves.toMatchObject({
      outcome: 'ok',
    });
    await expect(
      getModels('openai', 'sk-01234567890123456789')
    ).resolves.toEqual([
      { id: 'gpt-4o-mini', displayName: 'GPT 4o Mini', provider: 'openai' },
    ]);
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });

  it('keeps model-list Offline Mode blocking independent from the Local AI only guard', async () => {
    setOfflineMode(true);
    clearModelCache('openai');
    const fetchMock = vi.fn();
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      getModels('openai', 'sk-01234567890123456789')
    ).resolves.toEqual(expect.any(Array));
    expect(assertLocalOnlyAllowsExternalMock).toHaveBeenCalledWith(
      'model list refresh'
    );
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('local AI loopback exception', () => {
  it('keeps the bundled local server and Ollama working while Offline Mode is on', async () => {
    setOfflineMode(true);
    const requestedUrls: string[] = [];
    const responses = [
      localResponse('Bundled model answered.'),
      new Response(
        JSON.stringify({
          model: 'llama3.2:3b',
          message: { content: 'Ollama answered.' },
          done: true,
          prompt_eval_count: 1,
          eval_count: 1,
        }),
        { status: 200 }
      ),
    ];
    const fetchMock = vi.fn((input: RequestInfo | URL): Promise<Response> => {
      requestedUrls.push(
        typeof input === 'string' || input instanceof URL
          ? input.toString()
          : input.url
      );
      const response = responses.shift();
      if (!response) throw new Error('Unexpected extra loopback request');
      return Promise.resolve(response);
    });
    vi.stubGlobal('fetch', fetchMock);

    await expect(
      new AppLocalProvider({
        startSidecar: () => Promise.resolve('http://127.0.0.1:18089'),
      }).sendMessage('Hello')
    ).resolves.toMatchObject({ content: 'Bundled model answered.' });
    await expect(
      new OllamaProvider().sendMessage('Hello')
    ).resolves.toMatchObject({
      content: 'Ollama answered.',
    });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    expect(requestedUrls).toEqual([
      'http://127.0.0.1:18089/v1/chat/completions',
      'http://127.0.0.1:11434/api/chat',
    ]);
  });
});
