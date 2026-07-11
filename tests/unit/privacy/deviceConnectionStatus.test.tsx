import { beforeEach, describe, expect, it } from 'vitest';
import { render, screen } from '@testing-library/react';
import { DeviceConnectionStatus } from '@/platform/privacy/ui/DeviceConnectionStatus';
import { useOfflineModeStore } from '@/platform/privacy/offlineMode';

describe('DeviceConnectionStatus', () => {
  beforeEach(() => {
    useOfflineModeStore.setState({
      offlineMode: false,
      generation: 1,
      hydrated: true,
      isHydrating: false,
      hydrationError: null,
    });
  });

  it('does not infer device status from local AI and tells the truth while online', () => {
    render(<DeviceConnectionStatus />);
    expect(screen.getByTestId('device-connection-status')).toHaveAttribute('data-status', 'online');
    expect(screen.getByTestId('device-connection-status')).toHaveTextContent(
      'Internet connections are allowed when you choose an online feature.',
    );
  });

  it('states the whole-app block while Offline Mode is on', () => {
    useOfflineModeStore.setState({ offlineMode: true, hydrated: true });
    render(<DeviceConnectionStatus />);
    expect(screen.getByTestId('device-connection-status')).toHaveAttribute('data-status', 'offline');
    expect(screen.getByTestId('device-connection-status')).toHaveTextContent(
      'Offline Mode on. Internet connections from Lantern are blocked.',
    );
  });
});
