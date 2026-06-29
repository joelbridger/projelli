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

const SEED_FLAG_KEY = '__keepance_demo_seeded';
const SEED_VERSION_KEY = '__keepance_demo_seed_version';

/**
 * The workspace root the demo files actually live under in the app. The seeder
 * writes the raw sample paths (`/Webb Household/...`) into an OPFS directory
 * mounted at this root, so the app — and the matter folder mappings (e.g. the
 * Webb matter is scoped to `/keepance-demo/Webb Household`) — see them
 * root-prefixed. The browser retriever must index the same root-prefixed paths
 * or matter-scoped retrieval would mark every file `unassigned` and drop it.
 */
export const DEMO_WORKSPACE_ROOT = '/keepance-demo';

export type DemoProfession = 'advisor' | 'legal' | 'tax' | 'consulting';

interface SampleFile {
  path: string;
  content: string;
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
 * `advisor`, so a plain keepance.com/try shows advisor content.
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
  profession: DemoProfession;
  reason?: string;
}> {
  const profession = getDemoProfession();
  const sample = getSampleForProfession(profession);

  if (typeof navigator === 'undefined' || typeof navigator.storage.getDirectory !== 'function') {
    return { backend: null, seeded: false, profession, reason: 'opfs-unsupported' };
  }

  let opfsRoot: FileSystemDirectoryHandle;
  try {
    opfsRoot = await navigator.storage.getDirectory();
  } catch (err) {
    console.warn('[WebDemoSeeder] failed to open OPFS root', err);
    return { backend: null, seeded: false, profession, reason: 'opfs-open-failed' };
  }

  let demoDir: FileSystemDirectoryHandle;
  try {
    demoDir = await opfsRoot.getDirectoryHandle(DEMO_WORKSPACE_ROOT.replace(/^\//, ''), { create: true });
  } catch (err) {
    console.warn('[WebDemoSeeder] failed to create demo directory', err);
    return { backend: null, seeded: false, profession, reason: 'opfs-mkdir-failed' };
  }

  const backend = new WebFSBackend();
  backend.setRootHandle(demoDir);
  await backend.setRootPath(DEMO_WORKSPACE_ROOT);

  const alreadySeeded = readSeedFlag();
  const seededVersion = readSeedVersion();
  const seededProfession = readSeedProfession();
  if (alreadySeeded && seededVersion === sample.version && seededProfession === profession) {
    return { backend, seeded: false, profession, reason: 'already-seeded' };
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
  writeSeedProfession(profession);

  return { backend, seeded: true, profession };
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
    if (raw === 'tax' || raw === 'consulting' || raw === 'legal') return raw;
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
