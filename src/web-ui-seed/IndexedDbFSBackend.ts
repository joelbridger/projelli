/**
 * web-ui-seed — IndexedDB-backed FSBackend.
 *
 * WHY THIS EXISTS: WebFSBackend (OPFS / File System Access API) requires a
 * "secure context" — https, or http://localhost specifically. Jameson reviews
 * this build over plain http on a Tailscale IP (http://100.68.20.52:5273),
 * which is NOT localhost, so `navigator.storage.getDirectory()` and
 * `showDirectoryPicker()` are both unavailable there and the normal
 * OPFS-backed auto-open silently can't get a directory handle. IndexedDB has
 * no such restriction — it works over plain http on any host — so the
 * web-ui-seed dev bootstrap uses THIS backend instead of OPFS.
 *
 * A flat key-value store: one IndexedDB object store (`entries`), keyed by
 * the path relative to the workspace root ('' = root itself). Each entry
 * records its own type (file/folder) and, for files, its content — so
 * directories are real entries too (mkdir persists something to list()
 * later), not inferred from file paths.
 *
 * Implements the full FSBackend contract so it's a drop-in for
 * WorkspaceService/WebFSBackend call sites — nothing outside web-ui-seed
 * needs to know which backend is in use.
 *
 * Dev-only: imported only from WebUiSeedBootstrap.ts, itself reached only
 * behind `import.meta.env.DEV`.
 */
import type { FileNode } from '@/platform/types/workspace';
import type { FSBackend, FileOperation, FileStat, SetRootPathOptions } from '@/platform/fs/types';
import { FileOperationError } from '@/platform/fs/types';

interface StoredEntry {
  /** Key: path segments joined by '/', relative to the workspace root. '' = root. */
  path: string;
  name: string;
  type: 'file' | 'folder';
  /** Files only. Binary is stored as ArrayBuffer; write() stores a string. */
  content?: string | ArrayBuffer;
  size: number;
  modifiedAt: number;
  createdAt: number;
}

const DB_NAME = 'lantern-web-ui-seed-fs';
const DB_VERSION = 1;
const STORE_NAME = 'entries';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE_NAME)) {
        db.createObjectStore(STORE_NAME, { keyPath: 'path' });
      }
    };
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error('Failed to open IndexedDB')); };
  });
}

function requestToPromise<T>(req: IDBRequest<T>): Promise<T> {
  return new Promise((resolve, reject) => {
    req.onsuccess = () => { resolve(req.result); };
    req.onerror = () => { reject(req.error ?? new Error('IndexedDB request failed')); };
  });
}

export class IndexedDbFSBackend implements FSBackend {
  private rootPath = '';
  private dbPromise: Promise<IDBDatabase> | null = null;

