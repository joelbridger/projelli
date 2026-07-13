import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen } from '@testing-library/react';

const privacy = vi.hoisted(() => ({
  state: {
    status: 'on' as 'on' | 'off' | 'unknown',
    blocked: true,
    pending: false,
    error:
      'Network lockdown is still on because the privacy setting could not be updated.' as string | null,
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
    privacy.request.mockReset();
    privacy.state.status = 'on';
    privacy.state.blocked = true;
    privacy.state.pending = false;
    privacy.state.error =
      'Network lockdown is still on because the privacy setting could not be updated.';
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

  it('FINDING-20: displays the enforced lockdown state when the saved choice disagrees', () => {
    render(<ConfidentialityModeSettings />);

    expect(screen.getByRole('switch', { name: 'Network lockdown' })).toHaveAttribute(
      'aria-checked',
      String(privacy.state.blocked),
    );
  });

  it('toggle: keeps the displayed state unchanged until native enforcement confirms', () => {
    privacy.state.status = 'off';
    privacy.state.blocked = false;
    privacy.state.error = null;
    render(<ConfidentialityModeSettings />);

    const networkLockdown = screen.getByRole('switch', { name: 'Network lockdown' });
    expect(networkLockdown).toHaveAttribute('aria-checked', 'false');

    fireEvent.click(networkLockdown);

    expect(privacy.request).toHaveBeenCalledWith(true);
    expect(networkLockdown).toHaveAttribute('aria-checked', 'false');
  });

  it('unknown: pauses controls and says the enforced state cannot be confirmed', () => {
    privacy.state.status = 'unknown';
    privacy.state.blocked = true;
    privacy.state.error = null;
    render(<ConfidentialityModeSettings />);

    expect(screen.getByRole('switch', { name: 'Network lockdown' })).not.toHaveAttribute(
      'aria-checked',
    );
    expect(screen.getByTestId('network-lockdown-status-unconfirmed')).toHaveTextContent(
      /checking the desktop privacy guard/i,
    );
  });
});
