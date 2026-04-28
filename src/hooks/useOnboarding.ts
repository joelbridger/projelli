/**
 * useOnboarding — tracks whether the first-launch onboarding dialog has
 * been completed (or skipped). Once flipped to true, the dialog never
 * shows again on this install.
 */

import { useEffect, useState } from 'react';

const KEY = 'projelli_onboarding_completed_at';

export function useOnboardingCompleted(): {
  completed: boolean;
  markCompleted: () => void;
} {
  const [completed, setCompleted] = useState<boolean>(
    () => localStorage.getItem(KEY) != null
  );

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === KEY) setCompleted(e.newValue != null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return {
    completed,
    markCompleted: () => {
      localStorage.setItem(KEY, new Date().toISOString());
      setCompleted(true);
    },
  };
}
