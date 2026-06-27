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
  matters: Matter[]
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
export function mailFolderKey(
  provider: string,
  account: string,
  folderId?: string
): string {
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
  key: string
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

// ─────────────────────────────────────────────────────────────────────
// Wealthbox CRM -> matter mapping
//
// CRM records are indexed under a matter by the Wealthbox HOUSEHOLD id the
// household was mapped to when the matter was created or linked. The backend
// `crm_sync_all` command accepts `Vec<CrmMatterMapEntry>` in camelCase; this
// helper converts the matter store's `crmHouseholdKeys` lists into that format.
// ─────────────────────────────────────────────────────────────────────

/** One CRM household -> matter mapping entry (camelCase, mirroring the Rust DTO). */
export interface CrmMatterMapEntry {
  householdId: string;
  matterId: string;
}

/**
 * Flatten every matter's `crmHouseholdKeys` into the `CrmMatterMapEntry[]` the
 * backend `crm_sync_all` command consumes. Skips the unassigned sentinel and any
 * blank household ids.
 */
export function buildCrmMatterMap(matters: Matter[]): CrmMatterMapEntry[] {
  const out: CrmMatterMapEntry[] = [];
  // A household maps to exactly ONE matter. `addCrmHouseholdKey` already removes a key
  // from other matters, but dedupe defensively here too (first matter wins) so a stale
  // duplicate can never make the backend index the same household under two matters.
  const claimed = new Set<string>();
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    for (const key of m.crmHouseholdKeys ?? []) {
      if (!key || claimed.has(key)) continue;
      claimed.add(key);
      out.push({ householdId: key, matterId: m.id });
    }
  }
  return out;
}

export function filterCrmMatterMapForProvider(
  matterMap: CrmMatterMapEntry[],
  provider: 'wealthbox' | 'salesforce' | 'redtail'
): CrmMatterMapEntry[] {
  return matterMap.filter(({ householdId }) => {
    if (provider === 'salesforce') return householdId.startsWith('sfdc:');
    if (provider === 'redtail') return householdId.startsWith('redtail:');
    return (
      !householdId.startsWith('sfdc:') && !householdId.startsWith('redtail:')
    );
  });
}

// ─────────────────────────────────────────────────────────────────────
// External connector -> matter mapping slots
//
// These are intentionally simple shells for Foundation Part A. Each connector
// branch owns the real provider-specific matching rule; the shared foundation
// only flattens the matter store's persisted keys into backend-friendly shapes.
// ─────────────────────────────────────────────────────────────────────

export interface OneDriveMatterMapEntry {
  folderKey: string;
  matterId: string;
}

export interface EsignMatterMapEntry {
  esignKey: string;
  matterId: string;
}

export interface MeetingMatterMapEntry {
  meetingKey: string;
  matterId: string;
}

export function normalizeMeetingKey(key: string): string {
  return key.toLowerCase().trim().replace(/\s+/g, ' ');
}

function buildConnectorMatterMap<T extends { matterId: string }>(
  matters: Matter[],
  getKeys: (matter: Matter) => string[] | undefined,
  toEntry: (key: string, matterId: string) => T
): T[] {
  const out: T[] = [];
  const claimed = new Set<string>();
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    for (const key of getKeys(m) ?? []) {
      if (!key || claimed.has(key)) continue;
      claimed.add(key);
      out.push(toEntry(key, m.id));
    }
  }
  return out;
}

export function buildOneDriveMatterMap(
  matters: Matter[]
): OneDriveMatterMapEntry[] {
  return buildConnectorMatterMap(
    matters,
    (m) => m.onedriveFolderKeys,
    (folderKey, matterId) => ({ folderKey, matterId })
  );
}

export function buildEsignMatterMap(matters: Matter[]): EsignMatterMapEntry[] {
  return buildConnectorMatterMap(
    matters,
    (m) => m.esignKeys,
    (esignKey, matterId) => ({ esignKey, matterId })
  );
}

export function buildMeetingMatterMap(matters: Matter[]): MeetingMatterMapEntry[] {
  const out: MeetingMatterMapEntry[] = [];
  const claimed = new Set<string>();
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    for (const key of m.meetingKeys ?? []) {
      const meetingKey = normalizeMeetingKey(key);
      if (!meetingKey || claimed.has(meetingKey)) continue;
      claimed.add(meetingKey);
      out.push({ meetingKey, matterId: m.id });
    }
  }
  return out;
}

// ─────────────────────────────────────────────────────────────────────
// Household -> matter resolution (merge-by-name, no duplicates)
//
// When a Wealthbox sync runs, we need to decide what to do with each
// household: reuse an already-linked matter, merge (link) into an
// existing file-client whose name matches, or create a brand-new matter.
// ─────────────────────────────────────────────────────────────────────

