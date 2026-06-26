/**
 * hiddenNodes — hide internal, dot-prefixed workspace entries (e.g. the
 * `.keepance` config folder) from the rendered file listing.
 *
 * This is DISPLAY-ONLY: the underlying files are untouched and still readable by
 * the app. It mirrors the convention the workspace selector already uses
 * (`!folder.startsWith('.')`), so the file grid, tree, and folder pickers don't
 * surface internal config folders the user could be confused by or delete.
 */

/** True when a node is an internal/hidden entry (dot-prefixed name). */
export function isHiddenNode(node: { name: string }): boolean {
  return node.name.startsWith('.');
}

/** Drop hidden (dot-prefixed) nodes from a listing, preserving order. */
export function visibleNodes<T extends { name: string }>(nodes: T[]): T[] {
  return nodes.filter((node) => !isHiddenNode(node));
}
