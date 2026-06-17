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

/** The user's stored theme preference — may be 'system' to follow the OS. */
export type ThemePreference = 'light' | 'dark' | 'system';

/** The resolved theme actually applied to the document (never 'system'). */
export type EffectiveTheme = 'light' | 'dark';

export interface ThemeManager {
  /** The user's *preference* (may be 'system'). */
  theme: ThemePreference;
  /** Setter accepting a value or updater fn; persists to settingsStore. */
  setTheme: (valueOrFn: ThemePreference | ((prev: ThemePreference) => ThemePreference)) => void;
  /** Resolved 'light' | 'dark' after applying prefers-color-scheme. */
  effectiveTheme: EffectiveTheme;
}

export function useThemeManager(): ThemeManager {
  // UX-25: Theme state — 3 values: 'light' | 'dark' | 'system'.
  // 'system' follows the OS prefers-color-scheme media query.
  // Now reads from settingsStore as the canonical source. The local
  // `theme` / `setTheme` pair wraps the store so existing callers
  // keep working without refactoring every `setTheme` call.
  const settingsTheme = useSettingsStore((s) => s.getSetting<string>('theme')) as ThemePreference;
  const theme = (settingsTheme === 'light' || settingsTheme === 'dark' || settingsTheme === 'system')
    ? settingsTheme
    : 'system';
  const setTheme = useCallback((valueOrFn: ThemePreference | ((prev: ThemePreference) => ThemePreference)) => {
    const next = typeof valueOrFn === 'function' ? valueOrFn(theme) : valueOrFn;
    useSettingsStore.getState().setSetting('theme', next);
  }, [theme]);

  // Effective theme derived from `theme` + prefers-color-scheme. We listen
  // to the media query so that a user in 'system' mode gets instant sync
  // when they change their OS setting mid-session.
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

  // UX-25: Theme — apply effective theme (light/dark) as class and persist
  // the user's *preference* (which may be 'system'). The effective theme
  // can be different from the preference if the user is in 'system' mode.
  useEffect(() => {
    const htmlElement = document.documentElement;
    if (effectiveTheme === 'dark') {
      htmlElement.classList.add('dark');
    } else {
      htmlElement.classList.remove('dark');
    }
    localStorage.setItem('theme', theme);
  }, [theme, effectiveTheme]);

  return { theme, setTheme, effectiveTheme };
}
