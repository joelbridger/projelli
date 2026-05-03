import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { MarketplaceSettings } from '@/components/settings/MarketplaceSettings';
import { MobileSettings } from '@/components/settings/MobileSettings';
import { PluginsSettings } from '@/components/settings/PluginsSettings';
import { AdvancedSettings } from '@/components/settings/AdvancedSettings';

describe('Placeholder settings pages', () => {
  it('MarketplaceSettings renders heading', () => {
    render(<MarketplaceSettings />);
    expect(screen.getByRole('heading', { name: /marketplace/i })).toBeInTheDocument();
  });

  it('MobileSettings renders heading', () => {
    render(<MobileSettings />);
    expect(screen.getByRole('heading', { name: /mobile/i })).toBeInTheDocument();
  });

  it('PluginsSettings renders heading', () => {
    render(<PluginsSettings />);
    expect(screen.getByRole('heading', { name: /plugins/i })).toBeInTheDocument();
  });

  it('AdvancedSettings renders heading', () => {
    render(<AdvancedSettings />);
    expect(screen.getByRole('heading', { name: /advanced/i })).toBeInTheDocument();
  });
});
