import {
  describe,
  it,
  expect,
  vi,
  beforeEach,
  afterEach,
  type Mock,
} from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
} from '@testing-library/react';
import { InstalledPluginsList } from '@/components/marketplace/InstalledPluginsList';
import type { MarketplaceService } from '@/modules/marketplace';
import type {
  PluginInstance,
  PluginManifest,
  PluginStatus,
} from '@/types/plugin';
import { setActivePluginManager } from '@/modules/plugins/pluginManagerHolder';
import { usePluginManagerStore } from '@/stores/pluginManagerStore';
import { usePluginsMarketplaceStore } from '@/stores/pluginsMarketplaceStore';

// ---- Fixtures -----------------------------------------------------------

function makeManifest(
  overrides: Partial<PluginManifest> = {},
): PluginManifest {
  return {
    id: 'word-counter',
    name: 'Word Counter',
    version: '1.0.0',
    apiVersion: '1',
    author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
    description: 'Counts words in your editor in real time.',
    main: 'index.js',
    permissions: ['editor:selection'],
    minProjelliVersion: '2.0.0',
    category: 'utility',
    tags: ['editor'],
    ...overrides,
  };
}

function makeInstance(
  status: PluginStatus,
  overrides: Partial<PluginManifest> = {},
): PluginInstance {
  const manifest = makeManifest(overrides);
  return {
    manifest,
    status,
    installPath: `/ws/.projelli/plugins/${manifest.id}`,
    lastError: status === 'crashed' ? 'kaboom' : null,
    installedAt: '2026-04-28T00:00:00.000Z',
    enabledAt: status === 'enabled' ? '2026-04-28T00:00:01.000Z' : null,
  };
}

interface MockManager {
  enable: Mock;
  disable: Mock;
  restart: Mock;
  uninstall: Mock;
  installFromTarball: Mock;
  listInstalled: Mock;
}

function makeManager(overrides: Partial<MockManager> = {}): MockManager {
  return {
    enable: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    uninstall: vi.fn(async () => {}),
    installFromTarball: vi.fn(async () => {}),
    listInstalled: vi.fn(() => []),
    ...overrides,
  };
}

function makeMarketplaceService(
  uninstall?: (id: string) => Promise<void>,
): MarketplaceService {
  return {
    cacheStatus: vi.fn(() => 'fresh' as const),
    lastFetchedAtIso: vi.fn(() => null),
    refresh: vi.fn(async () => {}),
    list: vi.fn(async () => []),
    getById: vi.fn(async () => null),
    install: vi.fn(),
    uninstall: vi.fn(uninstall ?? (async () => {})),
    listInstalled: vi.fn(async () => []),
    checkForUpdates: vi.fn(async () => []),
  } as unknown as MarketplaceService;
}

function seedInstalled(
  instances: PluginInstance[],
  statuses?: Record<string, PluginStatus>,
): void {
  const store = usePluginManagerStore.getState();
  store.setInstalled(instances);
  if (statuses) {
    for (const [id, status] of Object.entries(statuses)) {
      store.setStatus(id, status);
    }
  }
}

function seedMarketplace(service: MarketplaceService | null): void {
  usePluginsMarketplaceStore.getState().seed(service);
}

beforeEach(() => {
  vi.clearAllMocks();
  usePluginManagerStore.setState({
    installedPlugins: [],
    statusByPluginId: {},
    errorsByPluginId: {},
  });
  usePluginsMarketplaceStore.getState().clear();
  setActivePluginManager(null);
});

afterEach(() => {
  cleanup();
  setActivePluginManager(null);
});

// ---- Empty state --------------------------------------------------------

describe('InstalledPluginsList - empty state', () => {
  it('renders the empty placeholder when no plugins are installed', () => {
    render(<InstalledPluginsList />);
    expect(screen.getByTestId('installed-plugins-empty')).toBeInTheDocument();
    expect(
      screen.queryByTestId('installed-plugins-list'),
    ).not.toBeInTheDocument();
  });
});

// ---- Status badges ------------------------------------------------------

describe('InstalledPluginsList - status badges', () => {
  it.each([
    ['enabled', 'Enabled'],
    ['disabled', 'Disabled'],
    ['crashed', 'Crashed'],
    ['updating', 'Updating'],
  ] as const)('renders %s status with label %s', (status, label) => {
    seedInstalled([makeInstance(status)]);
    render(<InstalledPluginsList />);
    const badge = screen.getByTestId('installed-plugin-status-word-counter');
    expect(badge).toHaveAttribute('data-status', status);
    expect(badge).toHaveTextContent(label);
  });
});

// ---- Action buttons per status ------------------------------------------

