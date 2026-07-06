/**
 * UI Iteration System — pure tier-classification logic (unit-tested).
 *
 * Extracted from classify-tier.mjs so the rules can be tested directly
 * (tests/unit/ui-system/classify.test.ts) — including the round-2 review's
 * misclassifying diffs. No git / fs here; callers feed in changed lines.
 */

// Behaviour-adjacent CSS: touching any of these escalates a CSS change to S
// (P-risky). Only pure token value swaps stay P-safe.
export const RISKY_CSS = [
  /\b(display|position|overflow(?:-[xy])?|pointer-events|z-index|opacity|visibility|animation|transition|transform|inset|top|right|bottom|left|width|height|max-width|min-width|max-height|min-height|flex|grid|float|clip|clip-path|content)\s*:/i,
  /:(hover|focus|focus-visible|active|disabled|checked|invalid)\b/i,
  /\[(?:aria-disabled|disabled|hidden|aria-hidden)\b/i,
  /@media\b/i,
  /@keyframes\b/i,
  /^[.#][\w-]+.*\{/,
  /^\s*(button|input|select|textarea|a|dialog|\*)\b[^:{]*\{/i,
];

// A changed CSS line is "P-safe" only if it's blank, a comment, a brace, or a
// custom-property / plain colour / font value declaration.
export const SAFE_CSS_LINE =
  /^\s*(\/\*.*|\*.*|\}|\{|@import\b.*|@source\b.*|--[\w-]+\s*:\s*[^;]+;?|(color|background|background-color|font-family|font-weight|border-color|fill|stroke|caret-color|accent-color)\s*:\s*[^;]+;?)?\s*$/i;

// Behaviour signals in changed lines of a UI code file → Tier B.
// Round-2 review: a bare handler REBIND (`onClick={connect}`→`onClick={disconnect}`),
// a disabled-state change, an href / form-action / submit-type / aria-disabled
// change all change what the app DOES, so they must escalate to B — not only
// inline-arrow handlers. So we match ANY on<Event>= binding and these attrs.
export const BEHAVIOUR_CODE = [
  /\buse(State|Effect|Ref|Reducer|Memo|Callback|LayoutEffect|Context|Store|[A-Z]\w*Store)\s*\(/, // hooks incl store hooks
  /\b(await|fetch\s*\(|\.then\s*\(|async\b)/, // async / IO
  /\binvoke\s*\(/, // Tauri command
  /\.(setState|getState|subscribe)\s*\(/, // store mutation
  /\b(localStorage|sessionStorage|indexedDB|navigator\.storage)\b/, // storage
  /\b(addEventListener|removeEventListener|dispatchEvent)\s*\(/, // events
  /\b(setTimeout|setInterval|requestAnimationFrame)\s*\(/, // timers
  /\bon[A-Z]\w*\s*=\s*[{"']/, // ANY event-handler binding (rebind = behaviour)
  /\b(disabled|aria-disabled|aria-checked|aria-selected|aria-expanded)\s*=/, // interactive state
  /\bhref\s*=/, // navigation target
  /\baction\s*=/, // form action
  /\btype\s*=\s*['"{]?\s*(submit|reset|button)\b/i, // button type — incl. type="button" (removing it inside a form defaults to submit = behaviour change)
  /\bimport\b[^;]*from\s*['"]@\/platform\//, // reaching into the behaviour layer
  /\b(provider|model)\b\s*[:=]/i, // provider/model selection
];

/** Which coarse bucket a path falls in (before content scanning). */
export function pathBucket(f) {
  // Test-only files are not a UI change — their own tier, they never gate the UI
  // (field-test addendum). gate-tier still auto-RUNS them for the changed code.
  if (/\.(test|spec)\.(tsx?|mjs)$/.test(f)) return 'TEST';
  // Connectors live under platform/ but a pure copy/tooltip/header hunk in one is
  // NOT behaviour — content-scan them (field-test addendum) instead of forcing B
  // by folder. Checked BEFORE the platform→B rule below.
  if (/^src\/platform\/connectors\//.test(f) && /\.tsx?$/.test(f)) return 'CONNECTOR';
  if (
    f.startsWith('src-tauri/') ||
    f.startsWith('backend/') ||
    f.startsWith('src/platform/') ||
    f.startsWith('src/lib/') ||
    f.startsWith('packages/') ||
    /\/[A-Za-z0-9]+(Store|Service)\.ts$/.test(f) ||
    (/\/(store|state)\//.test(f) && /\.tsx?$/.test(f))
  ) {
    return 'B';
  }
  if (f.endsWith('.css')) return 'CSS';
  if (f.startsWith('src/locales/')) return 'COPY';
  if (f.startsWith('brand/')) return 'PAINT-ASSET';
  if (f.startsWith('public/') && !/\.(html?|m?jsx?|m?tsx?)$/.test(f)) return 'PAINT-ASSET';
  if (/\.tsx?$/.test(f) && (f.startsWith('src/ui/') || f.startsWith('src/app/') || f.startsWith('src/features/'))) {
    return 'UICODE';
  }
  return 'NONE';
}

/**
 * Map a file's bucket + changed lines to its tier. Pure, so classify-tier.mjs
 * and the unit tests share one source of truth.
 * @returns {'B'|'S'|'P-safe'|'NONE'}
 */
export function fileTier(bucket, lines) {
  switch (bucket) {
    case 'B':
      return 'B';
    case 'CSS':
      return cssTier(lines);
    case 'COPY':
    case 'PAINT-ASSET':
      return 'P-safe';
    case 'UICODE':
    case 'CONNECTOR':
      // Content-scanned: behaviour → B, otherwise structural markup/copy → S.
      return uiCodeTier(lines);
    case 'TEST':
    case 'NONE':
    default:
      return 'NONE';
  }
}

/** Classify a CSS change from its changed lines. */
export function cssTier(lines) {
  if (lines.length === 0) return 'S'; // couldn't read the diff → conservative
  for (const raw of lines) {
    const ln = raw.trimEnd();
    if (RISKY_CSS.some((re) => re.test(ln))) return 'S';
    if (!SAFE_CSS_LINE.test(ln)) return 'S';
  }
  return 'P-safe';
}

/** Classify a UI code file's change from its changed lines. */
export function uiCodeTier(lines) {
  if (lines.length === 0) return 'S'; // couldn't read the diff → assume structural
  for (const raw of lines) {
    if (BEHAVIOUR_CODE.some((re) => re.test(raw))) return 'B';
  }
  return 'S';
}
