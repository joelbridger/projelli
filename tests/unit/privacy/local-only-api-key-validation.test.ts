/**
 * Phase A follow-up #6 — live API-key validation contacts the cloud provider
 * (it sends the key off-device). In private mode it must NOT make that call.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { validateApiKeyLive } from '@/platform/providers/apiKeyValidation';

let fetchSpy: ReturnType<typeof vi.fn>;

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
  try { localStorage.removeItem('lantern:settings'); } catch { /* jsdom */ }
  fetchSpy = vi.fn(async () => ({ ok: true, status: 200, json: async () => ({}) }));
  vi.stubGlobal('fetch', fetchSpy);
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('validateApiKeyLive — Local-only kill-switch', () => {
  it('does NOT contact the provider in Local-only (paused, key not sent)', async () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    const result = await validateApiKeyLive('anthropic', 'sk-ant-anything');
    expect(fetchSpy).not.toHaveBeenCalled();
    expect(result.outcome).not.toBe('ok');
    expect(result.message).toMatch(/private mode/i);
  });

  it('contacts the provider when NOT in Local-only', async () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
    await validateApiKeyLive('anthropic', 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(fetchSpy).toHaveBeenCalled();
  });
});
