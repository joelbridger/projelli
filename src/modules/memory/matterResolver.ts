/**
 * Pure matter-resolution helpers (WS-B/C app).
 *
 * Given a file path (or `mail:<id>` source id) and the set of matters, decide
 * which matter the source belongs to. Kept free of React and Zustand so the
 * indexer, the chat, and the tests can all share one source of truth.
 *
 * Resolution rules:
 *   - A file belongs to a matter when its path is INSIDE one of the matter's
 *     `folderPaths` (the folder itself, or any descendant — respecting path
 *     separators so "/ws/Acme" never matches "/ws/Acme Corp").
 *   - When several matters' folders match (e.g. a nested mapping), the LONGEST
 *     matching folder wins — the most specific mapping is the right one.
 *   - When nothing matches, the source is `unassigned` (the same sentinel the
 *     Rust indexer uses when no matterId is supplied).
 *   - `mail:<id>` source ids never live under a workspace folder, so they
 *     resolve to `unassigned` here. Fine-grained email->matter assignment is
 *     a later task; folder/account mapping is out of scope for this helper.
 */

import { UNASSIGNED_MATTER_ID, type Matter } from '@/types/matter';

/** Normalise a path for comparison: backslashes to slashes, strip trailing slashes. */
function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * True when `filePath` is the folder `folder` itself or a descendant of it,
 * respecting path boundaries. Both inputs are normalised here.
 */
export function isPathInFolder(filePath: string, folder: string): boolean {
  if (!filePath || !folder) return false;
  const f = normalize(filePath);
  const dir = normalize(folder);
  if (f === dir) return true;
  return f.startsWith(`${dir}/`);
}

/**
 * Resolve the matter id a path belongs to. Returns `UNASSIGNED_MATTER_ID`
 * when the path is outside every matter's mapped folders (or when the path is
 * a `mail:` id, which is never under a workspace folder).
 *
 * When more than one matter folder contains the path, the longest (most
 * specific) folder wins, so a sub-matter mapped to a child folder takes
 * precedence over a parent matter mapped to its ancestor.
 */
export function resolveMatterId(filePath: string, matters: Matter[]): string {
  if (!filePath) return UNASSIGNED_MATTER_ID;
  // `mail:` sources don't live under a folder — leave email assignment to a
  // later task. Resolve to unassigned for now.
  if (filePath.startsWith('mail:')) return UNASSIGNED_MATTER_ID;

  let bestId = UNASSIGNED_MATTER_ID;
  let bestLen = -1;
  for (const matter of matters) {
    if (matter.id === UNASSIGNED_MATTER_ID) continue;
    for (const folder of matter.folderPaths) {
      if (!folder) continue;
      if (isPathInFolder(filePath, folder)) {
        const len = normalize(folder).length;
        if (len > bestLen) {
          bestLen = len;
          bestId = matter.id;
        }
      }
    }
  }
  return bestId;
}

/**
 * Look up a matter by id. Returns `undefined` for the unassigned sentinel or
 * an unknown id.
 */
export function findMatter(
  matterId: string | null | undefined,
  matters: Matter[],
): Matter | undefined {
  if (!matterId || matterId === UNASSIGNED_MATTER_ID) return undefined;
  return matters.find((m) => m.id === matterId);
}

/**
 * A short display label for a matter ("Client - Matter" when both are set,
 * else whichever exists). Used by the active-matter indicator and selector.
 * Uses a hyphen, never an em dash (project copy rule).
 */
export function matterLabel(matter: Matter): string {
  const name = matter.name.trim();
  const client = matter.client.trim();
  if (name && client) return `${client} - ${name}`;
  return name || client || matter.id;
}
