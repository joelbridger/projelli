/**
 * Rectangle-intersection helpers for layout-overlap regression specs (QA-8 /
 * QA-9: decorative graphics / progress banners painting over text they
 * shouldn't). Playwright's own assertions cover single-element visibility;
 * nothing in the repo previously compared two elements' boxes against each
 * other, so this is a small, dependency-free helper rather than a full
 * geometry library.
 */

export interface Box {
  x: number;
  y: number;
  width: number;
  height: number;
}

/**
 * True when two boxes share any area. Boxes that merely touch at an edge
 * (e.g. `a.right === b.left`) do NOT count as overlapping — that's normal
 * adjacent layout, not a visual collision.
 */
export function boxesOverlap(a: Box, b: Box): boolean {
  const aLeft = a.x;
  const aRight = a.x + a.width;
  const aTop = a.y;
  const aBottom = a.y + a.height;
  const bLeft = b.x;
  const bRight = b.x + b.width;
  const bTop = b.y;
  const bBottom = b.y + b.height;

  return aLeft < bRight && bLeft < aRight && aTop < bBottom && bTop < aBottom;
}
