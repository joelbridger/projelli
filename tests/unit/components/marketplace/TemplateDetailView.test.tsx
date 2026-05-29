import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { render, screen, fireEvent, cleanup, waitFor, act } from '@testing-library/react';
import { TemplateDetailView } from '@/components/marketplace/TemplateDetailView';
import type { MarketplaceService, InstallPhase } from '@/modules/marketplace';
import type { CatalogEntry, InstalledEntry } from '@/types/marketplace';

const ENTRY: CatalogEntry = {
  id: 'investor-update-v1',
  name: 'Monthly Investor Update',
  description: 'A walkthrough for the monthly investor update.',
  version: '1.0.0',
  author: { name: 'Jameson Daines', githubUser: 'jamesondaines' },
  category: 'investor',
  tags: ['investor', 'update'],
  screenshots: [
    'https://example.test/shot1.png',
    'https://example.test/shot2.png',
    'https://example.test/shot3.png',
  ],
  installUrl: 'https://example.test/x.tar.gz',
  manifestUrl: 'https://example.test/x.json',
  minKeepanceVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

function makeInstalled(version: string): InstalledEntry {
  return {
    ...ENTRY,
    version,
    installedAt: '2026-04-28T00:00:00.000Z',
    installedPath: '/ws/.keepance/templates/investor-update-v1',
    provenance: 'community',
    manifestVersion: '1.0',
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

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('TemplateDetailView — basic render', () => {
  it('renders name, description, version, author, and GitHub link', () => {
    const service = makeService();
    render(
      <TemplateDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );
    expect(screen.getByTestId('template-detail-name')).toHaveTextContent(
      'Monthly Investor Update',
    );
    expect(screen.getByTestId('template-detail-description')).toHaveTextContent(
      'A walkthrough for the monthly investor update.',
    );
    expect(screen.getByTestId('template-detail-author')).toHaveTextContent(
      'Jameson Daines',
    );
    const link = screen.getByTestId('template-detail-github-link');
    expect(link.getAttribute('href')).toBe('https://github.com/jamesondaines');
  });

  it('renders carousel with prev/next when multiple screenshots', () => {
    const service = makeService();
    render(
      <TemplateDetailView entry={ENTRY} service={service} onBack={() => {}} />,
    );
    expect(screen.getByTestId('template-detail-carousel')).toBeInTheDocument();
    expect(
      screen.getByTestId('template-detail-carousel-next'),
    ).toBeInTheDocument();
  });

  it('renders the empty-screenshots placeholder when no screenshots', () => {
    const service = makeService();
    const noShots: CatalogEntry = { ...ENTRY };
    delete (noShots as Partial<CatalogEntry>).screenshots;
    render(
      <TemplateDetailView entry={noShots} service={service} onBack={() => {}} />,
    );
    expect(
      screen.getByTestId('template-detail-carousel-empty'),
    ).toBeInTheDocument();
  });

  it('Back button calls onBack', () => {
    const onBack = vi.fn();
    const service = makeService();
    render(<TemplateDetailView entry={ENTRY} service={service} onBack={onBack} />);
    fireEvent.click(screen.getByTestId('template-detail-back'));
    expect(onBack).toHaveBeenCalledTimes(1);
  });
});

describe('TemplateDetailView — action button states', () => {
  it('not installed → renders [Install]', () => {
    const service = makeService();
    render(<TemplateDetailView entry={ENTRY} service={service} onBack={() => {}} />);
    expect(screen.getByTestId('template-detail-install')).toBeInTheDocument();
    expect(
      screen.queryByTestId('template-detail-uninstall'),
    ).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-detail-update')).not.toBeInTheDocument();
  });

  it('installed at current version → renders [Uninstall] only', () => {
    const service = makeService();
    render(
      <TemplateDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
      />,
    );
    expect(screen.getByTestId('template-detail-uninstall')).toBeInTheDocument();
    expect(screen.queryByTestId('template-detail-install')).not.toBeInTheDocument();
    expect(screen.queryByTestId('template-detail-update')).not.toBeInTheDocument();
  });

  it('installed and update available → renders [Update] + [Uninstall]', () => {
    const service = makeService();
    render(
      <TemplateDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('0.9.0')}
        updateAvailable
        onBack={() => {}}
      />,
    );
    expect(screen.getByTestId('template-detail-update')).toBeInTheDocument();
    expect(screen.getByTestId('template-detail-uninstall')).toBeInTheDocument();
    expect(screen.queryByTestId('template-detail-install')).not.toBeInTheDocument();
  });
});

describe('TemplateDetailView — install flow', () => {
  it('clicking Install calls service.install, surfaces progress, and shows success outcome', async () => {
    let progressCallback:
      | ((phase: InstallPhase, pct: number) => void)
      | undefined;
    const service = makeService({
      installImpl: async (_id, opts) => {
        progressCallback = opts?.onProgress;
        // Simulate a phase update before resolving so the progress panel renders.
        progressCallback?.('download', 25);
        return makeInstalled('1.0.0');
      },
    });
    const onInstalled = vi.fn();

    render(
      <TemplateDetailView
        entry={ENTRY}
        service={service}
        onBack={() => {}}
        onInstalled={onInstalled}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('template-detail-install'));
    });

    expect(service.install).toHaveBeenCalledWith(
      ENTRY.id,
      expect.objectContaining({ onProgress: expect.any(Function) }),
    );

    await waitFor(() => {
      expect(
        screen.getByTestId('template-detail-outcome-success'),
      ).toBeInTheDocument();
    });
    expect(onInstalled).toHaveBeenCalledTimes(1);
    // View in Audit Log button is offered on success.
    expect(
      screen.getByTestId('template-detail-view-audit-log'),
    ).toBeInTheDocument();
  });

  it('progress bar renders the latest phase + percent', async () => {
    let resolveInstall!: (v: InstalledEntry) => void;
    let progressCallback:
      | ((phase: InstallPhase, pct: number) => void)
      | undefined;
    const service = makeService({
      installImpl: async (_id, opts) => {
        progressCallback = opts?.onProgress;
        return new Promise<InstalledEntry>((res) => {
          resolveInstall = res;
        });
      },
    });

    render(<TemplateDetailView entry={ENTRY} service={service} onBack={() => {}} />);
    fireEvent.click(screen.getByTestId('template-detail-install'));

    // Push a progress event mid-install.
    await act(async () => {
      progressCallback?.('extract', 60);
    });
    const panel = screen.getByTestId('template-detail-progress');
    expect(panel.getAttribute('data-phase')).toBe('extract');
    expect(panel).toHaveTextContent('60%');

    await act(async () => {
      resolveInstall(makeInstalled('1.0.0'));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('template-detail-outcome-success'),
      ).toBeInTheDocument(),
    );
  });

  it('clicking "View in Audit Log" dispatches the keepance:open-audit-log window event', async () => {
    const service = makeService();
    render(<TemplateDetailView entry={ENTRY} service={service} onBack={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('template-detail-install'));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('template-detail-view-audit-log'),
      ).toBeInTheDocument(),
    );

    const handler = vi.fn();
    window.addEventListener('keepance:open-audit-log', handler);
    fireEvent.click(screen.getByTestId('template-detail-view-audit-log'));
    expect(handler).toHaveBeenCalledTimes(1);
    window.removeEventListener('keepance:open-audit-log', handler);
  });

  it('dismiss button hides the success outcome panel', async () => {
    const service = makeService();
    render(<TemplateDetailView entry={ENTRY} service={service} onBack={() => {}} />);
    await act(async () => {
      fireEvent.click(screen.getByTestId('template-detail-install'));
    });
    await waitFor(() =>
      expect(
        screen.getByTestId('template-detail-outcome-success'),
      ).toBeInTheDocument(),
    );
    fireEvent.click(screen.getByTestId('template-detail-outcome-dismiss'));
    expect(
      screen.queryByTestId('template-detail-outcome-success'),
    ).not.toBeInTheDocument();
  });
});

