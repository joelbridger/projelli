import { useSettingsStore } from '@/stores/settingsStore';
import { useCallback, useMemo } from 'react';

/**
 * useFeatureTour
 *
 * Single source of truth for "should the feature tour render right now?".
 *
 * Rules:
 *   - If completed before (persistent flag): never auto-show. User can
 *     manually re-trigger via Settings, Onboarding, "Reset Feature Tour".
 *   - If skipped this session (session-only flag): don't show for the
 *     rest of this app session. Next launch, re-evaluate.
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
  }, [skipThisSession]);

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
