import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { render, screen, cleanup } from '@testing-library/react';
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

function resetStores() {
  useTemplatesMarketplaceStore.setState({
    service: null,
    reader: null,
    cacheStatus: 'fresh',
    updateCount: 0,
  });
}

describe('MarketplaceTab', () => {
  beforeEach(() => {
    resetStores();
  });

  afterEach(() => {
    cleanup();
    resetStores();
  });

  it('renders the marketplace tab container', () => {
    render(<MarketplaceTab />);
    expect(screen.getByTestId('marketplace-tab')).toBeInTheDocument();
  });

  it('shows the templates content area', () => {
    render(<MarketplaceTab />);
    expect(screen.getByTestId('marketplace-subtab-content-templates')).toBeInTheDocument();
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

  it('remounts without errors and shows the templates area', () => {
    const { unmount } = render(<MarketplaceTab />);
    expect(screen.getByTestId('marketplace-subtab-content-templates')).toBeInTheDocument();
    unmount();
    render(<MarketplaceTab />);
    expect(screen.getByTestId('marketplace-subtab-content-templates')).toBeInTheDocument();
  });
});
