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
import { PluginDetailView } from '@/components/marketplace/PluginDetailView';
import type {
  InstallPhase,
  MarketplaceService,
} from '@/modules/marketplace';
import type {
  CatalogEntry,
  InstalledEntry,
} from '@/types/marketplace';
import type {
  PluginInstance,
  PluginManifest,
  PluginStatus,
} from '@/types/plugin';
import { setActivePluginManager } from '@/modules/plugins/pluginManagerHolder';
import {
  usePluginManagerStore,
} from '@/stores/pluginManagerStore';

// ---- Stubs --------------------------------------------------------------

// usePluginConsentDialog returns { confirm, dialog }. We swap confirm for
// a controllable spy + render a no-op dialog node so the host can mount it.
const consentSpy = vi.fn<(m: PluginManifest) => Promise<boolean>>();
vi.mock('@/components/marketplace/PluginConsentDialog', async () => {
  const actual = await vi.importActual<
    typeof import('@/components/marketplace/PluginConsentDialog')
  >('@/components/marketplace/PluginConsentDialog');
  return {
    ...actual,
    usePluginConsentDialog: () => ({
      confirm: consentSpy,
      dialog: null,
    }),
  };
});

// ---- Fixtures -----------------------------------------------------------

const ENTRY: CatalogEntry = {
  id: 'word-counter',
  name: 'Word Counter',
  description: 'Counts words in your editor in real time.',
  version: '1.0.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  category: 'utility',
  tags: ['editor', 'counter'],
  screenshots: [
    'https://example.test/shot1.png',
    'https://example.test/shot2.png',
  ],
  installUrl: 'https://example.test/word-counter.tar.gz',
  manifestUrl: 'https://example.test/word-counter.manifest.json',
  minProjelliVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

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
    tags: ['editor', 'counter'],
    ...overrides,
  };
}

function makeInstalled(version: string): InstalledEntry {
  return {
    ...ENTRY,
    version,
    installedAt: '2026-04-28T00:00:00.000Z',
    installedPath: '/ws/.projelli/plugins/word-counter',
    provenance: 'community',
    manifestVersion: '1',
  };
}

function makeInstance(
  status: PluginStatus,
  manifest: PluginManifest = makeManifest(),
): PluginInstance {
  return {
    manifest,
    status,
    installPath: '/ws/.projelli/plugins/word-counter',
    lastError: status === 'crashed' ? 'kaboom' : null,
    installedAt: '2026-04-28T00:00:00.000Z',
    enabledAt: status === 'enabled' ? '2026-04-28T00:00:01.000Z' : null,
  };
}

interface SvcOpts {
  installImpl?: (
    id: string,
    opts?: { onProgress?: (phase: InstallPhase, pct: number) => void },
  ) => Promise<InstalledEntry>;
  uninstallImpl?: (id: string) => Promise<void>;
}

function makeService(o: SvcOpts = {}): MarketplaceService {
  return {
    cacheStatus: vi.fn(() => 'fresh' as const),
    lastFetchedAtIso: vi.fn(() => null),
    refresh: vi.fn(async () => {}),
    list: vi.fn(async () => [ENTRY]),
    getById: vi.fn(async () => ENTRY),
    install: vi.fn(o.installImpl ?? (async () => makeInstalled('1.0.0'))),
    uninstall: vi.fn(o.uninstallImpl ?? (async () => {})),
    listInstalled: vi.fn(async () => []),
    checkForUpdates: vi.fn(async () => []),
  } as unknown as MarketplaceService;
}

interface MockManager {
  installFromTarball: Mock;
  uninstall: Mock;
  enable: Mock;
  disable: Mock;
  restart: Mock;
  listInstalled: Mock;
}

function makeManager(overrides: Partial<MockManager> = {}): MockManager {
  return {
    installFromTarball: vi.fn(async () => makeInstance('enabled')),
    uninstall: vi.fn(async () => {}),
    enable: vi.fn(async () => {}),
    disable: vi.fn(async () => {}),
    restart: vi.fn(async () => {}),
    listInstalled: vi.fn(() => []),
    ...overrides,
  };
}

