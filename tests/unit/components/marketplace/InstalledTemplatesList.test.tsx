import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  render,
  screen,
  fireEvent,
  cleanup,
  waitFor,
  act,
  within,
} from '@testing-library/react';
import { InstalledTemplatesList } from '@/components/marketplace/InstalledTemplatesList';
import type { MarketplaceService } from '@/modules/marketplace';
import type { CatalogEntry, InstalledEntry } from '@/types/marketplace';

const ENTRY: CatalogEntry = {
  id: 'investor-update-v1',
  name: 'Monthly Investor Update',
  description: 'Walk through the monthly investor update.',
  version: '1.0.0',
  author: { name: 'Jameson Daines' },
  category: 'investor',
  tags: ['investor'],
  installUrl: 'https://example.test/x.tar.gz',
  manifestUrl: 'https://example.test/x.json',
  minKeepanceVersion: '2.0.0',
  publishedAt: '2026-04-28T00:00:00.000Z',
  updatedAt: '2026-04-28T00:00:00.000Z',
};

function makeInstalled(
  overrides: Partial<InstalledEntry> & { id?: string; name?: string } = {},
): InstalledEntry {
  return {
    ...ENTRY,
    installedAt: '2026-04-28T00:00:00.000Z',
    installedPath: '/ws/.keepance/templates/investor-update-v1',
    provenance: 'community',
    manifestVersion: '1.0',
    ...overrides,
  };
}

function makeService(
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
    readInstalledManifest: vi.fn(async () => null),
  } as unknown as MarketplaceService;
}

beforeEach(() => {
  vi.clearAllMocks();
});

afterEach(() => cleanup());

describe('InstalledTemplatesList — empty state', () => {
  it('renders the empty-state copy when no templates are installed', () => {
    const service = makeService();
    render(<InstalledTemplatesList service={service} installed={[]} />);
    expect(screen.getByTestId('installed-templates-empty')).toHaveTextContent(
      'No templates installed yet. Browse the marketplace to add one.',
    );
    expect(screen.queryByTestId('installed-templates-list')).not.toBeInTheDocument();
  });
});

describe('InstalledTemplatesList — populated', () => {
  it('renders one row per installed entry with name, version, and provenance badge', () => {
    const service = makeService();
    const items = [
      makeInstalled({ id: 'a', name: 'Alpha Template', version: '1.2.3' }),
      makeInstalled({
        id: 'b',
        name: 'Beta Template',
        version: '0.9.0',
        provenance: 'custom',
      }),
    ];
    render(<InstalledTemplatesList service={service} installed={items} />);

    expect(screen.getByTestId('installed-template-a')).toBeInTheDocument();
    expect(screen.getByTestId('installed-template-b')).toBeInTheDocument();
    expect(screen.getByTestId('installed-template-name-a')).toHaveTextContent(
      'Alpha Template',
    );
    expect(screen.getByTestId('installed-template-a')).toHaveTextContent('v1.2.3');
    expect(
      screen
        .getByTestId('installed-template-provenance-a')
        .getAttribute('data-provenance'),
    ).toBe('community');
    expect(
      screen
        .getByTestId('installed-template-provenance-b')
        .getAttribute('data-provenance'),
    ).toBe('custom');
  });

  it('uninstall buttons are disabled while one is in flight', async () => {
    let resolveUninstall: (() => void) | null = null;
    const service = makeService(
      () =>
        new Promise<void>((res) => {
          resolveUninstall = () => res();
        }),
    );
    const items = [
      makeInstalled({ id: 'a', name: 'Alpha' }),
      makeInstalled({ id: 'b', name: 'Beta' }),
    ];
    render(<InstalledTemplatesList service={service} installed={items} />);

    fireEvent.click(screen.getByTestId('installed-template-uninstall-a'));
    fireEvent.click(screen.getByRole('button', { name: 'Uninstall' }));

    await waitFor(() => {
      const otherBtn = screen.getByTestId('installed-template-uninstall-b');
      expect(otherBtn).toBeDisabled();
    });

    await act(async () => {
      resolveUninstall?.();
    });
  });
});

