/**
 * QA-6 (P1) — the Ask 3-column layout (conversations rail + thread/composer +
 * sources) has two fixed, non-shrinkable side columns. The center column (which
 * holds the composer) was the only flex-shrinkable thing on the row, so at a
 * normal laptop window (~1028px) it was squeezed until `ask-composer-input`
 * collapsed to 0px and became non-interactable; at ~600px the whole row clipped
 * under `overflow:hidden` instead of degrading.
 *
 * `askLayoutForWidth` is the pure breakpoint function that fixes this: as the
 * Ask BODY (the 3-column row, excluding the app spine) narrows, it first
 * collapses the conversations rail, then hides the sources column — always
 * keeping the composer a usable minimum width so the primary input never
 * collapses.
 */
import { describe, it, expect } from 'vitest';
import {
  askLayoutForWidth,
  RAIL_WIDTH,
  RAIL_COLLAPSED_WIDTH,
  SOURCES_WIDTH,
  COMPOSER_COMFORTABLE_WIDTH,
} from './askResponsive';

/** The width left for the composer's thread column under a given layout. */
function threadWidth(bodyWidth: number): number {
  const l = askLayoutForWidth(bodyWidth);
  return (
    bodyWidth -
    (l.collapseRail ? RAIL_COLLAPSED_WIDTH : RAIL_WIDTH) -
    (l.showSources ? SOURCES_WIDTH : 0)
  );
}

describe('askLayoutForWidth (QA-6)', () => {
  it('shows all three columns comfortably at a wide window', () => {
    // 1424px window ≈ ~1156 body after the spine — the reported working width.
    expect(askLayoutForWidth(1156)).toEqual({ collapseRail: false, showSources: true });
  });

  it('collapses the rail (but keeps sources) at a normal ~1028px laptop window', () => {
    // ~1028px window ≈ ~760 body after the spine — the reported break point.
    const layout = askLayoutForWidth(760);
    expect(layout.collapseRail).toBe(true);
    expect(layout.showSources).toBe(true);
  });

  it('hides the sources column when even the collapsed rail + sources no longer fit', () => {
    const layout = askLayoutForWidth(430);
    expect(layout.collapseRail).toBe(true);
    expect(layout.showSources).toBe(false);
  });

  it('keeps the composer at least its comfortable width whenever sources are shown', () => {
    for (const w of [760, 800, 950, 1100, 1400]) {
      if (askLayoutForWidth(w).showSources) {
        expect(threadWidth(w)).toBeGreaterThanOrEqual(COMPOSER_COMFORTABLE_WIDTH);
      }
    }
  });

  it('never leaves the composer with a non-positive width, down to a 600px window', () => {
    // 600px window ≈ ~332 body after the spine — the reported clip point.
    for (const w of [332, 400, 500, 600, 760, 1028, 1400]) {
      expect(threadWidth(w)).toBeGreaterThan(0);
    }
  });

  it('degrades monotonically: narrowing only ever collapses/hides, never re-expands', () => {
    let sawCollapse = false;
    let sawHide = false;
    for (let w = 1400; w >= 300; w -= 20) {
      const l = askLayoutForWidth(w);
      if (l.collapseRail) sawCollapse = true;
      if (!l.showSources) sawHide = true;
      // once collapsed, a narrower width must not re-expand the rail
      if (sawCollapse) expect(l.collapseRail).toBe(true);
      if (sawHide) expect(l.showSources).toBe(false);
    }
  });
});
