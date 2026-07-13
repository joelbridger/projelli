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
import { isAbsolutePath, sameOrInside, joinWorkspacePath, relativeInside, collapseDotSegments } from '@/platform/fs/appPath';

/** Normalise a path for comparison: backslashes to slashes, strip trailing slashes. */
export function normalize(p: string): string {
  return p.replace(/\\/g, '/').replace(/\/+$/, '');
}

/**
 * Like `normalize`, but also collapses DUPLICATE internal separators
 * (`Clients//Acme` -> `Clients/Acme`). Used only for the specificity length
 * metric below: `isPathInFolder`/`sameOrInside` already collapse duplicate
 * slashes when deciding whether two folder spellings denote the same real
 * folder, so the length used to break a specificity tie must agree — using
 * plain `normalize` here would let a redundantly-slashed spelling of the
 * SAME folder measure as "longer" and silently win a tie instead of
 * correctly failing closed as ambiguous (Codex review round 3, smoke-2 P0
 * #5 fix).
 */
function specificityLength(p: string): number {
  return normalize(p).replace(/\/{2,}/g, '/').length;
}

function normalizeClaimPath(path: string): string {
  return normalize(path.trim()).replace(/\/+/g, '/');
}

/**
 * Canonical key for folder ownership checks.
 *
 * Folder claims are privacy boundaries. The same physical folder may appear as
 * an absolute workspace path (`C:/WS/Clients/Acme`) or workspace-relative path
 * (`Clients/acme`), and Windows paths are case-insensitive. This key collapses
 * those shapes so auto-backfills never attach a folder already owned by another
 * matter.
 */
export function canonicalFolderClaimKey(
  folderPath: string,
  workspaceRoot?: string | null,
): string | null {
  const normalizedPath = normalizeClaimPath(folderPath);
  if (!normalizedPath) return null;

  const pathKey = normalizedPath.toLowerCase();
  const rootKey = workspaceRoot ? normalizeClaimPath(workspaceRoot).toLowerCase() : '';
  if (!rootKey) return pathKey;

  if (pathKey === rootKey) return null;
  const rootPrefix = `${rootKey}/`;
  if (!pathKey.startsWith(rootPrefix)) return pathKey;

  const relative = pathKey.slice(rootPrefix.length).replace(/^\/+/, '');
  return relative || null;
}

/**
 * True when `filePath` is the folder `folder` itself or a descendant of it,
 * respecting path boundaries. Both inputs are normalised here.
 */
export function isPathInFolder(filePath: string, folder: string): boolean {
  if (!filePath || !folder) return false;
  // sameOrInside is the single cross-platform containment predicate: it handles
  // `\` vs `/`, drive letters, UNC roots, trailing separators, AND (critically
  // for matter isolation on Windows) case-insensitive comparison — so a file
  // under `C:\WS\Acme` resolves to its matter even when typed `c:/ws/acme`.
  return sameOrInside(folder, filePath);
}

/**
 * `resolveMatterMatch`'s result. `ambiguous` is what lets a caller trying
 * several SHAPES of the same logical path (e.g. `resolveMatterIdForWorkspacePath`'s
 * direct/relative/absolute fallback forms) tell "this exact form genuinely
 * matches no folder, try another form" apart from "this form found a real
 * identity conflict between two matters" — the latter must never be papered
 * over by a different form of the SAME path happening to resolve cleanly
 * (Codex review, smoke-2 P0 #5 fix). `resolveMatterId` collapses both cases
 * to `UNASSIGNED_MATTER_ID` for callers that only need the id.
 */
export interface MatterMatch {
  id: string;
  ambiguous: boolean;
}

/**
 * Resolve the matter id a path belongs to, along with whether the failure (if
 * any) was a genuine identity conflict rather than a plain non-match. See
 * `resolveMatterId` for the resolution rules.
 */
export function resolveMatterMatch(filePath: string, matters: Matter[]): MatterMatch {
  return resolveMatterMatchAcrossForms([filePath], matters);
}

/**
 * Canonicalize a matter folder to absolute (using the same join `matterStore.ts`'s
 * `resolveAbsolute` uses when WRITING `folderPaths`) so a folder that's already
 * absolute and a rare legacy RELATIVE entry for the SAME physical folder compare
 * on equal footing. Without this, two matters claiming the same real folder in
 * different shapes (`Clients/Acme` vs `C:/WS/Clients/Acme`) would tie at
 * DIFFERENT raw string lengths — the absolute one always "longer" and so always
 * "winning" the specificity tie-break — silently picking one matter instead of
 * failing closed on the genuine ambiguity (Codex review, smoke-2 P0 #5 fix).
 * A `null`/missing `rootPath` leaves the folder as-is (nothing to canonicalize
 * against — matches today's behaviour for every caller that doesn't have one).
 */
