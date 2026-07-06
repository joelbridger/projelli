/**
 * usePreStartLocalAi — boot-time trigger for Fix 1 (demo readiness).
 *
 * If "On this computer only" is already the PERSISTED confidentiality choice
 * when the app launches, kick off the llama-server sidecar immediately rather
 * than waiting for the first question after boot. The other trigger —
 * selecting Local-only mid-session — lives in `useRecordConfidentialityChoice`.
 *
 * Waits for `settingsHydrated` before deciding: the settings store starts at
 * its schema default and only reflects the persisted value once hydration
 * completes, so reading it earlier could see 'direct' when the real, saved
 * choice is 'local-only' (same hydration race useAutoResumeWorkspace guards
 * against). Runs at most once per app session.
 */
import { useEffect, useRef } from 'react';
import { getConfidentialityMode } from '@/platform/hooks/useConfidentialityMode';
import { preStartLocalAi } from '@/platform/providers/localAiPreStart';

export function usePreStartLocalAi(settingsHydrated: boolean): void {
  const attempted = useRef(false);

  useEffect(() => {
    if (attempted.current || !settingsHydrated) return;
    attempted.current = true;
    if (getConfidentialityMode() === 'local-only') preStartLocalAi();
  }, [settingsHydrated]);
}
