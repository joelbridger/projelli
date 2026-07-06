/**
 * Settings Store -- Zustand + persist middleware.
 *
 * Persisted to localStorage under `lantern:settings`.
 * Defaults derive from the schema. `getSetting` returns the stored value or
 * the schema default if not yet set.
 *
 * On first hydration the store runs a one-time migration that pulls values
 * out of the old scattered localStorage keys (theme, tabOverflow, etc.) so
 * the user's existing preferences carry forward.
 */

import { useEffect, useState } from 'react';
import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SETTINGS_SCHEMA, getSchemaDefaults, type SettingDefinition } from '@/platform/settings/schema';
import {
  TEMPLATE_MODEL_OVERRIDES_KEY,
  sanitizeTemplateModelOverrides,
} from '@/platform/settings/templateModelOverrides';
import { CONFIDENTIALITY_MODE_SETTING_KEY } from '@/platform/privacy/egress';
import { SK_SETTINGS, SK_TAB_OVERFLOW } from '@/config/identity';

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
  // If this value is stale or corrupt, Advisor Prep Hero must fail closed: local model
  // only, so confidential legal data does not silently route to a cloud model.
  [CONFIDENTIALITY_MODE_SETTING_KEY]: 'local-only',
};

type SanitizedSettingValue =
  | { valid: true; value: unknown }
  | { valid: false };

function sanitizeSettingValue(key: string, value: unknown): SanitizedSettingValue {
  if (key === TEMPLATE_MODEL_OVERRIDES_KEY) {
    const sanitized = sanitizeTemplateModelOverrides(value);
    return sanitized ? { valid: true, value: sanitized } : { valid: false };
  }
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
      themeExplicitlyChosen: false,
    };
  }
  const state = persisted as Partial<SettingsState>;
  return {
    _migrated: state._migrated ?? false,
    featuresTourCompleted: state.featuresTourCompleted ?? false,
    language: state.language ?? null,
    themeExplicitlyChosen: state.themeExplicitlyChosen === true,
    values: sanitizePersistedValues(state.values),
  };
}

/**
 * Theme light-lock: a persisted non-light theme is only honored when the
 * explicit-choice stamp proves a user set it. Anything else — however it got
 * into storage — resolves to 'light'. Runs on EVERY hydration (via the
 * persist `merge` hook, which unlike `migrate` is not gated on a version
 * bump), so the guarantee holds even against state written by older builds
 * or resurrected by a lost/partial storage flush.
 */
