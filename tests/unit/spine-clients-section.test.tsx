/**
 * Spine — the "Clients" section (UI Simplification Pass): the redundant
 * repeated light-gray client name is gone, and the list is now a collapsible
 * section instead of an always-expanded block that force-fills the rail.
 */
import { describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import { Spine } from '@/app/shell/layout/Spine';
import type { Matter } from '@/platform/types/matter';

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

const MATTERS: Matter[] = [
  { id: 'm1', name: 'Hendricks Household', client: 'Hendricks Household', folderPaths: [] },
  { id: 'm2', name: 'Doe Family Trust', client: 'Doe Family Trust', folderPaths: [] },
];

vi.mock('@/platform/matter/matterStore', () => ({
  useMatters: () => MATTERS,
  useActiveMatters: () => MATTERS,
  useActiveMatterId: () => 'm1',
  useMatterStore: (selector: (s: { setActiveMatter: () => void }) => unknown) =>
    selector({ setActiveMatter: vi.fn() }),
}));
vi.mock('@/platform/rag/matterResolver', () => ({
  matterLabel: (m: { name: string }) => m.name,
}));

describe('Spine — Clients section', () => {
  it('does not render the redundant repeated client-name subtext', () => {
    render(<Spine activeTab="matters" />);
    // The matter name renders once (via matterLabel)...
    expect(screen.getByText('Hendricks Household')).toBeInTheDocument();
    // ...but not a second time as a separate light-gray subtext line under it.
    expect(screen.getAllByText('Hendricks Household')).toHaveLength(1);
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
