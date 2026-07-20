/* -------------------------------------------------------------------------- *
 * CONTAINMENT (WB-085) — file-backed meeting material: owner stamp + read gate.
 *
 * THE PROBLEM THIS CLOSES. Meeting material written to disk (`meeting.json`,
 * `transcript.json`, `notes.docx`, `audio.wav`, the note-review markdown, …)
 * carried NO owner information and was read back with NO viewer check, while
 * the app will open ANY OS-readable folder as a workspace
 * (`WorkspaceSelector.openWorkspacePath` -> `workspaceStore.setRootPath`). The
 * safety of the file path therefore rested entirely on the CONVENTION that two
 * advisors never point at the same folder. A NAS mount, network share, or
 * OneDrive/Dropbox/SharePoint-synced folder turns that convention into a live
 * cross-advisor leak of owner-private meeting content with ZERO code change.
 *
 * The shared record pool already carries `ownerRef` + `visibilityPolicyId` per
 * record and enforces owner-private there. This module is the SAME privacy
 * promise at the file mechanism: the identical vocabulary, the identical
 * fail-closed table, applied to material on disk.
 *
 * ============================ SUBSTRATE BOUNDARY ============================
 * This gate is enforced inside `WorkspaceService`, which is the chokepoint for
 * RENDERER (TypeScript) file access. It is TOTAL FOR THAT SUBSTRATE AND ONLY
 * THAT SUBSTRATE. It is NOT a containment boundary for the whole product, and
 * must never be described as one. Readers that reach the same bytes WITHOUT
 * passing through `WorkspaceService` are NOT gated by this module:
 *   - the Rust RAG walker (`src-tauri/src/commands/rag/reconcile.rs`), which
 *     indexes `notes.docx` / `transcript.json` into the store Ask retrieves
 *     from;
 *   - other Rust readers (retention sweep/redact, diarize, transcribe);
 *   - the raw `@tauri-apps/plugin-fs` bypass helpers in
 *     `src/platform/fs/tauriFsPlugin.ts`;
 *   - the out-of-process MCP server (`src-tauri/src/mcp_bin/`).
 * Those are recorded as an open finding, NOT closed here. See the lane report
 * and `prep/CONTAINMENT-TOTALITY-4-VERDICTS-c34.md`. The durable answer is the
 * native permissions engine (N3/N4/N5) owning visibility beneath every reader.
 * ============================================================================
 *
 * VOCABULARY IS SHARED, NOT COPIED-BY-CONVENTION. The policy identifiers and
 * the fail-closed table below are deliberately IDENTICAL to the pool-side
 * classifier (`src/platform/crm/meetingRecordVisibility.ts` on the WB-085
 * containment lane). If that lane merges, ONE of the two must import the other
 * so the file mechanism and the record mechanism can never disagree about what
 * `owner-private` means. `meetingMaterialVisibility.vocabulary.test.ts` pins
 * every string and every arm so drift on either side fails a test rather than
 * silently opening a hole.
 * -------------------------------------------------------------------------- */

/** The one visibility policy that restricts meeting material to its owner. */
export const OWNER_PRIVATE_VISIBILITY_POLICY = 'owner-private';

/**
 * The recognized broad-visibility policies. Anything NOT in this set (and not
 * `owner-private`) is unknown/legacy and is REFUSED — fail closed. Identical to
 * the pool classifier's set.
 */
export const RECOGNIZED_BROAD_VISIBILITY_POLICIES: ReadonlySet<string> =
  new Set(['firm-visible', 'household-team']);

export type MeetingMaterialRefusalReason =
  /** No stamp at all on disk — legacy/unstamped material. */
  | 'unstamped'
  /** Stamp present but the policy field is missing/blank/non-string. */
  | 'missing-policy'
  /** Policy is outside the recognized vocabulary. */
  | 'unknown-policy'
  /** `owner-private` and the viewer is not the owner (unknown viewer counts). */
  | 'owner-private-not-owner'
  /**
   * The viewer identity could not be resolved. A workspace folder is a SHARED
   * projection — it may hold material owned by anyone who ever pointed at it —
   * so with no viewer there is no per-file owner to fall back on and EVERY
   * stamped file fails closed, broad policy included.
   */
  | 'viewer-unresolved';

export type MeetingMaterialDisposition =
  | { readonly kind: 'allowed' }
  | { readonly kind: 'refused'; readonly reason: MeetingMaterialRefusalReason };

/**
 * The stamp carried by a meeting folder's `meeting.json`. Both fields are
 * optional at the TYPE level precisely because material on disk may predate the
 * stamp; the classifier is what makes their absence safe.
 */
export interface MeetingMaterialStamp {
  readonly ownerRef?: string | null;
  readonly visibilityPolicyId?: string | null;
}