describe('InstalledTemplatesList — uninstall confirmation', () => {
  it('shows confirm dialog before uninstalling', () => {
    const service = makeService();
    const item = makeInstalled({ id: 'a', name: 'Alpha' });
    render(<InstalledTemplatesList service={service} installed={[item]} />);

    fireEvent.click(screen.getByTestId('installed-template-uninstall-a'));

    // ConfirmDialog renders an alertdialog element with the description.
    expect(screen.getByRole('alertdialog')).toHaveTextContent(
      'Uninstall template?',
    );
    expect(screen.getByRole('alertdialog')).toHaveTextContent('Alpha');
    expect(service.uninstall).not.toHaveBeenCalled();
  });

  it('cancel closes the dialog without calling service.uninstall', () => {
    const service = makeService();
    const item = makeInstalled({ id: 'a' });
    render(<InstalledTemplatesList service={service} installed={[item]} />);

    fireEvent.click(screen.getByTestId('installed-template-uninstall-a'));
    const dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancel' }));

    expect(screen.queryByRole('alertdialog')).not.toBeInTheDocument();
    expect(service.uninstall).not.toHaveBeenCalled();
  });

  it('confirm calls service.uninstall and bubbles the id to onUninstalled', async () => {
    const service = makeService();
    const onUninstalled = vi.fn();
    const item = makeInstalled({ id: 'a', name: 'Alpha' });
    render(
      <InstalledTemplatesList
        service={service}
        installed={[item]}
        onUninstalled={onUninstalled}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('installed-template-uninstall-a'));
    });
    await act(async () => {
      const dialog = screen.getByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    });

    expect(service.uninstall).toHaveBeenCalledWith('a');
    expect(onUninstalled).toHaveBeenCalledWith('a');

    await waitFor(() =>
      expect(
        screen.getByTestId('installed-templates-outcome-success'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('installed-templates-outcome-success'),
    ).toHaveTextContent('Uninstalled Alpha.');
  });

  it('refresh after uninstall: parent removes the row, list re-renders without it', async () => {
    const service = makeService();
    const onUninstalled = vi.fn();
    const items: InstalledEntry[] = [
      makeInstalled({ id: 'a', name: 'Alpha' }),
      makeInstalled({ id: 'b', name: 'Beta' }),
    ];
    const { rerender } = render(
      <InstalledTemplatesList
        service={service}
        installed={items}
        onUninstalled={onUninstalled}
      />,
    );
    expect(screen.getByTestId('installed-template-a')).toBeInTheDocument();

    await act(async () => {
      fireEvent.click(screen.getByTestId('installed-template-uninstall-a'));
    });
    await act(async () => {
      const dialog = screen.getByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    });

    expect(onUninstalled).toHaveBeenCalledWith('a');

    // Parent reflows: the parent removes the row in response to onUninstalled.
    rerender(
      <InstalledTemplatesList
        service={service}
        installed={items.filter((i) => i.id !== 'a')}
        onUninstalled={onUninstalled}
      />,
    );

    expect(screen.queryByTestId('installed-template-a')).not.toBeInTheDocument();
    expect(screen.getByTestId('installed-template-b')).toBeInTheDocument();
  });

  it('failed uninstall shows the failure outcome and does not call onUninstalled', async () => {
    const service = makeService(async () => {
      throw new Error('Disk error');
    });
    const onUninstalled = vi.fn();
    const item = makeInstalled({ id: 'a', name: 'Alpha' });
    render(
      <InstalledTemplatesList
        service={service}
        installed={[item]}
        onUninstalled={onUninstalled}
      />,
    );

    await act(async () => {
      fireEvent.click(screen.getByTestId('installed-template-uninstall-a'));
    });
    await act(async () => {
      const dialog = screen.getByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    });

    await waitFor(() =>
      expect(
        screen.getByTestId('installed-templates-outcome-failure'),
      ).toBeInTheDocument(),
    );
    expect(
      screen.getByTestId('installed-templates-outcome-failure'),
    ).toHaveTextContent('Disk error');
    expect(onUninstalled).not.toHaveBeenCalled();
  });
});

describe('InstalledTemplatesList — audit event spot-check', () => {
  // The uninstall path emits `template_uninstalled` inside MarketplaceService.
  // We don't reproduce the audit pipeline here; instead we verify that the
  // component routes through `service.uninstall(id)`, which is the entrypoint
  // that performs the audit append. Service-level audit emission is covered
  // by tests/unit/marketplace/MarketplaceService tests.
  it('routes uninstall through service.uninstall(id) so the audit event fires', async () => {
    const service = makeService();
    const item = makeInstalled({ id: 'investor-update-v1' });
    render(<InstalledTemplatesList service={service} installed={[item]} />);

    await act(async () => {
      fireEvent.click(
        screen.getByTestId('installed-template-uninstall-investor-update-v1'),
      );
    });
    await act(async () => {
      const dialog = screen.getByRole('alertdialog');
      fireEvent.click(within(dialog).getByRole('button', { name: 'Uninstall' }));
    });

    expect(service.uninstall).toHaveBeenCalledTimes(1);
    expect(service.uninstall).toHaveBeenCalledWith('investor-update-v1');
  });
});
