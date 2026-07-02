import { beforeEach, describe, expect, it } from 'vitest';
import { migrateLegacyLanternStorageKeys } from './legacyStorageKeyMigration';
import {
  SK_ONBOARDING_COMPLETE,
  SK_PROFESSION,
  SK_DEFAULT_PROVIDER,
  SK_RECENT_WORKSPACES,
  SK_MACHINE_ID,
  SK_LICENSE_TOKEN,
  SK_AI_SETUP_REMINDER_DISMISSED,
  SK_TRIAL_BANNER_DISMISSED_AT,
  SK_APIKEYS_MIGRATED_V1,
  SK_APIKEYS_MIGRATED_V2,
  skKeyVerified,
  skKeyInvalid,
  skModelsCache,
  KC_FALLBACK_PREFIX,
} from '@/config/identity';

const MIGRATION_SENTINEL = 'lantern_storage_keys_migrated_v1';

/** Plain-object snapshot of every key/value pair (spreading a Storage
 * instance directly loses its class prototype, which ESLint flags). */
function snapshotStorage(storage: Storage): Record<string, string> {
  const out: Record<string, string> = {};
  for (let i = 0; i < storage.length; i++) {
    const key = storage.key(i);
    if (key !== null) out[key] = storage.getItem(key) as string;
  }
  return out;
}

