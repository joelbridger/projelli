/**
 * Client groups UI (feedback line 13):
 *   - NewClientGroupDialog names a group and adds clients via a searchable
 *     multi-select.
 *   - The Spine rail renders groups as collapsible sections under "All clients",
 *     with member rows, and a per-group menu to rename/delete (empty groups
 *     included).
 *
 * Uses the REAL clientGroupStore (the persistence + membership logic is pinned
 * separately in clientGroupStore.test.ts) with a mocked matter store.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';
import type { Matter } from '@/platform/types/matter';
import { useClientGroupStore } from '@/platform/matter/clientGroupStore';

const MATTERS: Matter[] = [
  { id: 'm1', name: 'Hendricks Household', client: 'Hendricks Household', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
  { id: 'm2', name: 'Doe Family Trust', client: 'Doe Family Trust', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
  { id: 'm3', name: 'Alvarez Retirement', client: 'Alvarez', folderPaths: [], createdAt: '2026-07-07T00:00:00.000Z' },
];

vi.mock('react-i18next', () => ({
  useTranslation: () => ({ t: (key: string) => key }),
}));

vi.mock('@/platform/matter/matterStore', () => ({
  useMatters: () => MATTERS,
  useActiveMatters: () => MATTERS,
  useActiveMatterId: () => null,
  useMatterStore: (selector: (s: Record<string, unknown>) => unknown) =>
    selector({
      setActiveMatter: vi.fn(),
      setClientMapHubId: vi.fn(),
      setClientMapHubTab: vi.fn(),
    }),
}));

import { NewClientGroupDialog } from '@/features/matters/NewClientGroupDialog';
import { Spine } from '@/app/shell/layout/Spine';

function resetGroups() {
  useClientGroupStore.setState({ groups: [] });
}

describe('NewClientGroupDialog', () => {
  beforeEach(resetGroups);

  it('creates a named group with the selected clients', () => {
    render(<NewClientGroupDialog open={true} onOpenChange={() => undefined} />);

    fireEvent.change(screen.getByTestId('new-group-name'), {
      target: { value: 'Retirement plans' },
    });
    fireEvent.click(screen.getByTestId('new-group-client-m1'));
    fireEvent.click(screen.getByTestId('new-group-client-m3'));
    fireEvent.click(screen.getByTestId('new-group-create'));

    const groups = useClientGroupStore.getState().groups;
    expect(groups).toHaveLength(1);
    expect(groups[0]!.name).toBe('Retirement plans');
    expect(groups[0]!.matterIds).toEqual(['m1', 'm3']);
  });

  it('filters the client list by the search box', () => {
    render(<NewClientGroupDialog open={true} onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByTestId('new-group-client-search'), {
      target: { value: 'alvarez' },
    });
    expect(screen.getByTestId('new-group-client-m3')).toBeInTheDocument();
    expect(screen.queryByTestId('new-group-client-m1')).not.toBeInTheDocument();
  });

  it('can create an empty group (no members selected)', () => {
    render(<NewClientGroupDialog open={true} onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByTestId('new-group-name'), {
      target: { value: 'Later' },
    });
    fireEvent.click(screen.getByTestId('new-group-create'));
    expect(useClientGroupStore.getState().groups[0]!.matterIds).toEqual([]);
  });
});

describe('Spine — client group sections', () => {
  beforeEach(resetGroups);

  it('renders a group as a collapsible section with its member rows', () => {
    const g = useClientGroupStore.getState().createGroup('Households')!;
    useClientGroupStore.getState().setGroupMembers(g.id, ['m1', 'm2']);

    render(<Spine activeTab="matters" />);

    expect(screen.getByTestId(`spine-group-${g.id}`)).toBeInTheDocument();
    // Member rows render under the group (distinct handle from the flat list).
    expect(screen.getByTestId(`spine-group-client-row-${g.id}-m1`)).toBeInTheDocument();
    expect(screen.getByTestId(`spine-group-client-row-${g.id}-m2`)).toBeInTheDocument();
    // The client also still appears in the flat list below.
    expect(screen.getByTestId('spine-client-row-m1')).toBeInTheDocument();
  });

  it('collapses a group when its toggle is clicked', () => {
    const g = useClientGroupStore.getState().createGroup('Households')!;
    useClientGroupStore.getState().setGroupMembers(g.id, ['m1']);

    render(<Spine activeTab="matters" />);
    expect(screen.getByTestId(`spine-group-client-row-${g.id}-m1`)).toBeInTheDocument();

    fireEvent.click(screen.getByTestId(`spine-group-toggle-${g.id}`));
    expect(screen.queryByTestId(`spine-group-client-row-${g.id}-m1`)).not.toBeInTheDocument();
  });

  it('shows an empty group and lets it be deleted', () => {
    const g = useClientGroupStore.getState().createGroup('Empty group')!;

    render(<Spine activeTab="matters" />);
    expect(screen.getByTestId(`spine-group-empty-${g.id}`)).toBeInTheDocument();

    fireEvent.pointerDown(screen.getByTestId(`spine-group-menu-${g.id}`));
    fireEvent.click(screen.getByTestId(`spine-group-delete-${g.id}`));

    expect(useClientGroupStore.getState().groups).toHaveLength(0);
  });

  it('lets one client belong to two groups', () => {
    const a = useClientGroupStore.getState().createGroup('A')!;
    const b = useClientGroupStore.getState().createGroup('B')!;
    useClientGroupStore.getState().setGroupMembers(a.id, ['m1']);
    useClientGroupStore.getState().setGroupMembers(b.id, ['m1']);

    render(<Spine activeTab="matters" />);
    expect(screen.getByTestId(`spine-group-client-row-${a.id}-m1`)).toBeInTheDocument();
    expect(screen.getByTestId(`spine-group-client-row-${b.id}-m1`)).toBeInTheDocument();
  });
});
