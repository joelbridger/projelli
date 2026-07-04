/**
 * FirstRunOverlay — the first-run onboarding entry point.
 *
 * Always renders OnboardingV2 (the 4-step flow). The old 9-step
 * GuidedOnboarding was retired 2026-06-30 and moved to `./_archive/` — it is
 * no longer wired into the live app. The `onboardingV2` flag that used to
 * gate this branch (`@/platform/flags/onboardingV2`) was removed entirely.
 *
 * Kept as its own file (not inlined into App.tsx) so the entry point stays a
 * single, easily swappable seam.
 */

import type { ReactNode } from 'react';
import type { GuidedOnboardingProps } from './onboardingTypes';
import { OnboardingV2 } from './v2/OnboardingV2';

export function FirstRunOverlay(props: GuidedOnboardingProps & { topBanner?: ReactNode }) {
  return <OnboardingV2 {...props} />;
}

export default FirstRunOverlay;
