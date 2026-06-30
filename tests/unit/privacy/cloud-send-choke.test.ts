/**
 * Phase A follow-up — the CENTRAL cloud-send choke point + fail-closed read.
 *
 * Every cloud provider send method calls assertCloudSendAllowed first, so in
 * private mode no AI prompt/file can reach a cloud AI from ANY call path. This
 * test exercises the guard directly AND through a real cloud provider, and pins
 * the fail-closed behaviour (a persisted Local-only choice blocks even before the
 * in-memory settings store has hydrated).
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import {
  assertCloudSendAllowed,
  isLocalOnlyModeFailClosed,
  LocalOnlyEgressError,
} from '@/platform/privacy/cloudSendGuard';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';

const PERSIST_KEY = 'lantern:settings';

function setMode(mode: string) {
  useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, mode);
}

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
  try { localStorage.removeItem(PERSIST_KEY); } catch { /* jsdom */ }
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('assertCloudSendAllowed (central choke)', () => {
  it('throws in Local-only and allows in Direct/Assured', () => {
    setMode('local-only');
    expect(() => assertCloudSendAllowed('anthropic')).toThrow(LocalOnlyEgressError);
    setMode('direct');
    expect(() => assertCloudSendAllowed('anthropic')).not.toThrow();
    setMode('assured');
    expect(() => assertCloudSendAllowed('openai')).not.toThrow();
  });
});

describe('a cloud provider cannot send in Local-only (covers all call paths)', () => {
  it('ClaudeProvider.sendMessage throws and never fetches in Local-only', async () => {
    setMode('local-only');
    const provider = new ClaudeProvider({ apiKey: 'sk-ant-test', model: 'claude-test' });
    await expect(provider.sendMessage('hello')).rejects.toThrow(/local-only/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });

  it('ClaudeProvider.structuredOutput throws and never fetches in Local-only', async () => {
    setMode('local-only');
    const provider = new ClaudeProvider({ apiKey: 'sk-ant-test', model: 'claude-test' });
    await expect(
      provider.structuredOutput('hello', { schema: { type: 'object' } } as never),
    ).rejects.toThrow(/local-only/i);
    expect(fetchSpy).not.toHaveBeenCalled();
  });
});

describe('fail-closed read (hydration gap)', () => {
  it('blocks when Local-only is PERSISTED even if the in-memory store has not hydrated', () => {
    // Simulate: persisted choice is Local-only, but the in-memory store is still
    // at its empty initial state (pre-rehydration → getSetting returns the
    // schema default 'direct').
    useSettingsStore.setState({ values: {} });
    localStorage.setItem(
      PERSIST_KEY,
      JSON.stringify({ state: { values: { [CONFIDENTIALITY_MODE_SETTING_KEY]: 'local-only' } } }),
    );
    expect(isLocalOnlyModeFailClosed()).toBe(true);
    expect(() => assertCloudSendAllowed('anthropic')).toThrow(LocalOnlyEgressError);
  });

  it('allows when neither persisted nor in-memory is Local-only', () => {
    useSettingsStore.setState({ values: {} });
    setMode('direct');
    expect(isLocalOnlyModeFailClosed()).toBe(false);
    expect(() => assertCloudSendAllowed('anthropic')).not.toThrow();
  });
});
