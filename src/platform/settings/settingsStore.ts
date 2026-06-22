/**
 * Settings Store -- Zustand + persist middleware.
 *
 * Persisted to localStorage under `keepance:settings`.
 * Defaults derive from the schema. `getSetting` returns the stored value or
 * the schema default if not yet set.
 *
 * On first hydration the store runs a one-time migration that pulls values
 * out of the old scattered localStorage keys (theme, tabOverflow, etc.) so
 * the user's existing preferences carry forward.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SETTINGS_SCHEMA, getSchemaDefaults, type SettingDefinition } from '@/platform/settings/schema';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';

/**
 * BUG-026: validate an imported value against its schema definition, so a
 * settings import can't inject a wrong-typed / out-of-range / unknown-option
 * value (e.g. `fontSize: "huge"`). Returns false for `shortcut-display`
 * (read-only) and for anything that doesn't match the def's type/options/range.
 */
function isValidSettingValue(def: SettingDefinition, value: unknown): boolean {
  switch (def.type) {
    case 'toggle':
      return typeof value === 'boolean';
    case 'number':
      return (
        typeof value === 'number' &&
        Number.isFinite(value) &&
        (def.min === undefined || value >= def.min) &&
        (def.max === undefined || value <= def.max)
      );
    case 'select':
      return typeof value === 'string' && (def.options ?? []).some((o) => o.value === value);
    case 'text':
      return typeof value === 'string';
    case 'shortcut-display':
      return false; // display-only; never importable
    default:
      return false;
  }
}

const SETTINGS_PERSIST_VERSION = 1;
const defByKey = new Map(SETTINGS_SCHEMA.map((d) => [d.key, d]));

const PRIVACY_CRITICAL_SAFE_DEFAULTS: Record<string, unknown> = {
  // If this value is stale or corrupt, Keepance must fail closed: local model
  // only, so confidential legal data does not silently route to a cloud model.
  [CONFIDENTIALITY_MODE_SETTING_KEY]: 'local-only',
};

type SanitizedSettingValue =
  | { valid: true; value: unknown }
  | { valid: false };

function sanitizeSettingValue(key: string, value: unknown): SanitizedSettingValue {
  const def = defByKey.get(key);
  if (!def) return { valid: false };
  if (isValidSettingValue(def, value)) return { valid: true, value };
  if (Object.prototype.hasOwnProperty.call(PRIVACY_CRITICAL_SAFE_DEFAULTS, key)) {
    return { valid: true, value: PRIVACY_CRITICAL_SAFE_DEFAULTS[key] };
  }
  return { valid: false };
}

function sanitizePersistedValues(values: unknown): Record<string, unknown> {
  if (typeof values !== 'object' || values === null || Array.isArray(values)) {
    return {};
  }
  const cleaned: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    const sanitized = sanitizeSettingValue(key, value);
    if (sanitized.valid) {
      cleaned[key] = sanitized.value;
    }
  }
  return cleaned;
}

function migratePersistedSettings(persisted: unknown): PersistedSettingsState {
  if (typeof persisted !== 'object' || persisted === null || Array.isArray(persisted)) {
    return {
      values: {},
      _migrated: false,
      featuresTourCompleted: false,
      language: null,
    };
  }
  const state = persisted as Partial<SettingsState>;
  return {
    _migrated: state._migrated ?? false,
    featuresTourCompleted: state.featuresTourCompleted ?? false,
    language: state.language ?? null,
    values: sanitizePersistedValues(state.values),
  };
}

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** User-overridable locale. null = use OS-detected locale at bootstrap. */
type Language = 'en' | 'es' | 'de' | null;

interface PersistedSettingsState {
  values: Record<string, unknown>;
  _migrated: boolean;
  featuresTourCompleted: boolean;
  language: Language;
}

interface SettingsState {
  values: Record<string, unknown>;
  /** True once the one-shot legacy migration has run. */
  _migrated: boolean;

  // v1.6: feature tour flags
  featuresTourCompleted: boolean;
  featuresTourSkippedThisSession: boolean;

  // v2.0: explicit language override (null = follow OS locale)
  language: Language;

  getSetting: <T = unknown>(key: string) => T;
  setSetting: (key: string, value: unknown) => void;
  resetAll: () => void;
  exportSettings: () => string;
  importSettings: (json: string) => boolean;

  // v1.6: feature tour actions
  markFeatureTourCompleted: () => void;
  skipFeatureTourThisSession: () => void;
  resetFeatureTour: () => void;

