/**
 * Stream D-web Group III · Task 3.1
 *
 * One-time seeder that pre-populates the demo workspace with a curated set of
 * notes, chats, source cards, and template descriptions. Runs at most once per
 * browser; the `__keepance_demo_seeded` localStorage key gates re-runs across
 * page reloads.
 *
 * The desktop app never imports this module: the demo entry point in
 * `src/web-demo/main.tsx` is only built by `vite.config.web-demo.ts`.
 *
 * Storage backing: an Origin-Private File System (OPFS) directory accessed via
 * the FileSystem Access API. We lean on the existing `WebFSBackend` so the
 * seeded files render in the same code paths the desktop app uses. OPFS is
 * available in Chromium and recent Safari/Firefox; on browsers where it is
 * not, the seeder logs a warning and skips silently (the demo still loads;
 * the user gets the empty workspace and a Group IV notice).
 */

import sampleWorkspaceAdvisor from './sample-workspace-advisor.json';
import sampleWorkspaceLegal from './sample-workspace.json';
import sampleWorkspaceTax from './sample-workspace-tax.json';
import sampleWorkspaceConsulting from './sample-workspace-consulting.json';
import { WebFSBackend } from '@/platform/fs/WebFSBackend';

// Pre-built PDF sample documents (committed binary assets). A browser has no JS
// PDF *writer*, so unlike `.docx` (generated from text at seed time) these are
// built ahead of time from src/web-demo/sample-docs/*.html via
// `node scripts/build-demo-pdfs.mjs`, imported here as URLs, and written to OPFS
// byte-for-byte so the file tree + PDF viewer show a real PDF.
import beneficiaryPdfUrl from './sample-docs/beneficiary-designations.pdf?url';
import clientIntakePdfUrl from './sample-docs/client-intake.pdf?url';

/** Map a seeded PDF file path to its committed binary asset URL. */
const PDF_ASSETS: Record<string, string> = {
  '/Webb Household/Beneficiary Designations.pdf': beneficiaryPdfUrl,
  '/Webb Household/Client Intake.pdf': clientIntakePdfUrl,
};

const SEED_FLAG_KEY = '__keepance_demo_seeded';
const SEED_VERSION_KEY = '__keepance_demo_seed_version';

/**
 * The workspace root the demo files actually live under in the app. The seeder
 * writes the raw sample paths (`/Webb Household/...`) into an OPFS directory
 * mounted at this root, so the app — and the matter folder mappings (e.g. the
 * Webb matter is scoped to `/lantern-demo/Webb Household`) — see them
 * root-prefixed. The browser retriever must index the same root-prefixed paths
 * or matter-scoped retrieval would mark every file `unassigned` and drop it.
 */
export const DEMO_WORKSPACE_ROOT = '/lantern-demo';

export type DemoProfession = 'advisor' | 'legal' | 'tax' | 'consulting';

export interface SampleFile {
  path: string;
  /**
   * Plain-text content. For `format: 'text'` this is written to disk verbatim.
   * For `'docx'` it is the markdown the Word file is generated from. For `'pdf'`
   * it is the document's text (the binary comes from a committed asset). In all
   * three cases this is what the demo's Ask retriever indexes and cites, so it
   * is the source of truth for the document's words.
   */
  content: string;
  /**
   * How to materialise the file on disk. Defaults to `'text'` when omitted, so
   * the legal/tax/consulting sample packs (plain markdown) need no changes.
   *   - 'text' → write `content` as-is.
   *   - 'docx' → generate a real Word file from `content` (markdown) at seed time.
   *   - 'pdf'  → write the committed PDF asset mapped in PDF_ASSETS.
   */
  format?: 'text' | 'docx' | 'pdf';
}

interface SampleWorkspace {
  version: number;
  description: string;
  files: SampleFile[];
}

/**
 * Read the `profession` URL parameter to determine which demo workspace to
 * seed. Accepts `advisor` (default — financial advisors are the lead ICP),
 * `legal`, `tax`, or `consulting`. Any unrecognised value falls back to
 * `advisor`, so a plain advisorprephero.com/try shows advisor content.
 */
export function getDemoProfession(): DemoProfession {
  if (typeof window === 'undefined') return 'advisor';
  const params = new URLSearchParams(window.location.search);
  const raw = params.get('profession');
  if (raw === 'legal') return 'legal';
  if (raw === 'tax') return 'tax';
  if (raw === 'consulting') return 'consulting';
  return 'advisor';
}

export function getSampleForProfession(profession: DemoProfession): SampleWorkspace {
  if (profession === 'legal') return sampleWorkspaceLegal as SampleWorkspace;
  if (profession === 'tax') return sampleWorkspaceTax as SampleWorkspace;
  if (profession === 'consulting') return sampleWorkspaceConsulting as SampleWorkspace;
  return sampleWorkspaceAdvisor as SampleWorkspace;
}

