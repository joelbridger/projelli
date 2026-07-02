import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

const carryMattersToFirm = vi.fn().mockResolvedValue([]);
vi.mock('@/features/firm/logic/carryMattersToFirm', () => ({
  carryMattersToFirm: (...a: unknown[]) => carryMattersToFirm(...a),
}));

// Provide matters: one normal, one privileged, one archived (excluded), one already-shared (excluded).
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: (sel: (s: unknown) => unknown) =>
    sel({
      matters: [
        { id: 'm1', name: 'Acme', client: 'Acme' },
        { id: 'm2', name: 'Secret', client: 'Secret', privileged: true },
        { id: 'm3', name: 'Old', client: 'Old', archived: true },
        { id: 'm4', name: 'Shared', client: 'Shared', shared: true, firmMatterId: 'fm_x' },
        // Linked to the firm but with a stale/missing `shared` flag: must still
        // be excluded (would otherwise create a duplicate firm shell).
        { id: 'm5', name: 'Linked', client: 'Linked', firmMatterId: 'fm_y' },
      ],
    }),
}));

// getClient: the real source is the firm store selector `s.client` (a () => FirmApiClient).
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: (sel: (s: unknown) => unknown) => sel({ client: () => ({}) }),
}));

import { CarryMattersStep } from '@/features/firm/CarryMattersStep';

beforeEach(() => vi.clearAllMocks());

describe('CarryMattersStep', () => {
  it('lists only eligible matters (excludes archived, already-shared, and firm-linked)', () => {
    render(<CarryMattersStep onDone={() => {}} onSkip={() => {}} />);
    expect(screen.getByText('Acme')).toBeInTheDocument();
    expect(screen.getByText('Secret')).toBeInTheDocument();
    expect(screen.queryByText('Old')).not.toBeInTheDocument();
    expect(screen.queryByText('Shared')).not.toBeInTheDocument();
    expect(screen.queryByText('Linked')).not.toBeInTheDocument();
  });

  it('requires a confirm before a privileged matter can be set to share', async () => {
    render(<CarryMattersStep onDone={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByTestId('carry-share-m2')); // try to set the privileged matter to share
    expect(screen.getByTestId('privileged-share-confirm')).toBeInTheDocument();
    fireEvent.click(screen.getByTestId('privileged-share-confirm-accept'));
    fireEvent.click(screen.getByTestId('carry-submit'));
    await waitFor(() => expect(carryMattersToFirm).toHaveBeenCalled());
    const selections = carryMattersToFirm.mock.calls[0]![0];
    expect(selections).toContainEqual(expect.objectContaining({ matterId: 'm2', action: 'share' }));
  });

  it('declining the privileged confirm leaves that matter private', async () => {
    render(<CarryMattersStep onDone={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByTestId('carry-share-m2'));
    fireEvent.click(screen.getByTestId('privileged-share-confirm-cancel'));
    fireEvent.click(screen.getByTestId('carry-submit'));
    await waitFor(() => expect(carryMattersToFirm).toHaveBeenCalled());
    const selections = carryMattersToFirm.mock.calls[0]![0];
    expect(selections).toContainEqual(expect.objectContaining({ matterId: 'm2', action: 'private' }));
  });

  it('a non-privileged matter set to share goes straight to share, no confirm', async () => {
    render(<CarryMattersStep onDone={() => {}} onSkip={() => {}} />);
    fireEvent.click(screen.getByTestId('carry-share-m1'));
    expect(screen.queryByTestId('privileged-share-confirm')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('carry-submit'));
    await waitFor(() => expect(carryMattersToFirm).toHaveBeenCalled());
    const selections = carryMattersToFirm.mock.calls[0]![0];
    expect(selections).toContainEqual(expect.objectContaining({ matterId: 'm1', action: 'share' }));
  });

  it('shows the per-matter results screen on submit and only finishes on Continue', async () => {
    carryMattersToFirm.mockResolvedValueOnce([
      { matterId: 'm1', status: 'shared', firmMatterId: 'fm_m1' },
      { matterId: 'm2', status: 'failed', error: 'relay down' },
    ]);
    const onDone = vi.fn();
    render(<CarryMattersStep onDone={onDone} onSkip={() => {}} />);
    fireEvent.click(screen.getByTestId('carry-share-m1'));
    fireEvent.click(screen.getByTestId('carry-submit'));
    // The results screen renders (with the failure visible); onDone has NOT fired.
    await waitFor(() => expect(screen.getByTestId('carry-done')).toBeInTheDocument());
    expect(screen.getByTestId('carry-outcome-error-m2')).toBeInTheDocument();
    expect(onDone).not.toHaveBeenCalled();
    // Only Continue advances the flow.
    fireEvent.click(screen.getByTestId('carry-done'));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it('Skip for now calls onSkip and does not carry anything', () => {
    const onSkip = vi.fn();
    render(<CarryMattersStep onDone={() => {}} onSkip={onSkip} />);
    fireEvent.click(screen.getByTestId('carry-skip'));
    expect(onSkip).toHaveBeenCalled();
    expect(carryMattersToFirm).not.toHaveBeenCalled();
  });
});
