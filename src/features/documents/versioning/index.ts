// Versioning Module Exports
export { VersionHistoryPanel } from './VersionHistoryPanel';
export { BinaryVersionHistoryPanel } from './BinaryVersionHistoryPanel';
export { VersionService } from './VersionService';
export type { FileVersion, VersionMetadata } from './VersionService';

// WS-A / A5: on-disk, binary-safe version history (works for .docx + text).
export {
  BinaryVersionService,
  toWorkspaceRelative,
} from './BinaryVersionService';
export type {
  BinaryVersionEntry,
  VersionAuthor,
  VersionFS,
  SaveVersionOptions,
} from './BinaryVersionService';

import { BinaryVersionService, type VersionFS } from './BinaryVersionService';

// A process-wide BinaryVersionService bound to the live workspace FS. We rebind
// when the workspace (root) changes so snapshots always land under the right
// `.versions/` area. Callers fetch via `getBinaryVersionService(fs)`.
let instance: BinaryVersionService | null = null;
let boundFs: VersionFS | null = null;

/**
 * Get the shared BinaryVersionService bound to `fs`. Rebinds if a different FS
 * (e.g. after a workspace switch) is passed. Returns null if `fs` is null.
 */
export function getBinaryVersionService(
  fs: VersionFS | null,
): BinaryVersionService | null {
  if (!fs) return null;
  if (!instance || boundFs !== fs) {
    instance = new BinaryVersionService(fs);
    boundFs = fs;
  }
  return instance;
}

/** Test seam: reset the shared instance. */
export function __resetBinaryVersionService(): void {
  instance = null;
  boundFs = null;
}
