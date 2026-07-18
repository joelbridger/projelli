import { fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { getVisibleSettingsSectionDescriptors } from '@/features/settings/registry/settingsModuleRegistry';
import { setDevFlagOverride } from '@/platform/flags';
import { useFirmStore } from '@/platform/firm/firmStore';
import { useProfileStore } from '@/platform/profile/profileStore';
import { SettingsV1FrameEnabled } from './SettingsV1FrameEnabled';
import type { SettingsV1Runtime } from './runtime';

const runtime: SettingsV1Runtime = {
  legacy: { settings: () => <div data-testid="legacy-settings-body" /> },
  settings: {
    action: vi.fn(),
    restartOnboarding: vi.fn(),
    loadTemplates: () => [],
    extraSections: [],
  },
  audit: { entries: [] },
  workspace: { rootPath: null },
};

const schedulingRuntime: SettingsV1Runtime = {
  ...runtime,
  settings: {
    ...runtime.settings,
    pageFocus: { category: 'scheduling', key: 1 },
  },
};

describe('SettingsV1FrameEnabled', () => {
  afterEach(() => {
    useProfileStore.setState({ soloName: '', firmName: '' });
    useFirmStore.setState({ session: null });
    setDevFlagOverride('teams-roles', undefined);
    setDevFlagOverride('custom-fields-firm', undefined);
    setDevFlagOverride('contact-sources', undefined);
    setDevFlagOverride('notification-preferences', undefined);
    setDevFlagOverride('booking-availability', undefined);
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

  it('shows the strongest shared search result before an earlier weak match', () => {
    render(<SettingsV1FrameEnabled runtime={runtime} />);

    fireEvent.change(screen.getByTestId('settings-v1-search'), {
      target: { value: 'plug' },
    });

    expect(screen.getByTestId('settings-v1-section-ai')).toBeInTheDocument();
    expect(screen.getByTestId('settings-v1-section-ai')).not.toHaveAttribute(
      'aria-current',
      'page',
    );
    expect(screen.getByTestId('settings-v1-section-advanced')).toHaveAttribute(
      'aria-current',
      'page',
    );
  });

  it('keeps the existing profile and workspace destinations reachable through menus', async () => {
    useProfileStore.setState({
      soloName: 'Maya Patel',
      firmName: 'Northstar Wealth',
    });
    const onAccount = vi.fn();
    window.addEventListener('lantern:open-account', onAccount, { once: true });
    render(<SettingsV1FrameEnabled runtime={runtime} />);

    fireEvent.pointerDown(screen.getByTestId('settings-v1-profile-entry'), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByTestId('settings-v1-profile-account'));
    fireEvent.pointerDown(screen.getByTestId('settings-v1-workspace-entry'), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(await screen.findByTestId('settings-v1-workspace-settings'));

    expect(onAccount).toHaveBeenCalledOnce();
    expect(screen.getByTestId('settings-v1-section-workspace')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('keeps the Personal and Organization destinations in their menus', async () => {
    setDevFlagOverride('teams-roles', true);
    setDevFlagOverride('notification-preferences', true);
    render(<SettingsV1FrameEnabled runtime={runtime} />);

    fireEvent.pointerDown(screen.getByTestId('settings-v1-profile-entry'), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      await screen.findByTestId('settings-v1-profile-personal-settings')
    );
    expect(screen.getByTestId('settings-v1-section-personal')).toHaveAttribute(
      'aria-current',
      'page'
    );

    fireEvent.pointerDown(screen.getByTestId('settings-v1-workspace-entry'), {
      button: 0,
      ctrlKey: false,
    });
    fireEvent.click(
      await screen.findByTestId('settings-v1-workspace-organization')
    );
    expect(screen.getByTestId('settings-v1-section-organization')).toHaveAttribute(
      'aria-current',
      'page'
    );
  });

  it('keeps booking availability absent in the enabled V1 Scheduling host while dark', () => {
    render(<SettingsV1FrameEnabled runtime={schedulingRuntime} />);

    expect(screen.getByTestId('settings-v1-section-scheduling')).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      screen.queryByTestId('booking-availability-settings')
    ).not.toBeInTheDocument();
  });

  it('reaches booking availability through the enabled V1 Scheduling host only while enabled', async () => {
    setDevFlagOverride('booking-availability', true);
    render(<SettingsV1FrameEnabled runtime={schedulingRuntime} />);

    expect(screen.getByTestId('settings-v1-section-scheduling')).toHaveAttribute(
      'aria-current',
      'page'
    );
    expect(
      await screen.findByTestId('booking-availability-settings')
    ).toBeInTheDocument();
  });
});
