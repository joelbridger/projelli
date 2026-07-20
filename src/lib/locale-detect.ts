/**
 * Detects the user's preferred locale at first launch.
 *
 * Uses `navigator.language` on every target. The desktop (Tauri) build has NO
 * `@tauri-apps/plugin-os` Rust plugin registered and no `os:` capability grant,
 * so the previous `@tauri-apps/plugin-os::locale()` call could never succeed in
 * a shipped app — it was rejected by the ACL and silently fell through to this
 * same `navigator.language` path (c34 capability-surface narrowing). The dead
 * import has been removed rather than papered over; WebView2/WKWebView expose a
 * correct `navigator.language`, so desktop locale detection is unaffected.
 */

const SUPPORTED = ['en', 'es', 'de'] as const;
export type SupportedLocale = (typeof SUPPORTED)[number];

function normalize(raw: string | null | undefined): SupportedLocale {
  if (!raw) return 'en';
  const lang = raw.split('-')[0]?.toLowerCase() ?? '';
  return (SUPPORTED as readonly string[]).includes(lang)
    ? (lang as SupportedLocale)
    : 'en';
}

// Returns a Promise (not `async`) so callers keep awaiting it unchanged, while
// the body stays synchronous now that the removed Tauri-OS branch was the only
// awaited call.
export function detectLocale(): Promise<SupportedLocale> {
  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      return Promise.resolve(normalize(navigator.language));
    }
  } catch {
    // Defensive: some environments (Node test runners without jsdom) may
    // throw when accessing navigator. Fall through to default.
  }

  return Promise.resolve('en');
}
