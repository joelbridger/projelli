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

  // 2026-07-04 UX review B6: a failed start must never close on silence —
  // the advisor has to see that no recording is running.
  it('shows a start failure inline instead of closing', () => {
    render(
      <ConsentDialog
        open
        consentMode="one-party"
        standingConsent={null}
        errorMessage="recording sidecar not found"
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId('consent-error').textContent).toContain('recording sidecar not found');
  });

  // 2026-07-04 UX review S2: with no state on file we must not assert
  // "Your state requires everyone's consent" as fact — wording goes
  // conditional while the recorded mode stays the safe two-party default.
  it('uses conditional two-party wording when the state is unknown', () => {
    render(
      <ConsentDialog
        open
        consentMode="two-party"
        stateKnown={false}
        standingConsent={null}
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByText(/if your state requires/i)).toBeInTheDocument();
  });

  // Recording Notice Kit: the "say this out loud" script step is a first-class
  // part of the dialog when a script is supplied.
  it('shows the spoken-notice script prominently when provided', () => {
    render(
      <ConsentDialog
        open
        consentMode="two-party"
        standingConsent={null}
        noticeScript="I'm recording this for my notes, alright?"
        onOpenChange={() => {}}
        onConfirm={() => {}}
      />,
    );
    expect(screen.getByTestId('consent-notice-script')).toBeInTheDocument();
    expect(screen.getByTestId('consent-notice-script-text').textContent).toContain("recording this for my notes");
  });

  // Trust review E2 / Legion bug: the "say this out loud" step must ALWAYS
  // render when starting a recording — it's the record-time nudge the whole
  // Notice Kit depends on. A blank/absent script must fall back to the built-in
  // localized wording, never vanish.
  it('always shows the script step, falling back to the built-in wording when no script is supplied', () => {
    render(
      <ConsentDialog open consentMode="one-party" standingConsent={null} onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByTestId('consent-notice-script')).toBeInTheDocument();
    // The built-in default wording is shown (not empty).
    expect(screen.getByTestId('consent-notice-script-text').textContent?.trim().length).toBeGreaterThan(2);
  });

  it('shows the script step even when an empty/blank script is passed', () => {
    render(
      <ConsentDialog open consentMode="one-party" standingConsent={null} noticeScript="   " onOpenChange={() => {}} onConfirm={() => {}} />,
    );
    expect(screen.getByTestId('consent-notice-script')).toBeInTheDocument();
    expect(screen.getByTestId('consent-notice-script-text').textContent?.trim().length).toBeGreaterThan(2);
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
