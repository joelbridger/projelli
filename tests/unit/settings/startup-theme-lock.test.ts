/**
 * Theme light-lock — the app must deterministically come up LIGHT on every
 * launch. The theme engine and explicit-choice stamp stay in place for future
 * theme UI work, but they do not allow dark/system in the current light-only
 * app.
 *
 * Background (Legion 3× demo dry-run, Run 2, 2026-07-06): after a restart the
 * persisted theme value was "dark" even though Light had been selected all
 * through Run 1 — a stale/stray value in storage was trusted at boot. Nothing
 * distinguished "the user chose this" from "this value drifted in" (legacy-key
 * import, a lost write resurrecting older state, a stray write). The fix:
 *
 *  1. On EVERY hydration (zustand persist `merge`, not version-gated
 *     `migrate`), a non-light theme value is normalized back to 'light' even
 *     if an old build stamped it as explicitly chosen.
 *  2. Runtime writes and settings imports accept only 'light'; dark/system are
 *     ignored and clear the stamp.
 *  3. The legacy raw localStorage 'theme' key is never imported and is
 *     deleted; the theme manager no longer echoes the preference into it.
 *
 * These tests re-import the store module with pre-seeded localStorage to
 * exercise the real hydration path.
 */
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SK_SETTINGS } from '@/config/identity';

type SettingsModule = typeof import('@/platform/settings/settingsStore');

async function loadStoreWithSeed(seed?: {
  values?: Record<string, unknown>;
  themeExplicitlyChosen?: boolean;
  legacyRawTheme?: string;
}): Promise<SettingsModule> {
  vi.resetModules();
  localStorage.clear();
  if (seed?.legacyRawTheme !== undefined) {
    localStorage.setItem('theme', seed.legacyRawTheme);
  }
  if (seed?.values !== undefined || seed?.themeExplicitlyChosen !== undefined) {
    localStorage.setItem(
      SK_SETTINGS,
      JSON.stringify({
        state: {
          values: seed.values ?? {},
          _migrated: true,
          featuresTourCompleted: false,
          language: null,
          ...(seed.themeExplicitlyChosen !== undefined
            ? { themeExplicitlyChosen: seed.themeExplicitlyChosen }
            : {}),
        },
        version: 1,
      }),
    );
  }
  return import('@/platform/settings/settingsStore');
}

