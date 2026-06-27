/**
 * onboardingV2 feature flag.
 *
 * Gates the new prototype-matched first-run onboarding (OnboardingV2) that
 * wires each screen to real functionality: AI-key setup, the real data
 * connectors, and the live setup-progress backend.
 *
 * Default OFF. Flag-OFF leaves today's behavior byte-for-byte identical
 * (the existing GuidedOnboarding shows on first run). This mirrors the
 * sibling `newNav` flag pattern exactly so the two branches stay symmetric.
 *
 * Resolution order (URL wins so a demo can force it without clearing state):
 *   1. `?onboardingV2=1` / `?onboardingV2=0` in the URL query string.
 *   2. localStorage `keepance:onboardingV2 === '1'`.
 *   3. Default: false.
 *
 * SSR/test-safe: returns false when `window` is absent and never throws.
 */

import { useState } from 'react';

const STORAGE_KEY = 'keepance:onboardingV2';
const URL_PARAM = 'onboardingV2';

/** Read the flag once (non-reactive). Safe to call anywhere, never throws. */
export function isOnboardingV2Enabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = params.get(URL_PARAM);
    if (fromUrl === '1') return true;
    if (fromUrl === '0') return false;
    return window.localStorage.getItem(STORAGE_KEY) === '1';
  } catch {
    return false;
  }
}

/** Persist the flag so it survives reloads (used by the demo re-entry path). */
export function setOnboardingV2Enabled(enabled: boolean): void {
  if (typeof window === 'undefined') return;
  try {
    if (enabled) window.localStorage.setItem(STORAGE_KEY, '1');
    else window.localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* storage unavailable — flag stays at its default */
  }
}

/**
 * Hook variant. The flag is stable for the session (URL query + localStorage
 * don't change mid-session), so it's read once at mount — no effect needed.
 */
export function useOnboardingV2(): boolean {
  const [enabled] = useState<boolean>(() => isOnboardingV2Enabled());
  return enabled;
}
