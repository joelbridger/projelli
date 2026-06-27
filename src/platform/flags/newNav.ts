/**
 * newNav feature flag — gates the 3-tab IA redesign (Client Map · Ask ·
 * Workflows + gear menu) while it is built and previewed.
 *
 * DEFAULT OFF. When off, the app renders the unchanged 8-tab shell, so every
 * existing test + the shipped Windows-verified build are 100% untouched. The
 * flag only flips on when explicitly requested:
 *   - URL:           ?newNav=1  (or ?newNav=0 to force off)
 *   - localStorage:  keepance:newNav = "1"
 *
 * Test/SSR-safe: returns false when there is no window and never throws.
 */
import { useState } from 'react';

export const NEW_NAV_FLAG_KEY = 'keepance:newNav';

/**
 * Read the newNav flag. A `?newNav` URL param wins over localStorage so a
 * preview link can force the new (or old) shell regardless of stored state.
 */
export function isNewNavEnabled(): boolean {
  if (typeof window === 'undefined') return false;
  try {
    const q = new URLSearchParams(window.location.search).get('newNav');
    if (q === '1' || q === 'true') return true;
    if (q === '0' || q === 'false') return false;
    return window.localStorage.getItem(NEW_NAV_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

/**
 * React hook form. The flag is fixed for the life of a session (set via URL or
 * stored preference at load), so it is read once on mount and kept stable —
 * flipping it takes a reload, which matches how the shell boots its default
 * surface.
 */
export function useNewNav(): boolean {
  const [on] = useState(isNewNavEnabled);
  return on;
}
