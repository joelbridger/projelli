/**
 * useFirm — React surface over the firm store (opt-in firm tier).
 *
 * Exposes the firm session, the derived entitlement (an active seat grants the
 * Firm tier), and the sign-in / activate / sign-out actions. Also drives the
 * periodic seat heartbeat so revocations are caught and offline grace stays
 * anchored, mirroring the licensing hook's posture. Solo/local users simply
 * never sign in, so every value here stays in its "no firm" default.
 */

import { useCallback, useEffect } from 'react';
import { useShallow } from 'zustand/react/shallow';
import {
  useFirmStore,
  selectFirmEntitlement,
  selectIsFirmSignedIn,
  selectHasActiveFirmSeat,
  type FirmOrg,
} from '@/platform/firm/firmStore';
import type { Entitlement } from '@/platform/licensing/entitlements';
import type { AssuredProvider } from '@/platform/firm/contract';

/** How often to heartbeat an active seat (catches revocations; anchors grace). */
const HEARTBEAT_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export interface UseFirmResult {
  isSignedIn: boolean;
  /** True when an active seat currently grants the Firm tier. */
  hasActiveSeat: boolean;
  email: string | null;
  role: 'admin' | 'member' | null;
  org: FirmOrg | null;
  seatId: string | null;
  entitlement: Entitlement;
  isOffline: boolean;
  isLoading: boolean;
  error: string | null;
  assuredProviders: AssuredProvider[];
  signIn: (email: string, password: string) => Promise<{ ok: boolean; error?: string }>;
  /** Sign in via the firm's OIDC identity provider (Tauri desktop only). */
  signInSso: (email: string) => Promise<void>;
  claimOrg: (
    licenseKey: string,
    email: string,
    password: string,
    orgName?: string,
  ) => Promise<{ ok: boolean; error?: string; claimedLicenseKey?: string }>;
  activateSeat: (
    licenseKey: string,
    machineLabel?: string,
  ) => ReturnType<ReturnType<typeof useFirmStore.getState>['activateSeat']>;
  signOut: () => Promise<void>;
}

export function useFirm(): UseFirmResult {
  const store = useFirmStore(
    useShallow((s) => ({
      session: s.session,
      isOffline: s.isOffline,
      isLoading: s.isLoading,
      error: s.error,
      assuredProviders: s.assuredProviders,
      serverVerdict: s.serverVerdict,
      offlineSeatValid: s.offlineSeatValid,
    })),
  );
  const signIn = useFirmStore((s) => s.signIn);
  const signInSso = useFirmStore((s) => s.signInSso);
  const claimOrg = useFirmStore((s) => s.claimOrg);
  const activateSeat = useFirmStore((s) => s.activateSeat);
  const signOut = useFirmStore((s) => s.signOut);
  const hydrate = useFirmStore((s) => s.hydrate);
  const validateSeat = useFirmStore((s) => s.validateSeat);
  const refreshAssuredProviders = useFirmStore((s) => s.refreshAssuredProviders);

  // On mount, re-hydrate keychain secrets for a previously signed-in user and
  // pull the admin's managed-key list (for the assured availability flag).
  useEffect(() => {
    if (useFirmStore.getState().session) {
      void hydrate();
      void refreshAssuredProviders();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Periodic heartbeat for an activated seat.
  useEffect(() => {
    if (!store.session?.activated) return;
    const id = setInterval(() => {
      void validateSeat();
    }, HEARTBEAT_INTERVAL_MS);
    return () => { clearInterval(id); };
  }, [store.session?.activated, validateSeat]);

  const entitlement = selectFirmEntitlement(useFirmStore.getState());

  const doSignOut = useCallback(async () => {
    await signOut();
  }, [signOut]);

  return {
    isSignedIn: selectIsFirmSignedIn(useFirmStore.getState()),
    hasActiveSeat: selectHasActiveFirmSeat(useFirmStore.getState()),
    email: store.session?.email ?? null,
    role: store.session?.role ?? null,
    org: store.session?.org ?? null,
    seatId: store.session?.seatId ?? null,
    entitlement,
    isOffline: store.isOffline,
    isLoading: store.isLoading,
    error: store.error,
    assuredProviders: store.assuredProviders,
    signIn,
    signInSso,
    claimOrg,
    activateSeat,
    signOut: doSignOut,
  };
}

/**
 * Whether the firm has a managed assured key for `provider`. Reactive. Drives
 * the egress indicator's `assuredAvailable` and the assured-mode picker card.
 */
export function useAssuredAvailable(provider: AssuredProvider): boolean {
  return useFirmStore((s) => s.assuredProviders.includes(provider));
}
