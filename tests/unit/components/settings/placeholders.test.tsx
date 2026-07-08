import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MobileSettings } from '@/features/settings/MobileSettings';
import { AdvancedSettings } from '@/features/settings/AdvancedSettings';

describe('Placeholder settings pages', () => {
  it('MobileSettings renders (shows provider tab triggers)', () => {
    render(<MobileSettings />);
    // MobileSettings is a re-export of MobileSettingsPage; verify stable provider handles.
    expect(screen.getByTestId('mobile-tab-icloud')).toBeInTheDocument();
  });


  it('AdvancedSettings hides the empty placeholder', () => {
    const { container } = render(<AdvancedSettings />);
    expect(container.firstChild).toBeNull();
  });
});
