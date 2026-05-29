/**
 * useTrial — 30-day full-feature trial state.
 *
 * Pricing model: Keepance is fully featured for 30 days from first launch.
 * After that, the app drops into "viewer" mode — open existing files,
 * read-only — until the user activates a paid license via useLicense.
 *
 * This hook is the single source of truth for "should the trial gate
 * apply right now?". It does NOT itself disable any UI; it just exposes
 * `isExpired`, `daysRemaining`, etc. so individual surfaces (AI send,
 * workflow run, file edits) can decide how to react.
 *
 * Public API:
 *   const { firstLaunchAt, daysRemaining, isExpired, daysElapsed } = useTrial();
 *
 * Notes:
 * - First launch is recorded once, in localStorage. Wiping localStorage
 *   resets the trial — that's a known weakness, acceptable for v1; if
 *   trial-evasion becomes real we can move the timestamp to the OS
 *   keychain via Tauri's invoke API (same pattern as license JWT).
 * - The trial gate is suppressed when the user has activated a license
 *   (the gate combines `isExpired && !isActivated` at the call site).
 *   See useTrialGate() below for the prebaked combination.
 */

import { useEffect, useState } from 'react';
import { useLicense } from './useLicense';
import { sendEventOnce } from '@/utils/telemetry';

const FIRST_LAUNCH_KEY = 'keepance_first_launch_at';
const TRIAL_DAYS = 30;
const MS_PER_DAY = 24 * 60 * 60 * 1000;

export interface TrialState {
  /** ISO timestamp of the very first time the app launched on this machine. */
  firstLaunchAt: Date;
  /** How many full days have passed since first launch (0 on day one). */
  daysElapsed: number;
  /** Days remaining in the trial. 0 (or negative) once expired. */
  daysRemaining: number;
  /** True once `daysElapsed >= TRIAL_DAYS`. */
  isExpired: boolean;
  /** Convenience: total trial length, exposed for UI copy ("30-day trial"). */
  trialDays: number;
}

function readOrInitFirstLaunch(): Date {
  const existing = localStorage.getItem(FIRST_LAUNCH_KEY);
  if (existing) {
    const d = new Date(existing);
    if (!Number.isNaN(d.getTime())) return d;
  }
  const now = new Date();
  localStorage.setItem(FIRST_LAUNCH_KEY, now.toISOString());
  // Anonymous funnel marker: this install just started its trial. Gated
  // by sendEventOnce so a localStorage wipe + reset can't double-count;
  // gated again by the consent check inside sendEvent so opted-out
  // users send nothing at all.
  void sendEventOnce('trial_start', { license_tier: 'trial', days_since_install: 0 });
  return now;
}

function computeState(firstLaunchAt: Date): TrialState {
  const elapsedMs = Date.now() - firstLaunchAt.getTime();
  const daysElapsed = Math.max(0, Math.floor(elapsedMs / MS_PER_DAY));
  const daysRemaining = Math.max(0, TRIAL_DAYS - daysElapsed);
  return {
    firstLaunchAt,
    daysElapsed,
    daysRemaining,
    isExpired: daysElapsed >= TRIAL_DAYS,
    trialDays: TRIAL_DAYS,
  };
}

/**
 * Trial state for the current machine. Reads (and lazily initializes) the
 * first-launch timestamp from localStorage.
 *
 * Re-evaluates on a 1-hour timer so a long-running app crosses the trial
 * boundary without needing a relaunch.
 */
export function useTrial(): TrialState {
  const [state, setState] = useState<TrialState>(() => computeState(readOrInitFirstLaunch()));

  useEffect(() => {
    const tick = () => {
      const next = computeState(readOrInitFirstLaunch());
      setState(next);
      // Fire the trial_end event the first time we cross the boundary.
      // sendEventOnce dedupes across launches.
      if (next.isExpired) {
        void sendEventOnce('trial_end', { license_tier: 'expired', days_since_install: next.daysElapsed });
      }
    };
    // Immediately check at mount so a long-idle app that comes back to
    // life after the boundary still fires the event on the next launch.
    tick();
    const id = setInterval(tick, 60 * 60 * 1000); // 1h
    return () => clearInterval(id);
  }, []);

  return state;
}

/**
 * The combined gate: "should we lock features right now?"
 *
 * Returns true when the trial is expired AND the user has not activated
 * a paid license. Use this at the call site of any feature you want to
 * gate (AI send, workflow run, new file write, etc.).
 *
 * Co-locates the trial check + the license check so individual UI
 * components don't have to know both hooks exist.
 */
export function useTrialGate(): {
  /** True when features should be disabled. */
  isLocked: boolean;
  /** Days remaining in the trial (when not yet expired). */
  daysRemaining: number;
  /** True when trial has ended and user hasn't paid. */
  isTrialExpired: boolean;
  /** True when the user has paid (no gate applies regardless of trial). */
  isActivated: boolean;
  /** Trial total — for copy. */
  trialDays: number;
} {
  const trial = useTrial();
  const { isActivated } = useLicense();
  return {
    isLocked: trial.isExpired && !isActivated,
    daysRemaining: trial.daysRemaining,
    isTrialExpired: trial.isExpired,
    isActivated,
    trialDays: trial.trialDays,
  };
}
