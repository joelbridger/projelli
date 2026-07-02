/**
 * legacyStorageKeyMigration.ts
 *
 * One-time first-launch migration: renames every legacy `keepance_*` /
 * `keepance_kc_fallback::*` browser-storage key (the underscore-style flag
 * family — see the "localStorage / sessionStorage flag keys" section of
 * `src/config/identity.ts`) to its `lantern_*` replacement. For each legacy
 * key found: read the old value, write it under the new key, then delete the
 * old key. Never renames-by-reading-only — this moves real user data (license
 * tokens, machine/install ids, onboarding state, firm-collab fallback
 * secrets, ...), not just a code-level alias.
 *
 * Distinct from `migrateLocalStorageApiKeysToKeychain` (KeychainService.ts),
 * which moves a *different* legacy key family (`apiKey_<provider>`) into the
 * keychain backend rather than renaming it. This migration DOES also rename
 * that other migration's own sentinel keys (`keepance_apikeys_migrated_v1/2`
 * -> `SK_APIKEYS_MIGRATED_V1/2`), since those are themselves `keepance_`-
 * prefixed. Call this migration BEFORE `migrateLocalStorageApiKeysToKeychain`
 * runs (see `src/main.tsx`) so the apikeys migration's own gate check reads
 * the already-renamed sentinel and never redundantly re-runs.
 *
 * Idempotent by construction (each per-key step is a no-op once the legacy
 * key is gone), plus a version-marker fast path so a completed migration
 * skips the full scan on every later launch. If any individual key fails to
 * migrate (e.g. a storage quota error), the marker is withheld so the next
 * launch retries just the keys that didn't finish — mirrors the
 * `migrationComplete` gating in the apikeys migration.
 */

import {
  SK_ONBOARDING_COMPLETE,
  SK_PROFESSION,
  SK_ONBOARDING_PROGRESS,
  SK_ONBOARDING_COMPLETED_AT,
  SK_AI_SETUP_DEFERRED,
  SK_AI_SETUP_REMINDER_DISMISSED,
  SK_DEFAULT_PROVIDER,
  SK_DEFAULT_MODEL,
  SK_RECENT_WORKSPACES,
  SK_FIRM_NAME,
  SK_FIRM_KEY_PUBLISH_FP,
  SK_MACHINE_ID,
  SK_LICENSE_TOKEN,
  SK_LICENSE_LAST_GOOD_AT,
  SK_INSTALL_ID,
  SK_DESIGN_PARTNER_CONSENT,
  SK_TELEMETRY_CONSENT,
  SK_TELEMETRY_SENT_EVENTS,
  SK_FIRST_LAUNCH_AT,
  SK_TRIAL_BANNER_DISMISSED_AT,
  SK_APIKEYS_MIGRATED_V1,
  SK_APIKEYS_MIGRATED_V2,
  skKeyVerified,
  skKeyInvalid,
  skModelsCache,
  KC_FALLBACK_PREFIX,
} from '@/config/identity';

/** Fast-path marker so a completed migration skips the scan on later launches. */
const MIGRATION_SENTINEL = 'lantern_storage_keys_migrated_v1';

const LEGACY_NS = 'keepance';
const KC_FALLBACK_LEGACY_PREFIX = `${LEGACY_NS}_kc_fallback::`;

/** Every `keepance_*` -> `lantern_*` static (non-templated) localStorage key. */
const STATIC_LOCAL_RENAMES: ReadonlyArray<readonly [string, string]> = [
  [`${LEGACY_NS}_onboarding_complete`, SK_ONBOARDING_COMPLETE],
  [`${LEGACY_NS}_profession`, SK_PROFESSION],
  [`${LEGACY_NS}_onboarding_progress`, SK_ONBOARDING_PROGRESS],
  [`${LEGACY_NS}_onboarding_completed_at`, SK_ONBOARDING_COMPLETED_AT],
  [`${LEGACY_NS}_ai_setup_deferred`, SK_AI_SETUP_DEFERRED],
  [`${LEGACY_NS}_default_provider`, SK_DEFAULT_PROVIDER],
  [`${LEGACY_NS}_default_model`, SK_DEFAULT_MODEL],
  [`${LEGACY_NS}_recent_workspaces`, SK_RECENT_WORKSPACES],
  [`${LEGACY_NS}_firm_name`, SK_FIRM_NAME],
  [`${LEGACY_NS}_firm_key_publish_fp`, SK_FIRM_KEY_PUBLISH_FP],
  [`${LEGACY_NS}_machine_id`, SK_MACHINE_ID],
  [`${LEGACY_NS}_license_token`, SK_LICENSE_TOKEN],
  [`${LEGACY_NS}_license_last_good_at`, SK_LICENSE_LAST_GOOD_AT],
  [`${LEGACY_NS}_install_id`, SK_INSTALL_ID],
  [`${LEGACY_NS}_design_partner_consent`, SK_DESIGN_PARTNER_CONSENT],
  [`${LEGACY_NS}_telemetry_consent`, SK_TELEMETRY_CONSENT],
  [`${LEGACY_NS}_telemetry_sent_events`, SK_TELEMETRY_SENT_EVENTS],
  [`${LEGACY_NS}_first_launch_at`, SK_FIRST_LAUNCH_AT],
  // Sentinels owned by KeychainService.ts's separate apiKey->keychain migration.
  [`${LEGACY_NS}_apikeys_migrated_v1`, SK_APIKEYS_MIGRATED_V1],
  [`${LEGACY_NS}_apikeys_migrated_v2`, SK_APIKEYS_MIGRATED_V2],
];