describe('InstalledPluginsList - action buttons per status', () => {
  it('enabled -> shows Disable + Uninstall, hides Enable + Restart', () => {
    seedInstalled([makeInstance('enabled')]);
    render(<InstalledPluginsList />);
    expect(
      screen.getByTestId('installed-plugin-disable-word-counter'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('installed-plugin-uninstall-word-counter'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('installed-plugin-enable-word-counter'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('installed-plugin-restart-word-counter'),
    ).not.toBeInTheDocument();
  });

  it('disabled -> shows Enable + Uninstall, hides Disable + Restart', () => {
    seedInstalled([makeInstance('disabled')]);
    render(<InstalledPluginsList />);
    expect(
      screen.getByTestId('installed-plugin-enable-word-counter'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('installed-plugin-uninstall-word-counter'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('installed-plugin-disable-word-counter'),
    ).not.toBeInTheDocument();
  });

  it('crashed -> shows Restart + Disable + Uninstall + inline error panel', () => {
    seedInstalled([makeInstance('crashed')]);
    render(<InstalledPluginsList />);
    expect(
      screen.getByTestId('installed-plugin-restart-word-counter'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('installed-plugin-disable-word-counter'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('installed-plugin-uninstall-word-counter'),
    ).toBeInTheDocument();
    expect(
      screen.getByTestId('plugin-error-panel-word-counter'),
    ).toBeInTheDocument();
  });

  it('updating -> shows spinner only, no actions', () => {
    seedInstalled([makeInstance('updating')]);
    render(<InstalledPluginsList />);
    expect(
      screen.getByTestId('installed-plugin-updating-word-counter'),
    ).toBeInTheDocument();
    expect(
      screen.queryByTestId('installed-plugin-disable-word-counter'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('installed-plugin-uninstall-word-counter'),
    ).not.toBeInTheDocument();
  });
});

// ---- Action callbacks ---------------------------------------------------

describe('InstalledPluginsList - action callbacks', () => {
  it('Enable click calls manager.enable', async () => {
    seedInstalled([makeInstance('disabled')]);
    const manager = makeManager();
    setActivePluginManager(manager as never);
    render(<InstalledPluginsList />);
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('installed-plugin-enable-word-counter'),
      );
    });
    expect(manager.enable).toHaveBeenCalledWith('word-counter');
  });

  it('Disable click calls manager.disable', async () => {
    seedInstalled([makeInstance('enabled')]);
    const manager = makeManager();
    setActivePluginManager(manager as never);
    render(<InstalledPluginsList />);
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('installed-plugin-disable-word-counter'),
      );
    });
    expect(manager.disable).toHaveBeenCalledWith('word-counter');
  });

  it('Restart click on crashed plugin calls manager.restart', async () => {
    seedInstalled([makeInstance('crashed')]);
    const manager = makeManager();
    setActivePluginManager(manager as never);
    render(<InstalledPluginsList />);
    await act(async () => {
      fireEvent.click(
        screen.getByTestId('installed-plugin-restart-word-counter'),
      );
    });
    expect(manager.restart).toHaveBeenCalledWith('word-counter');
  });

  it('Uninstall opens confirm; on confirm, calls manager.uninstall BEFORE service.uninstall', async () => {
    seedInstalled([makeInstance('enabled')]);
    const manager = makeManager();
    setActivePluginManager(manager as never);
    const callOrder: string[] = [];
    manager.uninstall.mockImplementation(async () => {
      callOrder.push('manager');
    });
    const service = makeMarketplaceService(async () => {
      callOrder.push('service');
    });
    seedMarketplace(service);

    render(<InstalledPluginsList />);
    fireEvent.click(
      screen.getByTestId('installed-plugin-uninstall-word-counter'),
    );

    // ConfirmDialog renders an "Uninstall" action button. Click it.
    const confirmButtons = await screen.findAllByRole('button', {
      name: /uninstall/i,
    });
    const dialogConfirm =
      confirmButtons.find(
        (b) =>
          b.getAttribute('data-testid') !==
          'installed-plugin-uninstall-word-counter',
      ) ?? null;
    expect(dialogConfirm).not.toBeNull();
    await act(async () => {
      fireEvent.click(dialogConfirm!);
    });

    await waitFor(() => {
      expect(manager.uninstall).toHaveBeenCalledWith('word-counter');
      expect(service.uninstall).toHaveBeenCalledWith('word-counter');
    });
    expect(callOrder).toEqual(['manager', 'service']);
    await waitFor(() =>
      expect(
        screen.getByTestId('installed-plugins-outcome-success'),
      ).toBeInTheDocument(),
    );
  });
});

// ---- Sort order ---------------------------------------------------------

describe('InstalledPluginsList - rendering', () => {
  it('renders multiple plugins sorted alphabetically by name', () => {
    seedInstalled([
      makeInstance('enabled', { id: 'zebra', name: 'Zebra Plugin' }),
      makeInstance('enabled', { id: 'alpha', name: 'Alpha Plugin' }),
    ]);
    render(<InstalledPluginsList />);
    const rows = screen
      .getAllByTestId(/^installed-plugin-name-/)
      .map((el) => el.textContent);
    expect(rows).toEqual(['Alpha Plugin', 'Zebra Plugin']);
  });
});
