// Install primitives for the marketplace pipeline.
//
// These are the low-level building blocks (download, checksum, extract, cleanup)
// used by `MarketplaceService.install()` in Group III. They are deliberately
// tiny, single-responsibility, and side-effect-only on the FS / Tauri layer
// so they can be unit-tested independently with mocked fetch + mocked invoke.
//
// Composition order in the install pipeline:
//   1. downloadTarball(url, tmp, fs)           → tarball on disk
//   2. verifyChecksum(tmp, expectedSha256)     → throw if mismatch
//   3. extractTarball(tmp, installDir)         → file list
//   4. (manifest validation, audit, etc.)
//   5. cleanupOnError([tmp]) on any failure    → rollback
//
// All errors are surfaced as thrown Error instances with prefixed messages
// so the orchestration layer can attribute failure to the right phase.

import { invoke } from '@tauri-apps/api/core';
import type { FSBackend } from '@/modules/workspace/types';

export interface DownloadProgress {
  /** Bytes downloaded so far. */
  loaded: number;
  /** Total bytes expected, or null when Content-Length is absent. */
  total: number | null;
  /** Fraction in [0, 1], or null when total is unknown. */
  fraction: number | null;
}

export interface DownloadTarballOptions {
  signal?: AbortSignal;
  onProgress?: (progress: DownloadProgress) => void;
}

/**
 * Stream `url` to `destPath` via the provided FSBackend. Writes to a temp
 * sibling file first, then moves into place on success so a partially
 * downloaded file never appears at `destPath`. Honors `AbortSignal` and
 * cleans up the temp file when aborted or on transport errors.
 */
export async function downloadTarball(
  url: string,
  destPath: string,
  fs: FSBackend,
  opts: DownloadTarballOptions = {},
): Promise<void> {
  const { signal, onProgress } = opts;
  const tempPath = `${destPath}.partial`;

  let response: Response;
  try {
    response = await fetch(url, signal ? { signal } : {});
  } catch (err) {
    throw new Error(`download failed: ${(err as Error).message}`);
  }

  if (!response.ok) {
    throw new Error(`download failed: HTTP ${response.status}`);
  }
  if (!response.body) {
    throw new Error('download failed: response has no body');
  }

  const contentLengthHeader = response.headers.get('content-length');
  const total = contentLengthHeader ? parseInt(contentLengthHeader, 10) : NaN;
  const knownTotal = Number.isFinite(total) && total > 0 ? total : null;

  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let loaded = 0;

  try {
    // Stream chunks. We accumulate in memory then write once at the end via
    // FSBackend.writeBinary, because FSBackend has no append primitive.
    // Tarballs in the catalog are bounded (a few MB at most), so the
    // memory cost is acceptable.
    // eslint-disable-next-line no-constant-condition
    while (true) {
      if (signal?.aborted) {
        throw new DOMException('Aborted', 'AbortError');
      }
      const { done, value } = await reader.read();
      if (done) break;
      if (value) {
        chunks.push(value);
        loaded += value.byteLength;
        if (onProgress) {
          onProgress({
            loaded,
            total: knownTotal,
            fraction: knownTotal !== null ? loaded / knownTotal : null,
          });
        }
      }
    }
  } catch (err) {
    try {
      reader.releaseLock();
    } catch {
      // already released, ignore
    }
    await safeDelete(fs, tempPath);
    if ((err as Error).name === 'AbortError') {
      throw err;
    }
    throw new Error(`download failed: ${(err as Error).message}`);
  }

  // Concatenate chunks into a single ArrayBuffer for writeBinary.
  const buffer = concatChunks(chunks, loaded);

  try {
    await fs.writeBinary(tempPath, buffer);
    await fs.move(tempPath, destPath);
  } catch (err) {
    await safeDelete(fs, tempPath);
    throw new Error(`download failed: ${(err as Error).message}`);
  }
}

function concatChunks(chunks: Uint8Array[], total: number): ArrayBuffer {
  const out = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    out.set(chunk, offset);
    offset += chunk.byteLength;
  }
  // Slice to a fresh ArrayBuffer (handles typed-array views into shared buffers).
  return out.buffer.slice(out.byteOffset, out.byteOffset + out.byteLength);
}

async function safeDelete(fs: FSBackend, path: string): Promise<void> {
  try {
    await fs.delete(path);
  } catch {
    // Already gone, or never created. Either way nothing to do.
  }
}

/**
 * Compute SHA-256 of the file at `filePath` via Tauri and compare against the
 * expected hex digest. Comparison is case-insensitive. Returns true on match,
 * false on mismatch. Throws if the Tauri command itself fails.
 */
export async function verifyChecksum(
  filePath: string,
  expectedSha256: string,
): Promise<boolean> {
  const actual = await invoke<string>('sha256_file', { path: filePath });
  return actual.trim().toLowerCase() === expectedSha256.trim().toLowerCase();
}

/**
 * Extract the gzipped tarball at `tarballPath` into `destPath` via the Tauri
 * command, which enforces path-traversal hardening on the Rust side. Returns
 * the list of extracted file paths (relative to `destPath`).
 */
export async function extractTarball(
  tarballPath: string,
  destPath: string,
): Promise<string[]> {
  return invoke<string[]>('extract_tarball', { tarballPath, destPath });
}

/**
 * Best-effort cleanup of the given paths after a failed install. Each delete
 * is attempted independently; missing or already-deleted paths are not
 * errors. Used by the orchestration layer for rollback.
 */
export async function cleanupOnError(
  fs: FSBackend,
  tempPaths: string[],
): Promise<void> {
  for (const path of tempPaths) {
    await safeDelete(fs, path);
  }
}