function canonicalizeFolder(folder: string, rootPath: string | null | undefined): string {
  if (!rootPath || isAbsolutePath(folder)) return folder;
  return joinWorkspacePath(rootPath, folder);
}

/**
 * Like `resolveMatterMatch`, but takes every equivalent SHAPE of the same
 * logical file (e.g. its workspace-relative form and its `rootPath`-joined
 * absolute form) and resolves them TOGETHER in one ambiguity-tracking pass,
 * rather than trying one shape, stopping at its first clean match, and never
 * even looking at the other shapes. When `rootPath` is supplied, every
 * matter folder is ALSO canonicalized to absolute before comparing (see
 * `canonicalizeFolder`) so mixed absolute/legacy-relative folder claims for
 * the same physical folder are recognized as the same folder, not two
 * differently-sized strings.
 *
 * This matters because `Matter.folderPaths` entries can themselves be a mix
 * of shapes (normally absolute; occasionally a legacy relative entry — see
 * `matterStore.ts`'s `resolveAbsolute` doc comment). A caller that tries
 * shapes sequentially and returns on the first non-empty result can get a
 * CLEAN match from a stale/legacy-relative folder entry while never
 * discovering that the file's CANONICAL (absolute) form is actually claimed
 * by two different matters — silently surfacing a matter-isolation-relevant
 * decision (CRM writes, recipient auto-suggestion) from what should have
 * failed closed (Codex review, smoke-2 P0 #5 fix). Evaluating every shape in
 * one pass, in one coordinate system, makes the longest-match-wins /
 * ambiguous-tie-fails-closed rule apply to the file's full identity, not to
 * whichever shape (or whichever matter's folder happened to be longer as a
 * raw string) was tried first.
 */
export function resolveMatterMatchAcrossForms(
  filePaths: string[],
  matters: Matter[],
  rootPath?: string | null,
): MatterMatch {
  let bestId = UNASSIGNED_MATTER_ID;
  let bestLen = -1;
  // Fail-closed ambiguity guard (Codex P1, 2026-06-30; extended to multi-form
  // resolution and cross-shape folder canonicalization, Codex P2 + P1,
  // smoke-2 P0 #5). Because containment is case-insensitive for
  // Windows-shaped paths, a file could match the folders of TWO DIFFERENT
  // matters that differ ONLY by case (`C:\WS\Acme` vs `C:\WS\acme`) —
  // possible if the workspace lives on a case-SENSITIVE Windows-shaped volume
  // (NTFS per-directory case sensitivity, a WSL/network-backed share). On a
  // normal case-insensitive Windows volume those two folders cannot coexist, so
  // this never triggers there; but where it CAN, silently picking the first
  // matter would surface one client's file under another's scope. So when the
  // longest match (across every equivalent shape of this file, and every
  // equivalent shape of each matter's folder) is claimed by more than one
  // distinct matter, resolve to UNASSIGNED (fail closed — the file is locked
  // out of both, never leaked).
  let bestIsAmbiguous = false;
  let ambiguousWith = '';
  let ambiguousFolder = '';
  let matchedFilePath = '';
  for (const filePath of filePaths) {
    // `mail:` sources don't live under a folder — leave email assignment to a
    // later task. Never matches, for any shape.
    if (!filePath || filePath.startsWith('mail:')) continue;
    for (const matter of matters) {
      if (matter.id === UNASSIGNED_MATTER_ID) continue;
      for (const rawFolder of matter.folderPaths) {
        if (!rawFolder) continue;
        const folder = canonicalizeFolder(rawFolder, rootPath);
        if (isPathInFolder(filePath, folder)) {
          const len = specificityLength(folder);
          if (len > bestLen) {
            bestLen = len;
            bestId = matter.id;
            bestIsAmbiguous = false;
            matchedFilePath = filePath;
          } else if (len === bestLen && matter.id !== bestId) {
            // A second, distinct matter ties at the longest match (whether via
            // the same shape or a different one) — a case-only (or
            // exact-duplicate) folder collision. Cannot safely attribute.
            bestIsAmbiguous = true;
            ambiguousWith = matter.id;
            ambiguousFolder = folder;
          }
        }
      }
    }
  }
  if (bestIsAmbiguous && import.meta.env.DEV) {
    // Silent fail-closed (correctly — see the guard above) is otherwise
    // indistinguishable from "this file just isn't mapped to any matter",
    // which made the Windows smoke-2 P0 #5 "Send to Wealthbox" investigation
    // (docs/evidence/windows-smoke-2/RUN-LOG.md) unable to tell those two
    // cases apart from the UI alone. Dev-only so it never reaches a shipped
    // build or a user's console.
    console.warn(
      `[matterResolver] "${matchedFilePath}" matches folders claimed by two different matters ` +
        `(${bestId} and ${ambiguousWith}, both via "${ambiguousFolder}"-length folders) — ` +
        'resolving to unassigned rather than guessing. This usually means two matters were ' +
        'independently given an overlapping folderPaths entry (e.g. a bulk/manual folder ' +
        'remap wrote a duplicate claim); check both matters\' folderPaths.',
    );
  }
  return bestIsAmbiguous
    ? { id: UNASSIGNED_MATTER_ID, ambiguous: true }
    : { id: bestId, ambiguous: false };
}

