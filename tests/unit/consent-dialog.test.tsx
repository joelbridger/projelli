import { render, screen, fireEvent } from '@testing-library/react';
import { describe, it, expect, vi } from 'vitest';
import { ConsentDialog } from '@/features/meetings/ConsentDialog';

describe('ConsentDialog', () => {
  // codex-review (P2): the dialog is rendered unconditionally by its parent
  // (open toggles a prop, not mount/unmount), so a stale checked state from
  // a prior confirmation must not leak into the next client's dialog.
  it('resets the checkbox on reopen when there is no standing consent', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConsentDialog open consentMode="one-party" standingConsent={null} onOpenChange={() => {}} onConfirm={onConfirm} />,
    );
    const checkbox = screen.getByTestId('consent-checkbox') as HTMLInputElement;
    expect(checkbox.checked).toBe(false);
    fireEvent.click(checkbox);
    expect(checkbox.checked).toBe(true);

    // Close, then reopen for (implicitly) a different client — same mounted
    // instance, mirroring how ClientMeetingsTab renders it.
    rerender(
      <ConsentDialog open={false} consentMode="one-party" standingConsent={null} onOpenChange={() => {}} onConfirm={onConfirm} />,
    );
    rerender(
      <ConsentDialog open consentMode="one-party" standingConsent={null} onOpenChange={() => {}} onConfirm={onConfirm} />,
    );
    expect((screen.getByTestId('consent-checkbox') as HTMLInputElement).checked).toBe(false);
  });

  it('pre-checks the checkbox when standing consent resolves after the dialog is already open', () => {
    const onConfirm = vi.fn();
    const { rerender } = render(
      <ConsentDialog open consentMode="one-party" standingConsent={null} onOpenChange={() => {}} onConfirm={onConfirm} />,
    );
    expect((screen.getByTestId('consent-checkbox') as HTMLInputElement).checked).toBe(false);

    rerender(
      <ConsentDialog
        open
        consentMode="one-party"
        standingConsent={{ mode: 'one-party', scope: 'standing', confirmedAt: '2026-06-12T00:00:00Z' }}
        onOpenChange={() => {}}
        onConfirm={onConfirm}
      />,
    );
    expect((screen.getByTestId('consent-checkbox') as HTMLInputElement).checked).toBe(true);
    expect(screen.getByTestId('standing-consent-note')).toBeInTheDocument();
  });

  it('disables Start recording until checked, then calls onConfirm', () => {
    const onConfirm = vi.fn();
    render(<ConsentDialog open consentMode="two-party" standingConsent={null} onOpenChange={() => {}} onConfirm={onConfirm} />);
    const start = screen.getByTestId('consent-start-button');
    expect(start).toBeDisabled();
    fireEvent.click(screen.getByTestId('consent-checkbox'));
    expect(start).not.toBeDisabled();
    fireEvent.click(start);
    expect(onConfirm).toHaveBeenCalledWith({});
  });
});
