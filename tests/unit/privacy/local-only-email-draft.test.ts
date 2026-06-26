/**
 * Phase A — Local-only guard for EmailViewer "Draft with AI".
 *
 * buildProviderAsync (the resolver behind the draft send) must force the local
 * model in Local-only so an email body never reaches the cloud. The send site
 * (handleDraftWithAI) additionally re-checks the mode immediately before the
 * send via assertLocalOnlyAllowsSend (the race guard, tested separately).
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { buildProviderAsync } from '@/features/email/EmailViewer';

beforeEach(() => {
  useSettingsStore.setState({ values: {} });
});

describe('EmailViewer buildProviderAsync — Local-only', () => {
  it('returns the local (Ollama) provider in Local-only, never a cloud provider', async () => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'local-only');
    const provider = await buildProviderAsync();
    expect(provider.getMetadata().providerId).toBe('ollama');
  });
});
