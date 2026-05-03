import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, fireEvent, cleanup } from '@testing-library/react';
import { MarketplaceTab } from '@/components/marketplace/MarketplaceTab';
import { useTemplatesMarketplaceStore } from '@/stores/templatesMarketplaceStore';
import type { MarketplaceService } from '@/modules/marketplace';

// Minimal stub matching the surface MarketplaceTab + the offline banner read.
function makeStubService(overrides: Partial<MarketplaceService> = {}): MarketplaceService {
  return {
    cacheStatus: vi.fn(() => 'fresh' as const),
    lastFetchedAtIso: vi.fn(() => null),
    refresh: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    getById: vi.fn(async () => null),
    install: vi.fn(),
    uninstall: vi.fn(),
    listInstalled: vi.fn(async () => []),
    checkForUpdates: vi.fn(async () => []),
    ...overrides,
  } as unknown as MarketplaceService;
}

describe('MarketplaceTab', () => {
  beforeEach(() => {
    useTemplatesMarketplaceStore.setState({
      service: null,
      reader: null,
      cacheStatus: 'fresh',
      updateCount: 0,
    });
  });

  afterEach(() => {
    cleanup();
    useTemplatesMarketplaceStore.setState({
      service: null,
      reader: null,
      cacheStatus: 'fresh',
      updateCount: 0,
    });
  });

  it('renders Templates and Plugins subtab triggers', () => {
    render(<MarketplaceTab />);
    expect(screen.getByTestId('marketplace-subtab-templates')).toBeInTheDocument();
    expect(screen.getByTestId('marketplace-subtab-plugins')).toBeInTheDocument();
  });

  it('Templates subtab is selected by default and shows the placeholder', () => {
    render(<MarketplaceTab />);
    const templatesTrigger = screen.getByTestId('marketplace-subtab-templates');
    expect(templatesTrigger.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('marketplace-templates-placeholder')).toBeInTheDocument();
  });

  it('Plugins subtab is disabled and aria-disabled', () => {
    render(<MarketplaceTab />);
    const pluginsTrigger = screen.getByTestId('marketplace-subtab-plugins');
    expect(pluginsTrigger).toBeDisabled();
    expect(pluginsTrigger.getAttribute('aria-disabled')).toBe('true');
  });

  it('does not switch to plugins subtab when its trigger is clicked', () => {
    render(<MarketplaceTab />);
    const templatesTrigger = screen.getByTestId('marketplace-subtab-templates');
    const pluginsTrigger = screen.getByTestId('marketplace-subtab-plugins');
    fireEvent.click(pluginsTrigger);
    // Disabled buttons emit no click event but verify state regardless.
    expect(templatesTrigger.getAttribute('aria-selected')).toBe('true');
    expect(screen.getByTestId('marketplace-templates-placeholder')).toBeInTheDocument();
  });

  it('renders the offline banner when cacheStatus is stale', () => {
    const service = makeStubService({
      cacheStatus: vi.fn(() => 'stale' as const),
      lastFetchedAtIso: vi.fn(() => new Date(Date.now() - 60_000).toISOString()),
    } as Partial<MarketplaceService>);
    useTemplatesMarketplaceStore.setState({
      service,
      reader: null,
      cacheStatus: 'stale',
      updateCount: 0,
    });
    render(<MarketplaceTab />);
    expect(screen.getByTestId('marketplace-offline-banner')).toBeInTheDocument();
  });

  it('hides the offline banner when cacheStatus is fresh', () => {
    const service = makeStubService();
    useTemplatesMarketplaceStore.setState({
      service,
      reader: null,
      cacheStatus: 'fresh',
      updateCount: 0,
    });
    render(<MarketplaceTab />);
    expect(screen.queryByTestId('marketplace-offline-banner')).not.toBeInTheDocument();
  });

  it('preserves the selected subtab across remounts via internal state', () => {
    // The Templates subtab stays the default through unmount/remount because
    // the placeholder is the only enabled subtab. The contract here is that
    // remounting does not throw and lands the user back on Templates.
    const { unmount } = render(<MarketplaceTab />);
    expect(screen.getByTestId('marketplace-subtab-templates').getAttribute('aria-selected')).toBe(
      'true',
    );
    unmount();
    render(<MarketplaceTab />);
    expect(screen.getByTestId('marketplace-subtab-templates').getAttribute('aria-selected')).toBe(
      'true',
    );
  });
});