function setManagerStatus(id: string, status: PluginStatus): void {
  // Pre-populate the store so selectStatus(id) returns the desired status.
  // We seed via setInstalled + setStatus to avoid relying on internal API.
  const store = usePluginManagerStore.getState();
  store.setInstalled([makeInstance(status)]);
  store.setStatus(id, status);
}

function clearStore(): void {
  const store = usePluginManagerStore.getState();
  store.setInstalled([]);
}

beforeEach(() => {
  vi.clearAllMocks();
  consentSpy.mockReset();
  clearStore();
  setActivePluginManager(null);

  // Default: fetch returns a valid manifest.
  global.fetch = vi.fn(async () =>
    new Response(JSON.stringify(makeManifest()), {
      status: 200,
      headers: { 'content-type': 'application/json' },
    }),
  ) as unknown as typeof fetch;
});

afterEach(() => {
  cleanup();
  setActivePluginManager(null);
});

// ---- Basic render -------------------------------------------------------

describe('PluginDetailView - basic render', () => {
  it('renders name, description, version, author, github link', () => {
    const service = makeService();
    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );
    expect(screen.getByTestId('plugin-detail-name')).toHaveTextContent(
      'Word Counter',
    );
    expect(
      screen.getByTestId('plugin-detail-description'),
    ).toHaveTextContent('Counts words');
    expect(screen.getByTestId('plugin-detail-author')).toHaveTextContent(
      'Jameson Daines',
    );
    expect(
      screen.getByTestId('plugin-detail-github-link').getAttribute('href'),
    ).toBe('https://github.com/jamesondaines');
  });

  it('renders carousel when screenshots present', () => {
    const service = makeService();
    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );
    expect(screen.getByTestId('plugin-detail-carousel')).toBeInTheDocument();
  });

  it('renders empty carousel placeholder when no screenshots', () => {
    const service = makeService();
    const noShots: CatalogEntry = { ...ENTRY };
    delete (noShots as Partial<CatalogEntry>).screenshots;
    render(
      <PluginDetailView
        entry={noShots}
        service={service}
        onBack={() => {}}
      />,
    );
    expect(
      screen.getByTestId('plugin-detail-carousel-empty'),
    ).toBeInTheDocument();
  });

  it('Back button calls onBack', () => {
    const onBack = vi.fn();
    const service = makeService();
    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={onBack} />,
    );
    fireEvent.click(screen.getByTestId('plugin-detail-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });

  it('fetches the manifest and renders the permissions list', async () => {
    const service = makeService();
    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-permission-editor:selection'),
      ).toBeInTheDocument(),
    );
  });

  it('reports the manifest permission count via onManifestLoaded', async () => {
    const onManifestLoaded = vi.fn();
    const service = makeService();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        onBack={() => {}}
        onManifestLoaded={onManifestLoaded}
      />,
    );
    await waitFor(() => {
      expect(onManifestLoaded).toHaveBeenCalledWith('word-counter', 1);
    });
  });
});

// ---- Action button states -----------------------------------------------

