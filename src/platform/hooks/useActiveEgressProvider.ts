/**
 * useActiveEgressProvider / useActiveEgressDestination — the top-bar trust
 * badge's destination, resolved from THE single source of truth in
 * `activeEgressProvider.ts`.
 *
 * The egress badge is the product's #1 trust signal, so it must never name a
 * destination the user can't actually send to, and it must agree with what the
 * real sends do. This file keeps only the React reactivity.
 *
 * Fix round 1, item 1 — the mode-switch DISPLAY RACE (recreated the old B-PRIV-1
 * bug): the confidentiality mode and the resolved provider come from TWO
 * independent hooks, so on a Local-only → Direct switch the component re-renders
 * with the NEW mode while this hook still holds the OLD provider (a local engine)
 * for one frame — painting "Using local AI" under Direct. Fix: tag the resolved
 * value with the mode it was resolved UNDER and return `null` ("checking") until
 * the tag matches the requested mode, exactly like useAsk's pre-send banner.
 */

import { useEffect, useRef, useState } from 'react';
import { type EgressProvider } from '@/platform/privacy/egress';
import {
  EGRESS_CONFIG_CHANGE_EVENT,
  notifyEgressConfigChange,
} from '@/platform/privacy/egressConfigEvents';
import {
  resolveActiveEgressDestination,
  resolveActiveEgressDestinationSync,
  resolveActiveEgressProviderId,
  resolveActiveEgressProviderIdSync,
  type ActiveEgressDestination,
} from '@/platform/privacy/activeEgressProvider';

// Re-export so existing importers keep working; the canonical home is
// egressConfigEvents (KeychainService imports it there to avoid a cycle).
export { EGRESS_CONFIG_CHANGE_EVENT, notifyEgressConfigChange };

/**
 * Synchronous best-effort resolution from the key metadata mirror. Exported for
 * non-React reads/tests. Delegates to the single source of truth.
 */
export function resolveActiveEgressProviderSync(mode: string): EgressProvider {
  return resolveActiveEgressProviderIdSync(mode);
}

/**
 * Authoritative resolution using the same sources the real send uses.
 * Delegates to the single source of truth so the badge and the send agree.
 */
export function resolveActiveEgressProvider(mode: string): Promise<EgressProvider> {
  return resolveActiveEgressProviderId(mode);
}

/**
 * The full destination (provider id + whether the firm assured proxy is live),
 * MODE-TAGGED. Returns `null` for the frames where the resolved value belongs to
 * a different mode than the one requested — the badge renders "checking" then,
 * never a stale destination under a new mode.
 */
export function useActiveEgressDestination(
  mode: string,
): (ActiveEgressDestination & { mode: string }) | null {
  const requestIdRef = useRef(0);
  const [resolved, setResolved] = useState<ActiveEgressDestination & { mode: string }>(
    () => ({ ...resolveActiveEgressDestinationSync(mode), mode }),
  );

  useEffect(() => {
    let cancelled = false;
    const update = () => {
      // Tag this resolution so a slower earlier async check can't overwrite the
      // badge with stale state after a newer change (e.g. rapid key add/remove).
      const requestId = ++requestIdRef.current;
      // Instant, flicker-free best-effort from the metadata mirror...
      setResolved({ ...resolveActiveEgressDestinationSync(mode), mode });
      // ...then correct it with the authoritative check, so the badge matches
      // exactly what the real send would do.
      void resolveActiveEgressDestination(mode).then((d) => {
        if (!cancelled && requestId === requestIdRef.current) setResolved({ ...d, mode });
      });
    };
    update();
    window.addEventListener(EGRESS_CONFIG_CHANGE_EVENT, update);
    window.addEventListener('storage', update);
    return () => {
      cancelled = true;
      window.removeEventListener(EGRESS_CONFIG_CHANGE_EVENT, update);
      window.removeEventListener('storage', update);
    };
  }, [mode]);

  // Mode-tagged: never return a destination resolved under a DIFFERENT mode. On a
  // mode switch the component re-renders with the new mode BEFORE this effect
  // re-resolves, so returning the stale value here would paint e.g. a local
  // engine under Direct for one frame. Return null ("checking") until they match.
  return resolved.mode === mode ? resolved : null;
}

/**
 * Provider-id-only view of {@link useActiveEgressDestination}. `null` means
 * "checking" (mode just changed, or the resolver has not settled).
 */
export function useActiveEgressProvider(mode: string): EgressProvider | null {
  const dest = useActiveEgressDestination(mode);
  return dest ? dest.providerId : null;
}
