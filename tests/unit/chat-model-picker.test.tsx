/**
 * ChatModelPicker + new-chat provider/model resolution.
 *
 * Two layers under test (both isolated from the heavyweight AIChatViewer):
 *   - ChatModelPicker: lists ONLY providers with a valid key, groups models by
 *     provider, and calls onSelect with (provider, model). Cloud providers are
 *     hidden when the confidentiality mode is "local-only".
 *   - resolveNewChatDefault: the pure resolver AIChatViewer uses on mount to
 *     seed a brand-new chat to a provider the user actually has a valid key for
 *     (the must-fix: an OpenAI-only user must NOT default to 'anthropic').
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// useConfidentialityMode reads the settings store; mock it so each test drives
// the mode directly without touching localStorage-backed settings.
const confidentialityMock = vi.hoisted(() => ({ mode: 'direct' as string }));
vi.mock('@/platform/hooks/useConfidentialityMode', () => ({
  useConfidentialityMode: () => confidentialityMock.mode,
}));

// detectOllama hits 127.0.0.1:11434; mock it so tests are deterministic and
// don't depend on a real daemon (or jsdom's fetch).
const ollamaMock = vi.hoisted(() => ({
  result: { reachable: false, models: [] as string[] },
}));
vi.mock('@/platform/providers/OllamaProvider', () => ({
  detectOllama: () => Promise.resolve(ollamaMock.result),
}));

import { ChatModelPicker } from '@/features/ask/chat/ChatModelPicker';
import {
  resolveNewChatDefault,
  resolveAvailableProviders,
  resolveModelsForProvider,
  resolveSettingsDefaults,
} from '@/features/ask/chat/providerModelResolution';
import type { APIKey } from '@/features/ask/AIChatViewer';

function key(provider: string, isValid: boolean): APIKey {
  return { provider, key: `${provider}-stub-key`, isValid };
}

beforeEach(() => {
  confidentialityMock.mode = 'direct';
  ollamaMock.result = { reachable: false, models: [] };
  localStorage.clear();
});

describe('ChatModelPicker', () => {
  it('lists ONLY providers that have a valid key', () => {
    const apiKeys = [
      key('anthropic', false), // invalid key -> excluded
      key('openai', true), // valid -> included
      key('google', false), // invalid -> excluded
    ];
    render(
      <ChatModelPicker
        provider="openai"
        model="gpt-4o-mini"
        apiKeys={apiKeys}
        onSelect={() => {}}
      />,
    );

    // Open the dropdown.
    fireEvent.keyDown(screen.getByTestId('chat-model-picker'), { key: 'Enter' });

    // OpenAI's models are listed (e.g. its default GPT-4o option).
    expect(screen.getByTestId('chat-model-option-openai-gpt-4o')).toBeInTheDocument();
    // Anthropic + Google have no valid key, so none of their options render.
    expect(screen.queryByTestId('chat-model-option-anthropic-claude-sonnet-4-6')).toBeNull();
    expect(screen.queryByTestId('chat-model-option-google-gemini-2.5-flash')).toBeNull();
  });

  it('calls onSelect with the chosen provider AND model', () => {
    const onSelect = vi.fn();
    render(
      <ChatModelPicker
        provider="openai"
        model="gpt-4o-mini"
        apiKeys={[key('openai', true)]}
        onSelect={onSelect}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('chat-model-picker'), { key: 'Enter' });
    fireEvent.click(screen.getByTestId('chat-model-option-openai-gpt-4o'));

    expect(onSelect).toHaveBeenCalledTimes(1);
    expect(onSelect).toHaveBeenCalledWith('openai', 'gpt-4o');
  });

  it('shows the trigger label as "Provider · model", or "Choose a model" when unset', () => {
    const { rerender } = render(
      <ChatModelPicker
        provider="openai"
        model="gpt-4o-mini"
        apiKeys={[key('openai', true)]}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('chat-model-picker')).toHaveTextContent('OpenAI · gpt-4o-mini');

    rerender(
      <ChatModelPicker
        provider={undefined}
        model={undefined}
        apiKeys={[key('openai', true)]}
        onSelect={() => {}}
      />,
    );
    expect(screen.getByTestId('chat-model-picker')).toHaveTextContent('Choose a model');
  });

  it('hides cloud providers when the matter is local-only', () => {
    confidentialityMock.mode = 'local-only';
    render(
      <ChatModelPicker
        provider="openai"
        model="gpt-4o-mini"
        // Valid OpenAI (cloud) key present, but local-only must hide it.
        apiKeys={[key('openai', true)]}
        onSelect={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('chat-model-picker'), { key: 'Enter' });

    // No cloud option is selectable; the empty-state note explains why.
    expect(screen.queryByTestId('chat-model-option-openai-gpt-4o')).toBeNull();
    expect(screen.getByTestId('chat-model-picker-empty')).toBeInTheDocument();
  });

  it('shows a local (ollama) provider when it has an apiKeys entry', () => {
    confidentialityMock.mode = 'local-only';
    render(
      <ChatModelPicker
        provider="ollama"
        model=""
        apiKeys={[key('ollama', true)]}
        onSelect={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('chat-model-picker'), { key: 'Enter' });
    // Ollama has no model cache/list -> a single "Default model" option that is
    // still selectable (provider with empty model).
    expect(screen.getByTestId('chat-model-option-ollama-default')).toBeInTheDocument();
  });

  it('auto-detects a running Ollama and lists its models with no apiKeys entry', async () => {
    ollamaMock.result = { reachable: true, models: ['llama3.2:3b'] };
    render(
      <ChatModelPicker
        provider={undefined}
        model={undefined}
        apiKeys={[]} // no ollama entry — detection alone should surface it
        onSelect={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('chat-model-picker'), { key: 'Enter' });
    // The detected tag appears as a selectable option once the effect resolves.
    expect(
      await screen.findByTestId('chat-model-option-ollama-llama3.2:3b'),
    ).toBeInTheDocument();
  });

  it('does NOT add ollama when the daemon is unreachable', async () => {
    ollamaMock.result = { reachable: false, models: [] };
    render(
      <ChatModelPicker
        provider="openai"
        model="gpt-4o-mini"
        apiKeys={[key('openai', true)]}
        onSelect={() => {}}
      />,
    );
    fireEvent.keyDown(screen.getByTestId('chat-model-picker'), { key: 'Enter' });
    // Give the detection effect a tick; ollama must not appear.
    await waitFor(() =>
      expect(screen.getByTestId('chat-model-option-openai-gpt-4o')).toBeInTheDocument(),
    );
    expect(screen.queryByTestId('chat-model-option-ollama-default')).toBeNull();
  });
});

describe('resolveSettingsDefaults', () => {
  it('prefers the settings-store value over the legacy localStorage value', () => {
    expect(
      resolveSettingsDefaults('openai', 'gpt-4o', 'anthropic', 'claude-x'),
    ).toEqual({ defaultProvider: 'openai', defaultModel: 'gpt-4o' });
  });

  it('falls back to the legacy keepance_default_* values when the store is empty', () => {
    expect(resolveSettingsDefaults('', '', 'google', 'gemini-1.5-pro')).toEqual({
      defaultProvider: 'google',
      defaultModel: 'gemini-1.5-pro',
    });
  });

  it('returns empty strings when neither source has a value', () => {
    expect(resolveSettingsDefaults(undefined, undefined, null, null)).toEqual({
      defaultProvider: '',
      defaultModel: '',
    });
  });
});

describe('resolveAvailableProviders', () => {
  it('returns valid-key providers in order, de-duplicated', () => {
    const apiKeys = [
      key('openai', true),
      key('anthropic', false),
      key('openai', true), // dup
      key('google', true),
    ];
    expect(resolveAvailableProviders(apiKeys)).toEqual(['openai', 'google']);
  });
});

describe('resolveModelsForProvider', () => {
  it('prefers the keepance_models_<provider> cache when present', () => {
    localStorage.setItem(
      'keepance_models_openai',
      JSON.stringify({
        models: [{ id: 'gpt-custom', displayName: 'Custom GPT', provider: 'openai' }],
        fetchedAt: Date.now(),
        cacheVersion: 2,
      }),
    );
    const models = resolveModelsForProvider('openai');
    expect(models.map((m) => m.id)).toContain('gpt-custom');
  });

  it('falls back to the hardcoded default list when no cache exists', () => {
    const models = resolveModelsForProvider('anthropic');
    expect(models.length).toBeGreaterThan(0);
    expect(models.some((m) => m.id === 'claude-sonnet-4-6')).toBe(true);
  });

  it('returns an empty list for ollama (no cache, no default list)', () => {
    expect(resolveModelsForProvider('ollama')).toEqual([]);
  });
});

describe('resolveNewChatDefault (the must-fix)', () => {
  it('resolves provider "openai" (NOT anthropic) when only OpenAI is valid', () => {
    const apiKeys = [
      key('anthropic', false), // bad anthropic key
      key('openai', true), // the only valid one
    ];
    const result = resolveNewChatDefault(apiKeys);
    expect(result).not.toBeNull();
    expect(result!.provider).toBe('openai');
    // A sensible model comes along too (first OpenAI default).
    expect(result!.model).toBeTruthy();
  });

  it('honors the settings default provider when it has a valid key', () => {
    const apiKeys = [key('openai', true), key('google', true)];
    const result = resolveNewChatDefault(apiKeys, {
      defaultProvider: 'google',
      defaultModel: 'gemini-1.5-pro',
    });
    expect(result!.provider).toBe('google');
    // Settings default model is honored because it belongs to the provider.
    expect(result!.model).toBe('gemini-1.5-pro');
  });

  it('ignores the settings default provider when its key is NOT valid', () => {
    const apiKeys = [
      key('anthropic', false), // settings wants anthropic, but it's invalid
      key('openai', true),
    ];
    const result = resolveNewChatDefault(apiKeys, { defaultProvider: 'anthropic' });
    // Falls through to the first valid provider instead.
    expect(result!.provider).toBe('openai');
  });

  it('returns null when there is no valid key at all (leave provider unset)', () => {
    const apiKeys = [key('anthropic', false), key('openai', false)];
    expect(resolveNewChatDefault(apiKeys)).toBeNull();
  });

  it('prefers a VERIFIED provider over a merely-present (possibly expired) one', () => {
    // Both present, but only OpenAI has passed a live check. Anthropic is first
    // in the list yet must NOT win.
    const apiKeys = [key('anthropic', true), key('openai', true)];
    const result = resolveNewChatDefault(apiKeys, {}, new Set(['openai']));
    expect(result!.provider).toBe('openai');
  });

  it('ignores the settings default when that provider is present but NOT verified', () => {
    const apiKeys = [key('anthropic', true), key('openai', true)];
    // Settings wants anthropic, but only openai is verified -> openai wins.
    const result = resolveNewChatDefault(
      apiKeys,
      { defaultProvider: 'anthropic' },
      new Set(['openai']),
    );
    expect(result!.provider).toBe('openai');
  });

  it('falls back to all present providers when NONE of them are verified', () => {
    // verified set names a provider the user does not have -> no narrowing,
    // so the first present provider wins (no lockout).
    const apiKeys = [key('anthropic', true), key('openai', true)];
    const result = resolveNewChatDefault(apiKeys, {}, new Set(['google']));
    expect(result!.provider).toBe('anthropic');
  });

  it('honors the settings default when that provider IS verified', () => {
    const apiKeys = [key('openai', true), key('google', true)];
    const result = resolveNewChatDefault(
      apiKeys,
      { defaultProvider: 'google' },
      new Set(['openai', 'google']),
    );
    expect(result!.provider).toBe('google');
  });

  it('EXCLUDES a known-invalid provider from the fallback pool', () => {
    // Anthropic is present but a live check rejected it; OpenAI is present but
    // unchecked. Nothing is verified, so without the invalid set anthropic (the
    // first present provider) would win. The invalid set must push it past.
    const apiKeys = [key('anthropic', true), key('openai', true)];
    const result = resolveNewChatDefault(
      apiKeys,
      {},
      undefined,
      new Set(['anthropic']),
    );
    expect(result!.provider).toBe('openai');
  });

  it('returns null when the only present provider is known-invalid', () => {
    // No good provider to pick -> leave it unset so "add a key" takes over,
    // rather than defaulting to a key we already know fails.
    const apiKeys = [key('anthropic', true)];
    const result = resolveNewChatDefault(apiKeys, {}, undefined, new Set(['anthropic']));
    expect(result).toBeNull();
  });

  it('ignores the settings default when that provider is known-invalid', () => {
    const apiKeys = [key('anthropic', true), key('openai', true)];
    const result = resolveNewChatDefault(
      apiKeys,
      { defaultProvider: 'anthropic' },
      undefined,
      new Set(['anthropic']),
    );
    expect(result!.provider).toBe('openai');
  });
});
