import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from '@testing-library/react';
import { PluginsTab } from '@/components/marketplace/PluginsTab';
import { usePluginsMarketplaceStore } from '@/stores/pluginsMarketplaceStore';
import type { MarketplaceService, CacheStatus } from '@/modules/marketplace';
import type { CatalogEntry, InstalledEntry } from '@/types/marketplace';

const ENTRY_A: CatalogEntry = {
  id: 'word-counter',
  name: 'Word Counter',
  description: 'Counts words in your editor.',
  version: '1.0.0',
  author: { name: 'Jameson Daines' },
  category: 'utility',
  tags: ['editor', 'word-count'],
  installUrl: 'https://example.test/wc.tar.gz',
  manifestUrl: 'https://example.test/wc.json',
  minProjelliVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

const ENTRY_B: CatalogEntry = {
  id: 'mermaid-export',
  name: 'Mermaid Exporter',
  description: 'Export Mermaid diagrams to PNG.',
  version: '0.4.0',
  author: { name: 'Allison D.' },
  category: 'export',
  tags: ['mermaid', 'export'],
  installUrl: 'https://example.test/mx.tar.gz',
  manifestUrl: 'https://example.test/mx.json',
  minProjelliVersion: '2.0.0',
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

function seedStore(
  service: MarketplaceService | null,
  cacheStatus: CacheStatus = 'fresh',
) {
  usePluginsMarketplaceStore.setState({
    service,
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

describe('PluginsTab', () => {
  it('shows an empty state when no service is loaded', () => {
    render(<PluginsTab />);
    expect(screen.getByTestId('plugins-tab-empty')).toBeInTheDocument();
  });

  it('on mount calls service.refresh({silent:true}) then service.list and renders the catalog', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<PluginsTab />);

    await waitFor(() => {
      expect(screen.getByTestId('plugins-tab-grid')).toBeInTheDocument();
    });
    expect(service.refresh).toHaveBeenCalledWith({ silent: true });
    expect(service.list).toHaveBeenCalled();
    expect(
      screen.getByTestId(`plugin-catalog-card-${ENTRY_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId(`plugin-catalog-card-${ENTRY_B.id}`),
    ).toBeInTheDocument();
  });

  it('after mount refresh, calls setCacheStatus on the store with the latest service status', async () => {
    const service = makeStubService({ cacheStatus: 'stale' });
    seedStore(service);
    const setCacheStatus = vi.spyOn(
      usePluginsMarketplaceStore.getState(),
      'setCacheStatus',
    );
    render(<PluginsTab />);
    await waitFor(() => {
      expect(setCacheStatus).toHaveBeenCalledWith('stale');
    });
  });

  it('search filters by name + description + tags case-insensitively', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<PluginsTab />);
    await waitFor(() =>
      expect(screen.getByTestId('plugins-tab-grid')).toBeInTheDocument(),
    );

    const search = screen.getByTestId('plugins-tab-search') as HTMLInputElement;
    fireEvent.change(search, { target: { value: 'mermaid' } });

    expect(
      screen.queryByTestId(`plugin-catalog-card-${ENTRY_A.id}`),
    ).not.toBeInTheDocument();
    expect(
      screen.getByTestId(`plugin-catalog-card-${ENTRY_B.id}`),
    ).toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'WORD' } });
    expect(
      screen.getByTestId(`plugin-catalog-card-${ENTRY_A.id}`),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId(`plugin-catalog-card-${ENTRY_B.id}`),
    ).not.toBeInTheDocument();

    fireEvent.change(search, { target: { value: 'no-such-thing' } });
    expect(screen.getByTestId('plugins-tab-empty-state')).toBeInTheDocument();
  });

  it('refresh button triggers service.refresh and updates cacheStatus', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<PluginsTab />);
    await waitFor(() =>
      expect(screen.getByTestId('plugins-tab-grid')).toBeInTheDocument(),
    );
    (service.refresh as ReturnType<typeof vi.fn>).mockClear();
    (service.cacheStatus as ReturnType<typeof vi.fn>).mockReturnValue('fresh');
    const setCacheStatus = vi.spyOn(
      usePluginsMarketplaceStore.getState(),
      'setCacheStatus',
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('plugins-tab-refresh'));
    });

    expect(service.refresh).toHaveBeenCalledTimes(1);
    expect(service.refresh).toHaveBeenCalledWith();
    expect(setCacheStatus).toHaveBeenCalledWith('fresh');
  });

  it('switching to Installed subview shows the Group V stub', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<PluginsTab />);
    await waitFor(() =>
      expect(screen.getByTestId('plugins-tab-grid')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId('plugins-tab-subview-installed'));
    expect(screen.getByTestId('installed-plugins-empty')).toBeInTheDocument();
    // Browse grid is hidden.
    expect(screen.queryByTestId('plugins-tab-grid')).not.toBeInTheDocument();
  });

  it('clicking a card opens the (Group IV stub) detail view and Back returns to the grid', async () => {
    const service = makeStubService();
    seedStore(service);
    render(<PluginsTab />);
    await waitFor(() =>
      expect(screen.getByTestId('plugins-tab-grid')).toBeInTheDocument(),
    );

    fireEvent.click(screen.getByTestId(`plugin-catalog-card-${ENTRY_A.id}`));
    expect(screen.getByTestId('plugin-detail-view')).toBeInTheDocument();
    expect(screen.queryByTestId('plugins-tab-grid')).not.toBeInTheDocument();

    fireEvent.click(screen.getByTestId('plugin-detail-back'));
    expect(screen.getByTestId('plugins-tab-grid')).toBeInTheDocument();
    expect(screen.queryByTestId('plugin-detail-view')).not.toBeInTheDocument();
  });

  it('renders the empty-state when the catalog is empty', async () => {
    const service = makeStubService({ list: [] });
    seedStore(service);
    render(<PluginsTab />);
    await waitFor(() =>
      expect(screen.getByTestId('plugins-tab-empty-state')).toBeInTheDocument(),
    );
  });

  it('shows the Installed badge count next to the subview tab', async () => {
    const installed: InstalledEntry = {
      ...ENTRY_A,
      installedAt: '2026-04-28T00:00:00.000Z',
      installedPath: '/ws/.projelli/plugins/word-counter',
      provenance: 'community',
      manifestVersion: '1',
    };
    const service = makeStubService({ installed: [installed] });
    seedStore(service);
    render(<PluginsTab />);
    await waitFor(() =>
      expect(screen.getByTestId('plugins-tab-grid')).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('plugins-tab-subview-installed'),
    ).toHaveTextContent('1');
  });
});