function trimmed(value: unknown): string {
  return typeof value === 'string' ? value.trim() : '';
}

/**
 * CONTAINMENT (WB-085): the single source of truth for whether file-backed
 * meeting material may be read by a viewer. Pure and TOTAL — every input maps
 * to `allowed` or to a NAMED refusal, so a partial/unhandled value can never
 * fall through to "allowed".
 *
 * Fail-closed table (identical to the pool classifier, plus `unstamped`, which
 * the record path cannot have because a record without an owner never parses):
 *   - no stamp on disk                      -> REFUSED (unstamped)
 *   - unresolved viewer                     -> REFUSED (viewer-unresolved)
 *   - missing / blank / non-string policy    -> REFUSED (missing-policy)
 *   - policy outside the vocabulary          -> REFUSED (unknown-policy)
 *   - `owner-private`, viewer !== owner      -> REFUSED (owner-private-not-owner)
 *   - `owner-private`, viewer === owner      -> ALLOWED
 *   - recognized broad policy                -> ALLOWED
 */
export function classifyMeetingMaterialForViewer(
  stamp: MeetingMaterialStamp | null | undefined,
  viewerMemberId: string | null | undefined
): MeetingMaterialDisposition {
  if (!stamp || typeof stamp !== 'object')
    return { kind: 'refused', reason: 'unstamped' };

  const owner = trimmed(stamp.ownerRef);
  const policy = trimmed(stamp.visibilityPolicyId);

  // Nothing identity-bearing at all: legacy material written before the stamp
  // existed. Refused for everyone — see MIGRATION in the lane report.
  if (owner === '' && policy === '')
    return { kind: 'refused', reason: 'unstamped' };

  // A shared folder has no per-file owner to fall back on without a viewer.
  const viewer = trimmed(viewerMemberId);
  if (viewer === '') return { kind: 'refused', reason: 'viewer-unresolved' };

  if (policy === '') return { kind: 'refused', reason: 'missing-policy' };

  if (policy === OWNER_PRIVATE_VISIBILITY_POLICY) {
    if (owner !== '' && viewer === owner) return { kind: 'allowed' };
    return { kind: 'refused', reason: 'owner-private-not-owner' };
  }

  if (RECOGNIZED_BROAD_VISIBILITY_POLICIES.has(policy))
    return { kind: 'allowed' };

  return { kind: 'refused', reason: 'unknown-policy' };
}

/**
 * The file every meeting folder carries its stamp in. The stamp is resolved
 * from the FOLDER, never from the individual file, so `audio.wav`,
 * `notes.docx`, `transcript.json` and the note-review markdown are all gated by
 * the same decision — a reader cannot pick a sibling file to dodge the check.
 */
export const MEETING_STAMP_FILE = 'meeting.json';

/**
 * The folder segment under a matter that holds per-meeting folders. Layout:
 *   <matter folder>/Meetings/<meeting folder>/<artifact>
 */
const MEETINGS_SEGMENT = 'Meetings';

/**
 * Resolve the meeting FOLDER that owns `path`, or null when `path` is not
 * per-meeting material.
 *
 * Deliberately returns null for a file sitting DIRECTLY in `Meetings/` (e.g.
 * `.consent-ledger.json`): that is matter-level, not per-meeting, so it has no
 * per-meeting owner stamp to be judged against. Recorded as a known gap rather
 * than silently judged by the wrong stamp.
 *
 * Path handling is separator-agnostic (Windows workspaces use `\`) and matches
 * the `Meetings` segment case-insensitively, because the guard must not be
 * defeatable by a case or separator variation on a case-insensitive filesystem.
 */
export function meetingFolderForPath(path: string): string | null {
  if (typeof path !== 'string' || path.trim() === '') return null;
  const parts = path.split(/[\\/]+/);
  // Find the LAST `Meetings` segment that still leaves a folder AND at least
  // one more component beneath it — i.e. `.../Meetings/<folder>/<something>`.
  for (let i = parts.length - 3; i >= 0; i--) {
    if (parts[i]?.toLowerCase() !== MEETINGS_SEGMENT.toLowerCase()) continue;
    const folder = parts[i + 1];
    if (!folder || folder.trim() === '') return null;
    // Preserve the caller's original separator style by rebuilding from the
    // original string rather than re-joining with a chosen separator.
    return rebuildPrefix(path, i + 1);
  }
  return null;
}

/**
 * True when `path` is the per-meeting folder ITSELF (`.../Meetings/<folder>`),
 * which is what a directory listing of `Meetings/` yields. Used to filter the
 * existence signal out of listings.
 */
