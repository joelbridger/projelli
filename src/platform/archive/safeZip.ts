// THE ARCHIVE CHOKEPOINT (renderer side).
//
// R-17 was filed as "the JSZip renderer paths lack the zip-bomb guard the
// native path has". Deriving the archive-reading set from ground truth showed
// the finding named the wrong boundary: JSZip is only two of the readers. The
// derived set also contains SheetJS (`XLSX.read` unzips an .xlsx), mammoth and
// docx-preview (both unzip a .docx internally). Those files never mention
// "zip", so a JSZip-shaped search reports GREEN over exactly the region it
// cannot see.
//
// The native reader `src-tauri/src/commands/rag/office.rs` already gets this
// right: entry-count cap, per-part cap, running total budget, and it never
// trusts the ZIP's own uncompressed-size headers for allocation. This module
// is the renderer's counterpart and uses the SAME numbers on purpose, so the
// two paths cannot drift into two different opinions about what is safe.
//
// TWO STRENGTHS, AND THE DIFFERENCE IS STATED NOT HIDDEN
// -----------------------------------------------------
//   readZipEntry / readGuardedZip  — FULL guard. We do the decompression, so
//       the byte budget is enforced against ACTUAL decompressed bytes as they
//       arrive. A lying header cannot buy anything.
//
//   assertArchiveWithinBudget      — PRE-FLIGHT guard, for bytes we are about
//       to hand to a third-party library that unzips internally (SheetJS,
//       mammoth, docx-preview). We can reject a declared bomb and an absurd
//       compression ratio before the library ever sees the bytes, but once it
//       has them the actual-bytes enforcement is theirs, not ours. This is
//       WEAKER and it is weaker for a structural reason, not an oversight.
//       The complete version is to move those extractions behind a reader we
//       drive (office.rs already does this natively for xlsx/pptx text).

import JSZip from 'jszip';

// ---------------------------------------------------------------------------
// Limits — deliberately identical to src-tauri/src/commands/rag/office.rs
// ---------------------------------------------------------------------------

/** Cap on any single entry's decompressed bytes. office.rs: MAX_PART_BYTES. */
export const MAX_ENTRY_BYTES = 64 * 1024 * 1024;
/** Running budget across every entry read from one archive. office.rs: MAX_TOTAL_PART_BYTES. */
export const MAX_TOTAL_BYTES = 256 * 1024 * 1024;
/** Cap on entries in one archive. office.rs: MAX_ENTRY_COUNT. */
export const MAX_ENTRY_COUNT = 10_000;
/**
 * Cap on the COMPRESSED input we will even open. A user picking a 2 GiB
 * "document" is not a case we need to serve, and JSZip holds the whole input
 * in memory before any entry is read.
 */
export const MAX_ARCHIVE_BYTES = 512 * 1024 * 1024;
/**
 * Highest declared expansion ratio we will accept in the pre-flight. Real
 * OOXML text parts compress well but not absurdly; 42 KiB of zeros per byte is
 * the classic bomb shape.
 */
export const MAX_DECLARED_RATIO = 200;

export class ArchiveBudgetError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'ArchiveBudgetError';
  }
}

function byteLength(bytes: ArrayBuffer | Uint8Array): number {
  return bytes instanceof Uint8Array ? bytes.byteLength : bytes.byteLength;
}

// ---------------------------------------------------------------------------
// Pre-flight — for bytes a third-party unzipper is about to receive
// ---------------------------------------------------------------------------

/**
 * Input-size cap only. For document formats that are NOT zips (legacy `.xls`
 * BIFF, `.rtf`) there is no central directory to inspect, so the honest guard
 * is the one that does not pretend otherwise: bound what we will read at all.
 *
 * @returns the input length, so callers can reuse it.
 * @throws ArchiveBudgetError
 */
export function assertInputBytesWithinCap(
  bytes: ArrayBuffer | Uint8Array,
  label = 'file',
): number {
  const size = byteLength(bytes);
  if (size === 0) {
    throw new ArchiveBudgetError(`${label}: empty file`);
  }
  if (size > MAX_ARCHIVE_BYTES) {
    throw new ArchiveBudgetError(
      `${label}: ${String(size)} bytes exceeds the ${String(MAX_ARCHIVE_BYTES)}-byte input cap`,
    );
  }
  return size;
}

