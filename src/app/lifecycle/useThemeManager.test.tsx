/**
 * useThemeManager — theme light-lock regression tests.
 *
 * The hook used to echo the current preference into the legacy raw
 * localStorage key 'theme' on every render commit. That key was the food for
 * a legacy-import path that could resurrect a stale ('system'/'dark') theme
 * on a later boot (Legion dry-run Run 2, 2026-07-06). The echo must be gone.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';
import { useThemeManager } from '@/app/lifecycle/useThemeManager';
import { useSettingsStore } from '@/platform/settings/settingsStore';

describe('useThemeManager light-lock', () => {
  beforeEach(() => {
    localStorage.removeItem('theme');
    useSettingsStore.getState().resetAll();
    document.documentElement.classList.remove('dark');
  });

  it("never writes the legacy raw localStorage 'theme' key", () => {
    const { result } = renderHook(() => useThemeManager());
    expect(localStorage.getItem('theme')).toBeNull();
    act(() => {
      result.current.setTheme('dark');
    });
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('defaults to light and applies no dark class without an explicit choice', () => {
    const { result } = renderHook(() => useThemeManager());
    expect(result.current.theme).toBe('light');
    expect(result.current.effectiveTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
  });

  it('setTheme("dark") stays light in the current light-only app', () => {
    const { result } = renderHook(() => useThemeManager());
    act(() => {
      result.current.setTheme('dark');
    });
    expect(result.current.theme).toBe('light');
    expect(result.current.effectiveTheme).toBe('light');
    expect(document.documentElement.classList.contains('dark')).toBe(false);
    expect(useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
  });
});
