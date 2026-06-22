/**
 * Helpers for writing dropped/uploaded files into the workspace (UX-19).
 *
 * Consolidated so the global-drop handler in App.tsx and any future
 * per-component drop sites (paste-into-editor etc.) share the same
 * duplicate-name rules and binary/text routing.
 */

import { isBinaryFile } from '@/platform/utils/file-utils';

/**
 * Minimal surface of the workspace service we depend on here. We declare
 * our own rather than importing the whole type because the type is big and
 * this helper only needs four methods. Also keeps the unit test easy to
 * fake.
 */
export interface WorkspaceWriter {
  exists(path: string): Promise<boolean>;
  writeFile(path: string, content: string): Promise<void>;
  writeFileBinary(path: string, content: ArrayBuffer): Promise<void>;
}

/**
 * Pick a non-colliding path inside `targetFolder` for `filename`. If
 * `foo.png` already exists, return `foo (1).png`. If `foo (1).png` also
 * exists, try `foo (2).png`, and so on. Caps at 99 to avoid an unbounded
 * loop when someone manages to create a truly unreasonable number of
 * duplicates.
 */
export async function resolveUniqueName(
  service: Pick<WorkspaceWriter, 'exists'>,
  targetFolder: string,
  filename: string
): Promise<string> {
  const dot = filename.lastIndexOf('.');
  const base = dot > 0 ? filename.slice(0, dot) : filename;
  const ext = dot > 0 ? filename.slice(dot) : '';

  // Start with the original name.
  let candidate = `${targetFolder}/${filename}`;
  if (!(await service.exists(candidate))) return filename;

  for (let i = 1; i <= 99; i += 1) {
    const next = `${base} (${i})${ext}`;
    candidate = `${targetFolder}/${next}`;
    // eslint-disable-next-line no-await-in-loop -- sequential exists checks
    if (!(await service.exists(candidate))) return next;
  }
  // Fallback: timestamp suffix. Guarantees uniqueness even at the limit.
  return `${base} (${Date.now()})${ext}`;
}

export interface DroppedFileResult {
  path: string;
  name: string;
  wasRenamed: boolean;
}

export interface WriteDroppedFilesOptions {
  service: WorkspaceWriter;
  targetFolder: string;
  files: File[];
}

/**
 * Copy a set of dropped File objects into the workspace. Binary files go
 * through writeFileBinary (ArrayBuffer preserves bytes exactly); text
 * files go through writeFile. Returns one record per file actually
 * written so the caller can open them in tabs.
 */
/**
 * UX-28: MIME identifier used to carry raw AI chat message content through
 * the DOM drag-and-drop DataTransfer pipe. Export so consumers don't have
 * to type the literal everywhere.
 */
export const AI_MESSAGE_MIME = 'application/x-keepance-chat-message';

/**
 * UX-28: Derive a reasonable filename from arbitrary AI chat content.
 *
 * Preference order:
 *   1. A leading Markdown heading (# / ## / ###)
 *   2. The first non-empty line, clipped to ~60 chars
 *   3. The literal word "chat-message"
 *
 * The result is lowercased, kebab-cased, and trimmed to 60 chars of slug
 * before the `.md` extension is appended. Non-ASCII alphanumerics are
 * stripped; runs of separators collapse to one hyphen. Always ends in
 * `.md`.
 */
export function deriveFilenameFromMessage(content: string): string {
  const lines = content.split('\n');
  let seed: string | null = null;

  for (const line of lines) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    // Heading?
    const headingMatch = trimmed.match(/^#{1,6}\s+(.+)$/);
    if (headingMatch) {
      seed = headingMatch[1] ?? null;
      break;
    }
    // Otherwise use the first non-empty line.
    seed = trimmed.slice(0, 60);
    break;
  }

  const fallback = 'chat-message';
  const base = (seed ?? fallback)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 60)
    || fallback;
  return `${base}.md`;
}

/** Basename of a path, tolerant of both `/` and `\` separators (native
 *  pickers return OS-native paths — Windows uses backslashes). */
