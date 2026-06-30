/**
 * oauthPending — a tiny global counter of in-flight interactive OAuth sign-ins
 * (Microsoft 365, Gmail, OneDrive). Those flows open a browser window and can
 * take a minute or more; while one is pending, onboarding must not let the user
 * click "Continue" and skip past the connect step before the sign-in resolves.
 *
 * The connector components increment on connect start and decrement when it
 * settles (success or failure). OnboardingV2 reads `useOAuthPending()` and
 * disables its Continue button while any sign-in is pending. Used outside
 * onboarding (e.g. Settings) the counter still moves but nothing reads it, so it
 * is harmless there.
 */
import { create } from 'zustand';

interface OAuthPendingState {
  /** Number of OAuth sign-ins currently in flight. */
  count: number;
  begin: () => void;
  end: () => void;
}

export const useOAuthPendingStore = create<OAuthPendingState>((set) => ({
  count: 0,
  begin: () => { set((s) => ({ count: s.count + 1 })); },
  // Never drop below zero even if end() is called more than begin().
  end: () => { set((s) => ({ count: Math.max(0, s.count - 1) })); },
}));

/** Reactive: true while at least one interactive OAuth sign-in is pending. */
export function useOAuthPending(): boolean {
  return useOAuthPendingStore((s) => s.count > 0);
}

/** Non-reactive begin/end for use inside connector connect() handlers. */
export function beginOAuth(): void {
  useOAuthPendingStore.getState().begin();
}
export function endOAuth(): void {
  useOAuthPendingStore.getState().end();
}