/** Every `keepance_*` -> `lantern_*` static sessionStorage key. */
const STATIC_SESSION_RENAMES: ReadonlyArray<readonly [string, string]> = [
  [`${LEGACY_NS}_ai_setup_reminder_dismissed`, SK_AI_SETUP_REMINDER_DISMISSED],
  [`${LEGACY_NS}_trial_banner_dismissed_at`, SK_TRIAL_BANNER_DISMISSED_AT],
];

/** The only providers a key-verification or model-cache write ever uses. */
const VERIFIABLE_PROVIDERS = ['anthropic', 'openai', 'google'] as const;
/** Includes the two read-only, never-written suffixes for exhaustiveness. */
const MODEL_CACHE_PROVIDERS = ['anthropic', 'openai', 'google', 'ollama', 'keepance-local'] as const;

type StorageArea = 'local' | 'session';

function getStorage(area: StorageArea): Storage | null {
  try {
    if (area === 'local') return typeof localStorage === 'undefined' ? null : localStorage;
    return typeof sessionStorage === 'undefined' ? null : sessionStorage;
  } catch {
    return null;
  }
}

/**
 * Migrate a single key. Returns true if the key is now fully migrated (either
 * moved, already-absent, or already-migrated by someone else) and false if a
 * retry is needed on the next launch.
 */
function migrateOne(area: StorageArea, oldKey: string, newKey: string): boolean {
  const storage = getStorage(area);
  if (!storage) return true;

  try {
    const oldValue = storage.getItem(oldKey);
    if (oldValue === null) return true;

    // Never clobber a value already written under the new key (e.g. a fresh
    // write since upgrade, or a prior partial migration run) -- just drop the
    // stale legacy copy, mirroring the apikeys migration's merge behavior.
    if (storage.getItem(newKey) !== null) {
      storage.removeItem(oldKey);
      return true;
    }

    storage.setItem(newKey, oldValue);
    if (storage.getItem(newKey) !== oldValue) return false;
    storage.removeItem(oldKey);
    return true;
  } catch {
    return false;
  }
}

/**
 * The `keepance_kc_fallback::<service>::<key>` family has an unbounded suffix
 * (arbitrary user/matter/device ids), so it can't be enumerated up front --
 * scan for the legacy prefix and rewrite only that prefix, preserving the
 * embedded service/key segments untouched.
 */
function migrateKcFallbackFamily(): boolean {
  const storage = getStorage('local');
  if (!storage) return true;

  let legacyKeys: string[];
  try {
    legacyKeys = Object.keys(storage).filter((k) => k.startsWith(KC_FALLBACK_LEGACY_PREFIX));
  } catch {
    return false;
  }

  let complete = true;
  for (const oldKey of legacyKeys) {
    const suffix = oldKey.slice(KC_FALLBACK_LEGACY_PREFIX.length);
    const newKey = `${KC_FALLBACK_PREFIX}${suffix}`;
    if (!migrateOne('local', oldKey, newKey)) complete = false;
  }
  return complete;
}

/**
 * Run the migration. Safe to call multiple times (idempotent) and safe to
 * call before any storage exists (fresh install: every key is absent, the
 * loop is a fast no-op, and the sentinel is set so later launches skip it
 * immediately).
 */
export function migrateLegacyLanternStorageKeys(): void {
  const local = getStorage('local');
  if (!local) return;
  if (local.getItem(MIGRATION_SENTINEL)) return;

  let complete = true;

  for (const [oldKey, newKey] of STATIC_LOCAL_RENAMES) {
    if (!migrateOne('local', oldKey, newKey)) complete = false;
  }
  for (const provider of VERIFIABLE_PROVIDERS) {
    if (!migrateOne('local', `${LEGACY_NS}_key_verified_${provider}`, skKeyVerified(provider))) {
      complete = false;
    }
    if (!migrateOne('local', `${LEGACY_NS}_key_invalid_${provider}`, skKeyInvalid(provider))) {
      complete = false;
    }
  }
  for (const provider of MODEL_CACHE_PROVIDERS) {
    if (!migrateOne('local', `${LEGACY_NS}_models_${provider}`, skModelsCache(provider))) {
      complete = false;
    }
  }
  if (!migrateKcFallbackFamily()) complete = false;
  for (const [oldKey, newKey] of STATIC_SESSION_RENAMES) {
    if (!migrateOne('session', oldKey, newKey)) complete = false;
  }

  if (complete) {
    try {
      local.setItem(MIGRATION_SENTINEL, 'true');
    } catch {
      // Best-effort: if even the marker write fails, the next launch just
      // retries (harmlessly, since every step above is itself idempotent).
    }
  }
}
