import { useSettingsStore } from '@/platform/settings/settingsStore';
import { useCallback, useMemo } from 'react';

/**
 * useFeatureTour
 *
 * Single source of truth for "should the feature tour render right now?".
 *
 * Rules:
 *   - If completed OR skipped before (both persist the same "seen it" flag):
 *     never auto-show again. User can manually re-trigger via Settings,
 *     Onboarding, "Reset Feature Tour". (Skipping used to set only a
 *     session-only flag, so the tour reappeared on every subsequent app
 *     launch until a user clicked all the way through to "Finish" — found
 *     live on the Legion pre-flight. Skip now persists too.)
 *   - Otherwise: yes, show.
 */
export function useFeatureTour() {
  const completed = useSettingsStore((s) => s.featuresTourCompleted);
  const skippedThisSession = useSettingsStore((s) => s.featuresTourSkippedThisSession);
  const markCompleted = useSettingsStore((s) => s.markFeatureTourCompleted);
  const skipThisSession = useSettingsStore((s) => s.skipFeatureTourThisSession);
  const resetTour = useSettingsStore((s) => s.resetFeatureTour);

  const shouldAutoShow = useMemo(
    () => !completed && !skippedThisSession,
    [completed, skippedThisSession],
  );

  const complete = useCallback(() => {
    markCompleted();
  }, [markCompleted]);

  const skipForNow = useCallback(() => {
    skipThisSession();
    // Persist the same "seen it" flag Finish uses — a skip must not
    // auto-show again next launch either.
    markCompleted();
  }, [skipThisSession, markCompleted]);

  const restart = useCallback(() => {
    resetTour();
  }, [resetTour]);

  return {
    shouldAutoShow,
    completed,
    skippedThisSession,
    complete,
    skipForNow,
    restart,
  };
}
