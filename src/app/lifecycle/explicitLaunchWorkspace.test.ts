import { describe, expect, it } from 'vitest';
import {
  resolveExplicitLaunchWorkspace,
  shouldUseExplicitLaunchWorkspace,
} from './explicitLaunchWorkspace';

const cleanFirstRun = {
  hasCandidate: true,
  onboardingComplete: false,
  recentWorkspacesLoaded: true,
  noRecentWorkspaces: true,
  isTestMode: false,
  isDemoMode: false,
};

describe('explicit launch workspace', () => {
  it('rejects an injected workspace in a release renderer', () => {
    expect(resolveExplicitLaunchWorkspace('/safe/workspace', false)).toBeNull();
  });

  it('allows it only for a genuinely clean debug first run', () => {
    expect(shouldUseExplicitLaunchWorkspace(cleanFirstRun)).toBe(true);
    expect(
      shouldUseExplicitLaunchWorkspace({
        ...cleanFirstRun,
        noRecentWorkspaces: false,
      })
    ).toBe(false);
    expect(
      shouldUseExplicitLaunchWorkspace({
        ...cleanFirstRun,
        onboardingComplete: true,
      })
    ).toBe(false);
  });

  it('waits for Recents before deciding, so it cannot beat reopen-last-workspace', () => {
    expect(
      shouldUseExplicitLaunchWorkspace({
        ...cleanFirstRun,
        recentWorkspacesLoaded: false,
      })
    ).toBe(false);
  });

  it('never competes with the fake test workspace in testMode', () => {
    expect(
      shouldUseExplicitLaunchWorkspace({
        ...cleanFirstRun,
        isTestMode: true,
      })
    ).toBe(false);
  });
});