describe('TemplateDetailView — install failure mapping', () => {
  // The component maps service error messages to actionable user copy.
  // We exercise each mapped category.
  const cases: Array<{
    name: string;
    error: Error;
    expectedHeadline: string;
  }> = [
    {
      name: 'catalog unreachable',
      error: new Error('Failed to fetch catalog: HTTP 503'),
      expectedHeadline: 'Catalog unreachable.',
    },
    {
      name: 'tarball corrupt (checksum mismatch)',
      error: new Error('Checksum mismatch for x: tarball does not match expected SHA-256'),
      expectedHeadline: 'Tarball corrupt.',
    },
    {
      name: 'manifest invalid',
      error: new Error('Manifest invalid: missing required field "name"'),
      expectedHeadline: 'Manifest invalid.',
    },
    {
      name: 'template missing from catalog',
      error: new Error('Template not found in catalog: foo-bar'),
      expectedHeadline: 'Template not found.',
    },
    {
      name: 'unrecognized error falls through to generic install failed',
      error: new Error('Disk full'),
      expectedHeadline: 'Install failed.',
    },
  ];

  for (const c of cases) {
    it(`maps ${c.name} → "${c.expectedHeadline}"`, async () => {
      const service = makeService({
        installImpl: async () => {
          throw c.error;
        },
      });
      render(<TemplateDetailView entry={ENTRY} service={service} onBack={() => {}} />);
      await act(async () => {
        fireEvent.click(screen.getByTestId('template-detail-install'));
      });
      await waitFor(() =>
        expect(
          screen.getByTestId('template-detail-outcome-failure'),
        ).toBeInTheDocument(),
      );
      expect(
        screen.getByTestId('template-detail-outcome-failure'),
      ).toHaveTextContent(c.expectedHeadline);
      // Failure path offers a Retry button (not a View Audit Log button).
      expect(screen.getByTestId('template-detail-retry')).toBeInTheDocument();
      expect(
        screen.queryByTestId('template-detail-view-audit-log'),
      ).not.toBeInTheDocument();
    });
  }
});

