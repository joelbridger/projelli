/**
 * hiddenNodes — hide Advisor Prep Hero's OWN internal entries from the rendered file
 * listing, so the user never sees (or deletes) app config they didn't create.
 *
 * This hides ONLY Advisor Prep Hero-internal names (e.g. the `.keepance` config folder),
 * NOT every dotfile: ordinary dotfiles like `.gitignore` keep their existing
 * behaviour and still respect the user's "Show Hidden Files" setting. (An earlier
 * version hid every dot-prefixed node unconditionally, which kept `.gitignore`
 * etc. hidden even with Show Hidden turned ON.)
 *
 * Display-only: the underlying files are untouched and still readable by the app.
 */

import { WORKSPACE_DATA_DIR } from '@/config/identity';

/** Advisor Prep Hero-internal entry names, hidden from the file UI regardless of settings. */
const KEEPANCE_INTERNAL_NAMES = new Set([WORKSPACE_DATA_DIR]);

/** True when a node is a Advisor Prep Hero-internal entry that must never be shown. */
export function isHiddenNode(node: { name: string }): boolean {
  return KEEPANCE_INTERNAL_NAMES.has(node.name);
}

/** Drop hidden (dot-prefixed) nodes from a listing, preserving order. */
export function visibleNodes<T extends { name: string }>(nodes: T[]): T[] {
  return nodes.filter((node) => !isHiddenNode(node));
}
