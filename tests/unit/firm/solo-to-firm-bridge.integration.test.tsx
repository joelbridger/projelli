/**
 * solo-to-firm-bridge.integration.test.tsx — locks the end-to-end bridge flow.
 *
 * Drives the REAL UseWithFirmFlow + the REAL CarryMattersStep, with only the
 * boundaries mocked: the firm session (useFirm), the firm auth panel
 * (FirmSignIn), the bulk carry routine (carryMattersToFirm), and the matter /
 * firm stores. It asserts:
 *   1. Post-seat trigger: create door -> seat activates -> CarryMattersStep
 *      renders -> submit (one share + one private) calls carryMattersToFirm with
 *      the right selections, then the flow closes.
 *   2. Firm-unchanged invariant: an existing active-seat firm user is routed
 *      straight to carry-over (never the auth panel), and the bridge never
 *      touches firm-tier auth (no claimOrg / activateSeat).
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent, waitFor } from '@testing-library/react';

// Firm auth actions we assert the BRIDGE never calls itself.
const claimOrg = vi.fn();
const activateSeat = vi.fn();

// Controllable firm session.
let firm = { isSignedIn: false, hasActiveSeat: false };
vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => ({ ...firm, claimOrg, activateSeat }),
}));

// FirmSignIn stands in for the existing auth panel. It must be the ONLY thing
// that could call claim/seat; the bridge just frames it. We render a marker and
// expose a button to simulate a successful claim (the seat flip is driven by
// the test mutating `firm` + rerender, mirroring the store update).
vi.mock('@/features/firm/FirmSignIn', () => ({
  FirmSignIn: ({ initialPanel }: { initialPanel?: string }) => (
    <div data-testid="firm-signin" data-panel={initialPanel ?? 'signin'} />
  ),
}));

// Real CarryMattersStep deps: matters + firm client + the bulk carry routine.
const carryMattersToFirm = vi.fn().mockResolvedValue([
  { matterId: 'm1', status: 'shared', firmMatterId: 'fm_m1' },
  { matterId: 'm2', status: 'kept-private' },
]);
vi.mock('@/features/firm/logic/carryMattersToFirm', () => ({
  carryMattersToFirm: (...a: unknown[]) => carryMattersToFirm(...a),
}));
vi.mock('@/platform/matter/matterStore', () => ({
  useMatterStore: (sel: (s: unknown) => unknown) =>
    sel({
      matters: [
        { id: 'm1', name: 'Acme', client: 'Acme' },
        { id: 'm2', name: 'Beta', client: 'Beta' },
      ],
    }),
}));
vi.mock('@/platform/firm/firmStore', () => ({
  useFirmStore: (sel: (s: unknown) => unknown) => sel({ client: () => ({}) }),
}));

import { UseWithFirmFlow } from '@/features/firm/UseWithFirmFlow';

beforeEach(() => {
  vi.clearAllMocks();
  firm = { isSignedIn: false, hasActiveSeat: false };
});

describe('solo-to-firm bridge — end to end', () => {
  it('create door -> seat activates -> carry one share + one private -> closes', async () => {
    const onClose = vi.fn();
    const { rerender } = render(<UseWithFirmFlow onClose={onClose} />);

    // Choose the create door; FirmSignIn opens in claim mode.
    fireEvent.click(screen.getByTestId('firm-door-create'));
    expect(screen.getByTestId('firm-signin')).toHaveAttribute('data-panel', 'claim');

    // The seat becomes active (claim + activate succeeded inside FirmSignIn).
    firm = { isSignedIn: true, hasActiveSeat: true };
    rerender(<UseWithFirmFlow onClose={onClose} />);

    // The post-seat trigger advances to the real carry-over step.
    expect(screen.getByTestId('carry-matters-step')).toBeInTheDocument();
    expect(screen.queryByTestId('firm-signin')).not.toBeInTheDocument();

    // Share m1, leave m2 private (default), then submit.
    fireEvent.click(screen.getByTestId('carry-share-m1'));
    fireEvent.click(screen.getByTestId('carry-submit'));

    await waitFor(() => expect(carryMattersToFirm).toHaveBeenCalledTimes(1));
    const selections = carryMattersToFirm.mock.calls[0][0];
    expect(selections).toContainEqual(expect.objectContaining({ matterId: 'm1', action: 'share' }));
    expect(selections).toContainEqual(expect.objectContaining({ matterId: 'm2', action: 'private' }));

    // onDone closes the flow.
    await waitFor(() => expect(onClose).toHaveBeenCalled());

    // The bridge itself never touches firm-tier auth.
    expect(claimOrg).not.toHaveBeenCalled();
    expect(activateSeat).not.toHaveBeenCalled();
  });

  it('existing firm user is routed straight to carry-over (firm-unchanged)', () => {
    firm = { isSignedIn: true, hasActiveSeat: true };
    render(<UseWithFirmFlow onClose={() => {}} />);

    // No choice screen, no auth panel — straight to carry-over.
    expect(screen.queryByTestId('firm-door-create')).not.toBeInTheDocument();
    expect(screen.queryByTestId('firm-signin')).not.toBeInTheDocument();
    expect(screen.getByTestId('carry-matters-step')).toBeInTheDocument();

    // The bridge never re-runs claim/seat for an already-active firm user.
    expect(claimOrg).not.toHaveBeenCalled();
    expect(activateSeat).not.toHaveBeenCalled();
  });
});
