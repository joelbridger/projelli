import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVisibleSettingsSectionDescriptors } from '@/features/settings/registry/settingsModuleRegistry';
import { setDevFlagOverride } from '@/platform/flags';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useProfileStore } from '@/platform/profile/profileStore';
import { SettingsV1FrameEnabled } from './SettingsV1FrameEnabled';
import type { SettingsV1Runtime } from './runtime';

const runtime = {
  legacy: { settings: () => <div data-testid="legacy-settings-body" /> },
  settings: { action: vi.fn(), restartOnboarding: vi.fn() },
  audit: { entries: [] },
  workspace: { rootPath: null },
} as unknown as SettingsV1Runtime;

describe('SettingsV1FrameEnabled', () => {
  afterEach(() => {
    useProfileStore.setState({ soloName: '', firmName: '' });
    useFirmStore.setState({ session: null });
    setDevFlagOverride('teams-roles', undefined);
    setDevFlagOverride('custom-fields-firm', undefined);
    setDevFlagOverride('contact-sources', undefined);
    setDevFlagOverride('notification-preferences', undefined);
  });

  it('uses the visible registered settings sections and keeps Organization wording', () => {
    setDevFlagOverride('teams-roles', true);
    render(<SettingsV1FrameEnabled runtime={runtime} />);

    for (const section of getVisibleSettingsSectionDescriptors()) {
      expect(
        screen.getByTestId(`settings-v1-section-${section.id}`)
      ).toBeInTheDocument();
    }
    expect(screen.getByTestId('settings-v1-organization')).toHaveTextContent(
      'Organization'
    );
    expect(screen.queryByTestId('legacy-settings-body')).not.toBeInTheDocument();
  });

  it('keeps the existing profile and workspace entry points reachable', () => {
    useProfileStore.setState({
      soloName: 'Maya Patel',
      firmName: 'Northstar Wealth',
    });
    const onAccount = vi.fn();
    window.addEventListener('lantern:open-account', onAccount, { once: true });
    render(<SettingsV1FrameEnabled runtime={runtime} />);

    fireEvent.click(screen.getByTestId('settings-v1-profile-entry'));
    fireEvent.click(screen.getByTestId('settings-v1-workspace-entry'));

    expect(onAccount).toHaveBeenCalledOnce();
    expect(screen.getByTestId('settings-v1-section-workspace')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });
});
