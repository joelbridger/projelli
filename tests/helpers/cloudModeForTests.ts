import { afterEach, beforeEach } from 'vitest';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { setPreparationEnforcementMode } from '@/platform/privacy/promptPreparationGuard';

/**
 * Call at the top level of a test file that exercises a REAL cloud provider's
 * send path. The cloud-send guard is fail-closed (it BLOCKS unless the persisted
 * confidentiality mode explicitly reads 'direct'/'assured'), so a test that just
 * constructs a provider and calls sendMessage would be blocked. This sets the
 * persisted mode to 'direct' before each test — mirroring a configured app where
 * the user has chosen a cloud mode. These are transport-contract tests that
 * deliberately call adapter methods directly, so they also explicitly turn
 * off the stamp backstop for that one test. Product-surface tests keep the
 * default enforce mode and must use prepared send helpers.
 */
export function useDirectModeForTests(): void {
  beforeEach(() => {
    useSettingsStore.getState().setSetting(CONFIDENTIALITY_MODE_SETTING_KEY, 'direct');
    setPreparationEnforcementMode('off');
  });
  afterEach(() => {
    setPreparationEnforcementMode('enforce');
  });
}
