// Binary Version Service (WS-A / A5)
//
// Lantern 3.0 made Microsoft Word `.docx` the canonical document format. The
// legacy `VersionService` snapshots TEXT into localStorage, which destroys a
// binary `.docx` (and can't scale to large packages). This service stores
// version snapshots as REAL FILES on disk inside a workspace `.versions/` area,
// so it works byte-for-byte for `.docx` (and any binary format) AND keeps full
// history for text files.
//
// LAYOUT (under the workspace root):
//
//   .versions/<relative-path>/index.json          ← small metadata index
//   .versions/<relative-path>/<timestamp>.<ext>   ← the snapshot bytes
//
// e.g. for `docs/Contract.docx`:
//   .versions/docs/Contract.docx/2026-06-09T12-30-00-000Z.docx
//   .versions/docs/Contract.docx/index.json
//
// The snapshot file name is an ISO-8601 timestamp with `:`/`.` swapped for `-`
// (those are illegal / awkward in file names), keeping the original extension so
// the engine can re-open a `.docx` snapshot directly for diffing.
//
// We cap retained snapshots per file (default 50, matching the legacy service)
// and prune the oldest beyond the cap. Decrypt/encrypt is intentionally NOT done
// here — workspace files are the user's own files, stored as-is.
//
// The service talks to a tiny FS surface (a subset of WorkspaceService) so it is
// trivially mockable in tests and works in both the browser (Web FS) and Tauri.

import { writeCoordinator } from '@/platform/fs/writeCoordinator';

/** Monotonic rev for the write coordinator (BUG-049). The value only feeds the
 *  coordinator's isLatest bookkeeping, which we ignore here — we use it purely to
 *  SERIALIZE per-index-path read-modify-writes. */
let _versionIndexSeq = 0;
function versionIndexRev(): number {
  return (_versionIndexSeq += 1);
}

/** Who authored a version. 'user' for manual/auto edits, 'ai' for redlines. */
export type VersionAuthor = 'user' | 'ai';

/** One entry in a file's on-disk version index. */
export interface BinaryVersionEntry {
  /** Stable id (the snapshot file name, which is unique per timestamp). */
  id: string;
  /** ISO-8601 timestamp of when the snapshot was taken. */
  timestamp: string;
  /** Snapshot file name within the file's `.versions/<relpath>/` folder. */
  snapshotFile: string;
  /** Byte size of the snapshot. */
  size: number;
  /** Who made the change. */
  author: VersionAuthor;
  /** Optional human message (e.g. "Restored from version history"). */
  message?: string;
}

/** The persisted index shape (`index.json`). */
interface VersionIndex {
  /** Schema version, for forward-compat. */
  v: 1;
  /** Newest-first list of versions. */
  entries: BinaryVersionEntry[];
}

/**
 * The minimal filesystem surface this service needs. `WorkspaceService` already
 * satisfies this (path-validated, works in browser + Tauri); tests pass a mock.
 * All paths are workspace-relative or absolute-within-workspace — whatever the
 * backend's `validatePath` accepts (WorkspaceService accepts both).
 */
export interface VersionFS {
  exists(path: string): Promise<boolean>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
  readFileBinary(path: string): Promise<ArrayBuffer>;
  writeFileBinary(path: string, content: ArrayBuffer): Promise<void>;
  delete(path: string): Promise<void>;
  /** List a directory's entries (BUG-049: used to rebuild history from snapshot
   *  files when the index is corrupt). Satisfied by WorkspaceService.list. */
  list(path: string): Promise<Array<{ name: string }>>;
  /** Absolute workspace root, used to make paths relative for the layout. */
  getRootPath(): string | null;
}

export interface SaveVersionOptions {
  author?: VersionAuthor;
  message?: string;
}

const VERSIONS_DIR = '.versions';
const INDEX_FILE = 'index.json';
const DEFAULT_MAX_VERSIONS = 50;

/**
 * Turn an ISO timestamp into a file-name-safe stamp:
 *   2026-06-09T12:30:00.000Z -> 2026-06-09T12-30-00-000Z
 */