/** True when the bytes start with a ZIP local-file-header / EOCD signature. */
export function looksLikeZip(bytes: ArrayBuffer | Uint8Array): boolean {
  const view = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes);
  return view.length >= 4 && view[0] === 0x50 && view[1] === 0x4b;
}

/**
 * Reject an archive that is a bomb on its own testimony, BEFORE handing the
 * bytes to a library that will unzip them out of our sight.
 *
 * The declared sizes come from the ZIP's central directory, which an attacker
 * controls. That makes them useless for ACCEPTING an archive and perfectly
 * good for REJECTING one: an archive that admits to 40 GiB is refused, and an
 * archive that lies downward still faces whatever the library does. We never
 * allocate against a declared size.
 *
 * @throws ArchiveBudgetError when the archive should not be opened at all.
 */
export async function assertArchiveWithinBudget(
  bytes: ArrayBuffer | Uint8Array,
  label = 'archive',
): Promise<void> {
  const compressed = assertInputBytesWithinCap(bytes, label);

  let zip: JSZip;
  try {
    zip = await JSZip.loadAsync(bytes);
  } catch (error) {
    throw new ArchiveBudgetError(
      `${label}: not a readable archive (${error instanceof Error ? error.message : String(error)})`,
    );
  }

  const entries = Object.values(zip.files).filter((f) => !f.dir);
  if (Object.keys(zip.files).length > MAX_ENTRY_COUNT) {
    throw new ArchiveBudgetError(
      `${label}: ${String(Object.keys(zip.files).length)} entries exceeds the ${String(MAX_ENTRY_COUNT)} cap`,
    );
  }

  let declaredTotal = 0;
  for (const entry of entries) {
    // JSZip exposes the central-directory size on the internal data object.
    // It is untrusted input; we only ever compare it against a cap.
    const declared =
      (entry as unknown as { _data?: { uncompressedSize?: number } })._data?.uncompressedSize ?? 0;
    if (Number.isFinite(declared)) {
      if (declared > MAX_ENTRY_BYTES) {
        throw new ArchiveBudgetError(
          `${label}: entry "${entry.name}" declares ${String(declared)} bytes, over the ` +
            `${String(MAX_ENTRY_BYTES)}-byte per-entry cap`,
        );
      }
      declaredTotal += declared;
    }
  }
  if (declaredTotal > MAX_TOTAL_BYTES) {
    throw new ArchiveBudgetError(
      `${label}: entries declare ${String(declaredTotal)} bytes total, over the ${String(MAX_TOTAL_BYTES)}-byte budget`,
    );
  }
  if (declaredTotal / compressed > MAX_DECLARED_RATIO) {
    throw new ArchiveBudgetError(
      `${label}: declared expansion ratio ${String(Math.round(declaredTotal / compressed))}:1 ` +
        `exceeds ${String(MAX_DECLARED_RATIO)}:1`,
    );
  }
}

// ---------------------------------------------------------------------------
// Full guard — for entries WE decompress
// ---------------------------------------------------------------------------

export interface GuardedZip {
  /** Entry names, directories excluded. */
  names(): string[];
  /** True when the archive contains a non-directory entry with this name. */
  has(name: string): boolean;
  /** Read one entry as text. Returns null when the entry does not exist. */
  text(name: string): Promise<string | null>;
  /** Read one entry as bytes. Returns null when the entry does not exist. */
  bytes(name: string): Promise<Uint8Array | null>;
}

/**
 * Open an archive with the full guard: entry count and input size checked up
 * front, and every subsequent read metered against actual decompressed bytes
 * with a running total across the whole archive.
 */
export interface ZipReadLimits {
  readonly maxEntryBytes?: number;
  readonly maxTotalBytes?: number;
}

