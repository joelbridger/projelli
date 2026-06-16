import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileSettings } from '@/components/settings/MobileSettings';
import { PluginsSettings } from '@/components/settings/PluginsSettings';
import { AdvancedSettings } from '@/components/settings/AdvancedSettings';

describe('Placeholder settings pages', () => {
  it('MobileSettings renders (shows provider tab triggers)', () => {
    render(<MobileSettings />);
    // MobileSettings is a re-export of MobileSettingsPage; verify stable tab testids.
    expect(screen.getByTestId('mobile-tab-icloud')).toBeInTheDocument();
  });

  it('PluginsSettings renders (shows the installed-plugins list element)', () => {
    render(<PluginsSettings />);
    expect(screen.getByTestId('plugins-installed-list')).toBeInTheDocument();
  });

  it('AdvancedSettings renders (shows its description paragraph)', () => {
    render(<AdvancedSettings />);
    // AdvancedSettings renders a description <p> from the i18n key
    // 'settings.advanced.description'. The element is always present even if
    // the translation falls back to the key itself.
    const container = document.querySelector('[class*="space-y"]');
    expect(container).toBeInTheDocument();
    // Verify the component renders at least one paragraph-level element.
    const paras = document.querySelectorAll('p');
    expect(paras.length).toBeGreaterThan(0);
  });
});