function timestampToFileStamp(iso: string): string {
  return iso.replace(/[:.]/g, '-');
}

/**
 * Inverse of `timestampToFileStamp`, for rebuilding the index from snapshot
 * file names (BUG-049): `2026-06-09T12-30-00-000Z__ab3cd.docx` -> the original
 * ISO `2026-06-09T12:30:00.000Z`. Falls back to the epoch when the name doesn't
 * match the expected stamp shape (so a rebuilt entry always has a valid date).
 */
function fileStampToTimestamp(snapshotFile: string): string {
  const base = snapshotFile.split('__')[0] ?? '';
  const m = base.match(/^(\d{4}-\d{2}-\d{2})T(\d{2})-(\d{2})-(\d{2})-(\d{3})Z$/);
  if (m) {
    const [, date, hour, minute, second, millisecond] = m;
    if (
      date === undefined ||
      hour === undefined ||
      minute === undefined ||
      second === undefined ||
      millisecond === undefined
    ) {
      return new Date(0).toISOString();
    }
    return `${date}T${hour}:${minute}:${second}.${millisecond}Z`;
  }
  return new Date(0).toISOString();
}

/** Extract the lowercase extension of a path (no dot), or '' if none. */
function extensionOf(path: string): string {
  const name = path.split('/').pop() ?? path;
  const dot = name.lastIndexOf('.');
  if (dot <= 0) return '';
  return name.slice(dot + 1).toLowerCase();
}

/**
 * Normalize an incoming file path (absolute-within-workspace OR already
 * relative) to a workspace-relative path for the `.versions/` layout. Strips a
 * leading workspace root and any leading slash. Never returns a path that could
 * escape the workspace (it is a pure string transform; the FS backend still
 * validates).
 */
export function toWorkspaceRelative(filePath: string, root: string | null): string {
  let p = filePath.replace(/\\/g, '/');
  if (root) {
    const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    if (p === normRoot) return '.';
    if (p.startsWith(normRoot + '/')) {
      p = p.slice(normRoot.length + 1);
    }
  }
  // Drop any leading slash so the result is genuinely relative.
  return p.replace(/^\/+/, '');
}

/**
 * BinaryVersionService — on-disk, binary-safe version history.
 *
 * Stateless aside from the injected FS + cap; every read goes to disk so two
 * editor panes (or a future second process) never see a stale index.
 */
export class BinaryVersionService {
  private readonly fs: VersionFS;
  private readonly maxVersions: number;

  constructor(fs: VersionFS, maxVersions: number = DEFAULT_MAX_VERSIONS) {
    this.fs = fs;
    this.maxVersions = maxVersions;
  }

  /** The `.versions/<relpath>` folder for a given workspace file. */
  private versionDir(filePath: string): string {
    const rel = toWorkspaceRelative(filePath, this.fs.getRootPath());
    return `${VERSIONS_DIR}/${rel}`;
  }

  private indexPath(filePath: string): string {
    return `${this.versionDir(filePath)}/${INDEX_FILE}`;
  }

  private snapshotPath(filePath: string, snapshotFile: string): string {
    return `${this.versionDir(filePath)}/${snapshotFile}`;
  }

  /** Read the on-disk index for a file. On a CORRUPT/invalid index, rebuild it
   *  from the snapshot files on disk (BUG-049) rather than reporting empty —
   *  the snapshots are still there, so history shouldn't silently vanish. */
  async readIndex(filePath: string): Promise<VersionIndex> {
    const path = this.indexPath(filePath);
    try {
      if (!(await this.fs.exists(path))) {
        // No index yet. Snapshots without an index can exist after a partial
        // delete / index loss — recover them if any are on disk.
        return await this.rebuildIndexFromSnapshots(filePath);
      }
      const raw = await this.fs.readFile(path);
      const parsed = JSON.parse(raw) as Partial<VersionIndex>;
      if (!Array.isArray(parsed.entries)) {
        return await this.rebuildIndexFromSnapshots(filePath);
      }
      return { v: 1, entries: parsed.entries };
    } catch {
      // Corrupt or partial index (e.g. a crash mid-write): recover the entries
      // from the snapshot files instead of losing the history. Best-effort —
      // never throws (version history must not block a save).
      return this.rebuildIndexFromSnapshots(filePath);
    }
  }

