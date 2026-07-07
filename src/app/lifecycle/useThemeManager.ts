/**
 * useThemeManager — owns the full theme subsystem: reading the user's
 * preference from settingsStore, tracking the OS prefers-color-scheme media
 * query, deriving the effective resolved theme, and applying it to the
 * document root.
 *
 * Extracted from App.tsx (Phase 3 decomposition). Every variable name, every
 * initial value, and every effect body is byte-for-byte identical to the
 * original code so that wiring-in via destructuring is a pure refactor with
 * no behavior change.
 */
import { useState, useEffect, useCallback } from 'react';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { isTauriEnvironment } from '@/platform/fs/BackendFactory';

/** Legacy/future theme preference shape. The current app accepts only light. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** The resolved theme actually applied to the document (never 'system'). */
export type EffectiveTheme = 'light' | 'dark';

export interface ThemeManager {
  /** The current preference. In the light-only app this resolves to 'light'. */
  theme: ThemePreference;
  /** Setter kept for compatibility; settingsStore ignores non-light values. */
  setTheme: (valueOrFn: ThemePreference | ((prev: ThemePreference) => ThemePreference)) => void;
  /** Resolved 'light' | 'dark' after applying prefers-color-scheme. */
  effectiveTheme: EffectiveTheme;
}

export function useThemeManager(): ThemeManager {
  // The hidden theme engine stays wired for future UI work, but the current
  // product is light-only. settingsStore is the gatekeeper: dark/system values
  // are ignored or normalized before they can affect the page.
  const settingsTheme = useSettingsStore((s) => s.getSetting<string>('theme')) as ThemePreference;
  const theme = (settingsTheme === 'light' || settingsTheme === 'dark' || settingsTheme === 'system')
    ? settingsTheme
    : 'light';
  const setTheme = useCallback((valueOrFn: ThemePreference | ((prev: ThemePreference) => ThemePreference)) => {
    const next = typeof valueOrFn === 'function' ? valueOrFn(theme) : valueOrFn;
    useSettingsStore.getState().setSetting('theme', next);
  }, [theme]);

  // Kept for future system-theme support; today settingsStore prevents
  // 'system' from being saved.
  const [systemPrefersDark, setSystemPrefersDark] = useState<boolean>(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false;
    return window.matchMedia('(prefers-color-scheme: dark)').matches;
  });
  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return;
    const mql = window.matchMedia('(prefers-color-scheme: dark)');
    const onChange = (e: MediaQueryListEvent) => setSystemPrefersDark(e.matches);
    // Safari < 14 uses addListener; modern browsers use addEventListener.
    if (mql.addEventListener) {
      mql.addEventListener('change', onChange);
      return () => mql.removeEventListener('change', onChange);
    } else {
      mql.addListener(onChange);
      return () => mql.removeListener(onChange);
    }
  }, []);

  const effectiveTheme: EffectiveTheme = theme === 'system'
    ? (systemPrefersDark ? 'dark' : 'light')
    : theme;

  // UX-25: Theme — apply effective theme (light/dark) as class. The
  // preference itself lives ONLY in settingsStore; the old echo into the raw
  // localStorage 'theme' key is gone — that key fed a legacy import that
  // could resurrect a stale OS-following theme on a later boot.
  useEffect(() => {
    const htmlElement = document.documentElement;
    if (effectiveTheme === 'dark') {
      htmlElement.classList.add('dark');
    } else {
      htmlElement.classList.remove('dark');
    }
  }, [effectiveTheme]);

  // Desktop: keep the native window chrome (titlebar) on the same theme as
  // the app. tauri.conf.json pins the window to light at launch.
  useEffect(() => {
    if (!isTauriEnvironment()) return;
    let cancelled = false;
    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        if (cancelled) return;
        return getCurrentWindow().setTheme(effectiveTheme);
      })
      .catch(() => { /* best-effort; the in-app theme is already applied */ });
    return () => { cancelled = true; };
  }, [effectiveTheme]);

  return { theme, setTheme, effectiveTheme };
}
