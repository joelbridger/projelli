/**
 * Shared Chromium-process recipe for browser tests and local UI rehearsal.
 *
 * On Linux, a locked GNOME keyring can stall Chromium while it initializes
 * cookie encryption, including before a plain HTTP navigation starts.
 * `--password-store=basic` keeps disposable test browsers independent of that
 * host service. macOS and Windows use their native key stores, so they do not
 * receive the Linux-only flag.
 *
 * Playwright's normal `browserType.launch` creates a temporary user-data
 * directory for each browser process, and Playwright Test creates a fresh
 * browser context for every test. Do not replace this with
 * `launchPersistentContext` or a shared user-data directory: disposable
 * profiles are part of the isolation and of this keyring cure.
 */
export function withBrowserLaunchOptions(options = {}) {
  if (process.platform !== 'linux') return { ...options };

  return {
    ...options,
    args: [...(options.args ?? []), '--password-store=basic'],
  };
}