  /**
   * BUG-049: reconstruct the version index from the snapshot files in
   * `.versions/<relpath>/` when `index.json` is missing or corrupt. Each
   * snapshot's id/name is the file itself and its timestamp is parsed back from
   * the filename; size is unknown (no stat) so it's reported as 0. Best-effort:
   * returns empty if the directory can't be listed (e.g. none exists yet).
   */
  private async rebuildIndexFromSnapshots(filePath: string): Promise<VersionIndex> {
    try {
      const dir = this.versionDir(filePath);
      const names = (await this.fs.list(dir))
        .map((e) => e.name)
        .filter((n) => n !== INDEX_FILE && !n.startsWith('.'));
      const entries: BinaryVersionEntry[] = names
        .map((snapshotFile) => ({
          id: snapshotFile,
          timestamp: fileStampToTimestamp(snapshotFile),
          snapshotFile,
          size: 0, // unknown after a rebuild (no stat) — not needed to restore
          author: 'user' as VersionAuthor,
        }))
        // Newest first — the timestamp-prefixed filename sorts chronologically.
        .sort((a, b) => b.snapshotFile.localeCompare(a.snapshotFile));
      return { v: 1, entries };
    } catch {
      return { v: 1, entries: [] };
    }
  }

  private async writeIndex(filePath: string, index: VersionIndex): Promise<void> {
    await this.fs.writeFile(this.indexPath(filePath), JSON.stringify(index, null, 2));
  }

  /**
   * List versions for a file, newest first.
   */
  async listVersions(filePath: string): Promise<BinaryVersionEntry[]> {
    const index = await this.readIndex(filePath);
    return index.entries;
  }

  /**
   * Snapshot the CURRENT bytes of `filePath` into `.versions/`. Reads the live
   * file from disk (binary-safe), writes a timestamped copy, records metadata,
   * and prunes the oldest beyond the cap.
   *
   * Returns the new entry, or null if there was nothing to snapshot (file is
   * missing) — callers treat that as a no-op.
   */
  async saveVersion(
    filePath: string,
    options: SaveVersionOptions = {},
  ): Promise<BinaryVersionEntry | null> {
    if (!(await this.fs.exists(filePath))) return null;

    const bytes = await this.fs.readFileBinary(filePath);
    return this.saveVersionFromBytes(filePath, bytes, options);
  }

  /**
   * Snapshot EXPLICIT bytes for `filePath` (used when the caller already holds
   * the just-saved bytes and wants to avoid a re-read). Same metadata + pruning
   * behavior as `saveVersion`.
   */
  async saveVersionFromBytes(
    filePath: string,
    bytes: ArrayBuffer,
    options: SaveVersionOptions = {},
  ): Promise<BinaryVersionEntry> {
    const iso = new Date().toISOString();
    const ext = extensionOf(filePath);
    const stamp = timestampToFileStamp(iso);
    // A short random suffix guarantees a unique file name even for multiple
    // saves within the same millisecond (timestamp alone would collide and
    // overwrite a prior snapshot).
    const suffix = Math.random().toString(36).slice(2, 7);
    const base = `${stamp}__${suffix}`;
    const snapshotFile = ext ? `${base}.${ext}` : base;

    // Write the snapshot bytes first; only record it in the index once on disk.
    await this.fs.writeFileBinary(this.snapshotPath(filePath, snapshotFile), bytes);

    const entry: BinaryVersionEntry = {
      id: snapshotFile,
      timestamp: iso,
      snapshotFile,
      size: bytes.byteLength,
      author: options.author ?? 'user',
      ...(options.message !== undefined ? { message: options.message } : {}),
    };

    // BUG-049: the index is a read-modify-write, so two snapshots of the SAME
    // file racing would each read the old index and the later write would drop
    // the other's entry. Serialize the whole read-modify-write per index path
    // through the write coordinator so concurrent saves can't lose entries.
    await writeCoordinator.enqueue(this.indexPath(filePath), versionIndexRev(), async () => {
      const index = await this.readIndex(filePath);
      // De-dup by snapshotFile before inserting: the snapshot bytes are written
      // to disk BEFORE this index update, so if readIndex had to REBUILD from
      // disk (corrupt/missing index, BUG-049a) it already lists this snapshot as
      // a placeholder — drop it and insert the accurate entry instead of duping.
      index.entries = index.entries.filter((e) => e.snapshotFile !== entry.snapshotFile);
      index.entries.unshift(entry);

      // Prune oldest beyond the cap — delete both the file and the index entry.
      if (index.entries.length > this.maxVersions) {
        const pruned = index.entries.slice(this.maxVersions);
        index.entries = index.entries.slice(0, this.maxVersions);
        for (const old of pruned) {
          try {
            await this.fs.delete(this.snapshotPath(filePath, old.snapshotFile));
          } catch {
            // A missing snapshot file is fine; keep pruning the index.
          }
        }
      }

      await this.writeIndex(filePath, index);
    });
    return entry;
  }

