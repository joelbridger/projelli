import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { TemplatesTab } from '@/features/workflows/marketplace/TemplatesTab';
import { useTemplatesMarketplaceStore } from '@/features/workflows/templatesMarketplaceStore';
import type { MarketplaceService, CacheStatus } from '@/features/workflows/marketplace/svc';
import type { CatalogEntry, InstalledEntry } from '@/features/workflows/types/marketplace';

const ENTRY_A: CatalogEntry = {
  id: 'investor-update-v1',
  name: 'Monthly Investor Update',
  description: 'Walk through the monthly investor update.',
  version: '1.0.0',
  author: { name: 'Jameson Daines' },
  category: 'investor',
  tags: ['investor', 'update'],
  installUrl: 'https://example.test/a.tar.gz',
  manifestUrl: 'https://example.test/a.json',
  minKeepanceVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

const ENTRY_B: CatalogEntry = {
  id: 'product-launch-v1',
  name: 'Product Launch Plan',
  description: 'Kick off a product launch with a structured plan.',
  version: '0.3.0',
  author: { name: 'Allison D.' },
  category: 'product',
  tags: ['launch', 'product'],
  installUrl: 'https://example.test/b.tar.gz',
  manifestUrl: 'https://example.test/b.json',
  minKeepanceVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

interface StubOpts {
  list?: CatalogEntry[];
  installed?: InstalledEntry[];
  cacheStatus?: CacheStatus;
  refreshImpl?: (() => Promise<void>) | undefined;
}

function makeStubService(o: StubOpts = {}): MarketplaceService {
  const list = o.list ?? [ENTRY_A, ENTRY_B];
  const installed = o.installed ?? [];
  const cacheStatus = o.cacheStatus ?? 'fresh';
  return {
    cacheStatus: vi.fn(() => cacheStatus),
    lastFetchedAtIso: vi.fn(() => new Date().toISOString()),
    refresh: vi.fn(o.refreshImpl ?? (async () => {})),
    list: vi.fn(async () => list),
    getById: vi.fn(async (id: string) => list.find((e) => e.id === id) ?? null),
    install: vi.fn(),
    uninstall: vi.fn(),
    listInstalled: vi.fn(async () => installed),
    checkForUpdates: vi.fn(async () => []),
  } as unknown as MarketplaceService;
}

function seedStore(service: MarketplaceService | null, cacheStatus: CacheStatus = 'fresh') {
  useTemplatesMarketplaceStore.setState({
    service,
    reader: null,
    cacheStatus,
    updateCount: 0,
  });
}

beforeEach(() => {
  seedStore(null);
});

afterEach(() => {
  cleanup();
  seedStore(null);
});

describe('TemplatesTab', () => {
  it('shows an empty state when no service is loaded', () => {
    render(<TemplatesTab />);
    expect(screen.getByTestId('templates-tab-empty')).toBeInTheDocument();
  });

  it('on mount calls service.refresh({silent:true}) then service.list and renders the catalog', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<TemplatesTab />);

    await waitFor(() => {
      expect(screen.getByTestId('templates-tab-grid')).toBeInTheDocument();
    });
    expect(service.refresh).toHaveBeenCalledWith({ silent: true });
    expect(service.list).toHaveBeenCalled();
    expect(
      screen.getByTestId(`template-catalog-card-${ENTRY_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`template-catalog-card-${ENTRY_B.id}`),
    ).toBeInTheDocument();
  });

  it('after mount refresh, calls setCacheStatus on the store with the latest service status', async () => {
    const service = makeStubService({ cacheStatus: 'stale' });
    seedStore(service);
    const setCacheStatus = vi.spyOn(useTemplatesMarketplaceStore.getState(), 'setCacheStatus');
    render(<TemplatesTab />);
    await waitFor(() => {
      expect(setCacheStatus).toHaveBeenCalledWith('stale');
    });
  });

  it('search filters by name + description + tags case-insensitively', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<TemplatesTab />);
    await waitFor(() =>
      expect(screen.getByTestId('templates-tab-grid')).toBeInTheDocument(),
    );

    const search = screen.getByTestId('templates-tab-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'launch' } });

    expect(
      screen.queryByTestId(`template-catalog-card-${ENTRY_A.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`template-catalog-card-${ENTRY_B.id}`),
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'INVESTOR' } });
    expect(
      screen.getByTestId(`template-catalog-card-${ENTRY_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`template-catalog-card-${ENTRY_B.id}`),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'no-such-thing' } });
    expect(screen.getByTestId('templates-tab-empty-state')).toBeInTheDocument();
  });

  it('refresh button triggers service.refresh and updates cacheStatus', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<TemplatesTab />);
    await waitFor(() =>
      expect(screen.getByTestId('templates-tab-grid')).toBeInTheDocument(),
    );
    // Reset the initial silent refresh call so the assertion is unambiguous.
    (service.refresh as ReturnType<typeof vi.fn>).mockClear();
    (service.cacheStatus as ReturnType<typeof vi.fn>).mockReturnValue('fresh');
    const setCacheStatus = vi.spyOn(
      useTemplatesMarketplaceStore.getState(),
      'setCacheStatus',
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('templates-tab-refresh'));
    });

    expect(service.refresh).toHaveBeenCalledTimes(1);
    // Non-silent refresh on user-driven button click.
    expect(service.refresh).toHaveBeenCalledWith();
    expect(setCacheStatus).toHaveBeenCalledWith('fresh');
  });

  it('switching to Installed subview shows the empty-state when no templates are installed', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<TemplatesTab />);
    await waitFor(() =>
      expect(screen.getByTestId('templates-tab-grid')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('templates-tab-subview-installed'));
    expect(
      screen.getByTestId('installed-templates-empty'),
    ).toBeInTheDocument();
    // Browse grid is hidden.
    expect(screen.queryByTestId('templates-tab-grid')).not.toBeInTheDocument();
  });

  it('switching to Installed subview lists installed entries when present', async () => {
    const installed: InstalledEntry = {
      ...ENTRY_A,
      installedAt: '2026-04-28T00:00:00.000Z',
      installedPath: '/ws/.keepance/templates/investor-update-v1',
      provenance: 'community',
      manifestVersion: '1.0',
    };
    const service = makeStubService({ installed: [installed] });
    seedStore(service);
    render(<TemplatesTab />);
    await waitFor(() =>
      expect(screen.getByTestId('templates-tab-grid')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('templates-tab-subview-installed'));
    expect(
      screen.getByTestId(`installed-template-${ENTRY_A.id}`),
    ).toBeInTheDocument();
  });

  it('clicking a card opens the detail view and Back returns to the grid', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<TemplatesTab />);
    await waitFor(() =>
      expect(screen.getByTestId('templates-tab-grid')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`template-catalog-card-${ENTRY_A.id}`));
    expect(screen.getByTestId('template-detail-view')).toBeInTheDocument();
    expect(screen.queryByTestId('templates-tab-grid')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('template-detail-back'));
    expect(screen.getByTestId('templates-tab-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('template-detail-view')).not.toBeInTheDocument();
  });

  it('renders the empty-state when the catalog is empty', async () => {
    const service = makeStubService({ list: [] });
    seedStore(service);
    render(<TemplatesTab />);
    await waitFor(() =>
      expect(screen.getByTestId('templates-tab-empty-state')).toBeInTheDocument(),
    );
  });

  it('shows the Installed badge count next to the subview tab', async () => {
    const installed: InstalledEntry = {
      ...ENTRY_A,
      installedAt: '2026-04-28T00:00:00.000Z',
      installedPath: '/ws/.keepance/templates/investor-update-v1',
      provenance: 'community',
      manifestVersion: '1.0',
    };
    const service = makeStubService({ installed: [installed] });
    seedStore(service);
    render(<TemplatesTab />);
    await waitFor(() =>
      expect(screen.getByTestId('templates-tab-grid')).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('templates-tab-subview-installed'),
    ).toHaveTextContent('1');
  });
});