describe('startup theme light-lock', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('a fresh install (no persisted state) resolves light', async () => {
    const mod = await loadStoreWithSeed();
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
  });

  it("a persisted 'dark' WITHOUT the explicit-choice stamp is normalized to light at boot", async () => {
    const mod = await loadStoreWithSeed({ values: { theme: 'dark' } });
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
  });

  it("a persisted 'system' WITHOUT the stamp is normalized to light at boot (OS theme must not decide)", async () => {
    const mod = await loadStoreWithSeed({ values: { theme: 'system' } });
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
  });

  it("a persisted 'system' WITH the old explicit-choice stamp is normalized to light and clears the stamp", async () => {
    const mod = await loadStoreWithSeed({
      values: { theme: 'system' },
      themeExplicitlyChosen: true,
    });
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
    expect(mod.useSettingsStore.getState().values['theme']).toBe('light');
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
  });

  it("a persisted 'dark' WITH the old explicit-choice stamp is normalized to light and clears the stamp", async () => {
    const mod = await loadStoreWithSeed({
      values: { theme: 'dark' },
      themeExplicitlyChosen: true,
    });
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
    expect(mod.useSettingsStore.getState().values['theme']).toBe('light');
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
  });

  it("a persisted 'light' needs no stamp and stays light", async () => {
    const mod = await loadStoreWithSeed({ values: { theme: 'light' } });
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
  });

  it('setSetting("theme", "dark"/"system") is ignored and clears the explicit-choice stamp', async () => {
    const mod = await loadStoreWithSeed();
    mod.useSettingsStore.setState({
      values: { theme: 'light' },
      themeExplicitlyChosen: true,
    });
    mod.useSettingsStore.getState().setSetting('theme', 'dark');
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
    expect(mod.useSettingsStore.getState().values['theme']).toBeUndefined();
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
    const persisted = JSON.parse(localStorage.getItem(SK_SETTINGS) ?? '{}');
    expect(persisted.state.themeExplicitlyChosen).toBe(false);
    expect(persisted.state.values.theme).toBeUndefined();

    mod.useSettingsStore.setState({
      values: { theme: 'light' },
      themeExplicitlyChosen: true,
    });
    mod.useSettingsStore.getState().setSetting('theme', 'system');
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
    expect(mod.useSettingsStore.getState().values['theme']).toBeUndefined();
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
  });

  it('setSetting("theme", "light") is still accepted for future theme UI compatibility', async () => {
    const mod = await loadStoreWithSeed();
    mod.useSettingsStore.getState().setSetting('theme', 'light');
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
    expect(mod.useSettingsStore.getState().values['theme']).toBe('light');
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(true);
  });

  it('setSetting on an unrelated key does NOT stamp the theme as chosen', async () => {
    const mod = await loadStoreWithSeed();
    mod.useSettingsStore.getState().setSetting('startupBehavior', 'selector');
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
  });

  it('importSettings with non-light theme values ignores them and does not stamp', async () => {
    const mod = await loadStoreWithSeed();
    const ok = mod.useSettingsStore.getState().importSettings(JSON.stringify({ theme: 'dark' }));
    expect(ok).toBe(true);
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
    expect(mod.useSettingsStore.getState().values['theme']).toBeUndefined();
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');

    const systemOk = mod.useSettingsStore.getState().importSettings(JSON.stringify({ theme: 'system' }));
    expect(systemOk).toBe(true);
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
    expect(mod.useSettingsStore.getState().values['theme']).toBeUndefined();
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
  });

  it('importSettings with a light theme value is accepted', async () => {
    const mod = await loadStoreWithSeed();
    const ok = mod.useSettingsStore.getState().importSettings(JSON.stringify({ theme: 'light' }));
    expect(ok).toBe(true);
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(true);
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
  });

  it('importSettings without a theme value does not stamp', async () => {
    const mod = await loadStoreWithSeed();
    const ok = mod.useSettingsStore
      .getState()
      .importSettings(JSON.stringify({ startupBehavior: 'selector' }));
    expect(ok).toBe(true);
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
  });

  it('resetAll clears the stamp along with the values', async () => {
    const mod = await loadStoreWithSeed({
      values: { theme: 'dark' },
      themeExplicitlyChosen: true,
    });
    mod.useSettingsStore.getState().resetAll();
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
    expect(mod.useSettingsStore.getState().themeExplicitlyChosen).toBe(false);
  });

  it("the legacy raw localStorage 'theme' key is NEVER imported into the store", async () => {
    // Historically every session echoed the preference into localStorage['theme']
    // ('system' on most old installs), and a one-shot migration imported it
    // whenever the settings blob looked fresh — re-infecting a clean install
    // with an OS-following theme. That import must be gone.
    const mod = await loadStoreWithSeed({ legacyRawTheme: 'dark' });
    expect(mod.useSettingsStore.getState().getSetting<string>('theme')).toBe('light');
    expect(mod.useSettingsStore.getState().values['theme']).toBeUndefined();
  });

  it("the legacy raw 'theme' key is deleted at boot so it can never resurface", async () => {
    await loadStoreWithSeed({ legacyRawTheme: 'system' });
    expect(localStorage.getItem('theme')).toBeNull();
  });

  it('the legacy tabOverflow migration actually runs now (it was dead code — the hydration listener registered after sync hydration already finished)', async () => {
    localStorage.clear();
    localStorage.setItem('lantern:tabOverflow', 'wrap');
    vi.resetModules();
    const mod = await import('@/platform/settings/settingsStore');
    expect(mod.useSettingsStore.getState().getSetting<string>('tabOverflow')).toBe('wrap');
    expect(mod.useSettingsStore.getState()._migrated).toBe(true);
  });
});