function enforceStartupThemePolicy(state: PersistedSettingsState): PersistedSettingsState {
  const theme = state.values['theme'];
  if (theme === undefined || theme === 'light' || state.themeExplicitlyChosen) {
    return state;
  }
  return { ...state, values: { ...state.values, theme: 'light' } };
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
  /** Theme light-lock: true only once a REAL runtime write set the theme
   *  (Settings dropdown / toolbar toggle / settings import). A theme value
   *  that reaches storage any other way (stale state resurrected by a lost
   *  write, a stray/legacy import) has no stamp and is normalized back to
   *  'light' on the next hydration — the app must never come up dark
   *  unprompted (Legion demo dry-run Run 2, 2026-07-06). */
  themeExplicitlyChosen: boolean;
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

  /** See PersistedSettingsState.themeExplicitlyChosen. */
  themeExplicitlyChosen: boolean;

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
      themeExplicitlyChosen: false,

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
          // Theme light-lock: every runtime write to 'theme' comes from a
          // user-facing control (Settings dropdown, toolbar toggle), so it
          // stamps the choice as explicit. Values that arrive any other way
          // stay unstamped and are normalized to 'light' at next boot.
          ...(key === 'theme' && (value === 'light' || value === 'dark' || value === 'system')
            ? { themeExplicitlyChosen: true }
            : {}),
        }));
      },

      resetAll: () => {
        set({ values: {}, themeExplicitlyChosen: false });
      },

      exportSettings: () => {
        // Merge stored values over defaults so the export is a full snapshot.
        const merged: Record<string, unknown> = {};
        for (const def of SETTINGS_SCHEMA) {
          const stored = get().values[def.key];
          merged[def.key] = stored !== undefined ? stored : def.defaultValue;
        }
        const templateModelOverrides = sanitizeTemplateModelOverrides(
          get().values[TEMPLATE_MODEL_OVERRIDES_KEY],
        );
        if (templateModelOverrides) {
          merged[TEMPLATE_MODEL_OVERRIDES_KEY] = templateModelOverrides;
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
          set({
            values: { ...get().values, ...cleaned },
            // A settings-file import is a deliberate user action; a theme it
            // carries counts as an explicit choice.
            ...(cleaned['theme'] !== undefined ? { themeExplicitlyChosen: true } : {}),
          });
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: SK_SETTINGS,
      version: SETTINGS_PERSIST_VERSION,
      migrate: (persisted) => migratePersistedSettings(persisted),
      // `migrate` only runs on a version bump; `merge` runs on EVERY
      // hydration. Sanitization (BUG-026) and the theme light-lock must hold
      // against same-version blobs too, so both run here.
      merge: (persisted, current) => ({
        ...current,
        ...enforceStartupThemePolicy(migratePersistedSettings(persisted)),
      }),
      // Only persist `values` and the migration flag.
      partialize: (state) => ({
        values: state.values,
        _migrated: state._migrated,
        featuresTourCompleted: state.featuresTourCompleted,
        language: state.language,
        themeExplicitlyChosen: state.themeExplicitlyChosen,
        // featuresTourSkippedThisSession is intentionally session-only
      }),
    }
  )
);

// ---------------------------------------------------------------------------
// Legacy migration (one-shot, runs after hydration)
// ---------------------------------------------------------------------------

function migrateLegacySettings(): void {
  // Theme light-lock: the legacy raw "theme" key is deliberately NOT
  // migrated, and is deleted outright. Every old session echoed its current
  // preference into that key ('system' on most historical installs), so its
  // value can never prove an explicit user choice — importing it is exactly
  // how a clean install could come up dark/OS-following unprompted. Users who
  // genuinely want dark re-pick it once in Settings, which stamps the choice.
  try {
    localStorage.removeItem('theme');
  } catch { /* noop */ }

  const state = useSettingsStore.getState();
  if (state._migrated) return;

  const updates: Record<string, unknown> = {};

  // tabOverflow -- was at "lantern:tabOverflow"
  try {
    const oldOverflow = localStorage.getItem(SK_TAB_OVERFLOW);
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

// Run migration after the persist middleware has rehydrated. With the
// synchronous localStorage backend, hydration completes DURING create() —
// before this module-level code runs — so an onFinishHydration subscription
// alone never fires (proven live 2026-07-06: a long-lived install still had
// `_migrated: false` persisted). Run immediately when already hydrated;
// subscribe only for the async-storage case.
if (useSettingsStore.persist.hasHydrated()) {
  migrateLegacySettings();
} else {
  const unsub = useSettingsStore.persist.onFinishHydration(() => {
    migrateLegacySettings();
    unsub();
  });
}

/**
 * Reactive "has the persisted settings blob finished loading" flag. Reading
 * `useSettingsStore.getState().getSetting(...)` before hydration silently
 * returns the schema default even when a different value is on disk — fine
 * for most UI, but callers that make a one-time boot decision from a setting
 * (e.g. auto-resuming the last workspace) need to know when it's safe to
 * trust the value. `persist.hasHydrated()` is imperative-only; this wraps it
 * in a hook so components can wait for hydration before deciding.
 */
export function useSettingsHydrated(): boolean {
  const [hydrated, setHydrated] = useState(() => useSettingsStore.persist.hasHydrated());
  useEffect(() => {
    if (hydrated) return undefined;
    return useSettingsStore.persist.onFinishHydration(() => { setHydrated(true); });
  }, [hydrated]);
  return hydrated;
}
