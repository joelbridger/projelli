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
 *   - `mail:<id>` source ids never live under a workspace folder, so this
 *     path-based resolver returns `unassigned` for them. Email is mapped to a
 *     matter by its mail folder, not by the `mail:<id>` key — see
 *     `mailFolderKey` / `resolveMailMatter` / `buildMailMatterMap` below.
 */

import { UNASSIGNED_MATTER_ID, type Matter } from '@/platform/types/matter';

/** Normalise a path for comparison: backslashes to slashes, strip trailing slashes. */
export function normalize(p: string): string {
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

// ─────────────────────────────────────────────────────────────────────
// Email -> matter mapping (WS-B/C)
//
// Email is filed into a matter by the mail FOLDER it lives in, not by the
// `mail:<id>` source key. A mail-folder key encodes the provider, account, and
// (optionally) folder id so the same matter store can map mail alongside files.
// ─────────────────────────────────────────────────────────────────────

/** One parsed mail-folder mapping (the backend `MailMatterMapEntry` shape). */
export interface MailMatterMapEntry {
  provider: string;
  account: string;
  /** Empty string == account-level mapping (every folder in the account). */
  folderId: string;
  matterId: string;
}

/**
 * Build a mail-folder key from its parts. `folderId` is optional; omitting it
 * (or passing an empty string) yields an account-level key (`provider/account`)
 * that maps every folder in that account.
 *
 * The key is the value stored in a matter's `mailFolderPaths`. Provider and
 * account are required and must be non-empty.
 */
export function mailFolderKey(provider: string, account: string, folderId?: string): string {
  const p = provider.trim();
  const a = account.trim();
  const f = (folderId ?? '').trim();
  return f ? `${p}/${a}/${f}` : `${p}/${a}`;
}

/**
 * Parse a mail-folder key back into its parts. The first two segments are
 * provider + account; everything after the second slash is the folder id (folder
 * ids may themselves contain slashes, so we only split on the first two). A key
 * with just `provider/account` has an empty `folderId` (account-level).
 *
 * Returns `null` for a malformed key (fewer than two segments).
 */
export function parseMailFolderKey(
  key: string,
): { provider: string; account: string; folderId: string } | null {
  const firstSlash = key.indexOf('/');
  if (firstSlash < 0) return null;
  const provider = key.slice(0, firstSlash);
  const rest = key.slice(firstSlash + 1);
  const secondSlash = rest.indexOf('/');
  if (secondSlash < 0) {
    // provider/account (account-level)
    if (!provider || !rest) return null;
    return { provider, account: rest, folderId: '' };
  }
  const account = rest.slice(0, secondSlash);
  const folderId = rest.slice(secondSlash + 1);
  if (!provider || !account) return null;
  return { provider, account, folderId };
}

/**
 * Flatten every matter's `mailFolderPaths` into the `MailMatterMapEntry[]` the
 * backend `mail_sync_all` / mapping commands consume. Skips the unassigned
 * sentinel and any malformed keys.
 */
export function buildMailMatterMap(matters: Matter[]): MailMatterMapEntry[] {
  const out: MailMatterMapEntry[] = [];
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    for (const key of m.mailFolderPaths ?? []) {
      const parsed = parseMailFolderKey(key);
      if (!parsed) continue;
      out.push({ ...parsed, matterId: m.id });
    }
  }
  return out;
}

/**
 * Resolve which matter a given mail folder (provider/account/folder) belongs to,
 * mirroring the backend `resolve_mail_matter`: a folder-level mapping wins over
 * an account-level one; nothing matching falls back to `unassigned`. Used by the
 * frontend MiniSearch path and tests so the two indexers agree.
 */
export function resolveMailMatter(
  matters: Matter[],
  provider: string,
  account: string,
  folderId: string,
): string {
  let accountLevel: string | null = null;
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    for (const key of m.mailFolderPaths ?? []) {
      const parsed = parseMailFolderKey(key);
      if (!parsed) continue;
      if (parsed.provider !== provider || parsed.account !== account) continue;
      if (parsed.folderId && parsed.folderId === folderId) return m.id; // most specific wins
      if (!parsed.folderId) accountLevel = m.id;
    }
  }
  return accountLevel ?? UNASSIGNED_MATTER_ID;
}
