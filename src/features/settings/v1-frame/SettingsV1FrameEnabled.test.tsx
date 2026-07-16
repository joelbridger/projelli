import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getSettingsSectionDescriptors } from '@/features/settings/registry/settingsModuleRegistry';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useProfileStore } from '@/platform/profile/profileStore';
import { SettingsV1FrameEnabled } from './SettingsV1FrameEnabled';
import type { SettingsV1Runtime } from './runtime';

const runtime = {
  legacy: { settings: () => <div data-testid="legacy-settings-body" /> },
} satisfies SettingsV1Runtime;

describe('SettingsV1FrameEnabled', () => {
  afterEach(() => {
    useProfileStore.setState({ soloName: '', firmName: '' });
    useFirmStore.setState({ session: null });
  });

  it('uses the registered settings sections and keeps Organization wording', () => {
    render(<SettingsV1FrameEnabled runtime={runtime} />);

    for (const section of getSettingsSectionDescriptors()) {
      expect(
        screen.getByTestId(`settings-v1-section-${section.id}`)
      ).toBeInTheDocument();
    }
    expect(screen.getByTestId('settings-v1-organization')).toHaveTextContent(
      'Organization'
    );
    expect(screen.getByTestId('legacy-settings-body')).toBeInTheDocument();
  });

  it('keeps the existing profile and workspace entry points reachable', () => {
    useProfileStore.setState({
      soloName: 'Maya Patel',
      firmName: 'Northstar Wealth',
    });
    const onAccount = vi.fn();
    const onSettings = vi.fn();
    window.addEventListener('lantern:open-account', onAccount, { once: true });
    window.addEventListener('lantern:open-settings', onSettings, {
      once: true,
    });
    render(<SettingsV1FrameEnabled runtime={runtime} />);

    fireEvent.click(screen.getByTestId('settings-v1-profile-entry'));
    fireEvent.click(screen.getByTestId('settings-v1-workspace-entry'));

    expect(onAccount).toHaveBeenCalledOnce();
    expect(onSettings).toHaveBeenCalledWith(
      expect.objectContaining({ detail: { category: 'workspace' } })
    );
  });
});
