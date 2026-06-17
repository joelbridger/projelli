// Trash Service
// Manages soft-deleted files with restore capability

import type { FileNode } from '@/types/workspace';

export interface TrashedItem {
  /** Unique ID for the trash entry */
  id: string;
  /** Original file/folder path before deletion */
  originalPath: string;
  /** Path in trash folder */
  trashPath: string;
  /** Name of the file/folder */
  name: string;
  /** Type: file or folder */
  type: 'file' | 'folder';
  /** When the item was deleted */
  deletedAt: Date;
  /** Size in bytes (for files) */
  size?: number;
}

export interface TrashStats {
  /** Number of items in trash */
  itemCount: number;
  /** Total size of all items */
  totalSize: number;
  /** Oldest item date */
  oldestItem: Date | undefined;
}

export interface FileOps {
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
  delete(path: string): Promise<void>;
  move(from: string, to: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  mkdir(path: string): Promise<void>;
  list(path: string): Promise<FileNode[]>;
  stat(path: string): Promise<{ type: 'file' | 'folder'; size: number }>;
}

const TRASH_FOLDER = '.trash';
const TRASH_MANIFEST = '.trash/manifest.json';
const AUTO_CLEANUP_DAYS = 30;

/**
 * TrashService manages soft-deleted files
 */
export class TrashService {
  private items: Map<string, TrashedItem> = new Map();

  constructor(
    private readonly fileOps: FileOps,
    private readonly workspaceRoot: string
  ) {}

  /**
   * Initialize trash folder and load manifest
   */
  async initialize(): Promise<void> {
    const trashPath = this.getTrashPath();
    const exists = await this.fileOps.exists(trashPath);

    if (!exists) {
      await this.fileOps.mkdir(trashPath);
    }

    await this.loadManifest();
  }

  /**
   * Get the trash folder path
   */
  private getTrashPath(): string {
    return `${this.workspaceRoot}/${TRASH_FOLDER}`;
  }

  /**
   * Get the manifest file path
   */
  private getManifestPath(): string {
    return `${this.workspaceRoot}/${TRASH_MANIFEST}`;
  }

  /**
   * Load trash manifest from disk
   */
  private async loadManifest(): Promise<void> {
    try {
      const content = await this.fileOps.read(this.getManifestPath());
      const data = JSON.parse(content) as TrashedItem[];

      this.items.clear();
      for (const item of data) {
        // Convert date strings back to Date objects
        item.deletedAt = new Date(item.deletedAt);
        this.items.set(item.id, item);
      }
    } catch {
      // Manifest doesn't exist yet, start fresh
      this.items.clear();
    }
  }

  /**
   * Save trash manifest to disk
   */
  private async saveManifest(): Promise<void> {
    const data = Array.from(this.items.values());
    await this.fileOps.write(this.getManifestPath(), JSON.stringify(data, null, 2));
  }

  /**
   * Generate a unique trash ID
   */
  private generateId(): string {
    return `trash_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
  }

  /**
   * Move a file or folder to trash
   * @returns The trash entry
   */
  async moveToTrash(originalPath: string): Promise<TrashedItem> {
    const id = this.generateId();
    const name = originalPath.split('/').pop() ?? 'unknown';

    // Get file stats
    const stat = await this.fileOps.stat(originalPath);

    // Create unique trash path with timestamp
    const timestamp = Date.now();
    const trashName = `${timestamp}_${name}`;
    const trashPath = `${this.getTrashPath()}/${trashName}`;

    // Move to trash
    await this.fileOps.move(originalPath, trashPath);

    const item: TrashedItem = {
      id,
      originalPath,
      trashPath,
      name,
      type: stat.type,
      deletedAt: new Date(),
      size: stat.size,
    };

    this.items.set(id, item);
    await this.saveManifest();

    return item;
  }

  /**
   * Restore a trashed item to its original location
   */
  async restore(id: string): Promise<string> {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Trash item not found: ${id}`);
    }

