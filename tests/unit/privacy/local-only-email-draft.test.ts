/**
 * Phase A — Local-only guard for EmailViewer "Draft with AI".
 *
 * buildProviderAsync (the resolver behind the draft send) must force the local
 * model in Local-only so an email body never reaches the cloud. The send site
 * (handleDraftWithAI) additionally re-checks the mode immediately before the
 * send via assertLocalOnlyAllowsSend (the race guard, tested separately).
 *
 * F-503 — WHICH local engine: the embedded Keepance Local AI when its model is
 * downloaded + ready, else the user's Ollama daemon — the same on-device
 * resolution Ask / Chat / Client Map use, so a machine with the embedded model
 * but no Ollama can still draft privately.
 */

import { describe, it, expect, beforeEach, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ status: vi.fn() }));

vi.mock('@/platform/utils/tauri-commands', async (orig) => {
  const real = await orig<typeof import('@/platform/utils/tauri-commands')>();
  return { ...real, localLlmModelStatus: mocks.status };
});

import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { buildProviderAsync } from '@/features/email/EmailViewer';

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
  // Default: no embedded model (the off-desktop / not-downloaded case).
  mocks.status.mockReset();
  mocks.status.mockResolvedValue('absent');
});

describe('EmailViewer buildProviderAsync — Local-only', () => {
  it('returns the local Ollama provider in Local-only when no embedded model is ready, never a cloud provider', async () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    const provider = await buildProviderAsync();
    expect(provider.getMetadata().providerId).toBe('ollama');
  });

  it('returns the EMBEDDED Keepance Local AI in Local-only when its model is ready (no Ollama needed)', async () => {
    mocks.status.mockResolvedValue('ready');
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    const provider = await buildProviderAsync();
    expect(provider.getMetadata().providerId).toBe('keepance-local');
  });
});
