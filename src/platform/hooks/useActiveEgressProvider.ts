/**
 * useActiveEgressProvider — the top-bar trust badge's provider, resolved from
 * THE single source of truth in `activeEgressProvider.ts`.
 *
 * The egress badge is the product's #1 trust signal, so it must never name a
 * provider the user can't actually send to, and it must agree with what Ask
 * actually does. F1 fix: this hook and Ask's pre-send banner now resolve through
 * the SAME functions (`resolveActiveEgressProviderId` / …Sync), so the top bar
 * and Ask can never disagree on one screen. See `activeEgressProvider.ts` for the
 * resolution rules and the unit-tested pure core.
 *
 * This file keeps only the React reactivity: a synchronous best-effort initial
 * value (flicker-free) that is then corrected by the authoritative async check,
 * re-run whenever a key is added/removed (KeychainService broadcasts
 * `notifyEgressConfigChange`) or the confidentiality mode changes.
 */

import { useEffect, useRef, useState } from 'react';
import { type EgressProvider } from '@/platform/privacy/egress';
import {
  EGRESS_CONFIG_CHANGE_EVENT,
  notifyEgressConfigChange,
} from '@/platform/privacy/egressConfigEvents';
import {
  resolveActiveEgressProviderId,
  resolveActiveEgressProviderIdSync,
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
 * Authoritative resolution using the same key source the real send uses.
 * Delegates to the single source of truth so the badge and the send agree.
 */
export function resolveActiveEgressProvider(mode: string): Promise<EgressProvider> {
  return resolveActiveEgressProviderId(mode);
}

export function useActiveEgressProvider(mode: string): EgressProvider {
  const requestIdRef = useRef(0);
  const [provider, setProvider] = useState<EgressProvider>(() =>
    resolveActiveEgressProviderSync(mode),
  );

  useEffect(() => {
    let cancelled = false;
    const update = () => {
      // Tag this resolution so a slower earlier async check can't overwrite the
      // badge with stale state after a newer change (e.g. rapid key add/remove).
      const requestId = ++requestIdRef.current;
      // Instant, flicker-free best-effort from the metadata mirror...
      setProvider(resolveActiveEgressProviderSync(mode));
      // ...then correct it with the authoritative key-presence check (keychain
      // on desktop), so the badge matches exactly what Ask would send with.
      void resolveActiveEgressProvider(mode).then((p) => {
        if (!cancelled && requestId === requestIdRef.current) setProvider(p);
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

  return provider;
}
