/**
 * Spine — the "Clients" section (UI Simplification Pass): the redundant
 * repeated light-gray client name is gone, and the list is now a collapsible
 * section instead of an always-expanded block that force-fills the rail.
 *
 * Rule (round 2): there is never a separate subtext line for the client
 * name — matterLabel() itself folds the client into the one-line label
 * ("Client - Name" when the matter's internal name differs from the client,
 * or just the shared name/client when they match), so the client's name
 * stays visible in the row either way. This suite uses the REAL matterLabel
 * (not a mock) so that folding behavior is actually exercised.
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
    { id: 'm1', name: 'Hendricks Household', client: 'Hendricks Household', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
    { id: 'm2', name: 'Doe Family Trust', client: 'Doe Family Trust', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
    // Internal name deliberately differs from the client — exercises matterLabel's
    // "Client - Name" folding branch instead of the name===client shortcut above.
    { id: 'm3', name: 'Retirement Plan Review', client: 'Alvarez', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
  ] as Matter[],
}));

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  useMatters: () => matterMocks.matters,
  useActiveMatters: () => matterMocks.matters,
  useActiveMatterId: () => matterMocks.activeMatterId,
  useMatterStore: (selector: (s: {
    setActiveMatter: (id: string | null) => void;
    setClientMapHubId: (id: string | null) => void;
    setClientMapHubTab: (tab: string | null) => void;
  }) => unknown) =>
    selector({
      setActiveMatter: storeMocks.setActiveMatter,
      setClientMapHubId: storeMocks.setClientMapHubId,
      setClientMapHubTab: storeMocks.setClientMapHubTab,
    }),
}));

describe('Spine — Clients section', () => {
  beforeEach(() => {
    matterMocks.activeMatterId = 'm1';
    matterMocks.matters = [
      { id: 'm1', name: 'Hendricks Household', client: 'Hendricks Household', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
      { id: 'm2', name: 'Doe Family Trust', client: 'Doe Family Trust', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
      { id: 'm3', name: 'Retirement Plan Review', client: 'Alvarez', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
    ];
    storeMocks.setActiveMatter.mockClear();
    storeMocks.setClientMapHubId.mockClear();
    storeMocks.setClientMapHubTab.mockClear();
  });

  it('pins a permanent All Clients row above individual client rows', () => {
    render(<Spine activeTab="matters" />);
    const allClients = screen.getByTestId('spine-all-clients-row');
    const firstClient = screen.getByTestId('spine-client-row-m1');
    expect(allClients.compareDocumentPosition(firstClient) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it('clicking All Clients clears the selected client and returns to the Client Map surface', () => {
    const onTabChange = vi.fn();
    render(<Spine activeTab="search" onTabChange={onTabChange} />);

    fireEvent.click(screen.getByTestId('spine-all-clients-row'));

    expect(storeMocks.setActiveMatter).toHaveBeenCalledWith(null);
    expect(storeMocks.setClientMapHubId).toHaveBeenCalledWith(null);
    expect(storeMocks.setClientMapHubTab).toHaveBeenCalledWith(null);
    expect(onTabChange).toHaveBeenCalledWith('matters');
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

  it('does not render the redundant repeated client-name subtext', () => {
    render(<Spine activeTab="matters" />);
    // The matter name renders once (via matterLabel)...
    expect(screen.getByText('Hendricks Household')).toBeInTheDocument();
    // ...but not a second time as a separate light-gray subtext line under it.
    expect(screen.getAllByText('Hendricks Household')).toHaveLength(1);
  });

  it('folds the client name into the one-line label when the internal name differs, with no separate subtext', () => {
    render(<Spine activeTab="matters" />);
    // matterLabel formats this as "Alvarez - Retirement Plan Review" — the
    // client name is still visible, just folded into the single label line
    // rather than duplicated as its own row underneath.
    expect(screen.getByText('Alvarez - Retirement Plan Review')).toBeInTheDocument();
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
});
