/**
 * NewClientDialog (feedback line 14) — the calm one-field create modal.
 *   - a single "display name" field, nothing else mandatory,
 *   - on create, lands the user inside the new client's Client Map by
 *     dispatching lantern:matter-launch with surface: 'matters',
 *   - closes the modal on create.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, act } from '@testing-library/react';
import { useMatterStore, setMatterAuditEmitter } from '@/platform/matter/matterStore';
import { EV_MATTER_LAUNCH } from '@/config/identity';

vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: '/ws', fileTree: [] }),
}));

// ensureClientFolderOnDisk's disk write no-ops without a workspace service.
vi.mock('@/platform/fs/activeWorkspaceService', () => ({
  getActiveWorkspaceService: () => null,
}));

import { NewClientDialog } from '@/features/matters/NewClientDialog';

function reset() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  setMatterAuditEmitter(() => undefined);
}

describe('NewClientDialog', () => {
  beforeEach(reset);

  it('has only a display-name field (no company / privilege / folder controls)', () => {
    render(<NewClientDialog open={true} onOpenChange={() => undefined} />);
    expect(screen.getByTestId('new-client-name')).toBeInTheDocument();
    // The heavy create controls are gone.
    expect(screen.queryByTestId('matter-new-client')).not.toBeInTheDocument();
    expect(screen.queryByTestId('matter-new-privileged')).not.toBeInTheDocument();
  });

  it('creates the client and lands inside its Client Map', () => {
    const launches: Array<{ matterId?: string; surface?: string }> = [];
    const onLaunch = (e: Event) => {
      launches.push((e as CustomEvent).detail);
    };
    window.addEventListener(EV_MATTER_LAUNCH, onLaunch);
    const onOpenChange = vi.fn();

    render(<NewClientDialog open={true} onOpenChange={onOpenChange} />);
    fireEvent.change(screen.getByTestId('new-client-name'), {
      target: { value: 'The Reyes Household' },
    });
    act(() => {
      fireEvent.click(screen.getByTestId('new-client-create'));
    });

    const matters = useMatterStore.getState().matters;
    expect(matters).toHaveLength(1);
    expect(matters[0]!.name).toBe('The Reyes Household');
    // The new client is scoped to its own folder from the first action.
    expect(matters[0]!.folderPaths).toEqual(['/ws/The Reyes Household']);
    // Modal closes and we land in the new client's Client Map.
    expect(onOpenChange).toHaveBeenCalledWith(false);
    expect(launches).toEqual([{ matterId: matters[0]!.id, surface: 'matters' }]);

    window.removeEventListener(EV_MATTER_LAUNCH, onLaunch);
  });

  it('does not create a client with a blank name', () => {
    render(<NewClientDialog open={true} onOpenChange={() => undefined} />);
    // Button disabled + handler guards against whitespace-only names.
    fireEvent.change(screen.getByTestId('new-client-name'), { target: { value: '   ' } });
    act(() => {
      fireEvent.click(screen.getByTestId('new-client-create'));
    });
    expect(useMatterStore.getState().matters).toHaveLength(0);
  });
});
