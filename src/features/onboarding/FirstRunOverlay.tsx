/**
 * FirstRunOverlay — picks the first-run onboarding implementation by flag.
 *
 * Flag OFF (default): the existing GuidedOnboarding, byte-for-byte today's
 * behavior. Flag ON (`?onboardingV2=1` or localStorage): the prototype-matched
 * OnboardingV2 wired to real functionality.
 *
 * Both share GuidedOnboardingProps, so App.tsx swaps one component name and
 * nothing else changes. Keeping the branch here (not in App.tsx) minimizes
 * edits to the shared entry file so the parallel nav-redesign branch merges
 * cleanly.
 */

import { isOnboardingV2Enabled } from '@/platform/flags/onboardingV2';
import { GuidedOnboarding, type GuidedOnboardingProps } from './GuidedOnboarding';
import { OnboardingV2 } from './v2/OnboardingV2';

export function FirstRunOverlay(props: GuidedOnboardingProps) {
  if (isOnboardingV2Enabled()) {
    return <OnboardingV2 {...props} />;
  }
  return <GuidedOnboarding {...props} />;
}

export default FirstRunOverlay;
