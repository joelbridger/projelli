import { beforeEach } from 'vitest';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';

/**
 * Call at the top level of a test file that exercises a REAL cloud provider's
 * send path. The cloud-send guard is fail-closed (it BLOCKS unless the persisted
 * confidentiality mode explicitly reads 'direct'/'assured'), so a test that just
 * constructs a provider and calls sendMessage would be blocked. This sets the
 * persisted mode to 'direct' before each test — mirroring a configured app where
 * the user has chosen a cloud mode. Tests that need Local-only override it.
 */
export function useDirectModeForTests(): void {
  beforeEach(() => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
  });
}
