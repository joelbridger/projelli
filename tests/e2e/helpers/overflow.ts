import type { Page } from '@playwright/test';

/**
 * Returns a list of elements that are visibly overflowing the viewport
 * horizontally — i.e. where the user would actually see a horizontal scrollbar
 * or clipped content.
 *
 * False-positive guard: elements whose bounding rect extends beyond
 * window.innerWidth are only reported if NO ancestor has a computed
 * overflow-x of hidden/clip/auto/scroll that would clip them.  An ancestor
 * with any of those values absorbs the child's overflow, so there is no
 * user-visible scroll or clipping at the document level.
 *
 * The document-level scrollWidth check is kept as-is: that one is a true
 * positive (the document itself has grown wider than the viewport).
 */
export async function horizontalOverflow(page: Page): Promise<string[]> {
  return page.evaluate(() => {
    const doc = document.documentElement;
    const offenders: string[] = [];

    // True positive: the document itself is wider than the viewport.
    if (doc.scrollWidth > doc.clientWidth + 1) {
      offenders.push(`document ${doc.scrollWidth}>${doc.clientWidth}`);
    }

    /**
     * Walk the ancestor chain of `el` (not including `el` itself, not
     * including the document root) and return true if any ancestor has a
     * computed overflow-x value that would clip the element's overflow.
     */
    function isClippedByAncestor(el: HTMLElement): boolean {
      let node = el.parentElement;
      while (node && node !== document.documentElement) {
        const ov = getComputedStyle(node).overflowX;
        if (ov === 'hidden' || ov === 'clip' || ov === 'auto' || ov === 'scroll') {
          return true;
        }
        node = node.parentElement;
      }
      return false;
    }

    for (const el of Array.from(document.querySelectorAll('body *')) as HTMLElement[]) {
      const r = el.getBoundingClientRect();
      if (r.width > 0 && (r.left < -8 || r.right > window.innerWidth + 8)) {
        // Skip elements that are clipped by an ancestor — no visible overflow.
        if (isClippedByAncestor(el)) continue;
        offenders.push(
          `${el.tagName}.${String(el.className).slice(0, 60)} left=${Math.round(r.left)} right=${Math.round(r.right)}`,
        );
      }
    }

    return offenders.slice(0, 20);
  });
}
