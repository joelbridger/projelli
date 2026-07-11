import type { Store } from "./db.ts";

/** How often the relay removes expired legacy-ID bridge rows while it is running. */
export const LEGACY_MANIFEST_GC_INTERVAL_MS = 60_000;

/**
 * Remove expired migration bridge rows now, then keep doing so while the relay
 * runs. The immediate sweep makes the migration deadline hold even when no
 * desktop ever calls a migration endpoint after expiry.
 */
export function startLegacyManifestGc(
  store: Store,
  intervalMs = LEGACY_MANIFEST_GC_INTERVAL_MS,
): ReturnType<typeof setInterval> {
  store.purgeExpiredLegacyManifest();
  const timer = setInterval(() => store.purgeExpiredLegacyManifest(), intervalMs);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
