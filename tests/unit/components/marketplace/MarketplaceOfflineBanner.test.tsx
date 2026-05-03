import { describe, it, expect, vi, afterEach } from 'vitest';
import { render, screen, fireEvent, waitFor, cleanup } from '@testing-library/react';
import { MarketplaceOfflineBanner } from '@/components/marketplace/MarketplaceOfflineBanner';
import type { CacheStatus, MarketplaceService } from '@/modules/marketplace';

interface StubServiceOverrides {
  cacheStatus?: CacheStatus;
  lastFetchedAtIso?: string | null;
  refresh?: () => Promise<void>;
}

function makeStubService(overrides: StubServiceOverrides = {}): MarketplaceService {
  let nextStatus: CacheStatus = overrides.cacheStatus ?? 'fresh';
  return {
    cacheStatus: vi.fn(() => nextStatus),
    lastFetchedAtIso: vi.fn(() => overrides.lastFetchedAtIso ?? null),
    refresh: vi.fn(async () => {
      if (overrides.refresh) {
        await overrides.refresh();
      }
      nextStatus = 'fresh';
    }),
    list: vi.fn(async () => []),
    getById: vi.fn(async () => null),
    install: vi.fn(),
    uninstall: vi.fn(),
    listInstalled: vi.fn(async () => []),
    checkForUpdates: vi.fn(async () => []),
  } as unknown as MarketplaceService;
}

describe('MarketplaceOfflineBanner', () => {
  afterEach(() => cleanup());

  it('renders nothing when cacheStatus is fresh', () => {
    const service = makeStubService();
    const { container } = render(
      <MarketplaceOfflineBanner service={service} cacheStatus="fresh" />,
    );
    expect(container.firstChild).toBeNull();
  });

  it('renders amber stale banner with relative time', () => {
    const oneHourAgo = new Date(Date.now() - 60 * 60 * 1000).toISOString();
    const service = makeStubService({
      cacheStatus: 'stale',
      lastFetchedAtIso: oneHourAgo,
    });
    render(<MarketplaceOfflineBanner service={service} cacheStatus="stale" />);
    const banner = screen.getByTestId('marketplace-offline-banner');
    expect(banner.getAttribute('data-status')).toBe('stale');
    expect(banner.textContent).toContain('Showing cached catalog');
    expect(banner.textContent).toMatch(/1 hour ago/);
  });

  it('renders destructive offline banner', () => {
    const service = makeStubService({ cacheStatus: 'offline', lastFetchedAtIso: null });
    render(<MarketplaceOfflineBanner service={service} cacheStatus="offline" />);
    const banner = screen.getByTestId('marketplace-offline-banner');
    expect(banner.getAttribute('data-status')).toBe('offline');
    expect(banner.textContent).toContain('Marketplace unreachable');
    expect(banner.textContent).toContain('No cached catalog yet');
  });

  it('shows "Last updated" detail for offline status when a previous cache exists', () => {
    const oldIso = new Date(Date.now() - 2 * 24 * 60 * 60 * 1000).toISOString();
    const service = makeStubService({ cacheStatus: 'offline', lastFetchedAtIso: oldIso });
    render(<MarketplaceOfflineBanner service={service} cacheStatus="offline" />);
    const banner = screen.getByTestId('marketplace-offline-banner');
    expect(banner.textContent).toMatch(/2 days ago/);
  });

  it('Retry button calls service.refresh() and reports new status via onRefreshed', async () => {
    const onRefreshed = vi.fn();
    const service = makeStubService({
      cacheStatus: 'offline',
      lastFetchedAtIso: null,
    });
    render(
      <MarketplaceOfflineBanner
        service={service}
        cacheStatus="offline"
        onRefreshed={onRefreshed}
      />,
    );
    fireEvent.click(screen.getByTestId('marketplace-offline-retry'));
    await waitFor(() => expect(service.refresh).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(onRefreshed).toHaveBeenCalledWith('fresh'));
  });

  it('Retry button is disabled when service is null', () => {
    render(<MarketplaceOfflineBanner service={null} cacheStatus="offline" />);
    expect(screen.getByTestId('marketplace-offline-retry')).toBeDisabled();
  });

  it('swallows refresh errors and still calls onRefreshed', async () => {
    const onRefreshed = vi.fn();
    const service = makeStubService({
      cacheStatus: 'offline',
      lastFetchedAtIso: null,
      refresh: async () => {
        throw new Error('network down');
      },
    });
    render(
      <MarketplaceOfflineBanner
        service={service}
        cacheStatus="offline"
        onRefreshed={onRefreshed}
      />,
    );
    fireEvent.click(screen.getByTestId('marketplace-offline-retry'));
    await waitFor(() => expect(onRefreshed).toHaveBeenCalledTimes(1));
  });
});
