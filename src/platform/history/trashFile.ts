/**
 * Move a file/folder into the workspace `.trash` and record it in the SAME
 * on-disk metadata the Trash panel reads (`.trash/metadata.json`). Used by the
 * AI's `delete_file` chat tool so an AI-deleted file is GENUINELY recoverable
 * (and the "moved to Trash" message + audit entry are honest) — previously the
 * AI hard-deleted via the backend while claiming the file went to Trash.
 *
 * The metadata is updated by read-modify-write of the file directly, so this is
 * independent of the UI's React trash state. The Trash panel's loader filters
 * out any entry whose trash file is gone, so a stale entry (e.g. after a
 * restore) self-heals on the next load.
 */
import type { TrashedItem } from '@/platform/history/TrashService';
import { workspacePath } from '@/platform/fs/appPath';

const TRASH_FOLDER = '.trash';
const TRASH_METADATA_FILE = '.trash/metadata.json';

/** The minimal filesystem surface moveToTrash needs (a subset of WorkspaceService). */
export interface TrashFs {
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  stat(path: string): Promise<{ type: 'file' | 'folder'; size: number }>;
  readFile(path: string): Promise<string>;
  writeFile(path: string, content: string): Promise<void>;
}

/** Serialized form of a trash entry on disk (Date → ISO string). */
interface SerializedTrashItem extends Omit<TrashedItem, 'deletedAt'> {
  deletedAt: string;
}

/**
 * Move `absPath` into `<rootPath>/.trash` (recoverable) and prepend an entry to
 * the shared trash metadata. `now`/`id` are injected so the operation is
 * deterministic + testable (the caller stamps Date.now() + a unique id).
 * Returns the created entry (including its `trashPath`) for restore/undo wiring.
 */
export async function moveToTrash(
  fs: TrashFs,
  rootPath: string,
  absPath: string,
  opts: { now: number; id: string },
): Promise<TrashedItem> {
  const name = absPath.split('/').pop() ?? 'unknown';
  const stat = await fs.stat(absPath);

  const trashFolder = workspacePath(rootPath, TRASH_FOLDER);
  if (!(await fs.exists(trashFolder))) {
    await fs.mkdir(trashFolder);
  }

  // Build a COLLISION-PROOF trash path: the unique id makes a same-millisecond
  // same-name clash effectively impossible, and the loop guarantees we NEVER
  // overwrite another already-trashed file (which would be silent data loss).
  let trashPath = `${trashFolder}/${String(opts.now)}_${opts.id}_${name}`;
  for (let dedupe = 1; await fs.exists(trashPath); dedupe += 1) {
    trashPath = `${trashFolder}/${String(opts.now)}_${opts.id}_${String(dedupe)}_${name}`;
  }

  const item: TrashedItem = {
    id: opts.id,
    originalPath: absPath,
    trashPath,
    name,
    type: stat.type,
    deletedAt: new Date(opts.now),
    size: stat.size,
  };

  // Record in metadata FIRST, then move. If the move later fails, the original
  // file is untouched and the dangling metadata entry self-filters (the loader
  // drops entries whose trashPath doesn't exist) — never a lost-but-hidden file.
  // Read-modify-write the metadata (newest first), tolerating a missing/corrupt
  // file by starting fresh.
  const metadataPath = workspacePath(rootPath, TRASH_METADATA_FILE);
  let existing: SerializedTrashItem[] = [];
  if (await fs.exists(metadataPath)) {
    try {
      const parsed = JSON.parse(await fs.readFile(metadataPath)) as unknown;
      if (Array.isArray(parsed)) existing = parsed as SerializedTrashItem[];
    } catch {
      existing = [];
    }
  }
  const serialized: SerializedTrashItem = { ...item, deletedAt: item.deletedAt.toISOString() };
  await fs.writeFile(metadataPath, JSON.stringify([serialized, ...existing], null, 2));

  await fs.move(absPath, trashPath);

  return item;
}