  // v2.0: language action
  setLanguage: (lang: Language) => void;
}

// ---------------------------------------------------------------------------
// Defaults
// ---------------------------------------------------------------------------

const DEFAULTS = getSchemaDefaults();

// ---------------------------------------------------------------------------
// Store
// ---------------------------------------------------------------------------

export const useSettingsStore = create<SettingsState>()(
  persist(
    (set, get) => ({
      values: {},
      _migrated: false,
      featuresTourCompleted: false,
      featuresTourSkippedThisSession: false,
      language: null,

      markFeatureTourCompleted: () => set({ featuresTourCompleted: true }),
      skipFeatureTourThisSession: () => set({ featuresTourSkippedThisSession: true }),
      resetFeatureTour: () =>
        set({ featuresTourCompleted: false, featuresTourSkippedThisSession: false }),

      setLanguage: (lang) => set({ language: lang }),

      getSetting: <T = unknown>(key: string): T => {
        const stored = get().values[key];
        if (stored !== undefined) {
          const sanitized = sanitizeSettingValue(key, stored);
          if (sanitized.valid) return sanitized.value as T;
        }
        return (DEFAULTS[key] ?? undefined) as T;
      },

      setSetting: (key, value) => {
        set((state) => ({
          values: { ...state.values, [key]: value },
        }));
      },

      resetAll: () => {
        set({ values: {} });
      },

      exportSettings: () => {
        // Merge stored values over defaults so the export is a full snapshot.
        const merged: Record<string, unknown> = {};
        for (const def of SETTINGS_SCHEMA) {
          const stored = get().values[def.key];
          merged[def.key] = stored !== undefined ? stored : def.defaultValue;
        }
        return JSON.stringify(merged, null, 2);
      },

      importSettings: (json: string): boolean => {
        try {
          const parsed = JSON.parse(json) as Record<string, unknown>;
          if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
            return false;
          }
          // BUG-026: validate each value against the schema (type + options +
          // range), not just the key name — a wrong-typed value (e.g. fontSize:
          // "huge") must not be accepted. And MERGE into the current values
          // rather than REPLACING them, so a partial import can't silently reset
          // settings (incl. privacy/workspace choices) that aren't in the file.
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(parsed)) {
            const sanitized = sanitizeSettingValue(k, v);
            if (sanitized.valid) {
              cleaned[k] = sanitized.value;
            }
          }
          set({ values: { ...get().values, ...cleaned } });
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'keepance:settings',
      version: SETTINGS_PERSIST_VERSION,
      migrate: (persisted) => migratePersistedSettings(persisted),
      // Only persist `values` and the migration flag.
      partialize: (state) => ({
        values: state.values,
        _migrated: state._migrated,
        featuresTourCompleted: state.featuresTourCompleted,
        language: state.language,
        // featuresTourSkippedThisSession is intentionally session-only
      }),
    }
  )
);

// ---------------------------------------------------------------------------
// Legacy migration (one-shot, runs after hydration)
// ---------------------------------------------------------------------------

function migrateLegacySettings(): void {
  const state = useSettingsStore.getState();
  if (state._migrated) return;

  const updates: Record<string, unknown> = {};

  // theme -- was stored at localStorage key "theme"
  try {
    const oldTheme = localStorage.getItem('theme');
    if (oldTheme && (oldTheme === 'light' || oldTheme === 'dark' || oldTheme === 'system')) {
      if (state.values['theme'] === undefined) {
        updates['theme'] = oldTheme;
      }
    }
  } catch { /* noop */ }

  // tabOverflow -- was at "keepance:tabOverflow"
  try {
    const oldOverflow = localStorage.getItem('keepance:tabOverflow');
    if (oldOverflow && (oldOverflow === 'scroll' || oldOverflow === 'wrap')) {
      if (state.values['tabOverflow'] === undefined) {
        updates['tabOverflow'] = oldOverflow;
      }
    }
  } catch { /* noop */ }

  if (Object.keys(updates).length > 0) {
    useSettingsStore.setState((prev) => ({
      values: { ...prev.values, ...updates },
      _migrated: true,
    }));
  } else {
    useSettingsStore.setState({ _migrated: true });
  }
}

// Run migration after the persist middleware has rehydrated.
// Zustand persist fires the `onRehydrateStorage` listener on the `persist` API,
// but the simpler approach is to subscribe and run once:
const unsub = useSettingsStore.persist.onFinishHydration(() => {
  migrateLegacySettings();
  unsub();
});
