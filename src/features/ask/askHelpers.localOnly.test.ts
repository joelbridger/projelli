// Fix 2 (demo readiness) — Local-only mode used to silently swap to Ollama
// whenever the embedded Advisor Prep Hero Local AI model wasn't `ready` yet, even on a
// machine with no Ollama installed at all. That guaranteed a confusing failure
// deep inside the send ("Ollama unreachable") on a fresh install where the
// embedded model is still downloading. Local-only must now use Ollama ONLY
// when it's provably reachable, and otherwise fail with an honest, actionable
// message up front — never construct a provider for an engine that isn't there.

import { describe, it, expect, vi, beforeEach } from 'vitest';

const isLocalOnlyModeMock = vi.fn();
vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  isLocalOnlyMode: (): unknown => isLocalOnlyModeMock(),
  assertCloudGenerationAllowed: vi.fn(),
}));

const resolveAvailableLocalGenerationProviderMock = vi.fn();
const resolveLocalGenerationProviderMock = vi.fn();
vi.mock('@/platform/providers/resolveLocalProvider', () => ({
  resolveAvailableLocalGenerationProvider: (): unknown => resolveAvailableLocalGenerationProviderMock(),
  resolveLocalGenerationProvider: (): unknown => resolveLocalGenerationProviderMock(),
}));

import {
  buildResolvedAskProvider,
  resolveLocalOnlyAskProvider,
  LOCAL_AI_NOT_READY_MESSAGE,
  friendlyErrorMessage,
} from './askHelpers';

describe('Local-only mode never silently swaps to an unreachable Ollama (Fix 2)', () => {
  beforeEach(() => {
    isLocalOnlyModeMock.mockReset().mockReturnValue(true);
    resolveAvailableLocalGenerationProviderMock.mockReset();
    resolveLocalGenerationProviderMock.mockReset();
  });

  it('resolves to the embedded local engine when it is ready', async () => {
    const fakeProvider = { provider: {}, providerId: 'keepance-local' as const, model: 'qwen3-4b' };
    resolveAvailableLocalGenerationProviderMock.mockResolvedValue(fakeProvider);

    const resolved = await buildResolvedAskProvider();

    expect(resolved).toBe(fakeProvider);
    expect(resolveLocalGenerationProviderMock).not.toHaveBeenCalled();
  });

  it('falls back to Ollama only when it is provably reachable', async () => {
    const fakeProvider = { provider: {}, providerId: 'ollama' as const, model: 'llama3.2:3b' };
    resolveAvailableLocalGenerationProviderMock.mockResolvedValue(fakeProvider);

    const resolved = await buildResolvedAskProvider();

    expect(resolved.providerId).toBe('ollama');
  });

  it('throws an honest, actionable error instead of constructing an unreachable Ollama provider', async () => {
    resolveAvailableLocalGenerationProviderMock.mockResolvedValue(null);

    await expect(buildResolvedAskProvider()).rejects.toThrow(LOCAL_AI_NOT_READY_MESSAGE);
    // The blind, always-returns-something resolver must never be used as a
    // silent fallback for Local-only Ask — that's the exact bug being fixed.
    expect(resolveLocalGenerationProviderMock).not.toHaveBeenCalled();
  });

  it('resolveLocalOnlyAskProvider is the same strict resolution used by the mid-flight re-check in useAsk', async () => {
    resolveAvailableLocalGenerationProviderMock.mockResolvedValue(null);
    await expect(resolveLocalOnlyAskProvider()).rejects.toThrow(LOCAL_AI_NOT_READY_MESSAGE);

    const fakeProvider = { provider: {}, providerId: 'keepance-local' as const, model: 'qwen3-4b' };
    resolveAvailableLocalGenerationProviderMock.mockResolvedValue(fakeProvider);
    await expect(resolveLocalOnlyAskProvider()).resolves.toBe(fakeProvider);
  });

  it('friendlyErrorMessage preserves the LOCAL_AI_NOT_READY_MESSAGE verbatim', () => {
    expect(friendlyErrorMessage(LOCAL_AI_NOT_READY_MESSAGE, { mode: 'local-only' })).toBe(
      LOCAL_AI_NOT_READY_MESSAGE,
    );
  });
});
