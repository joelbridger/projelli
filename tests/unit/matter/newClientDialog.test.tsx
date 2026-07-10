/**
 * NewClientDialog — new-client intake flow.
 *   - collects a display name plus optional contact fields,
 *   - lets the advisor review the locked New household checklist,
 *   - on link creation, lands the user inside the new client's Onboarding tab by
 *     dispatching lantern:matter-launch with surface: 'matters',
 *   - keeps the copy-first link controls visible.
 */

import { beforeEach, describe, it, expect, vi } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';
import { useMatterStore, setMatterAuditEmitter } from '@/platform/matter/matterStore';
import { useIntakeStore } from '@/platform/intake/intakeStore';
import { EV_MATTER_LAUNCH } from '@/config/identity';

const intakeMocks = vi.hoisted(() => ({
  createAdvisorIntake: vi.fn(async () => ({
    link: 'https://forms.example.test/i/intake-1#secret',
    tokenB64: 'token',
    linkSecretB64: 'secret',
    publicKeyRaw: new Uint8Array(65),
    privateKey: {} as CryptoKey,
    checklistCiphertextB64: 'checklist',
    stateCiphertextB64: 'state',
    intakeId: 'intake-1',
  })),
}));

vi.mock('@/platform/fs/workspaceStore', () => ({
  useWorkspaceStore: (sel: (s: { rootPath: string | null; fileTree: unknown[] }) => unknown) =>
    sel({ rootPath: '/ws', fileTree: [] }),
}));

// ensureClientFolderOnDisk's disk write no-ops without a workspace service.
vi.mock('@/platform/fs/activeWorkspaceService', () => ({
  getActiveWorkspaceService: () => null,
}));

vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: (sel: (s: {
    seatToken: string;
    accessToken: string;
    session: { org: { name: string } };
  }) => unknown) => sel({
    seatToken: 'seat-test',
    accessToken: 'access-test',
    session: { org: { name: 'North Star Planning' } },
  }),
}));

vi.mock('@/platform/intake/createIntake', () => ({
  createAdvisorIntake: intakeMocks.createAdvisorIntake,
}));

import { NewClientDialog } from '@/features/matters/NewClientDialog';

function reset() {
  useMatterStore.setState({ matters: [], activeMatterId: null });
  useIntakeStore.getState().resetForTests();
  intakeMocks.createAdvisorIntake.mockClear();
  setMatterAuditEmitter(() => undefined);
}

describe('NewClientDialog', () => {
  beforeEach(reset);

  it('starts with display name plus optional contact fields', () => {
    render(<NewClientDialog open={true} onOpenChange={() => undefined} />);
    expect(screen.getByTestId('new-client-name')).toBeInTheDocument();
    expect(screen.getByLabelText('Email')).toBeInTheDocument();
    expect(screen.getByLabelText('Phone')).toBeInTheDocument();
    // The heavy create controls are gone.
    expect(screen.queryByTestId('matter-new-client')).not.toBeInTheDocument();
    expect(screen.queryByTestId('matter-new-privileged')).not.toBeInTheDocument();
  });

  it('creates the client, stores the intake, and lands inside Onboarding', async () => {
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
    fireEvent.click(screen.getByTestId('new-client-next'));
    fireEvent.click(screen.getByTestId('new-client-review'));
    fireEvent.click(screen.getByTestId('new-client-create'));

    await waitFor(() => expect(useMatterStore.getState().matters).toHaveLength(1));
    const matters = useMatterStore.getState().matters;
    expect(matters).toHaveLength(1);
    expect(matters[0]!.name).toBe('The Reyes Household');
    // The new client is scoped to its own folder from the first action.
    expect(matters[0]!.folderPaths).toEqual(['/ws/The Reyes Household']);
    expect(useIntakeStore.getState().getIntakeForMatter(matters[0]!.id)?.link).toBe(
      'https://forms.example.test/i/intake-1#secret',
    );
    expect(useMatterStore.getState().clientMapHubTab).toBe('onboarding');
    // The link controls stay visible for copy/email/SMS after the client opens.
    expect(onOpenChange).not.toHaveBeenCalledWith(false);
    expect(launches).toEqual([{ matterId: matters[0]!.id, surface: 'matters' }]);

    window.removeEventListener(EV_MATTER_LAUNCH, onLaunch);
  });

  it('does not advance with a blank name', () => {
    render(<NewClientDialog open={true} onOpenChange={() => undefined} />);
    fireEvent.change(screen.getByTestId('new-client-name'), { target: { value: '   ' } });
    expect(screen.getByTestId('new-client-next')).toBeDisabled();
    expect(useMatterStore.getState().matters).toHaveLength(0);
  });
});
