import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileSettings } from '@/features/settings/MobileSettings';
import { AdvancedSettings } from '@/features/settings/AdvancedSettings';

describe('Placeholder settings pages', () => {
  it('MobileSettings renders (shows provider tab triggers)', () => {
    render(<MobileSettings />);
    // MobileSettings is a re-export of MobileSettingsPage; verify stable tab testids.
    expect(screen.getByTestId('mobile-tab-icloud')).toBeInTheDocument();
  });


  it('AdvancedSettings renders (shows its info help)', () => {
    render(<AdvancedSettings />);
    // AdvancedSettings now tucks the description into an InfoHelp tooltip,
    // keeping the page quieter while still exposing the help text.
    const container = document.querySelector('[class*="space-y"]');
    expect(container).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /about/i })).toBeInTheDocument();
  });
});
