import { describe, expect, it } from 'vitest';
import { shouldShowFirstRunForLaunch } from '@/app/lifecycle/explicitLaunchWorkspace';

describe('first run with an explicit launch workspace', () => {
  it('does not show onboarding or the folder picker on a clean profile', () => {
    expect(
      shouldShowFirstRunForLaunch({
        onboardingComplete: false,
        noRecentWorkspaces: true,
        isTestMode: false,
        isDemoMode: false,
        hasExplicitWorkspace: true,
        forceOnboarding: false,
      })
    ).toBe(false);
  });

  it('keeps normal first-run behavior when no workspace was explicitly supplied', () => {
    expect(
      shouldShowFirstRunForLaunch({
        onboardingComplete: false,
        noRecentWorkspaces: true,
        isTestMode: false,
        isDemoMode: false,
        hasExplicitWorkspace: false,
        forceOnboarding: false,
      })
    ).toBe(true);
  });
});
