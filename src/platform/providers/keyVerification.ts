/**
 * keyVerification.ts
 *
 * A tiny, persistent record of how each provider key fared against a LIVE check
 * (a real one-token call), as opposed to merely being present. Two states are
 * tracked, mutually exclusive per provider:
 *   - VERIFIED: the stored key passed a live check.
 *   - INVALID:  the stored key was rejected by a live check (bad / expired).
 * A provider with neither marker is "unknown" (present but never checked, or
 * saved while offline).
 *
 * Why this exists: the app's in-memory `APIKey.isValid` flag means "a key is
 * stored for this provider", NOT "the key works". So a present-but-expired key
 * (e.g. a stale Anthropic key) looked just as good as a freshly verified one,
 * and a brand-new chat could default to the dead provider and fail on the first
 * message. This module lets the new-chat resolver PREFER a verified provider and
 * EXCLUDE a known-invalid one.
 *
 * It is deliberately separate from key STORAGE (KeychainService): it never holds
 * a key, only per-provider status markers in localStorage. The two places that
 * do a real live check write here:
 *   - ApiKeyWizard's validate-on-save (only AFTER the key is actually saved)
 *   - ApiKeyManager's "Check" button (which checks the already-stored key)
 * and removal clears the status entirely.
 */

import { skKeyInvalid, skKeyVerified } from '@/config/identity';

/** The three cloud providers that have a verifiable key. */
export type VerifiableProvider = 'anthropic' | 'openai' | 'google';

const VERIFIED_PROVIDERS: VerifiableProvider[] = ['anthropic', 'openai', 'google'];

/** localStorage keys for a provider's status markers. */
function verifiedKey(provider: string): string {
  return skKeyVerified(provider);
}
function invalidKey(provider: string): string {
  return skKeyInvalid(provider);
}

/** Record that this provider's stored key passed a live check just now. */
export function markKeyVerified(provider: VerifiableProvider): void {
  try {
    if (typeof localStorage === 'undefined') return;
    // The value is informational; presence of the marker is what matters.
    localStorage.setItem(verifiedKey(provider), new Date().toISOString());
    localStorage.removeItem(invalidKey(provider));
  } catch {
    // Best-effort: a storage failure must never break the save/check flow.
  }
}

/** Record that this provider's stored key was rejected by a live check. */
export function markKeyInvalid(provider: VerifiableProvider): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.setItem(invalidKey(provider), new Date().toISOString());
    localStorage.removeItem(verifiedKey(provider));
  } catch {
    // Best-effort.
  }
}

/** Forget both status markers for this provider (e.g. the key was removed). */
export function clearKeyStatus(provider: VerifiableProvider): void {
  try {
    if (typeof localStorage === 'undefined') return;
    localStorage.removeItem(verifiedKey(provider));
    localStorage.removeItem(invalidKey(provider));
  } catch {
    // Best-effort.
  }
}

/** True when this provider's key has been verified and not since invalidated. */
export function isKeyVerified(provider: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(verifiedKey(provider)) !== null;
  } catch {
    return false;
  }
}

/** True when this provider's key was rejected by a live check. */
export function isKeyInvalid(provider: string): boolean {
  try {
    if (typeof localStorage === 'undefined') return false;
    return localStorage.getItem(invalidKey(provider)) !== null;
  } catch {
    return false;
  }
}

/** The set of providers with a verified marker right now. */
export function getVerifiedProviders(): Set<string> {
  const out = new Set<string>();
  for (const p of VERIFIED_PROVIDERS) {
    if (isKeyVerified(p)) out.add(p);
  }
  return out;
}

/** The set of providers known to be invalid right now. */
export function getInvalidProviders(): Set<string> {
  const out = new Set<string>();
  for (const p of VERIFIED_PROVIDERS) {
    if (isKeyInvalid(p)) out.add(p);
  }
  return out;
}