/**
 * Normalise a client name for fuzzy comparison: lowercase, trim, collapse
 * internal whitespace to a single space, strip surrounding punctuation/quotes.
 * Internal punctuation (commas, ampersands, etc.) is preserved so "Smith, Bob"
 * and "smith, bob" compare equal while their internal structure is intact.
 */
export function normalizeClientName(s: string): string {
  // 1. Lowercase + trim leading/trailing whitespace.
  let n = s.toLowerCase().trim();
  // 2. Collapse any internal whitespace runs to a single space.
  n = n.replace(/\s+/g, ' ');
  // 3. Strip surrounding characters that are not letters, digits, or whitespace
  //    (catches leading/trailing quotes, periods, parentheses, etc.).
  n = n.replace(/^[^a-z0-9\s]+|[^a-z0-9\s]+$/g, '').trim();
  return n;
}

/** The outcome of resolving one Wealthbox household against the matter list. */
export interface HouseholdResolution {
  /** The existing matter's id; empty string for `'create'` (no matter exists yet). */
  matterId: string;
  /** How the household should be handled. */
  action: 'reuse' | 'link' | 'create';
  /** The resolved name: the existing matter name for 'reuse'/'link'; `household.name` for 'create'. */
  name: string;
}

/**
 * Decide how to handle a Wealthbox household during a sync, in priority order:
 *
 *   1. **reuse** — a matter is already linked to this household via `crmHouseholdKeys`.
 *      No change needed; the map will pick it up automatically.
 *
 *   2. **link** — the household's normalized name must identify EXACTLY ONE existing matter,
 *      counted over ALL matters by `name`/`client` **before** any linked/claimed filter. A
 *      normalized name shared by two or more existing clients is not a reliable identity, so
 *      it is AMBIGUOUS and we never link (attaching this household's CRM data to a possibly-
 *      wrong same-name client would corrupt that client's record) — even if filtering would
 *      otherwise leave a single eligible candidate. When the name does identify exactly one
 *      matter, we link only if that matter has NO existing `crmHouseholdKeys` (not already tied
 *      to another household) and isn't already claimed earlier in this batch; otherwise we
 *      `create`. The caller should call `addCrmHouseholdKey` and add `matterId` to
 *      `claimedMatterIds` after a link so a second household can't grab the same matter.
 *
 *   3. **create** — no match was found; the caller should call `createMatter`.
 *
 * `claimedMatterIds` is an optional set of matter ids already claimed for `link` in the
 * current sync batch. Passing it prevents two households from both linking to the same
 * matter when their names happen to be identical. The function is pure: same inputs always
 * produce the same output.
 */
export function resolveMatterForHousehold(
  matters: Matter[],
  household: { id: string; name: string },
  claimedMatterIds: ReadonlySet<string> = new Set()
): HouseholdResolution {
  // Priority 1: already linked by household key.
  for (const matter of matters) {
    if ((matter.crmHouseholdKeys ?? []).includes(household.id)) {
      return { matterId: matter.id, action: 'reuse', name: matter.name };
    }
  }

  // Priority 2: name-based merge into an existing file-client.
  // Judge ambiguity over ALL matters that carry this normalized name FIRST, before
  // any linked/claimed filtering. A name shared by 2+ existing clients is not a
  // reliable identity, so linking on it could attach this household's CRM data to
  // the WRONG same-name client (a record-correctness/privacy hazard) — even if the
  // claimed/linked filter would otherwise leave a single eligible candidate. Only a
  // name that uniquely identifies one existing matter is safe to consider for a link.
  const normalizedHouseholdName = normalizeClientName(household.name);
  if (normalizedHouseholdName) {
    const matches = matters.filter(
      (m) =>
        normalizeClientName(m.name) === normalizedHouseholdName ||
        normalizeClientName(m.client) === normalizedHouseholdName
    );
    // Exactly one matter carries this name → unambiguous identity. Zero or many → create.
    if (matches.length === 1) {
      const match = matches[0];
      // That single match is linkable only if it isn't already tied to another
      // household (its own CRM key) and hasn't been claimed earlier in this batch.
      if (
        match &&
        (match.crmHouseholdKeys ?? []).length === 0 &&
        !claimedMatterIds.has(match.id)
      ) {
        return { matterId: match.id, action: 'link', name: match.name };
      }
    }
  }

  // Priority 3: no match (or an ambiguous one) — create a new matter.
  return { matterId: '', action: 'create', name: household.name };
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
  folderId: string
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
