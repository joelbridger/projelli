/**
 * Stream D-web Group III · Task 3.1
 *
 * One-time seeder that pre-populates the demo workspace with a curated set of
 * notes, chats, source cards, and template descriptions. Runs at most once per
 * browser; the `__projelli_demo_seeded` localStorage key gates re-runs across
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

import sampleWorkspace from './sample-workspace.json';
import { WebFSBackend } from '@/modules/workspace/WebFSBackend';

const SEED_FLAG_KEY = '__projelli_demo_seeded';
const SEED_VERSION_KEY = '__projelli_demo_seed_version';

interface SampleFile {
  path: string;
  content: string;
}

interface SampleWorkspace {
  version: number;
  description: string;
  files: SampleFile[];
}

const sample = sampleWorkspace as SampleWorkspace;

/**
 * Public seed entry point. Returns the WebFSBackend pointing at the seeded
 * OPFS workspace so the rest of the app can use it without re-resolving.
 *
 * Idempotent: if the seed flag is already set AND the version matches, we
 * skip the writes and just return the backend pointing at the existing
 * directory. Bumping `sample-workspace.json#version` re-seeds everyone.
 */
export async function seedWebDemoWorkspace(): Promise<{
  backend: WebFSBackend | null;
  seeded: boolean;
  reason?: string;
}> {
  if (typeof navigator === 'undefined' || typeof navigator.storage.getDirectory !== 'function') {
    return { backend: null, seeded: false, reason: 'opfs-unsupported' };
  }

  let opfsRoot: FileSystemDirectoryHandle;
  try {
    opfsRoot = await navigator.storage.getDirectory();
  } catch (err) {
    console.warn('[WebDemoSeeder] failed to open OPFS root', err);
    return { backend: null, seeded: false, reason: 'opfs-open-failed' };
  }

  let demoDir: FileSystemDirectoryHandle;
  try {
    demoDir = await opfsRoot.getDirectoryHandle('projelli-demo', { create: true });
  } catch (err) {
    console.warn('[WebDemoSeeder] failed to create demo directory', err);
    return { backend: null, seeded: false, reason: 'opfs-mkdir-failed' };
  }

  const backend = new WebFSBackend();
  backend.setRootHandle(demoDir);
  await backend.setRootPath('/projelli-demo');

  const alreadySeeded = readSeedFlag();
  const seededVersion = readSeedVersion();
  if (alreadySeeded && seededVersion === sample.version) {
    return { backend, seeded: false, reason: 'already-seeded' };
  }

  for (const file of sample.files) {
    try {
      await ensureParentDirs(backend, file.path);
      await backend.write(file.path, file.content);
    } catch (err) {
      console.warn(`[WebDemoSeeder] failed to write ${file.path}`, err);
    }
  }

  writeSeedFlag();
  writeSeedVersion(sample.version);

  return { backend, seeded: true };
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

/**
 * Test helper: clears both the flag and the version so the next seed call
 * runs from a clean slate. Not used by production code paths.
 */
export function resetWebDemoSeedFlagForTests(): void {
  try {
    localStorage.removeItem(SEED_FLAG_KEY);
    localStorage.removeItem(SEED_VERSION_KEY);
  } catch {
    // tolerate
  }
}