/**
 * Public seed entry point. Returns the WebFSBackend pointing at the seeded
 * OPFS workspace so the rest of the app can use it without re-resolving.
 *
 * Idempotent: if the seed flag is already set AND the version + profession
 * match what is already seeded, we skip the writes and return the backend
 * pointing at the existing directory. Bumping a sample JSON's `version`
 * field, or navigating to /try/ with a different `profession` parameter,
 * triggers a fresh re-seed.
 */
export async function seedWebDemoWorkspace(): Promise<{
  backend: WebFSBackend | null;
  seeded: boolean;
  /**
   * True only when the demo workspace is FULLY populated on disk — i.e. every
   * seed file is present (a fresh full seed succeeded, or a matching prior seed
   * is already complete). The bootstrap (`main.tsx`) MUST gate retrieval install
   * + Client Map seeding on this: if a write failed (PDF fetch, DOCX generation,
   * OPFS quota) or OPFS is unavailable, `ready` is false and the demo must NOT
   * index or cite files — otherwise an Ask/Client Map citation could point at a
   * file that was never written and its source chip would fail to open, which is
   * exactly the source-click trust the demo is selling.
   */
  ready: boolean;
  profession: DemoProfession;
  reason?: string;
}> {
  const profession = getDemoProfession();
  const sample = getSampleForProfession(profession);

  if (typeof navigator === 'undefined' || typeof navigator.storage.getDirectory !== 'function') {
    return { backend: null, seeded: false, ready: false, profession, reason: 'opfs-unsupported' };
  }

  let opfsRoot: FileSystemDirectoryHandle;
  try {
    opfsRoot = await navigator.storage.getDirectory();
  } catch (err) {
    console.warn('[WebDemoSeeder] failed to open OPFS root', err);
    return { backend: null, seeded: false, ready: false, profession, reason: 'opfs-open-failed' };
  }

  let demoDir: FileSystemDirectoryHandle;
  try {
    demoDir = await opfsRoot.getDirectoryHandle(DEMO_WORKSPACE_ROOT.replace(/^\//, ''), { create: true });
  } catch (err) {
    console.warn('[WebDemoSeeder] failed to create demo directory', err);
    return { backend: null, seeded: false, ready: false, profession, reason: 'opfs-mkdir-failed' };
  }

  const backend = new WebFSBackend();
  backend.setRootHandle(demoDir);
  await backend.setRootPath(DEMO_WORKSPACE_ROOT);

  const alreadySeeded = readSeedFlag();
  const seededVersion = readSeedVersion();
  const seededProfession = readSeedProfession();
  if (alreadySeeded && seededVersion === sample.version && seededProfession === profession) {
    // The seed flag is only ever written after a fully-successful seed (below),
    // so a matching flag means every file is already on disk → ready.
    return { backend, seeded: false, ready: true, profession, reason: 'already-seeded' };
  }

  // Re-seed wipes the prior demo workspace first, so a version bump that renames
  // or swaps files (e.g. the .md client files becoming .docx/.pdf) doesn't leave
  // the old files lingering next to the new ones. On a first seed the directory
  // is empty, so this is a no-op.
  await clearDirectory(demoDir);

  const { ok, failedPaths } = await writeAllSampleFiles(sample.files, async (file) => {
    await ensureParentDirs(backend, file.path);
    await writeSampleFile(backend, file);
  });

  // Only mark the seed complete — and only report `ready` — when EVERY file was
  // written. On a partial seed we leave the flag unset (so the next load clears
  // and retries) AND return ready:false so the bootstrap skips installing the
  // retriever and seeding the Client Map: the demo must never boot a state that
  // can cite a file which isn't on disk.
  if (ok) {
    writeSeedFlag();
    writeSeedVersion(sample.version);
    writeSeedProfession(profession);
    return { backend, seeded: true, ready: true, profession };
  }

  console.warn(
    `[WebDemoSeeder] seed incomplete — ${String(failedPaths.length)} file(s) could not be written; ` +
      'skipping retrieval + Client Map so the demo never cites a missing file:',
    failedPaths,
  );
  return { backend, seeded: false, ready: false, profession, reason: 'partial-seed' };
}

/**
 * Write every sample file via `writeOne`, retrying the failures ONCE (PDF fetch /
 * DOCX generation / OPFS writes can fail transiently). Returns whether all files
 * ended up written, plus the paths that still failed — the caller uses this to
 * decide whether the workspace is safe to index and cite. Pure w.r.t. OPFS
 * (the write side is injected), so it's unit-testable without a real filesystem.
 */
export async function writeAllSampleFiles(
  files: SampleFile[],
  writeOne: (file: SampleFile) => Promise<void>,
): Promise<{ ok: boolean; failedPaths: string[] }> {
  const failed: SampleFile[] = [];
  for (const file of files) {
    try {
      await writeOne(file);
    } catch (err) {
      failed.push(file);
      console.warn(`[WebDemoSeeder] failed to write ${file.path}`, err);
    }
  }
  if (failed.length === 0) return { ok: true, failedPaths: [] };

  // One retry pass over just the files that failed.
  const stillFailed: SampleFile[] = [];
  for (const file of failed) {
    try {
      await writeOne(file);
    } catch (err) {
      stillFailed.push(file);
      console.warn(`[WebDemoSeeder] retry failed for ${file.path}`, err);
    }
  }
  return { ok: stillFailed.length === 0, failedPaths: stillFailed.map((f) => f.path) };
}

/**
 * Materialise one sample file on disk according to its `format`:
 *   - 'docx' → generate a real Word document from the markdown `content`.
 *   - 'pdf'  → write the committed PDF binary asset mapped in PDF_ASSETS.
 *   - 'text' (default) → write `content` as a UTF-8 text file.
 */
async function writeSampleFile(backend: WebFSBackend, file: SampleFile): Promise<void> {
  const format = file.format ?? 'text';
  if (format === 'docx') {
    const fileName = file.path.split('/').pop() ?? 'document.docx';
    await backend.writeBinary(file.path, await generateDocxBytes(file.content, fileName));
    return;
  }
  if (format === 'pdf') {
    const url = PDF_ASSETS[file.path];
    if (!url) throw new Error(`No PDF asset mapped for ${file.path}`);
    const res = await fetch(url);
    if (!res.ok) throw new Error(`Failed to fetch PDF asset for ${file.path}: HTTP ${String(res.status)}`);
    await backend.writeBinary(file.path, await res.arrayBuffer());
    return;
  }
  await backend.write(file.path, file.content);
}

/**
 * Generate a real `.docx` byte stream from markdown. The `docx` toolchain is
 * dynamically imported so it only loads when the demo actually seeds a Word file
 * (and stays out of the demo's first-paint critical path). Returns an exact-size
 * ArrayBuffer for WebFSBackend.writeBinary.
 */
async function generateDocxBytes(markdown: string, fileName: string): Promise<ArrayBuffer> {
  const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
  const bytes = await markdownToDocxBytes(markdown, fileName);
  // bytes may be a view over a larger pooled buffer; slice() copies to an
  // exact-size ArrayBuffer.
  return bytes.slice().buffer as ArrayBuffer;
}

/**
 * Remove every entry (files and subdirectories) directly under an OPFS
 * directory handle. Names are collected before removal because an async
 * directory iterator must not be mutated mid-iteration.
 */
async function clearDirectory(dir: FileSystemDirectoryHandle): Promise<void> {
  const names: string[] = [];
  for await (const [name] of dir.entries()) {
    names.push(name);
  }
  for (const name of names) {
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch {
      // Tolerate: a partially-removed entry shouldn't abort the re-seed.
    }
  }
}

/**
 * Walk the path's parent segments and `mkdir` each one. The WebFSBackend's
 * write() creates the leaf file but does not create intermediate folders.
 */
async function ensureParentDirs(backend: WebFSBackend, path: string): Promise<void> {
  const segments = path.split('/').filter((s) => s.length > 0);
  if (segments.length <= 1) return;
  const parents = segments.slice(0, -1);
  let current = '';
  for (const seg of parents) {
    current = `${current}/${seg}`;
    try {
      await backend.mkdir(current);
    } catch {
      // mkdir on an existing directory is a no-op for our purposes.
    }
  }
}

function readSeedFlag(): boolean {
  try {
    return localStorage.getItem(SEED_FLAG_KEY) === '1';
  } catch {
    return false;
  }
}

function writeSeedFlag(): void {
  try {
    localStorage.setItem(SEED_FLAG_KEY, '1');
  } catch {
    // Private browsing or quota: tolerate. We will reseed on next load.
  }
}

function readSeedVersion(): number | null {
  try {
    const raw = localStorage.getItem(SEED_VERSION_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSeedVersion(version: number): void {
  try {
    localStorage.setItem(SEED_VERSION_KEY, String(version));
  } catch {
    // tolerate
  }
}

const SEED_PROFESSION_KEY = '__keepance_demo_seed_profession';

function readSeedProfession(): DemoProfession | null {
  try {
    const raw = localStorage.getItem(SEED_PROFESSION_KEY);
    if (raw === 'tax' || raw === 'consulting' || raw === 'legal' || raw === 'advisor') return raw;
    return null;
  } catch {
    return null;
  }
}

function writeSeedProfession(profession: DemoProfession): void {
  try {
    localStorage.setItem(SEED_PROFESSION_KEY, profession);
  } catch {
    // tolerate
  }
}

/**
 * Test helper: clears the seed flag, version, and profession so the next
 * seed call runs from a clean slate. Not used by production code paths.
 */
export function resetWebDemoSeedFlagForTests(): void {
  try {
    localStorage.removeItem(SEED_FLAG_KEY);
    localStorage.removeItem(SEED_VERSION_KEY);
    localStorage.removeItem(SEED_PROFESSION_KEY);
  } catch {
    // tolerate
  }
}