describe('migrateLegacyLanternStorageKeys', () => {
  beforeEach(() => {
    localStorage.clear();
    sessionStorage.clear();
  });

  it('does nothing on a fresh install (no legacy keys) and still sets the sentinel', () => {
    migrateLegacyLanternStorageKeys();

    expect(localStorage.getItem(MIGRATION_SENTINEL)).toBe('true');
    expect(localStorage.length).toBe(1); // only the sentinel itself
  });

  it('moves a static key from its legacy name to the new lantern name and deletes the old one', () => {
    localStorage.setItem('keepance_onboarding_complete', 'true');
    localStorage.setItem('keepance_profession', 'advisor');
    localStorage.setItem('keepance_default_provider', 'openai');
    localStorage.setItem('keepance_recent_workspaces', '["/a","/b"]');
    localStorage.setItem('keepance_machine_id', 'machine-123');
    localStorage.setItem('keepance_license_token', 'tok-abc');

    migrateLegacyLanternStorageKeys();

    expect(localStorage.getItem(SK_ONBOARDING_COMPLETE)).toBe('true');
    expect(localStorage.getItem(SK_PROFESSION)).toBe('advisor');
    expect(localStorage.getItem(SK_DEFAULT_PROVIDER)).toBe('openai');
    expect(localStorage.getItem(SK_RECENT_WORKSPACES)).toBe('["/a","/b"]');
    expect(localStorage.getItem(SK_MACHINE_ID)).toBe('machine-123');
    expect(localStorage.getItem(SK_LICENSE_TOKEN)).toBe('tok-abc');

    expect(localStorage.getItem('keepance_onboarding_complete')).toBeNull();
    expect(localStorage.getItem('keepance_profession')).toBeNull();
    expect(localStorage.getItem('keepance_default_provider')).toBeNull();
    expect(localStorage.getItem('keepance_recent_workspaces')).toBeNull();
    expect(localStorage.getItem('keepance_machine_id')).toBeNull();
    expect(localStorage.getItem('keepance_license_token')).toBeNull();
  });

  it('an absent legacy key is a true no-op: no new key is created', () => {
    migrateLegacyLanternStorageKeys();

    expect(localStorage.getItem(SK_ONBOARDING_COMPLETE)).toBeNull();
    expect(localStorage.getItem(SK_LICENSE_TOKEN)).toBeNull();
  });

  it('migrates the key-verified/key-invalid markers for all three providers', () => {
    localStorage.setItem('keepance_key_verified_anthropic', '2026-01-01T00:00:00.000Z');
    localStorage.setItem('keepance_key_invalid_openai', '2026-01-02T00:00:00.000Z');

    migrateLegacyLanternStorageKeys();

    expect(localStorage.getItem(skKeyVerified('anthropic'))).toBe('2026-01-01T00:00:00.000Z');
    expect(localStorage.getItem(skKeyInvalid('openai'))).toBe('2026-01-02T00:00:00.000Z');
    expect(localStorage.getItem('keepance_key_verified_anthropic')).toBeNull();
    expect(localStorage.getItem('keepance_key_invalid_openai')).toBeNull();
    // Untouched providers stay absent on both sides.
    expect(localStorage.getItem(skKeyVerified('google'))).toBeNull();
  });

  it('migrates the per-provider model-list cache', () => {
    localStorage.setItem('keepance_models_openai', '{"models":[]}');

    migrateLegacyLanternStorageKeys();

    expect(localStorage.getItem(skModelsCache('openai'))).toBe('{"models":[]}');
    expect(localStorage.getItem('keepance_models_openai')).toBeNull();
  });

  it('rewrites the unbounded kc_fallback:: family by scanning the legacy prefix', () => {
    localStorage.setItem('keepance_kc_fallback::com.lantern.user.u1::access_token', 'enc-1');
    localStorage.setItem('keepance_kc_fallback::com.lantern.matter.m1::content_key', 'enc-2');

    migrateLegacyLanternStorageKeys();

    expect(localStorage.getItem(`${KC_FALLBACK_PREFIX}com.lantern.user.u1::access_token`)).toBe(
      'enc-1'
    );
    expect(localStorage.getItem(`${KC_FALLBACK_PREFIX}com.lantern.matter.m1::content_key`)).toBe(
      'enc-2'
    );
    expect(
      localStorage.getItem('keepance_kc_fallback::com.lantern.user.u1::access_token')
    ).toBeNull();
    expect(
      localStorage.getItem('keepance_kc_fallback::com.lantern.matter.m1::content_key')
    ).toBeNull();
  });

  it('migrates sessionStorage-backed keys separately from localStorage', () => {
    sessionStorage.setItem('keepance_ai_setup_reminder_dismissed', 'true');
    sessionStorage.setItem('keepance_trial_banner_dismissed_at', '2026-07-01T00:00:00.000Z');

    migrateLegacyLanternStorageKeys();

    expect(sessionStorage.getItem(SK_AI_SETUP_REMINDER_DISMISSED)).toBe('true');
    expect(sessionStorage.getItem(SK_TRIAL_BANNER_DISMISSED_AT)).toBe('2026-07-01T00:00:00.000Z');
    expect(sessionStorage.getItem('keepance_ai_setup_reminder_dismissed')).toBeNull();
    expect(sessionStorage.getItem('keepance_trial_banner_dismissed_at')).toBeNull();
  });

  it('chains correctly with the apikeys migration sentinels: renames them so the apikeys gate reads the new name', () => {
    localStorage.setItem('keepance_apikeys_migrated_v1', 'true');
    localStorage.setItem('keepance_apikeys_migrated_v2', 'true');

    migrateLegacyLanternStorageKeys();

    expect(localStorage.getItem(SK_APIKEYS_MIGRATED_V1)).toBe('true');
    expect(localStorage.getItem(SK_APIKEYS_MIGRATED_V2)).toBe('true');
    expect(localStorage.getItem('keepance_apikeys_migrated_v1')).toBeNull();
    expect(localStorage.getItem('keepance_apikeys_migrated_v2')).toBeNull();
  });

  it('is idempotent: a second run after a clean first run changes nothing', () => {
    localStorage.setItem('keepance_license_token', 'tok-abc');
    migrateLegacyLanternStorageKeys();
    const snapshot = snapshotStorage(localStorage);

    migrateLegacyLanternStorageKeys();

    expect(snapshotStorage(localStorage)).toEqual(snapshot);
    expect(localStorage.getItem(SK_LICENSE_TOKEN)).toBe('tok-abc');
  });

  it('is a no-op once the sentinel is already set, even if a legacy key reappears', () => {
    localStorage.setItem(MIGRATION_SENTINEL, 'true');
    localStorage.setItem('keepance_license_token', 'should-not-move');

    migrateLegacyLanternStorageKeys();

    expect(localStorage.getItem(SK_LICENSE_TOKEN)).toBeNull();
    expect(localStorage.getItem('keepance_license_token')).toBe('should-not-move');
  });

  it('never clobbers a value already written under the new key name, but still cleans up the stale legacy copy', () => {
    localStorage.setItem(SK_MACHINE_ID, 'new-good-value');
    localStorage.setItem('keepance_machine_id', 'stale-legacy-value');

    migrateLegacyLanternStorageKeys();

    expect(localStorage.getItem(SK_MACHINE_ID)).toBe('new-good-value');
    expect(localStorage.getItem('keepance_machine_id')).toBeNull();
  });
});