  private db(): Promise<IDBDatabase> {
    this.dbPromise ??= openDb();
    return this.dbPromise;
  }

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.db();
    return db.transaction(STORE_NAME, mode).objectStore(STORE_NAME);
  }

  getRootPath(): string {
    return this.rootPath;
  }

  async setRootPath(path: string, _options?: SetRootPathOptions): Promise<void> {
    this.rootPath = path;
    const store = await this.store('readwrite');
    const existing = await requestToPromise(store.get('') as IDBRequest<StoredEntry | undefined>);
    if (!existing) {
      const now = Date.now();
      const rootName = path.replace(/^\//, '') || 'workspace';
      await requestToPromise(
        store.put({ path: '', name: rootName, type: 'folder', size: 0, modifiedAt: now, createdAt: now } satisfies StoredEntry),
      );
    }
  }

  // ==================== Path helpers ====================

  private key(path: string): string {
    let relative = path;
    if (this.rootPath && relative.startsWith(this.rootPath)) relative = relative.slice(this.rootPath.length);
    const segments = relative.split('/').filter((s) => s.length > 0 && s !== '.');
    return segments.join('/');
  }

  private parentKey(key: string): string {
    const idx = key.lastIndexOf('/');
    return idx === -1 ? '' : key.slice(0, idx);
  }

  private nameOf(key: string): string {
    const idx = key.lastIndexOf('/');
    return idx === -1 ? key : key.slice(idx + 1);
  }

  private nodePath(key: string): string {
    const root = this.rootPath.endsWith('/') ? this.rootPath.slice(0, -1) : this.rootPath;
    return key === '' ? root : `${root}/${key}`;
  }

  private async getEntry(key: string): Promise<StoredEntry | undefined> {
    const store = await this.store('readonly');
    return requestToPromise(store.get(key) as IDBRequest<StoredEntry | undefined>);
  }

  private async putEntry(entry: StoredEntry): Promise<void> {
    const store = await this.store('readwrite');
    await requestToPromise(store.put(entry));
  }

  /** Ensure every ancestor of `key` exists as a folder entry (auto-mkdir -p). */
  private async ensureAncestors(key: string): Promise<void> {
    const segments = key.split('/').filter(Boolean);
    let current = '';
    for (const seg of segments.slice(0, -1)) {
      current = current ? `${current}/${seg}` : seg;
      const existing = await this.getEntry(current);
      if (!existing) {
        const now = Date.now();
        await this.putEntry({ path: current, name: seg, type: 'folder', size: 0, modifiedAt: now, createdAt: now });
      }
    }
  }

  // ==================== File operations ====================

  async read(path: string): Promise<string> {
    const entry = await this.requireFile(path, 'read');
    if (typeof entry.content === 'string') return entry.content;
    return new TextDecoder().decode(entry.content ?? new ArrayBuffer(0));
  }

  async readBinary(path: string): Promise<ArrayBuffer> {
    const entry = await this.requireFile(path, 'read');
    if (entry.content instanceof ArrayBuffer) return entry.content.slice(0);
    return new TextEncoder().encode(entry.content ?? '').buffer as ArrayBuffer;
  }

  async write(path: string, content: string): Promise<void> {
    const key = this.key(path);
    await this.ensureAncestors(key);
    const now = Date.now();
    const existing = await this.getEntry(key);
    await this.putEntry({
      path: key,
      name: this.nameOf(key),
      type: 'file',
      content,
      size: content.length,
      modifiedAt: now,
      createdAt: existing?.createdAt ?? now,
    });
  }

  async writeBinary(path: string, content: ArrayBuffer): Promise<void> {
    const key = this.key(path);
    await this.ensureAncestors(key);
    const now = Date.now();
    const existing = await this.getEntry(key);
    await this.putEntry({
      path: key,
      name: this.nameOf(key),
      type: 'file',
      content: content.slice(0),
      size: content.byteLength,
      modifiedAt: now,
      createdAt: existing?.createdAt ?? now,
    });
  }

  async exists(path: string): Promise<boolean> {
    return (await this.getEntry(this.key(path))) !== undefined;
  }

  async delete(path: string): Promise<void> {
    const key = this.key(path);
    if (key === '') throw new FileOperationError('Cannot delete workspace root', path, 'delete');
    const store = await this.store('readwrite');
    const all = await requestToPromise(store.getAllKeys()) as string[];
    const prefix = `${key}/`;
    for (const s of all) {
      if (s === key || s.startsWith(prefix)) await requestToPromise(store.delete(s));
    }
  }

  async move(from: string, to: string): Promise<void> {
    const stat = await this.stat(from);
    if (stat.type === 'file') {
      const content = await this.readBinary(from);
      await this.writeBinary(to, content);
    } else {
      await this.copy(from, to);
    }
    await this.delete(from);
  }

  async copy(from: string, to: string): Promise<void> {
    const stat = await this.stat(from);
    if (stat.type === 'file') {
      const content = await this.readBinary(from);
      await this.writeBinary(to, content);
    } else {
      await this.mkdir(to);
      const children = await this.list(from);
      for (const child of children) {
        await this.copy(child.path, `${to}/${child.name}`);
      }
    }
  }

  async rename(path: string, newName: string): Promise<void> {
    const key = this.key(path);
    if (key === '') throw new FileOperationError('Cannot rename workspace root', path, 'rename');
    const parent = this.parentKey(key);
    const newPath = this.nodePath(parent ? `${parent}/${newName}` : newName);
    await this.move(path, newPath);
  }

  async mkdir(path: string): Promise<void> {
    const key = this.key(path);
    if (key === '') return;
    await this.ensureAncestors(key);
    const existing = await this.getEntry(key);
    if (existing) return; // idempotent, mirrors WebFSBackend's mkdir-on-existing-dir tolerance
    const now = Date.now();
    await this.putEntry({ path: key, name: this.nameOf(key), type: 'folder', size: 0, modifiedAt: now, createdAt: now });
  }

  async list(path: string): Promise<FileNode[]> {
    const key = this.key(path);
    const store = await this.store('readonly');
    const all = await requestToPromise(store.getAll() as IDBRequest<StoredEntry[]>);
    const prefix = key === '' ? '' : `${key}/`;
    const nodes: FileNode[] = [];
    for (const entry of all) {
      if (entry.path === key) continue;
      if (!entry.path.startsWith(prefix)) continue;
      const rest = entry.path.slice(prefix.length);
      if (rest.includes('/')) continue; // only direct children
      const node: FileNode = {
        id: this.nodePath(entry.path),
        name: entry.name,
        path: this.nodePath(entry.path),
        type: entry.type,
      };
      if (entry.type === 'file') {
        node.size = entry.size;
        node.modifiedAt = new Date(entry.modifiedAt);
        const dotIndex = entry.name.lastIndexOf('.');
        if (dotIndex > 0) node.extension = entry.name.slice(dotIndex + 1).toLowerCase();
      }
      nodes.push(node);
    }
    return nodes;
  }

  async stat(path: string): Promise<FileStat> {
    const key = this.key(path);
    const entry = await this.getEntry(key);
    if (!entry) throw new FileOperationError(`Path not found: ${path}`, path, 'stat');
    return {
      path,
      name: entry.name,
      type: entry.type,
      size: entry.size,
      modifiedAt: new Date(entry.modifiedAt),
      createdAt: new Date(entry.createdAt),
      isSymlink: false,
    };
  }

  isSymlink(_path: string): Promise<boolean> {
    return Promise.resolve(false);
  }

  resolveSymlink(path: string): Promise<string> {
    return Promise.resolve(path);
  }

  /** Wipe every entry except the root — used before a version-bump reseed. */
  async clearAll(): Promise<void> {
    const store = await this.store('readwrite');
    const all = await requestToPromise(store.getAllKeys()) as string[];
    for (const k of all) {
      if (k !== '') await requestToPromise(store.delete(k));
    }
  }

  private async requireFile(path: string, op: FileOperation): Promise<StoredEntry> {
    const entry = await this.getEntry(this.key(path));
    if (!entry || entry.type !== 'file') {
      throw new FileOperationError(`File not found: ${path}`, path, op);
    }
    return entry;
  }
}

export function createIndexedDbFSBackend(): IndexedDbFSBackend {
  return new IndexedDbFSBackend();
}
