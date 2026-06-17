/**
 * onboardingState — centralised helpers for onboarding persistence.
 *
 * All onboarding-related localStorage keys flow through here so callers
 * don't scatter raw key strings across the app.  The two primary exported
 * helpers (hasCompletedOnboarding / getOnboardingProfession) are
 * re-exported from here; FirstRunWizard.tsx still exports them directly as
 * well so existing importers of '@/features/onboarding' are unaffected.
 */

export const ONBOARDING_COMPLETE_KEY = 'keepance_onboarding_complete';
export const ONBOARDING_PROFESSION_KEY = 'keepance_profession';
const ONBOARDING_PROGRESS_KEY = 'keepance_onboarding_progress';

export type OnboardingStep = 'ai-key' | 'email' | 'firm';

// ---------------------------------------------------------------------------
// Completion helpers
// ---------------------------------------------------------------------------

/** Returns true when the user has finished (or explicitly skipped) onboarding. */
export function hasCompletedOnboarding(): boolean {
  return localStorage.getItem(ONBOARDING_COMPLETE_KEY) === 'true';
}

/**
 * Mark onboarding as complete, persisting the chosen profession at the same
 * time.  Callers that previously wrote the profession separately can pass the
 * value here to keep it in one atomic write.
 */
export function markOnboardingComplete(profession: string): void {
  localStorage.setItem(ONBOARDING_PROFESSION_KEY, profession);
  localStorage.setItem(ONBOARDING_COMPLETE_KEY, 'true');
}

/** Clear the completion flag (for testing / "show onboarding again"). */
export function resetOnboarding(): void {
  localStorage.removeItem(ONBOARDING_COMPLETE_KEY);
  localStorage.removeItem(ONBOARDING_PROFESSION_KEY);
  localStorage.removeItem(ONBOARDING_PROGRESS_KEY);
}

// ---------------------------------------------------------------------------
// Profession helper
// ---------------------------------------------------------------------------

type Profession = 'legal' | 'tax' | 'consulting' | 'advisor' | 'other';

/** Read the profession stored during onboarding; defaults to 'other'. */
export function getOnboardingProfession(): Profession {
  const v = localStorage.getItem(ONBOARDING_PROFESSION_KEY);
  if (
    v === 'legal' ||
    v === 'tax' ||
    v === 'consulting' ||
    v === 'advisor' ||
    v === 'other'
  ) {
    return v;
  }
  return 'other';
}

// ---------------------------------------------------------------------------
// Per-step progress helpers
// ---------------------------------------------------------------------------

const DEFAULT_PROGRESS: Record<OnboardingStep, boolean> = {
  'ai-key': false,
  email: false,
  firm: false,
};

/** Return the progress map, defaulting every step to false. */
export function getOnboardingProgress(): Record<OnboardingStep, boolean> {
  try {
    const raw = localStorage.getItem(ONBOARDING_PROGRESS_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Record<OnboardingStep, boolean>>;
      return {
        'ai-key': parsed['ai-key'] ?? false,
        email: parsed.email ?? false,
        firm: parsed.firm ?? false,
      };
    }
  } catch {
    // Malformed JSON or unavailable storage; return defaults.
  }
  return { ...DEFAULT_PROGRESS };
}

/** Mark one step as done (or not-done). */
export function setOnboardingProgressStep(
  step: OnboardingStep,
  done: boolean,
): void {
  const current = getOnboardingProgress();
  current[step] = done;
  try {
    localStorage.setItem(ONBOARDING_PROGRESS_KEY, JSON.stringify(current));
  } catch {
    // Ignore write failures; in-memory state is fine for the current session.
  }
}
