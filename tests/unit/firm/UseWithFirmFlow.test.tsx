import { describe, it, expect, vi, beforeEach } from 'vitest';
import { render, screen, fireEvent } from '@testing-library/react';

// Mock FirmSignIn so we can assert which mode (claim vs signin) it renders in.
vi.mock('@/features/firm/FirmSignIn', () => ({
  FirmSignIn: ({ initialPanel }: { initialPanel?: string }) => (
    <div data-testid="firm-signin-mock" data-panel={initialPanel ?? 'signin'} />
  ),
}));

// Mock CarryMattersStep so we can assert it renders once a seat is active.
vi.mock('@/features/firm/CarryMattersStep', () => ({
  CarryMattersStep: ({ onDone, onSkip }: { onDone: () => void; onSkip: () => void }) => (
    <div data-testid="carry-step-mock">
      <button data-testid="carry-step-done" onClick={() => onDone()} />
      <button data-testid="carry-step-skip" onClick={() => onSkip()} />
    </div>
  ),
}));

// Controllable firm session.
let firm = { isSignedIn: false, hasActiveSeat: false };
vi.mock('@/platform/hooks/useFirm', () => ({
  useFirm: () => firm,
}));

import { UseWithFirmFlow } from '@/features/firm/UseWithFirmFlow';

beforeEach(() => {
  vi.clearAllMocks();
  firm = { isSignedIn: false, hasActiveSeat: false };
});

describe('UseWithFirmFlow', () => {
  it('opens on the two-door choice screen', () => {
    render(<UseWithFirmFlow onClose={() => {}} />);
    expect(screen.getByTestId('firm-door-create')).toBeInTheDocument();
    expect(screen.getByTestId('firm-door-join')).toBeInTheDocument();
    expect(screen.queryByTestId('firm-signin-mock')).not.toBeInTheDocument();
  });

  it('the create door routes into FirmSignIn claim mode', () => {
    render(<UseWithFirmFlow onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('firm-door-create'));
    const signin = screen.getByTestId('firm-signin-mock');
    expect(signin).toHaveAttribute('data-panel', 'claim');
  });

  it('the join door routes into FirmSignIn sign-in mode', () => {
    render(<UseWithFirmFlow onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('firm-door-join'));
    const signin = screen.getByTestId('firm-signin-mock');
    expect(signin).toHaveAttribute('data-panel', 'signin');
  });

  it('advances to CarryMattersStep once a firm seat becomes active', () => {
    const { rerender } = render(<UseWithFirmFlow onClose={() => {}} />);
    fireEvent.click(screen.getByTestId('firm-door-join'));
    expect(screen.getByTestId('firm-signin-mock')).toBeInTheDocument();
    // Seat activates (e.g. activateSeat succeeded).
    firm = { isSignedIn: true, hasActiveSeat: true };
    rerender(<UseWithFirmFlow onClose={() => {}} />);
    expect(screen.getByTestId('carry-step-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('firm-signin-mock')).not.toBeInTheDocument();
  });

  it('finishing the carry step closes the flow', () => {
    firm = { isSignedIn: true, hasActiveSeat: true };
    const onClose = vi.fn();
    render(<UseWithFirmFlow onClose={onClose} />);
    // Already has an active seat: routed straight to carry-over, no choice/auth.
    expect(screen.getByTestId('carry-step-mock')).toBeInTheDocument();
    expect(screen.queryByTestId('firm-door-create')).not.toBeInTheDocument();
    fireEvent.click(screen.getByTestId('carry-step-done'));
    expect(onClose).toHaveBeenCalled();
  });

  it('skipping the carry step closes the flow', () => {
    firm = { isSignedIn: true, hasActiveSeat: true };
    const onClose = vi.fn();
    render(<UseWithFirmFlow onClose={onClose} />);
    fireEvent.click(screen.getByTestId('carry-step-skip'));
    expect(onClose).toHaveBeenCalled();
  });
});
