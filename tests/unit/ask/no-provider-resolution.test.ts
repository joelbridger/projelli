import { beforeEach, describe, expect, it, vi } from 'vitest';
import { NO_AI_PROVIDER } from '@/platform/privacy/egress';

const h = vi.hoisted(() => ({
  mode: 'direct',
  defaultProvider: '',
  defaultModel: '',
  localStatus: 'absent',
  ollamaReachable: false,
  ollamaModels: ['llama3.2:3b'],
  ollamaConstructed: 0,
  keys: {
    anthropic: null as string | null,
    openai: null as string | null,
    google: null as string | null,
  },
}));

vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  getConfidentialityMode: () => h.mode,
}));

vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: { getState: () => ({ session: { activated: true } }) },
}));

vi.mock('@/platform/settings/settingsStore', () => ({
  useSettingsStore: {
    getState: () => ({
      getSetting: (key: string) => {
        if (key === 'defaultProvider') return h.defaultProvider;
        if (key === 'defaultModel') return h.defaultModel;
        return true;
      },
    }),
  },
}));

vi.mock('@/platform/providers/ClaudeProvider', () => ({
  ClaudeProvider: class {
    kind = 'anthropic';
    model: string | undefined;
    constructor(config: { model?: string }) {
      this.model = config.model;
    }
    getMetadata() {
      return { model: this.model ?? 'claude-test' };
    }
  },
}));

vi.mock('@/platform/providers/OpenAIProvider', () => ({
  OpenAIProvider: class {
    kind = 'openai';
    model: string | undefined;
    constructor(config: { model?: string }) {
      this.model = config.model;
    }
    getMetadata() {
      return { model: this.model ?? 'openai-test' };
    }
  },
}));

vi.mock('@/platform/providers/GeminiProvider', () => ({
  GeminiProvider: class {
    kind = 'google';
    model: string | undefined;
    constructor(config: { model?: string }) {
      this.model = config.model;
    }
    getMetadata() {
      return { model: this.model ?? 'gemini-test' };
    }
  },
}));

vi.mock('@/platform/providers/OllamaProvider', () => ({
  detectOllama: vi.fn(async () => ({
    reachable: h.ollamaReachable,
    models: h.ollamaReachable ? h.ollamaModels : [],
  })),
  OllamaProvider: class {
    kind = 'ollama';
    constructor() {
      h.ollamaConstructed += 1;
    }
    getMetadata() {
      return { model: 'ollama-test' };
    }
  },
}));

vi.mock('@/platform/providers/AppLocalProvider', () => ({
  AppLocalProvider: class {
    kind = 'lantern-local';
    getMetadata() {
      return { model: 'qwen3-4b' };
    }
  },
}));

vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const actual = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return {
    ...actual,
    localLlmModelStatus: vi.fn(async () => h.localStatus),
  };
});

vi.mock('@/platform/providers/KeychainService', () => ({
  KeychainService: vi.fn().mockImplementation(function () {
    return {
      getKey: (p: string) => Promise.resolve(h.keys[p as keyof typeof h.keys] ?? null),
      hasKey: (p: string) =>
        Promise.resolve(Boolean(h.keys[p as keyof typeof h.keys]?.trim())),
    };
  }),
}));

import {
  buildResolvedAskProvider,
  friendlyErrorMessage,
  NO_ASK_PROVIDER_CONNECTED_MESSAGE,
  resolveActiveAskProviderId,
} from '@/features/ask/askHelpers';

describe('Ask provider resolution when no AI is connected', () => {
  beforeEach(() => {
    h.mode = 'direct';
    h.defaultProvider = '';
    h.defaultModel = '';
    h.localStatus = 'absent';
    h.ollamaReachable = false;
    h.ollamaModels = ['llama3.2:3b'];
    h.ollamaConstructed = 0;
    h.keys = { anthropic: null, openai: null, google: null };
    localStorage.clear();
  });

  it('shows no provider, not Ollama, when there is no cloud key and Ollama is unreachable', async () => {
    await expect(resolveActiveAskProviderId()).resolves.toBe(NO_AI_PROVIDER);
  });

  it('fails before constructing a local provider when there is no cloud key and no reachable local engine', async () => {
    await expect(buildResolvedAskProvider()).rejects.toThrow(
      NO_ASK_PROVIDER_CONNECTED_MESSAGE,
    );
    expect(h.ollamaConstructed).toBe(0);
  });

  it('keeps the clear no-provider setup message for the Ask surface', () => {
    expect(
      friendlyErrorMessage(NO_ASK_PROVIDER_CONNECTED_MESSAGE, {
        mode: 'direct',
        reachedProvider: false,
        failedStage: 'provider-resolution',
      }),
    ).toBe(NO_ASK_PROVIDER_CONNECTED_MESSAGE);
  });

  it('still resolves a configured cloud provider without probing local AI', async () => {
    h.keys = { anthropic: 'sk-ant-test', openai: null, google: null };

    await expect(resolveActiveAskProviderId()).resolves.toBe('anthropic');
    await expect(buildResolvedAskProvider()).resolves.toMatchObject({
      providerId: 'anthropic',
    });
    expect(h.ollamaConstructed).toBe(0);
  });

  it('resolves Ollama when no cloud key exists and Ollama is reachable', async () => {
    h.ollamaReachable = true;

    await expect(resolveActiveAskProviderId()).resolves.toBe('ollama');
    await expect(buildResolvedAskProvider()).resolves.toMatchObject({
      providerId: 'ollama',
    });
  });
});