  /**
   * The ABSOLUTE on-disk path of a snapshot file (e.g.
   * `<root>/.versions/docs/Contract.docx/2026-...docx`), or the workspace-
   * relative path when the root is unknown. The engine (`docx_open`) needs an
   * absolute path, so this prefixes the workspace root when available. Throws if
   * the version id is unknown.
   */
  async snapshotAbsolutePath(
    filePath: string,
    versionId: string,
  ): Promise<string> {
    const index = await this.readIndex(filePath);
    const entry = index.entries.find((e) => e.id === versionId);
    if (!entry) throw new Error(`Version not found: ${versionId}`);
    const rel = this.snapshotPath(filePath, entry.snapshotFile);
    const root = this.fs.getRootPath();
    if (!root) return rel;
    const normRoot = root.replace(/\\/g, '/').replace(/\/+$/, '');
    return `${normRoot}/${rel}`;
  }

  /** Read a snapshot's raw bytes (for restore or binary diff). */
  async readSnapshotBytes(
    filePath: string,
    versionId: string,
  ): Promise<ArrayBuffer> {
    const index = await this.readIndex(filePath);
    const entry = index.entries.find((e) => e.id === versionId);
    if (!entry) {
      throw new Error(`Version not found: ${versionId}`);
    }
    return this.fs.readFileBinary(this.snapshotPath(filePath, entry.snapshotFile));
  }

  /**
   * Restore a snapshot over the current file. Before overwriting we snapshot the
   * CURRENT bytes (so the pre-restore state is never lost), then copy the chosen
   * snapshot back onto `filePath`. Returns the restored bytes so the caller can
   * reload the editor.
   */
  async restoreVersion(
    filePath: string,
    versionId: string,
  ): Promise<ArrayBuffer> {
    const snapshotBytes = await this.readSnapshotBytes(filePath, versionId);

    // Safety net: capture the current state as a new version first, so a restore
    // is itself reversible (nothing is lost).
    await this.saveVersion(filePath, {
      author: 'user',
      message: 'Before restore',
    });

    // Copy the chosen snapshot back over the live file.
    await this.fs.writeFileBinary(filePath, snapshotBytes);

    // Record the restore itself as the newest version.
    await this.saveVersionFromBytes(filePath, snapshotBytes, {
      author: 'user',
      message: 'Restored from version history',
    });

    return snapshotBytes;
  }

  /** Number of versions retained for a file. */
  async getVersionCount(filePath: string): Promise<number> {
    return (await this.readIndex(filePath)).entries.length;
  }

  /** Delete every version for a file (snapshots + index). Best-effort. */
  async clearVersions(filePath: string): Promise<void> {
    const index = await this.readIndex(filePath);
    for (const e of index.entries) {
      try {
        await this.fs.delete(this.snapshotPath(filePath, e.snapshotFile));
      } catch {
        /* ignore */
      }
    }
    try {
      await this.fs.delete(this.indexPath(filePath));
    } catch {
      /* ignore */
    }
  }
}