export async function readGuardedZip(
  input: ArrayBuffer | Uint8Array,
  label = 'archive',
  // Overridable for the same reason lantern-docx's `Package` takes a `Limits`
  // struct: proving a 64 MiB guard by building a 64 MiB fixture proves it
  // slowly and flakily. Production callers pass nothing and get the constants
  // above; only tests shrink them.
  limits: ZipReadLimits = {},
): Promise<GuardedZip> {
  await assertArchiveWithinBudget(input, label);
  const zip = await JSZip.loadAsync(input);
  const maxEntry = limits.maxEntryBytes ?? MAX_ENTRY_BYTES;
  let totalRemaining = limits.maxTotalBytes ?? MAX_TOTAL_BYTES;

  async function read(name: string): Promise<Uint8Array | null> {
    const entry = zip.file(name);
    if (!entry) return null;
    const budget = Math.min(maxEntry, totalRemaining);
    const bytes = await meteredRead(entry, budget, `${label}: entry "${name}"`);
    totalRemaining -= bytes.byteLength;
    return bytes;
  }

  return {
    names: () =>
      Object.values(zip.files)
        .filter((f) => !f.dir)
        .map((f) => f.name),
    has: (name) => zip.file(name) !== null,
    bytes: read,
    text: async (name) => {
      const bytes = await read(name);
      return bytes === null ? null : new TextDecoder('utf-8').decode(bytes);
    },
  };
}

/**
 * Decompress one entry, counting bytes as they arrive and aborting the moment
 * the budget is passed. This is what makes the header irrelevant: an entry
 * that claims 1 KiB and produces 1 GiB is stopped at the budget, not at the
 * claim.
 *
 * JSZip's `internalStream` emits chunks; we reject on the first chunk that
 * carries us past the budget instead of letting `async('uint8array')`
 * materialise the whole thing first.
 */
interface ChunkStream {
  on(event: 'data', handler: (chunk: Uint8Array) => void): ChunkStream;
  on(event: 'error', handler: (error: unknown) => void): ChunkStream;
  on(event: 'end', handler: () => void): ChunkStream;
  resume(): ChunkStream;
  pause(): ChunkStream;
}

/**
 * `internalStream` is present on every JSZip 3.x entry at runtime (it is what
 * `async()` is built on) but is absent from the shipped `.d.ts`. Declaring the
 * shape we use is honest about that; the alternative — `async('uint8array')` —
 * materialises the whole entry BEFORE we can count it, which is precisely the
 * property the guard needs.
 */
function chunkStreamFor(entry: JSZip.JSZipObject): ChunkStream {
  const withStream = entry as unknown as {
    internalStream?: (type: 'uint8array') => ChunkStream;
  };
  if (typeof withStream.internalStream !== 'function') {
    // FAIL CLOSED: without a metered read we cannot honour the budget, and a
    // guard that silently degrades to no guard is worse than no guard.
    throw new ArchiveBudgetError(
      'this JSZip build has no internalStream(); refusing to decompress unmetered',
    );
  }
  return withStream.internalStream('uint8array');
}

function meteredRead(
  entry: JSZip.JSZipObject,
  budget: number,
  label: string,
): Promise<Uint8Array> {
  return new Promise<Uint8Array>((resolve, reject) => {
    const chunks: Uint8Array[] = [];
    let seen = 0;
    let settled = false;
    let stream: ChunkStream;
    try {
      stream = chunkStreamFor(entry);
    } catch (error) {
      reject(error instanceof Error ? error : new Error(String(error)));
      return;
    }
    stream.on('data', (bytes: Uint8Array) => {
      if (settled) return;
      seen += bytes.byteLength;
      if (seen > budget) {
        settled = true;
        try {
          stream.pause();
        } catch (pauseError) {
          // pause() is best-effort back-pressure. The rejection below is what
          // actually protects the budget, so a pause failure must not mask it —
          // but it is still recorded rather than swallowed.
          console.warn('[safeZip] could not pause a stream past its budget', pauseError);
        }
        reject(
          new ArchiveBudgetError(
            `${label} exceeded its ${String(budget)}-byte budget after ${String(seen)} decompressed bytes ` +
              `(decompression-bomb guard)`,
          ),
        );
        return;
      }
      chunks.push(bytes);
    });
    stream.on('error', (error: unknown) => {
      if (settled) return;
      settled = true;
      reject(error instanceof Error ? error : new Error(String(error)));
    });
    stream.on('end', () => {
      if (settled) return;
      settled = true;
      const out = new Uint8Array(seen);
      let offset = 0;
      for (const chunk of chunks) {
        out.set(chunk, offset);
        offset += chunk.byteLength;
      }
      resolve(out);
    });
    stream.resume();
  });
}
