import '@/i18n';
import { describe, it, expect } from 'vitest';
import { render, screen } from '@testing-library/react';
import { OnboardingShell } from './OnboardingShell';

const baseProps = {
  showLogo: false,
  showBack: false,
  onBack: () => {},
  showContinue: false,
  continueLabel: 'Continue',
  onContinue: () => {},
  dotCount: 0,
  activeDot: -1,
};

/**
 * QA-9 — the model-download progress banner used to be mounted as an
 * independent `fixed` layer OUTSIDE this shell, above it in z-index but with
 * no reserved space, so it painted over a scene's own step header ("2.
 * Securely connect your data"). `topBanner` is now rendered INSIDE the
 * shell's own flow, before the scrolling scene content, so it always occupies
 * its own space and the scene content is pushed down, never covered.
 */
describe('OnboardingShell — QA-9 topBanner placement', () => {
  it('renders no banner wrapper when topBanner is omitted', () => {
    render(
      <OnboardingShell {...baseProps}>
        {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
        <h1>2. Securely connect your data</h1>
      </OnboardingShell>,
    );
    expect(screen.queryByTestId('qa9-banner')).toBeNull();
    expect(screen.getByText('2. Securely connect your data')).toBeTruthy();
  });

  it('places topBanner BEFORE the scene content in DOM order, inside the same shell', () => {
    render(
      <OnboardingShell {...baseProps} topBanner={<div data-testid="qa9-banner">Downloading…</div>}>
        {/* eslint-disable-next-line lantern-i18n/no-hardcoded-string */}
        <h1 data-testid="qa9-heading">2. Securely connect your data</h1>
      </OnboardingShell>,
    );
    const shell = screen.getByTestId('onboarding-v2');
    const banner = screen.getByTestId('qa9-banner');
    const heading = screen.getByTestId('qa9-heading');

    // Both must be inside the same fixed-inset shell (not a separate
    // independently-positioned overlay reintroducing the z-index bug).
    expect(shell.contains(banner)).toBe(true);
    expect(shell.contains(heading)).toBe(true);

    // DOM order: banner before heading. Combined with the banner NOT being
    // `position: fixed`/`absolute` (it renders in normal flow — see
    // OnboardingShell.tsx), this guarantees it occupies space above the
    // heading rather than floating over it.
    const position = banner.compareDocumentPosition(heading);
    expect(Boolean(position & Node.DOCUMENT_POSITION_FOLLOWING)).toBe(true);
  });
});