/**
 * Resolve the matter id a path belongs to. Returns `UNASSIGNED_MATTER_ID`
 * when the path is outside every matter's mapped folders, OR when it matches
 * more than one (a genuine identity conflict — fails closed rather than
 * guessing). Use `resolveMatterMatch` when the caller needs to tell those two
 * cases apart.
 *
 * When more than one matter folder contains the path, the longest (most
 * specific) folder wins, so a sub-matter mapped to a child folder takes
 * precedence over a parent matter mapped to its ancestor.
 */
export function resolveMatterId(filePath: string, matters: Matter[]): string {
  return resolveMatterMatch(filePath, matters).id;
}

/**
 * Resolve a workspace file that may be represented by either a workspace-
 * relative path (the file tree) or an absolute path (the indexer). Every form
 * is checked together so an ownership conflict fails closed instead of one
 * convenient spelling silently winning.
 */
export function resolveWorkspaceMatterId(
  filePath: string,
  rootPath: string | null | undefined,
  matters: Matter[],
): string {
  const forms = [filePath];
  if (rootPath) {
    const relative = relativeInside(rootPath, filePath);
    if (relative) forms.push(relative);
    if (!isAbsolutePath(filePath)) forms.push(joinWorkspacePath(rootPath, filePath));
  }
  return resolveMatterMatchAcrossForms(forms, matters, rootPath).id;
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
 * A short display label for a matter ("Client - Matter" when both are set and
 * DIFFER, else whichever exists). CRM-created household matters set name ===
 * client (both the household name), so we must not render "Name - Name".
 * Uses a hyphen, never an em dash (project copy rule).
 */
export function matterLabel(matter: Matter): string {
  const name = matter.name.trim();
  const client = matter.client.trim();
  if (name && client && name !== client) return `${client} - ${name}`;
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

/**
 * Invert the matter store's `crmHouseholdKeys` into matterId -> householdIds.
 * Used by the CRM write-back review card to resolve which household(s) a
 * client's writes should target (the backend does not persist this map).
 * Same skip rules as `buildCrmMatterMap`, including the same "first matter
 * wins" defensive dedup for a stale household key claimed by two matters —
 * without it, a write could target the wrong client's CRM household.
 */
export function buildInverseCrmMap(matters: Matter[]): Map<string, string[]> {
  const out = new Map<string, string[]>();
  const claimed = new Set<string>();
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    for (const key of m.crmHouseholdKeys ?? []) {
      if (!key || claimed.has(key)) continue;
      claimed.add(key);
      const existing = out.get(m.id);
      if (existing) {
        existing.push(key);
      } else {
        out.set(m.id, [key]);
      }
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
  /**
   * Workspace-relative folder to MATERIALIZE this client's OneDrive files into on
   * disk, so they show in the client's Documents tab and index via the normal
   * local-file pipeline. Empty string keeps the legacy RAG-only behaviour.
   */
  destFolder: string;
}

export interface BoxMatterMapEntry {
  folderKey: string;
  matterId: string;
}

export interface EsignMatterMapEntry {
  esignKey: string;
  matterId: string;
}

export interface JotformMatterMapEntry {
  jotformKey: string;
  matterId: string;
}

export interface SharefileMatterMapEntry {
  folderKey: string;
  matterId: string;
}

export interface ZocksMatterMapEntry {
  zocksKey: string;
  matterId: string;
}

export interface AddeparMatterMapEntry {
  addeparKey: string;
  matterId: string;
}

export interface EsignEnvelopeCandidate {
  subject?: string;
  senderEmail?: string;
  senderName?: string;
  recipientEmails?: string[];
  recipientNames?: string[];
  customFields?: Array<{ name?: string; value?: string }>;
}

export interface EsignEnvelopeResolution {
  matterId: string;
  needsAssignment: boolean;
  reason: string;
}

export interface MeetingMatterMapEntry {
  meetingKey: string;
  matterId: string;
}

export function normalizeMeetingKey(key: string): string {
  return key.toLowerCase().trim().replace(/\s+/g, ' ');
}

/**
 * Normalize a Zocks key exactly like the Rust backend's `zocks::engine::normalize_key`
 * (lowercase, replace `< > " ' , ;` with spaces, collapse whitespace) so the
 * frontend's ambiguity pre-filter and the backend's matcher agree on which keys
 * collide. Without the punctuation pass, the frontend would treat `Smith, John`
 * and `Smith John` as distinct while the backend treats them as the same key.
 */
function normalizeZocksKey(key: string): string {
  return key
    .toLowerCase()
    .replace(/[<>"',;]/g, ' ')
    .split(/\s+/)
    .filter(Boolean)
    .join(' ');
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

/**
 * The workspace-RELATIVE folder a client's OneDrive files are materialized into
 * on disk. Prefers the matter's own on-disk folder (`folderPaths[0]`, resolved
 * relative to the workspace root); falls back to `Clients/<client name>` when the
 * matter has no folder yet. Empty string means "no safe destination" (the backend
 * then keeps the file as RAG-only). Exported so the connector can register the
 * same folder on the matter, keeping Documents scoping and the write path aligned.
 */
export function oneDriveDestFolderForMatter(
  matter: Pick<Matter, 'folderPaths' | 'client' | 'name'>,
  workspaceRoot?: string | null,
): string {
  const first = matter.folderPaths.find(Boolean);
  if (first) {
    const rel = toWorkspaceRelativeFolder(first, workspaceRoot);
    if (rel) return rel;
  }
  const name = (matter.client || matter.name || '').trim();
  const safe = name.replace(/[\\/:*?"<>|\r\n]/g, ' ').replace(/\s+/g, ' ').trim();
  return safe ? `Clients/${safe}` : '';
}

/** Resolve a possibly-absolute matter folder to a workspace-relative path.
 *  Returns '' for an absolute path that is not under the workspace root.
 *  Containment uses `relativeInside` (case-sensitive per directory segment,
 *  case-folded only for a Windows drive/UNC volume root) rather than a full
 *  lowercase compare, so a path that merely SHARES a name with something
 *  inside the workspace but differs by segment case is never mistaken for
 *  being inside it — callers of this helper (retention sweep included) use
 *  the result to decide what gets deleted. */
export function toWorkspaceRelativeFolder(
  folderPath: string,
  workspaceRoot?: string | null,
): string {
  const p = normalize(folderPath);
  if (!isAbsolutePath(p)) {
    // A relative input is assumed already-relative-to-the-workspace, so it
    // should never need to climb above where it started. Resolve `.`/`..`
    // the same way the containment checks below do; if anything is left
    // climbing (a leading `..`), that's an escape attempt — refuse it
    // instead of handing back a path outside the intended scope (this
    // result feeds the retention sweep's delete boundary).
    const resolved = collapseDotSegments(p.replace(/^\/+/, ''));
    if (resolved === '..' || resolved.startsWith('../')) return '';
    return resolved;
  }
  if (!workspaceRoot) return '';
  const root = normalize(workspaceRoot);
  const rel = relativeInside(root, p);
  return rel ?? '';
}

export function buildOneDriveMatterMap(
  matters: Matter[],
  workspaceRoot?: string | null,
): OneDriveMatterMapEntry[] {
  const destByMatter = new Map<string, string>();
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    destByMatter.set(m.id, oneDriveDestFolderForMatter(m, workspaceRoot));
  }
  return buildConnectorMatterMap(
    matters,
    (m) => m.onedriveFolderKeys,
    (folderKey, matterId) => ({
      folderKey,
      matterId,
      destFolder: destByMatter.get(matterId) ?? '',
    })
  ).sort(
    (a, b) =>
      oneDriveFolderPathLength(b.folderKey) -
      oneDriveFolderPathLength(a.folderKey)
  );
}

export function buildBoxMatterMap(matters: Matter[]): BoxMatterMapEntry[] {
  return buildConnectorMatterMap(
    matters,
    (m) => m.boxFolderKeys,
    (folderKey, matterId) => ({ folderKey, matterId })
  );
}

export function buildJotformMatterMap(
  matters: Matter[]
): JotformMatterMapEntry[] {
  const out: JotformMatterMapEntry[] = [];
  for (const matter of matters) {
    if (matter.id === UNASSIGNED_MATTER_ID) continue;
    const seenForMatter = new Set<string>();
    const keys = [
      ...(matter.jotformKeys ?? []),
      matter.client,
      matter.name,
    ];
    for (const rawKey of keys) {
      const key = rawKey.trim();
      const normalized = normalizeEsignKey(key);
      if (!key || !normalized || seenForMatter.has(normalized)) continue;
      seenForMatter.add(normalized);
      out.push({ jotformKey: key, matterId: matter.id });
    }
  }
  return out;
}

export function buildSharefileMatterMap(
  matters: Matter[]
): SharefileMatterMapEntry[] {
  return buildConnectorMatterMap(
    matters,
    (m) => m.sharefileFolderKeys,
    (folderKey, matterId) => ({ folderKey, matterId })
  ).sort(
    (a, b) =>
      connectorFolderPathLength(b.folderKey) -
      connectorFolderPathLength(a.folderKey)
  );
}

export function buildZocksMatterMap(matters: Matter[]): ZocksMatterMapEntry[] {
  // First pass: count the DISTINCT matters that claim each normalized key. A key
  // claimed by 2+ matters (e.g. two matters sharing a client name) is ambiguous
  // and must NOT map anywhere — otherwise a Zocks meeting matching only that
  // shared key gets silently indexed under whichever matter was processed first
  // (a matter-isolation bug). Ambiguous meetings are left for manual assignment.
  const mattersPerKey = new Map<string, Set<string>>();
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    for (const rawKey of [...(m.zocksKeys ?? []), m.client, m.name]) {
      const normalized = normalizeZocksKey(rawKey.trim());
      if (!normalized) continue;
      let set = mattersPerKey.get(normalized);
      if (!set) {
        set = new Set<string>();
        mattersPerKey.set(normalized, set);
      }
      set.add(m.id);
    }
  }

  // Second pass: emit one entry per unambiguous key, de-duplicated per key.
  const out: ZocksMatterMapEntry[] = [];
  const emitted = new Set<string>();
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    for (const rawKey of [...(m.zocksKeys ?? []), m.client, m.name]) {
      const zocksKey = rawKey.trim();
      const normalized = normalizeZocksKey(zocksKey);
      if (!zocksKey || !normalized || emitted.has(normalized)) continue;
      if ((mattersPerKey.get(normalized)?.size ?? 0) > 1) continue; // ambiguous
      emitted.add(normalized);
      out.push({ zocksKey, matterId: m.id });
    }
  }
  return out;
}

export function buildAddeparMatterMap(
  matters: Matter[]
): AddeparMatterMapEntry[] {
  return buildConnectorMatterMap(
    matters,
    (m) => m.addeparKeys,
    (addeparKey, matterId) => ({ addeparKey, matterId })
  );
}

function oneDriveFolderPathLength(folderKey: string): number {
  return connectorFolderPathLength(folderKey);
}

function connectorFolderPathLength(folderKey: string): number {
  const colon = folderKey.lastIndexOf(':');
  return colon >= 0 ? folderKey.slice(colon + 1).length : folderKey.length;
}

export interface OneDriveFolderIdentity {
  driveId: string;
  siteId?: string | null;
  name: string;
  path: string;
}

export interface OneDriveFolderResolution {
  matterId: string;
  action: 'reuse' | 'link' | 'unassigned';
  name: string;
}

function normalizeOneDriveCloudPath(path: string): string {
  let normalized = path.replace(/\\/g, '/');
  const rootMarker = normalized.indexOf('root:');
  if (rootMarker >= 0)
    normalized = normalized.slice(rootMarker + 'root:'.length);
  while (normalized.includes('//'))
    normalized = normalized.replace(/\/\//g, '/');
  normalized = normalized.trim().replace(/\/+$/, '').toLowerCase();
  if (!normalized) return '/';
  return normalized.startsWith('/') ? normalized : `/${normalized}`;
}

export function buildOneDriveFolderKey(
  folder: Pick<OneDriveFolderIdentity, 'driveId' | 'siteId' | 'path'>
): string {
  const path = normalizeOneDriveCloudPath(folder.path);
  const siteId = folder.siteId?.trim();
  return siteId
    ? `m365/default/${siteId}/${folder.driveId}:${path}`
    : `m365/default/${folder.driveId}:${path}`;
}

function oneDriveFolderLeafName(folder: OneDriveFolderIdentity): string {
  const path = folder.path.replace(/\\/g, '/').replace(/\/+$/, '');
  const withoutRoot = path.includes('root:')
    ? path.slice(path.indexOf('root:') + 'root:'.length)
    : path;
  const leaf = withoutRoot.split('/').filter(Boolean).pop()?.trim();
  return leaf || folder.name.trim();
}

export function isTopLevelOneDriveClientFolder(
  folder: Pick<OneDriveFolderIdentity, 'path'>
): boolean {
  const path = normalizeOneDriveCloudPath(folder.path);
  const segments = path.split('/').filter(Boolean);
  return segments.length === 2 && segments[0] === 'clients';
}

/**
 * A OneDrive folder is a candidate for auto-linking to a same-name client when it
 * is EITHER a `Clients/<name>` folder OR a top-level `<name>` folder (a client
 * whose OneDrive folder sits at the drive root, named exactly after them — the
 * common real-world layout). Linking itself stays strict: `resolveMatterForOneDriveFolder`
 * only links an unambiguous exact name match, so a top-level "Documents" or
 * "Desktop" folder never links unless a client is literally named that.
 */
export function isLinkableOneDriveClientFolder(
  folder: Pick<OneDriveFolderIdentity, 'path'>
): boolean {
  if (isTopLevelOneDriveClientFolder(folder)) return true;
  const segments = normalizeOneDriveCloudPath(folder.path)
    .split('/')
    .filter(Boolean);
  return segments.length === 1;
}

/**
 * Resolve a OneDrive / SharePoint folder against existing matters.
 *
 * This mirrors `resolveMatterForHousehold`, except OneDrive never creates a
 * matter from a folder. If the folder name is ambiguous or already claimed, the
 * safe answer is to leave it unassigned.
 */
export function resolveMatterForOneDriveFolder(
  matters: Matter[],
  folder: OneDriveFolderIdentity,
  claimedMatterIds: ReadonlySet<string> = new Set()
): OneDriveFolderResolution {
  const folderKey = buildOneDriveFolderKey(folder);

  // Priority 1: already linked by OneDrive folder key.
  for (const matter of matters) {
    if ((matter.onedriveFolderKeys ?? []).includes(folderKey)) {
      return { matterId: matter.id, action: 'reuse', name: matter.name };
    }
  }

  // Priority 2: unambiguous name-based link to an existing matter. Judge
  // ambiguity over ALL matters before filtering out already-linked / claimed
  // ones, exactly like the Wealthbox matcher.
  const folderName = oneDriveFolderLeafName(folder);
  const normalizedFolderName = normalizeClientName(folderName);
  if (normalizedFolderName) {
    const matches = matters.filter(
      (m) =>
        normalizeClientName(m.name) === normalizedFolderName ||
        normalizeClientName(m.client) === normalizedFolderName
    );
    if (matches.length === 1) {
      const match = matches[0];
      if (
        match &&
        (match.onedriveFolderKeys ?? []).length === 0 &&
        !claimedMatterIds.has(match.id)
      ) {
        return { matterId: match.id, action: 'link', name: match.name };
      }
    }
  }

  // Priority 3: no clear match. Do not create a matter from a cloud folder.
  return { matterId: '', action: 'unassigned', name: folderName };
}

export interface BoxFolderResolution {
  matterId: string;
  action: 'reuse' | 'link' | 'unassigned';
  name: string;
}

/**
 * A Box folder is a "top-level client folder" when its path is exactly
 * `/clients/<name>` (two segments, first segment "clients", case-insensitive) —
 * the same convention used for OneDrive auto-linking.
 */
export function isTopLevelBoxClientFolder(folder: { path: string }): boolean {
  const segments = normalize(folder.path)
    .split('/')
    .filter(Boolean);
  return segments.length === 2 && (segments[0]?.toLowerCase() ?? '') === 'clients';
}

function boxFolderLeafName(folder: { name: string; path: string }): string {
  const leaf = normalize(folder.path).split('/').filter(Boolean).pop()?.trim();
  return leaf || folder.name.trim();
}

/**
 * Resolve a Box folder against existing matters, mirroring the OneDrive matcher:
 * reuse an existing Box-folder link, link one unambiguous same-name matter that
 * has no Box folder yet, otherwise leave it unassigned. Never creates a matter
 * from a cloud folder. `folder` is structural (key/name/path) so this module
 * does not import box-commands (which imports BoxMatterMapEntry from here).
 */
export function resolveMatterForBoxFolder(
  matters: Matter[],
  folder: { key: string; name: string; path: string },
  claimedMatterIds: ReadonlySet<string> = new Set()
): BoxFolderResolution {
  // Priority 1: already linked by Box folder key.
  for (const matter of matters) {
    if ((matter.boxFolderKeys ?? []).includes(folder.key)) {
      return { matterId: matter.id, action: 'reuse', name: matter.name };
    }
  }

  // Priority 2: unambiguous name-based link. Judge ambiguity over ALL matters
  // before filtering out already-linked / claimed ones, like the OneDrive and
  // Wealthbox matchers.
  const folderName = boxFolderLeafName(folder);
  const normalizedFolderName = normalizeClientName(folderName);
  if (normalizedFolderName) {
    const matches = matters.filter(
      (m) =>
        normalizeClientName(m.name) === normalizedFolderName ||
        normalizeClientName(m.client) === normalizedFolderName
    );
    if (matches.length === 1) {
      const match = matches[0];
      if (
        match &&
        (match.boxFolderKeys ?? []).length === 0 &&
        !claimedMatterIds.has(match.id)
      ) {
        return { matterId: match.id, action: 'link', name: match.name };
      }
    }
  }

  // Priority 3: no clear match. Do not create a matter from a cloud folder.
  return { matterId: '', action: 'unassigned', name: folderName };
}

function folderPathLeafName(folderPath: string): string {
  return normalize(folderPath).split('/').filter(Boolean).pop()?.trim() ?? '';
}

/**
 * Resolve a CRM household against the user's workspace folders.
 *
 * This is deliberately stricter than a fuzzy search: a household may claim a
 * folder only when its normalized name matches exactly one workspace folder's
 * leaf name. Duplicate same-name folders stay unassigned so Lantern never
 * guesses across client privacy boundaries.
 */
export function resolveFolderForHousehold(
  folderPaths: string[],
  household: { id?: string; name: string },
  claimedFolders: ReadonlySet<string> = new Set(),
  workspaceRoot?: string | null,
): string | null {
  const householdName = normalizeClientName(household.name);
  if (!householdName) return null;

  const matches = folderPaths.filter(
    (folderPath) =>
      normalizeClientName(folderPathLeafName(folderPath)) === householdName
  );
  if (matches.length !== 1) return null;

  const match = matches[0];
  if (!match) return null;
  const claimKey = canonicalFolderClaimKey(match, workspaceRoot);
  if (!claimKey || claimedFolders.has(claimKey)) return null;
  return match;
}

export function buildEsignMatterMap(matters: Matter[]): EsignMatterMapEntry[] {
  const out: EsignMatterMapEntry[] = [];
  for (const matter of matters) {
    if (matter.id === UNASSIGNED_MATTER_ID) continue;
    const seenForMatter = new Set<string>();
    const keys = [
      ...(matter.esignKeys ?? []),
      matter.client,
      matter.name,
    ];
    for (const rawKey of keys) {
      const key = rawKey.trim();
      const normalized = normalizeEsignKey(key);
      if (!key || !normalized || seenForMatter.has(normalized)) continue;
      seenForMatter.add(normalized);
      out.push({ esignKey: key, matterId: matter.id });
    }
  }
  return out;
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

// ── Calendar connector (Wave 1) ────────────────────────────────────────────

export interface CalendarMatterMapEntry {
  key: string;
  matterId: string;
}

/**
 * Keys for calendar attendee/title -> matter matching:
 *  - every taught `meetingKeys` entry (emails or phrases; first-writer-wins
 *    like `buildMeetingMatterMap`, since teaching moves keys explicitly),
 *  - the matter's client name and matter name, normalized — BUT a
 *    name-derived key claimed by two different matters is dropped entirely
 *    (ambiguity never auto-links; better unfiled than misfiled).
 */
export function buildCalendarMatterMap(matters: Matter[]): CalendarMatterMapEntry[] {
  const taught = new Map<string, string>();
  const named = new Map<string, string | null>(); // null = ambiguous, dropped
  for (const m of matters) {
    if (m.id === UNASSIGNED_MATTER_ID) continue;
    for (const raw of m.meetingKeys ?? []) {
      const key = normalizeMeetingKey(raw);
      if (!key || taught.has(key)) continue;
      taught.set(key, m.id);
    }
    for (const raw of [m.client, m.name]) {
      const key = normalizeClientName(raw ?? '');
      if (!key) continue;
      const existing = named.get(key);
      if (existing === undefined) named.set(key, m.id);
      else if (existing !== m.id) named.set(key, null);
    }
  }
  const out: CalendarMatterMapEntry[] = [];
  for (const [key, matterId] of taught) out.push({ key, matterId });
  for (const [key, matterId] of named) {
    if (matterId !== null && !taught.has(key)) out.push({ key, matterId });
  }
  return out;
}

/**
 * Resolve a calendar event to matters. Per attendee, email match beats name
 * match; across attendees (and the event title) every distinct matched
 * matter is kept — a joint meeting belongs to several clients. Returns []
 * when nothing matches: the event stays unassigned, never guessed.
 * Mirrors the Rust `calendar::engine::resolve_event_matters`.
 */
export function resolveMattersForCalendarEvent(
  event: {
    title: string;
    attendees: { email: string; name: string }[];
    /** Full-diff review finding (P2): when the CLIENT sends the invite
     *  (common with Google/Graph), attendees may only list the advisor —
     *  the client's own address lands here, not in attendees. Mirrors the
     *  Rust engine::resolve_event_matters organizer_email check. */
    organizerEmail?: string;
  },
  entries: CalendarMatterMapEntry[],
): string[] {
  const map = new Map<string, string>();
  for (const e of entries) {
    const key = normalizeMeetingKey(e.key);
    if (key && !map.has(key)) map.set(key, e.matterId);
  }
  const matches = new Set<string>();
  for (const attendee of event.attendees) {
    const email = attendee.email.trim().toLowerCase();
    const byEmail = email ? map.get(email) : undefined;
    if (byEmail) {
      matches.add(byEmail);
      continue;
    }
    const byName = map.get(normalizeClientName(attendee.name ?? ''));
    if (byName) matches.add(byName);
  }
  const organizerEmail = (event.organizerEmail ?? '').trim().toLowerCase();
  const byOrganizer = organizerEmail ? map.get(organizerEmail) : undefined;
  if (byOrganizer) matches.add(byOrganizer);
  const byTitle = map.get(normalizeMeetingKey(event.title ?? ''));
  if (byTitle) matches.add(byTitle);
  return [...matches].sort();
}

function normalizeEsignKey(value: string): string {
  return value
    .toLowerCase()
    .replace(/[<>"',;]/g, ' ')
    .trim()
    .replace(/\s+/g, ' ');
}

function addExactEsignMatches(
  keyMap: Map<string, string[]>,
  matches: Set<string>,
  value: string | undefined,
): void {
  const key = normalizeEsignKey(value ?? '');
  const found = keyMap.get(key);
  if (!found) return;
  for (const matterId of found) matches.add(matterId);
}

function addFuzzyEsignMatches(
  keyMap: Map<string, string[]>,
  matches: Set<string>,
  value: string | undefined,
): void {
  const haystack = normalizeEsignKey(value ?? '');
  if (!haystack) return;
  for (const [key, matterIds] of keyMap) {
    if (key.length < 4) continue;
    if (haystack.includes(key) || key.includes(haystack)) {
      for (const matterId of matterIds) matches.add(matterId);
    }
  }
}

export function resolveEsignMatterForEnvelope(
  matters: Matter[],
  envelope: EsignEnvelopeCandidate,
): EsignEnvelopeResolution {
  const map = buildEsignMatterMap(matters);
  const keyMap = new Map<string, string[]>();
  for (const entry of map) {
    const key = normalizeEsignKey(entry.esignKey);
    if (!key) continue;
    keyMap.set(key, [...(keyMap.get(key) ?? []), entry.matterId]);
  }

  const matches = new Set<string>();
  for (const email of envelope.recipientEmails ?? []) addExactEsignMatches(keyMap, matches, email);
  if (matches.size === 0) addExactEsignMatches(keyMap, matches, envelope.senderEmail);
  if (matches.size === 0) {
    for (const name of envelope.recipientNames ?? []) addFuzzyEsignMatches(keyMap, matches, name);
    addFuzzyEsignMatches(keyMap, matches, envelope.senderName);
  }
  if (matches.size === 0) {
    addFuzzyEsignMatches(keyMap, matches, envelope.subject);
    for (const field of envelope.customFields ?? []) {
      addFuzzyEsignMatches(keyMap, matches, field.name);
      addFuzzyEsignMatches(keyMap, matches, field.value);
    }
  }

  if (matches.size === 1) {
    for (const only of matches) {
      return { matterId: only, needsAssignment: false, reason: '' };
    }
  }
  return {
    matterId: UNASSIGNED_MATTER_ID,
    needsAssignment: true,
    reason: matches.size === 0 ? 'no matter matched this DocuSign envelope' : 'multiple matters matched this DocuSign envelope',
  };
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