    // Check if original location exists
    let targetPath = item.originalPath;
    const parentPath = targetPath.split('/').slice(0, -1).join('/');

    // Ensure parent directory exists
    if (parentPath) {
      const parentExists = await this.fileOps.exists(parentPath);
      if (!parentExists) {
        await this.fileOps.mkdir(parentPath);
      }
    }

    // If original path exists, create a unique name
    const exists = await this.fileOps.exists(targetPath);
    if (exists) {
      const ext = item.name.includes('.') ? item.name.split('.').pop() : '';
      const baseName = ext ? item.name.slice(0, -(ext.length + 1)) : item.name;
      const timestamp = Date.now();
      targetPath = ext
        ? `${parentPath}/${baseName}_restored_${timestamp}.${ext}`
        : `${parentPath}/${baseName}_restored_${timestamp}`;
    }

    // Move back from trash
    await this.fileOps.move(item.trashPath, targetPath);

    // Remove from manifest
    this.items.delete(id);
    await this.saveManifest();

    return targetPath;
  }

  /**
   * Permanently delete a trashed item
   */
  async permanentDelete(id: string): Promise<void> {
    const item = this.items.get(id);
    if (!item) {
      throw new Error(`Trash item not found: ${id}`);
    }

    // Delete from disk
    await this.fileOps.delete(item.trashPath);

    // Remove from manifest
    this.items.delete(id);
    await this.saveManifest();
  }

  /**
   * Empty the entire trash
   */
  async emptyTrash(): Promise<number> {
    const count = this.items.size;

    for (const item of this.items.values()) {
      try {
        await this.fileOps.delete(item.trashPath);
      } catch {
        // Ignore errors for individual deletions
      }
    }

    this.items.clear();
    await this.saveManifest();

    return count;
  }

  /**
   * Cleanup old items (older than AUTO_CLEANUP_DAYS)
   */
  async autoCleanup(): Promise<number> {
    const cutoff = new Date();
    cutoff.setDate(cutoff.getDate() - AUTO_CLEANUP_DAYS);

    const toDelete: string[] = [];

    for (const [id, item] of this.items) {
      if (item.deletedAt < cutoff) {
        toDelete.push(id);
      }
    }

    for (const id of toDelete) {
      try {
        await this.permanentDelete(id);
      } catch {
        // Ignore errors for individual deletions
      }
    }

    return toDelete.length;
  }

  /**
   * Get all trashed items
   */
  list(): TrashedItem[] {
    return Array.from(this.items.values()).sort(
      (a, b) => b.deletedAt.getTime() - a.deletedAt.getTime()
    );
  }

  /**
   * Get a specific trashed item
   */
  get(id: string): TrashedItem | undefined {
    return this.items.get(id);
  }

  /**
   * Get trash statistics
   */
  getStats(): TrashStats {
    const items = this.list();
    let totalSize = 0;
    let oldestItem: Date | undefined;

    for (const item of items) {
      totalSize += item.size ?? 0;
      if (!oldestItem || item.deletedAt < oldestItem) {
        oldestItem = item.deletedAt;
      }
    }

    return {
      itemCount: items.length,
      totalSize,
      oldestItem,
    };
  }

  /**
   * Check if an item is in trash by original path
   */
  isInTrash(originalPath: string): boolean {
    for (const item of this.items.values()) {
      if (item.originalPath === originalPath) {
        return true;
      }
    }
    return false;
  }

  /**
   * Find a trashed item by original path
   */
  findByOriginalPath(originalPath: string): TrashedItem | undefined {
    for (const item of this.items.values()) {
      if (item.originalPath === originalPath) {
        return item;
      }
    }
    return undefined;
  }
}

/**
 * Create a trash service instance
 */
export function createTrashService(
  fileOps: FileOps,
  workspaceRoot: string
): TrashService {
  return new TrashService(fileOps, workspaceRoot);
}