function baseName(p: string): string {
  const parts = p.split(/[\\/]/);
  return parts[parts.length - 1] ?? p;
}

export interface ImportedFileResult {
  /** Destination path inside the workspace. */
  path: string;
  /** Final (possibly de-duplicated) file name. */
  name: string;
  /** Whether the file was indexed for search. */
  indexed: boolean;
  /** Why indexing didn't happen (e.g. a scanned PDF with OCR off). */
  reason?: string;
  /** Set when the copy itself failed (the file was skipped). */
  error?: string;
}

export interface ImportPickedFilesOptions {
  service: WorkspaceWriter;
  /** Folder inside the workspace to import into. */
  targetFolder: string;
  /** Absolute source paths chosen in the native picker. */
  paths: string[];
  /** Reads the bytes of a SOURCE path (Tauri fs in the app; a fake in tests). */
  readBytes: (sourcePath: string) => Promise<ArrayBuffer>;
  /** Index a non-PDF file already written into the workspace. */
  indexFile: (path: string) => Promise<void>;
  /** Index a PDF written into the workspace; returns whether it indexed + why not. */
  indexPdf: (path: string) => Promise<{ indexed: boolean; reason?: string }>;
}

/**
 * BUG-014 — bring existing files (chosen via the native "Add files" picker)
 * INTO the workspace and index them. Mirrors `writeDroppedFiles`' dedup rules,
 * but works from source PATHS (the picker gives paths, not File objects) and —
 * crucially — EXPLICITLY indexes each file rather than relying on the
 * file-watcher (which can miss writes). Per-file failures are recorded, not
 * thrown, so one bad file doesn't abort the batch.
 */
export async function importPickedFiles({
  service,
  targetFolder,
  paths,
  readBytes,
  indexFile,
  indexPdf,
}: ImportPickedFilesOptions): Promise<ImportedFileResult[]> {
  const results: ImportedFileResult[] = [];
  for (const sourcePath of paths) {
    const name = baseName(sourcePath);
    // eslint-disable-next-line no-await-in-loop -- sequential dedup + IO
    const finalName = await resolveUniqueName(service, targetFolder, name);
    const dest = `${targetFolder}/${finalName}`;
    try {
      const bytes = await readBytes(sourcePath);
      await service.writeFileBinary(dest, bytes);
    } catch (err) {
      results.push({
        path: dest,
        name: finalName,
        indexed: false,
        error: err instanceof Error ? err.message : String(err),
      });
      continue;
    }
    // Index explicitly so search works without depending on the watcher.
    try {
      if (finalName.toLowerCase().endsWith('.pdf')) {
        const r = await indexPdf(dest);
        results.push({ path: dest, name: finalName, indexed: r.indexed, ...(r.reason ? { reason: r.reason } : {}) });
      } else {
        await indexFile(dest);
        results.push({ path: dest, name: finalName, indexed: true });
      }
    } catch (err) {
      // The file IS imported; only indexing failed. Surface it, don't lose the file.
      results.push({
        path: dest,
        name: finalName,
        indexed: false,
        reason: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return results;
}

export async function writeDroppedFiles({
  service,
  targetFolder,
  files,
}: WriteDroppedFilesOptions): Promise<DroppedFileResult[]> {
  const results: DroppedFileResult[] = [];
  for (const file of files) {
    // eslint-disable-next-line no-await-in-loop -- resolveUniqueName awaits
    const finalName = await resolveUniqueName(service, targetFolder, file.name);
    const wasRenamed = finalName !== file.name;
    const path = `${targetFolder}/${finalName}`;
    try {
      if (isBinaryFile(finalName) || isBinaryFile(file.name)) {
        const buffer = await file.arrayBuffer();
        await service.writeFileBinary(path, buffer);
      } else {
        const content = await file.text();
        await service.writeFile(path, content);
      }
      results.push({ path, name: finalName, wasRenamed });
    } catch (err) {
      // Skip the one that failed; keep going with the rest.
      console.error('[fileDrop] Failed to write', file.name, err);
    }
  }
  return results;
}