describe('TemplateDetailView — uninstall', () => {
  it('clicking Uninstall calls service.uninstall and surfaces success outcome', async () => {
    const service = makeService();
    const onUninstalled = vi.fn();
    render(
      <TemplateDetailView
        entry={ENTRY}
        service={service}
        installed={makeInstalled('1.0.0')}
        onBack={() => {}}
        onUninstalled={onUninstalled}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('template-detail-uninstall'));
    });

    expect(service.uninstall).toHaveBeenCalledWith(ENTRY.id);
    await waitFor(() =>
      expect(
        screen.getByTestId('template-detail-outcome-success'),
      ).toBeInTheDocument(),
    );
    expect(onUninstalled).toHaveBeenCalledWith(ENTRY.id);
  });
});

describe('TemplateDetailView — update flow (Group VIII)', () => {
  it('passes isUpdate + fromVersion to service.install when [Update] is clicked', async () => {
    const installSpy = vi.fn(async () => makeInstalled('1.1.0'));
    const service = makeService({ installImpl: installSpy });
    render(
      <TemplateDetailView
        entry={{ ...ENTRY, version: '1.1.0' }}
        service={service}
        installed={makeInstalled('1.0.0')}
        updateAvailable
        onBack={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('template-detail-update'));
    });

    expect(installSpy).toHaveBeenCalledWith(
      ENTRY.id,
      expect.objectContaining({
        isUpdate: true,
        fromVersion: '1.0.0',
        onProgress: expect.any(Function),
      }),
    );
  });

  it('does NOT pass isUpdate when installing fresh (no installed entry)', async () => {
    const installSpy = vi.fn(async () => makeInstalled('1.0.0'));
    const service = makeService({ installImpl: installSpy });
    render(
      <TemplateDetailView
        entry={ENTRY}
        service={service}
        onBack={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('template-detail-install'));
    });

    const opts = installSpy.mock.calls[0]?.[1];
    expect(opts?.isUpdate).toBeUndefined();
    expect(opts?.fromVersion).toBeUndefined();
  });

  it('shows the "Updated to vX.Y.Z" success copy on update', async () => {
    const service = makeService({
      installImpl: async () => makeInstalled('1.2.0'),
    });
    render(
      <TemplateDetailView
        entry={{ ...ENTRY, version: '1.2.0' }}
        service={service}
        installed={makeInstalled('1.0.0')}
        updateAvailable
        onBack={() => {}}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('template-detail-update'));
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('template-detail-outcome-success'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('template-detail-outcome-success'),
    ).toHaveTextContent(/Updated/);
    expect(
      screen.getByTestId('template-detail-outcome-success'),
    ).toHaveTextContent(/v1\.2\.0/);
  });
});

describe('TemplateDetailView — carousel navigation', () => {
  it('clicking next advances the dot indicator', () => {
    const service = makeService();
    render(<TemplateDetailView entry={ENTRY} service={service} onBack={() => {}} />);
    const dots = screen
      .getByTestId('template-detail-carousel-dots')
      .querySelectorAll('button');
    expect(dots.length).toBe(3);
    fireEvent.click(screen.getByTestId('template-detail-carousel-next'));
    // After clicking next, the second dot becomes the wide one.
    const widerDot = dots[1]!;
    expect(widerDot.className).toMatch(/w-6/);
  });
});
