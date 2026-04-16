/**
 * Settings Store -- Zustand + persist middleware.
 *
 * Persisted to localStorage under `projelli:settings`.
 * Defaults derive from the schema. `getSetting` returns the stored value or
 * the schema default if not yet set.
 *
 * On first hydration the store runs a one-time migration that pulls values
 * out of the old scattered localStorage keys (theme, tabOverflow, etc.) so
 * the user's existing preferences carry forward.
 */

import { create } from 'zustand';
import { persist } from 'zustand/middleware';
import { SETTINGS_SCHEMA, getSchemaDefaults } from '@/settings/schema';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

interface SettingsState {
  values: Record<string, unknown>;
  /** True once the one-shot legacy migration has run. */
  _migrated: boolean;

  getSetting: <T = unknown>(key: string) => T;
  setSetting: (key: string, value: unknown) => void;
  resetAll: () => void;
  exportSettings: () => string;
  importSettings: (json: string) => boolean;
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

      getSetting: <T = unknown>(key: string): T => {
        const stored = get().values[key];
        if (stored !== undefined) return stored as T;
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
          // Only accept keys that exist in the schema.
          const validKeys = new Set(SETTINGS_SCHEMA.map((d) => d.key));
          const cleaned: Record<string, unknown> = {};
          for (const [k, v] of Object.entries(parsed)) {
            if (validKeys.has(k)) {
              cleaned[k] = v;
            }
          }
          set({ values: cleaned });
          return true;
        } catch {
          return false;
        }
      },
    }),
    {
      name: 'projelli:settings',
      // Only persist `values` and the migration flag.
      partialize: (state) => ({
        values: state.values,
        _migrated: state._migrated,
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

  // tabOverflow -- was at "projelli:tabOverflow"
  try {
    const oldOverflow = localStorage.getItem('projelli:tabOverflow');
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
