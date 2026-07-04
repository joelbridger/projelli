/**
 * askResponsive — pure breakpoint logic for the Ask 3-column layout (QA-6).
 *
 * The Ask body is a flex row: the conversations rail (fixed width) + the thread
 * column that holds the composer (the only flex-shrinkable column) + the sources
 * column (fixed width). With two fixed side columns, the composer used to be
 * squeezed to 0px at a normal ~1028px window and the whole row clipped at
 * ~600px. `askLayoutForWidth` degrades the layout gracefully as the body
 * narrows so the primary input never collapses:
 *
 *   wide            → rail expanded  + sources shown
 *   medium (~1028)  → rail collapsed + sources shown
 *   narrow          → rail collapsed + sources hidden
 *
 * A plain width measurement (ResizeObserver in Ask.tsx) drives this, matching
 * the existing MainPanel toolbar pattern — CSS container queries aren't reliable
 * in the Tauri WebView.
 */

/** Conversations rail width when expanded (mirrors ConversationsRail). */
export const RAIL_WIDTH = 264;
/** Conversations rail width when collapsed to its thin strip. */
export const RAIL_COLLAPSED_WIDTH = 52;
/** Sources column width (mirrors Ask.tsx). */
export const SOURCES_WIDTH = 326;
/**
 * The width the thread/composer column wants for a comfortable composer. Above
 * this, the layout keeps whichever side columns still fit; below it, the next
 * side column is shed.
 */
export const COMPOSER_COMFORTABLE_WIDTH = 380;
/**
 * A hard floor for the thread column, applied as a `minWidth` in Ask.tsx so the
 * composer input can never be driven to 0 even at window sizes below the
 * supported range. Chosen so a 600px OS window (≈332px body, rail collapsed)
 * still leaves a usable input.
 */
export const COMPOSER_MIN_WIDTH = 280;

export interface AskLayout {
  /** Whether the conversations rail should be forced to its collapsed strip. */
  collapseRail: boolean;
  /** Whether the sources column should be rendered at all. */
  showSources: boolean;
}

/**
 * Decide the Ask layout for a measured BODY width (the 3-column row, i.e.
 * excluding the app spine).
 */
export function askLayoutForWidth(bodyWidth: number): AskLayout {
  // Enough room for all three columns with a comfortable composer.
  if (bodyWidth >= RAIL_WIDTH + COMPOSER_COMFORTABLE_WIDTH + SOURCES_WIDTH) {
    return { collapseRail: false, showSources: true };
  }
  // Collapse the rail first; keep sources while they still fit alongside a
  // comfortable composer.
  if (bodyWidth >= RAIL_COLLAPSED_WIDTH + COMPOSER_COMFORTABLE_WIDTH + SOURCES_WIDTH) {
    return { collapseRail: true, showSources: true };
  }
  // Too narrow for the sources column — shed it, keep the composer usable.
  return { collapseRail: true, showSources: false };
}
