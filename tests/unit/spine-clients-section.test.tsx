/**
 * Spine — the "Clients" section (UI Simplification Pass): the redundant
 * repeated light-gray client name is gone, and the list is now a collapsible
 * section instead of an always-expanded block that force-fills the rail.
 *
 * Rule (UX simplification): the rail shows only the display client name.
 * When the internal matter name differs, the full "Client - Name" label stays
 * available in the row title instead of taking visible rail space.
 */
import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Spine } from '@/app/shell/layout/Spine';
import type { Matter } from '@/platform/types/matter';

const storeMocks = vi.hoisted(() => ({
  setActiveMatter: vi.fn(),
  setClientMapHubId: vi.fn(),
  setClientMapHubTab: vi.fn(),
}));

const matterMocks = vi.hoisted(() => ({
  activeMatterId: 'm1' as string | null,
  matters: [
    {
      id: 'm1',
      name: 'Hendricks Household',
      client: 'Hendricks Household',
      folderPaths: [],
      createdAt: '2026-07-07T00:00:00.000Z',
    },
    {
      id: 'm2',
      name: 'Doe Family Trust',
      client: 'Doe Family Trust',
      folderPaths: [],
      createdAt: '2026-07-07T00:00:00.000Z',
    },
    // Internal name deliberately differs from the client — exercises matterLabel's
    // "Client - Name" folding branch instead of the name===client shortcut above.
    {
      id: 'm3',
      name: 'Retirement Plan Review',
      client: 'Alvarez',
      folderPaths: [],
      createdAt: '2026-07-07T00:00:00.000Z',
    },
  ] as Matter[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  useMatters: () => matterMocks.matters,
  useActiveMatters: () => matterMocks.matters,
  useActiveMatterId: () => matterMocks.activeMatterId,
  useMatterStore: Object.assign(
    (selector: (s: {
      matters: Matter[];
      activeMatterId: string | null;
      setActiveMatter: (id: string | null) => void;
      setClientMapHubId: (id: string | null) => void;
      setClientMapHubTab: (tab: string | null) => void;
    }) => unknown) => selector({
      matters: matterMocks.matters,
      activeMatterId: matterMocks.activeMatterId,
      setActiveMatter: storeMocks.setActiveMatter,
      setClientMapHubId: storeMocks.setClientMapHubId,
      setClientMapHubTab: storeMocks.setClientMapHubTab,
    }),
    {
      getState: () => ({
        matters: matterMocks.matters,
        activeMatterId: matterMocks.activeMatterId,
        setActiveMatter: storeMocks.setActiveMatter,
        setClientMapHubId: storeMocks.setClientMapHubId,
        setClientMapHubTab: storeMocks.setClientMapHubTab,
      }),
      subscribe: () => () => {},
    }
  ),
}));

describe('Spine — Clients section', () => {
  beforeEach(() => {
    matterMocks.activeMatterId = 'm1';
    matterMocks.matters = [
      {
        id: 'm1',
        name: 'Hendricks Household',
        client: 'Hendricks Household',
        folderPaths: [],
        createdAt: '2026-07-07T00:00:00.000Z',
      },
      {
        id: 'm2',
        name: 'Doe Family Trust',
        client: 'Doe Family Trust',
        folderPaths: [],
        createdAt: '2026-07-07T00:00:00.000Z',
      },
      {
        id: 'm3',
        name: 'Retirement Plan Review',
        client: 'Alvarez',
        folderPaths: [],
        createdAt: '2026-07-07T00:00:00.000Z',
      },
    ];
    storeMocks.setActiveMatter.mockClear();
    storeMocks.setClientMapHubId.mockClear();
    storeMocks.setClientMapHubTab.mockClear();
  });

  it('pins a permanent All Clients row above individual client rows', () => {
    render(<Spine activeTab="matters" />);
    const allClients = screen.getByTestId('spine-all-clients-row');
    const firstClient = screen.getByTestId('spine-client-row-m1');
    expect(
      allClients.compareDocumentPosition(firstClient) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy();
  });

  it('clicking All Clients clears the selected client and returns to the Client Map surface', async () => {
    const onTabChange = vi.fn();
    render(<Spine activeTab="search" onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('spine-all-clients-row'));

    await vi.waitFor(() => {
      expect(storeMocks.setActiveMatter).toHaveBeenCalledWith(null);
      expect(storeMocks.setClientMapHubId).toHaveBeenCalledWith(null);
      expect(storeMocks.setClientMapHubTab).toHaveBeenCalledWith(null);
      expect(onTabChange).toHaveBeenCalledWith('matters');
    });
  });

  it('highlights All Clients without also highlighting the Client Map nav tab', () => {
    matterMocks.activeMatterId = null;
    render(<Spine activeTab="matters" allClientsSelected />);

    expect(screen.getByTestId('spine-all-clients-row')).toHaveAttribute('aria-current', 'page');
    expect(screen.getByTestId('spine-nav-matters')).not.toHaveAttribute('aria-current');
    expect(screen.getByTestId('spine-client-row-m1').getAttribute('style')).toContain('background: transparent');
  });

  it('clicking a client row always launches that client on the Client Map hub', () => {
    const dispatchSpy = vi.spyOn(window, 'dispatchEvent');
    render(<Spine activeTab="email" />);

    fireEvent.click(screen.getByTestId('spine-client-row-m2'));

    const event = dispatchSpy.mock.calls[0]?.[0] as CustomEvent | undefined;
    expect(event?.type).toBe('lantern:matter-launch');
    expect(event?.detail).toEqual({ matterId: 'm2', surface: 'matters' });
    dispatchSpy.mockRestore();
  });

  it('keeps All Clients and New Client visible when there are zero clients', () => {
    matterMocks.activeMatterId = null;
    matterMocks.matters = [];

    render(<Spine activeTab="matters" />);

    expect(screen.getByTestId('spine-clients-toggle')).toBeInTheDocument();
    expect(screen.getByTestId('spine-all-clients-row')).toBeInTheDocument();
    expect(screen.getByTestId('spine-new-client')).toBeInTheDocument();
  });

  it('shows client search as an icon that expands on click', () => {
    render(<Spine activeTab="matters" />);

    expect(screen.queryByTestId('spine-client-search')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('spine-client-search-toggle'));
    expect(screen.getByTestId('spine-client-search')).toBeInTheDocument();
  });

  it('stays an icon regardless of how many clients exist (C2: no threshold UI — regression, caught by Jameson on the bench)', () => {
    matterMocks.matters = Array.from({ length: 26 }, (_, i) => ({
      ...matterMocks.matters[0]!,
      id: `m${i}`,
      name: `Client ${i}`,
      label: `Client ${i}`,
      client: `Client ${i}`,
    }));
    render(<Spine activeTab="matters" />);

    expect(screen.queryByTestId('spine-client-search')).not.toBeInTheDocument();
    expect(screen.getByTestId('spine-client-search-toggle')).toBeInTheDocument();
  });

  it('collapses back to the icon when the empty search field loses focus', () => {
    render(<Spine activeTab="matters" />);

    fireEvent.click(screen.getByTestId('spine-client-search-toggle'));
    const input = screen.getByTestId('spine-client-search');
    fireEvent.blur(input);
    expect(screen.queryByTestId('spine-client-search')).not.toBeInTheDocument();
  });

  it('filters the client rail as the advisor types in the client search box', () => {
    render(<Spine activeTab="matters" />);

    fireEvent.click(screen.getByTestId('spine-client-search-toggle'));
    fireEvent.change(screen.getByTestId('spine-client-search'), {
      target: { value: 'doe' },
    });

    expect(screen.getByText('Doe Family Trust')).toBeInTheDocument();
    expect(screen.queryByText('Hendricks Household')).not.toBeInTheDocument();
    expect(screen.queryByText('Alvarez')).not.toBeInTheDocument();
    expect(screen.getByTestId('spine-all-clients-row')).toBeInTheDocument();
  });

  it('shows a small empty row under All Clients when rail search matches no clients', () => {
    render(<Spine activeTab="matters" />);

    fireEvent.click(screen.getByTestId('spine-client-search-toggle'));
    fireEvent.change(screen.getByTestId('spine-client-search'), {
      target: { value: 'zzzz' },
    });

    expect(screen.getByTestId('spine-all-clients-row')).toBeInTheDocument();
    expect(screen.getByTestId('spine-client-search-empty')).toHaveTextContent(
      'spine.no-clients-found'
    );
  });

  it('does not render the redundant repeated client-name subtext', () => {
    render(<Spine activeTab="matters" />);
    // The matter name renders once (via matterLabel)...
    expect(screen.getByText('Hendricks Household')).toBeInTheDocument();
    // ...but not a second time as a separate light-gray subtext line under it.
    expect(screen.getAllByText('Hendricks Household')).toHaveLength(1);
  });

  it('shows the display client name and keeps the full label in the row title', () => {
    render(<Spine activeTab="matters" />);
    const row = screen.getByTestId('spine-client-row-m3');
    expect(screen.getByText('Alvarez')).toBeInTheDocument();
    expect(row).toHaveAttribute('title', 'Alvarez - Retirement Plan Review');
    expect(
      screen.queryByText('Alvarez - Retirement Plan Review')
    ).not.toBeInTheDocument();
    expect(screen.getAllByText(/Alvarez/)).toHaveLength(1);
  });

  it('is a collapsible section: open by default, and toggling hides the client rows', () => {
    render(<Spine activeTab="matters" />);
    const toggle = screen.getByTestId('spine-clients-toggle');
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hendricks Household')).toBeInTheDocument();
    expect(screen.getByText('Doe Family Trust')).toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'false');
    expect(screen.queryByText('Hendricks Household')).not.toBeInTheDocument();
    expect(screen.queryByText('Doe Family Trust')).not.toBeInTheDocument();

    fireEvent.click(toggle);
    expect(toggle).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByText('Hendricks Household')).toBeInTheDocument();
  });

  it('lets the client list fill the available rail space instead of using a small fixed cap', () => {
    render(<Spine activeTab="matters" />);
    const list = screen.getByTestId('spine-client-list');

    expect(list).toHaveStyle({ flex: '1 1 auto', minHeight: '0' });
    expect(list.style.maxHeight).toBe('');
  });
});