describe('PluginDetailView - action button states', () => {
  it('not installed -> renders [Install] only', () => {
    const service = makeService();
    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );
    expect(screen.getByTestId('plugin-detail-install')).toBeInTheDocument();
    expect(
      screen.queryByTestId('plugin-detail-uninstall'),
    ).not.toBeInTheDocument();
    expect(
      screen.queryByTestId('plugin-detail-update'),
    ).not.toBeInTheDocument();
  });

  it('installed + enabled -> [Disable] + [Uninstall]', () => {
    setManagerStatus(ENTRY.id, 'enabled');
    const service = makeService();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
      />,
    );
    expect(screen.getByTestId('plugin-detail-disable')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-detail-uninstall')).toBeInTheDocument();
    expect(
      screen.queryByTestId('plugin-detail-enable'),
    ).not.toBeInTheDocument();
  });

  it('installed + disabled -> [Enable] + [Uninstall]', () => {
    setManagerStatus(ENTRY.id, 'disabled');
    const service = makeService();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
      />,
    );
    expect(screen.getByTestId('plugin-detail-enable')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-detail-uninstall')).toBeInTheDocument();
    expect(
      screen.queryByTestId('plugin-detail-disable'),
    ).not.toBeInTheDocument();
  });

  it('installed + crashed -> [Restart] + [Disable] + [Uninstall]', () => {
    setManagerStatus(ENTRY.id, 'crashed');
    const service = makeService();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
      />,
    );
    expect(screen.getByTestId('plugin-detail-restart')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-detail-disable')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-detail-uninstall')).toBeInTheDocument();
  });

  it('installed + updating -> spinner only, no actions enabled', () => {
    setManagerStatus(ENTRY.id, 'updating');
    const service = makeService();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
      />,
    );
    expect(screen.getByTestId('plugin-detail-updating')).toBeDisabled();
    expect(
      screen.queryByTestId('plugin-detail-uninstall'),
    ).not.toBeInTheDocument();
  });

  it('installed + update available -> [Update] + [Uninstall]', () => {
    setManagerStatus(ENTRY.id, 'enabled');
    const service = makeService();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('0.9.0')}
        updateAvailable
        onBack={() => {}}
      />,
    );
    expect(screen.getByTestId('plugin-detail-update')).toBeInTheDocument();
    expect(screen.getByTestId('plugin-detail-uninstall')).toBeInTheDocument();
    expect(
      screen.queryByTestId('plugin-detail-disable'),
    ).not.toBeInTheDocument();
  });
});

// ---- Install flow -------------------------------------------------------

describe('PluginDetailView - install flow', () => {
  it('Install -> consent (approve) -> service.install -> manager.installFromTarball', async () => {
    consentSpy.mockResolvedValue(true);
    const service = makeService();
    const manager = makeManager();
    setActivePluginManager(manager as never);

    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );

    // Wait for the manifest fetch so consent has something to show.
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-permission-editor:selection'),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-install'));
    });

    expect(consentSpy).toHaveBeenCalledTimes(1);
    expect(service.install).toHaveBeenCalledWith(
      ENTRY.id,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );
    expect(manager.installFromTarball).toHaveBeenCalledWith(
      '/ws/.projelli/plugins/word-counter',
      expect.objectContaining({ onConsent: expect.any(Function) }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-detail-outcome-success'),
      ).toBeInTheDocument(),
    );
  });

  it('Install -> consent (cancel) does NOT call service.install or manager', async () => {
    consentSpy.mockResolvedValue(false);
    const service = makeService();
    const manager = makeManager();
    setActivePluginManager(manager as never);

    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-permission-editor:selection'),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-install'));
    });

    expect(consentSpy).toHaveBeenCalledTimes(1);
    expect(service.install).not.toHaveBeenCalled();
    expect(manager.installFromTarball).not.toHaveBeenCalled();
    expect(
      screen.getByTestId('plugin-detail-outcome-cancelled'),
    ).toBeInTheDocument();
  });

  it('Install with no active PluginManager still completes via service install only', async () => {
    consentSpy.mockResolvedValue(true);
    const service = makeService();

    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-permission-editor:selection'),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-install'));
    });

    expect(service.install).toHaveBeenCalled();
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-detail-outcome-success'),
      ).toBeInTheDocument(),
    );
  });

  it('Install: failure to fetch manifest surfaces a friendly error', async () => {
    consentSpy.mockResolvedValue(true);
    global.fetch = vi.fn(async () =>
      new Response('not found', { status: 404 }),
    ) as unknown as typeof fetch;
    const service = makeService();
    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-install'));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-detail-outcome-failure'),
      ).toBeInTheDocument(),
    );
    expect(consentSpy).not.toHaveBeenCalled();
    expect(service.install).not.toHaveBeenCalled();
  });

  it('Install: marketplace install error maps to friendly outcome', async () => {
    consentSpy.mockResolvedValue(true);
    const service = makeService({
      installImpl: async () => {
        throw new Error('Checksum mismatch for word-counter');
      },
    });
    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-permission-editor:selection'),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-install'));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-detail-outcome-failure'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('plugin-detail-outcome-failure'),
    ).toHaveTextContent('Tarball corrupt.');
  });
});

