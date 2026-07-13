import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const privacy = vi.hoisted(() => ({
  state: {
    blocked: true,
    pending: false,
    error:
      'Network lockdown is still on because the privacy setting could not be updated.',
  },
  retry: vi.fn(),
  request: vi.fn(),
}));

vi.mock('@/platform/privacy/nativeNetworkLockdownBridge', () => ({
  useNativeNetworkLockdownBridgeState: () => privacy.state,
  retryNativeNetworkLockdown: privacy.retry,
  requestNativeNetworkLockdown: privacy.request,
}));

import { ConfidentialityModeSettings } from '@/features/settings/ConfidentialityModeSettings';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useSettingsStore } from '@/platform/settings/settingsStore';

describe('Network lockdown recovery in Privacy settings', () => {
  beforeEach(() => {
    privacy.retry.mockReset();
    useSettingsStore.setState({ values: {} });
    useMatterStore.setState({ matters: [], activeMatterId: null });
    useFirmStore.setState({ assuredProviders: [], session: null });
  });

  it('shows the failed release honestly beside the switch and offers Retry', () => {
    render(<ConfidentialityModeSettings />);

    expect(screen.getByTestId('network-lockdown-update-failed')).toHaveTextContent(
      /network lockdown is still on/i,
    );
    fireEvent.click(screen.getByTestId('privacy-settings-network-lockdown-retry'));
    expect(privacy.retry).toHaveBeenCalledTimes(1);
  });
});