export function meetingFolderIfSelf(path: string): string | null {
  if (typeof path !== 'string' || path.trim() === '') return null;
  const parts = path.split(/[\\/]+/);
  const last = parts.length - 1;
  const parent = parts[last - 1];
  if (!parent || parent.toLowerCase() !== MEETINGS_SEGMENT.toLowerCase())
    return null;
  const folder = parts[last];
  if (!folder || folder.trim() === '') return null;
  return path;
}

/**
 * Rebuild the prefix of `path` covering `parts[0..=upTo]`, preserving the
 * original separators exactly. Walking the original string (rather than
 * re-joining) keeps a UNC prefix, a drive letter, or a leading `./` intact.
 */
function rebuildPrefix(path: string, upTo: number): string {
  const ends = tokenEndOffsets(path);
  const end = ends[upTo];
  return end === undefined ? path : path.slice(0, end);
}

const SEPARATOR = /[\\/]/;

/**
 * End offset of each element produced by `path.split(/[\\/]+/)`, so an index
 * into that array can be turned back into an offset in the ORIGINAL string.
 *
 * `split` emits a LEADING EMPTY element for an absolute POSIX path (`/ws/a` ->
 * ['', 'ws', 'a']); this mirrors that so the two stay index-aligned. Getting
 * this wrong silently mis-resolves the meeting folder, which reads as
 * "unstamped" and would refuse everything — safe, but broken — so it is pinned
 * by the separator/case test.
 */
function tokenEndOffsets(path: string): number[] {
  const ends: number[] = [];
  if (SEPARATOR.test(path[0] ?? '')) ends.push(0);
  let cursor = 0;
  while (cursor < path.length) {
    while (cursor < path.length && SEPARATOR.test(path[cursor] as string))
      cursor++;
    const start = cursor;
    while (cursor < path.length && !SEPARATOR.test(path[cursor] as string))
      cursor++;
    if (cursor > start) ends.push(cursor);
  }
  return ends;
}

/**
 * The path of the stamp file for a resolved meeting folder.
 */
export function stampPathForFolder(meetingFolder: string): string {
  const separator =
    meetingFolder.includes('\\') && !meetingFolder.includes('/') ? '\\' : '/';
  return `${meetingFolder}${separator}${MEETING_STAMP_FILE}`;
}

/**
 * Parse a stamp out of raw `meeting.json` text. Returns null (-> `unstamped`,
 * i.e. REFUSED) for anything that is not a JSON object — a truncated, corrupt,
 * or hostile file must never read as "allowed".
 */
export function parseMeetingStamp(raw: string): MeetingMaterialStamp | null {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed))
    return null;
  const record = parsed as Record<string, unknown>;
  return {
    ownerRef:
      typeof record['ownerRef'] === 'string' ? record['ownerRef'] : null,
    visibilityPolicyId:
      typeof record['visibilityPolicyId'] === 'string'
        ? record['visibilityPolicyId']
        : null,
  };
}

/**
 * Apply the canonical stamp to a `meeting.json` payload.
 *
 * WHERE THE VALUES COME FROM. `ownerRef` is the firm member id of the advisor
 * whose seat is writing the material — the SAME identity space the pool's
 * `MeetingProjection.ownerRef` uses (see `contract.ts` `MeetingProjection` and
 * the "mine" owner filter in `shell/contracts.tsx`). `visibilityPolicyId` is
 * `owner-private` unless a broader policy is supplied by the caller, because
 * raw audio, a verbatim transcript, and AI-generated notes of a client
 * conversation are the most sensitive material the product holds.
 *
 * IDEMPOTENT AND NON-DEMOTING: an existing stamp is never overwritten. Meeting
 * metadata is merge-written many times over a meeting's life (notes errors,
 * transcript errors, delivery receipts, rename); re-deriving the owner on each
 * of those would let a LATER writer silently re-own an EARLIER advisor's
 * material — exactly the leak this module exists to prevent.
 */
export function applyMeetingStamp<T extends Record<string, unknown>>(
  meta: T,
  stamp: { readonly ownerRef: string; readonly visibilityPolicyId?: string }
): T & MeetingMaterialStamp {
  const existingOwner = trimmed(meta['ownerRef']);
  const existingPolicy = trimmed(meta['visibilityPolicyId']);
  if (existingOwner !== '' && existingPolicy !== '')
    return meta as T & MeetingMaterialStamp;
  const owner = trimmed(stamp.ownerRef);
  const policy =
    trimmed(stamp.visibilityPolicyId) || OWNER_PRIVATE_VISIBILITY_POLICY;
  return {
    ...meta,
    ...(existingOwner === '' && owner !== '' ? { ownerRef: owner } : {}),
    ...(existingPolicy === '' ? { visibilityPolicyId: policy } : {}),
  } as T & MeetingMaterialStamp;
}