// ---- Update flow --------------------------------------------------------

describe('PluginDetailView - update flow', () => {
  it('Update -> service.install with isUpdate + fromVersion', async () => {
    consentSpy.mockResolvedValue(true);
    setManagerStatus(ENTRY.id, 'enabled');
    const installSpy = vi.fn(async () => makeInstalled('1.1.0'));
    const service = makeService({ installImpl: installSpy });
    const manager = makeManager();
    setActivePluginManager(manager as never);

    render(
      <PluginDetailView
        entry={{ ...ENTRY, version: '1.1.0' }}
        service={service}
        installed={makeInstalled('1.0.0')}
        updateAvailable
        onBack={() => {}}
      />,
    );

    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-permission-editor:selection'),
      ).toBeInTheDocument(),
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-update'));
    });

    expect(installSpy).toHaveBeenCalledWith(
      ENTRY.id,
      expect.objectContaining({
        isUpdate: true,
        fromVersion: '1.0.0',
        onProgress: expect.any(Function),
      }),
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-detail-outcome-success'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('plugin-detail-outcome-success'),
    ).toHaveTextContent(/Updated/);
  });

  it('fresh install does NOT pass isUpdate', async () => {
    consentSpy.mockResolvedValue(true);
    const installSpy = vi.fn(async () => makeInstalled('1.0.0'));
    const service = makeService({ installImpl: installSpy });
    render(
      <PluginDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );
    await waitFor(() =>
      expect(
        screen.getByTestId('plugin-permission-editor:selection'),
      ).toBeInTheDocument(),
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-install'));
    });
    const opts = installSpy.mock.calls[0]?.[1] as
      | { isUpdate?: boolean; fromVersion?: string }
      | undefined;
    expect(opts?.isUpdate).toBeUndefined();
    expect(opts?.fromVersion).toBeUndefined();
  });
});

// ---- Lifecycle actions --------------------------------------------------

describe('PluginDetailView - lifecycle actions', () => {
  it('Disable click calls manager.disable', async () => {
    setManagerStatus(ENTRY.id, 'enabled');
    const manager = makeManager();
    setActivePluginManager(manager as never);
    const service = makeService();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-disable'));
    });
    expect(manager.disable).toHaveBeenCalledWith(ENTRY.id);
  });

  it('Enable click calls manager.enable', async () => {
    setManagerStatus(ENTRY.id, 'disabled');
    const manager = makeManager();
    setActivePluginManager(manager as never);
    const service = makeService();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-enable'));
    });
    expect(manager.enable).toHaveBeenCalledWith(ENTRY.id);
  });

  it('Restart click on crashed plugin calls manager.restart', async () => {
    setManagerStatus(ENTRY.id, 'crashed');
    const manager = makeManager();
    setActivePluginManager(manager as never);
    const service = makeService();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-restart'));
    });
    expect(manager.restart).toHaveBeenCalledWith(ENTRY.id);
  });

  it('Uninstall click calls manager.uninstall AND service.uninstall', async () => {
    setManagerStatus(ENTRY.id, 'enabled');
    const manager = makeManager();
    setActivePluginManager(manager as never);
    const service = makeService();
    const onUninstalled = vi.fn();
    render(
      <PluginDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
        onUninstalled={onUninstalled}
      />,
    );
    await act(async () => {
      fireEvent.click(screen.getByTestId('plugin-detail-uninstall'));
    });
    expect(manager.uninstall).toHaveBeenCalledWith(ENTRY.id);
    expect(service.uninstall).toHaveBeenCalledWith(ENTRY.id);
    await waitFor(() => expect(onUninstalled).toHaveBeenCalledWith(ENTRY.id));
  });
});
