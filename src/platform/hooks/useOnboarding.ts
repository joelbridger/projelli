/**
 * useOnboarding — tracks whether the first-launch onboarding dialog has
 * been completed (or skipped). Once flipped to true, the dialog never
 * shows again on this install.
 */

import { useEffect, useState } from 'react';
import { SK_ONBOARDING_COMPLETED_AT } from '@/config/identity';

export function useOnboardingCompleted(): {
  completed: boolean;
  markCompleted: () => void;
} {
  const [completed, setCompleted] = useState<boolean>(
    () => localStorage.getItem(SK_ONBOARDING_COMPLETED_AT) != null
  );

  useEffect(() => {
    const onStorage = (e: StorageEvent) => {
      if (e.key === SK_ONBOARDING_COMPLETED_AT) setCompleted(e.newValue != null);
    };
    window.addEventListener('storage', onStorage);
    return () => window.removeEventListener('storage', onStorage);
  }, []);

  return {
    completed,
    markCompleted: () => {
      localStorage.setItem(SK_ONBOARDING_COMPLETED_AT, new Date().toISOString());
      setCompleted(true);
    },
  };
}
