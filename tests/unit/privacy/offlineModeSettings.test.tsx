import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fireEvent, render, screen, waitFor } from '@testing-library/react';

const controls = vi.hoisted(() => ({ setOfflineMode: vi.fn() }));

vi.mock('@/platform/privacy/offlineMode', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/privacy/offlineMode')>();
  return {
    ...actual,
    hydrateOfflineMode: vi.fn(async () => ({ offlineMode: false, generation: 1 })),
    setOfflineMode: controls.setOfflineMode,
  };
});

import { OfflineModeSettings } from '@/features/settings/OfflineModeSettings';
import { useOfflineModeStore } from '@/platform/privacy/offlineMode';

describe('OfflineModeSettings', () => {
  beforeEach(() => {
    controls.setOfflineMode.mockClear();
    controls.setOfflineMode.mockImplementation(async (enabled: boolean) => {
      useOfflineModeStore.setState({ offlineMode: enabled, hydrated: true });
    });
    useOfflineModeStore.setState({
      offlineMode: false,
      generation: 1,
      hydrated: true,
      isHydrating: false,
      hydrationError: null,
    });
  });

  it('asks before enabling and uses the native-backed setting', async () => {
    render(<OfflineModeSettings />);
    fireEvent.click(screen.getByTestId('offline-mode-switch'));
    expect(screen.getByTestId('offline-mode-confirmation')).toHaveTextContent(
      'Sync, mail, updates, downloads, login, and external AI clients will pause.',
    );

    fireEvent.click(screen.getByTestId('offline-mode-confirm-enable'));
    await waitFor(() => expect(controls.setOfflineMode).toHaveBeenCalledWith(true));
    expect(screen.getByTestId('offline-mode-switch')).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByTestId('offline-mode-settings')).toHaveAttribute('data-offline-mode', 'on');
  });

  it('turns off directly after Offline Mode is already on', async () => {
    useOfflineModeStore.setState({ offlineMode: true, hydrated: true });
    render(<OfflineModeSettings />);
    fireEvent.click(screen.getByTestId('offline-mode-switch'));
    await waitFor(() => expect(controls.setOfflineMode).toHaveBeenCalledWith(false));
  });
});
