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

describe('validateApiKeyLive — Local AI only', () => {
  it('still checks a cloud key in Local AI only mode', async () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    await validateApiKeyLive('anthropic', 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(fetchSpy).toHaveBeenCalled();
  });

  it('contacts the provider when NOT in Local-only', async () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
    await validateApiKeyLive('anthropic', 'sk-ant-api03-aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa');
    expect(fetchSpy).toHaveBeenCalled();
  });
});
