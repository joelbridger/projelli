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
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Spine } from '@/app/shell/layout/Spine';
import type { Matter } from '@/platform/types/matter';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MATTERS: Matter[] = [
  { id: 'm1', name: 'Hendricks Household', client: 'Hendricks Household', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
  { id: 'm2', name: 'Doe Family Trust', client: 'Doe Family Trust', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
  // Internal name deliberately differs from the client — exercises matterLabel's
  // "Client - Name" folding branch instead of the name===client shortcut above.
  { id: 'm3', name: 'Retirement Plan Review', client: 'Alvarez', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
];

vi.mock('@/platform/matter/matterStore', () => ({
  useMatters: () => MATTERS,
  useActiveMatters: () => MATTERS,
  useActiveMatterId: () => 'm1',
  useMatterStore: (selector: (s: { setActiveMatter: () => void }) => unknown) =>
    selector({ setActiveMatter: vi.fn() }),
}));

describe('Spine — Clients section', () => {
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
