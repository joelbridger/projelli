/**
 * Detects the user's preferred locale at first launch.
 *
 * Desktop (Tauri): uses `@tauri-apps/plugin-os::locale()`.
 * Web demo: falls back to `navigator.language` so users hitting the hosted
 * preview still get a sensible default (per spec §8.6 web demo specifics).
 *
 * The Tauri plugin import is loaded dynamically so a missing plugin (i.e.
 * the web build) doesn't blow up at module-evaluation time.
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

export async function detectLocale(): Promise<SupportedLocale> {
  // Try Tauri OS plugin first (desktop builds).
  try {
    const mod = await import('@tauri-apps/plugin-os');
    const raw = await mod.locale();
    return normalize(raw);
  } catch {
    // Either the plugin isn't installed (web build) or the call failed.
    // Fall through to navigator.language.
  }

  try {
    if (typeof navigator !== 'undefined' && navigator.language) {
      return normalize(navigator.language);
    }
  } catch {
    // Defensive: some environments (Node test runners without jsdom) may
    // throw when accessing navigator. Fall through to default.
  }

  return 'en';
}
