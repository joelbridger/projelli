/**
 * web-ui-seed — dev-only browser bootstrap for the lantern-ui-web UI-review
 * build (design/ui-iteration worktree, port 5273).
 *
 * DEV-ONLY. This module is reached only from App.tsx's `IS_WEB_UI_SEED_MODE`
 * branch, itself gated on `import.meta.env.DEV` — Vite replaces that with the
 * literal `false` in every production build (`vite build`), so this file is
 * simply never imported (and its effect never runs) in a shipped build. It is
 * also never imported by the Tauri desktop entry point.
 *
 * PERSISTENCE: IndexedDB, not OPFS. This build is reviewed over plain http on
 * a Tailscale IP (not localhost, not https) — a browser "insecure context" —
 * where OPFS (`navigator.storage.getDirectory()`) and the File System Access
 * API (`showDirectoryPicker()`) are both unavailable, and the app's normal
 * WorkspaceSelector screen is a dead end (both "Open Existing" and "New
 * Workspace" fail there). IndexedDB has no such restriction. See
 * IndexedDbFSBackend.ts for the full FSBackend implementation this uses
 * instead of the desktop/production WebFSBackend.
 *
 * What it does, once per browser profile (idempotent via a localStorage
 * version flag, same pattern as src/web-demo/WebDemoSeeder.ts):
 *   - Writes a Household Overview document (and, for ~15-16 "full" tier
 *     households, an Account Summary, an Email Thread, and a Meetings/
 *     entry with meeting.json + generated notes.docx) into an IndexedDB-backed
 *     workspace, for all 80 households in
 *     src/web-ui-seed/data/households.generated.json.
 *   - Creates one Matter per household (useMatterStore) so the Clients list
 *     and Client Map show all 80.
 *   - Sets a ClientMap per household (useClientMapStore) built from the same
 *     real facts written into the documents, so Client Map / Book view show
 *     real content, not placeholders.
 *   - Installs a browser keyword-search retrieval backend (MiniSearch, the
 *     same mechanism src/web-demo/demoRetrieval.ts uses for the public /try
 *     demo) over every written document, so Ask citations resolve to real
 *     seeded passages. Reinstalled on every load (in-memory, not persisted).
 *
 * What is deliberately NOT seeded (see .agent/results/web-ui-seed.json for
 * the full write-up): the encrypted CRM household record (facts/accounts/
 * notes edited in the Household detail screen) and the CRM activity Timeline
 * sub-tab are Tauri/SQLCipher-only with no browser fallback anywhere in the
 * app (src/platform/crm/liveRecords.ts, src/platform/crm/store/index.ts) —
 * seeding around that would require faking a persistence layer the real app
 * doesn't have in the browser. Live email sync (src/platform/connectors/
 * email/useMailSync.ts) is also Tauri-only; household emails are instead
 * represented as a real "Email Thread" document (Documents tab + Ask
 * citations), the same technique src/web-demo's sample packs already use.
 */
import { createIndexedDbFSBackend, IndexedDbFSBackend } from './IndexedDbFSBackend';
import { createWorkspaceService, type WorkspaceService } from '@/platform/fs/WorkspaceService';
import { useMatterStore } from '@/platform/matter/matterStore';
import { useClientMapStore } from '@/platform/clientMap/clientMapStore';
import { installDemoRetrieval, type DemoFile } from '@/web-demo/demoRetrieval';
import householdsData from './data/households.generated.json';
import {
  buildHouseholdOverviewMarkdown,
  buildAccountSummaryMarkdown,
  buildEmailThreadMarkdown,
  buildMeetingNotesMarkdown,
  buildMeetingMeta,
  buildClientMap,
  type SeedHousehold,
} from './buildContent';

export const WEB_UI_SEED_ROOT = '/lantern-web-ui-seed';
const SEED_FLAG_KEY = '__lantern_web_ui_seed_version';

const households = (householdsData as unknown as { version: number; households: SeedHousehold[] }).households;
const SEED_VERSION = (householdsData as unknown as { version: number }).version;

function readSeedVersion(): number | null {
  try {
    const raw = localStorage.getItem(SEED_FLAG_KEY);
    if (raw === null) return null;
    const parsed = Number(raw);
    return Number.isFinite(parsed) ? parsed : null;
  } catch {
    return null;
  }
}

function writeSeedVersion(version: number): void {
  try {
    localStorage.setItem(SEED_FLAG_KEY, String(version));
  } catch {
    // Private browsing or quota: tolerate. We will reseed on next load.
  }
}

// IndexedDbFSBackend's write()/writeBinary()/mkdir() all auto-create parent
// directory entries, so (unlike WebDemoSeeder's OPFS version) no separate
// ensureParentDirs step is needed here.

/** Generate a real .docx from markdown, reusing the same helper WebDemoSeeder
 *  uses (dynamically imported so it never loads outside a seed run). */
async function writeDocxFile(backend: IndexedDbFSBackend, path: string, markdown: string): Promise<void> {
  const { markdownToDocxBytes } = await import('@/platform/utils/docx-io');
  const fileName = path.split('/').pop() ?? 'document.docx';
  const bytes = await markdownToDocxBytes(markdown, fileName);
  await backend.writeBinary(path, bytes.slice().buffer as ArrayBuffer);
}

interface SeedCounts {
  households: number;
  full: number;
  light: number;
  documents: number;
  meetings: number;
  emailThreads: number;
}

/**
 * Write every household's documents/matter/client-map. Returns the flat list
 * of {path, content} used for the retrieval index, plus counts for the
 * result report. `root` is the workspace-absolute root (e.g. `/lantern-web-ui-seed`).
 */
async function seedHouseholds(backend: IndexedDbFSBackend, root: string): Promise<{ files: DemoFile[]; counts: SeedCounts }> {
  const files: DemoFile[] = [];
  const counts: SeedCounts = { households: 0, full: 0, light: 0, documents: 0, meetings: 0, emailThreads: 0 };
  const matterStore = useMatterStore.getState();
  const clientMapStore = useClientMapStore.getState();

  for (const h of households) {
    const folder = `/${h.folderName}`;
    const overviewPath = `${folder}/Household Overview.md`;
    const overviewContent = buildHouseholdOverviewMarkdown(h);
    await backend.write(overviewPath, overviewContent);
    files.push({ path: overviewPath, content: overviewContent });
    counts.documents += 1;

    let accountsPath: string | null = null;
    if (h.tier === 'full') {
      accountsPath = `${folder}/Account Summary.md`;
      const accountsContent = buildAccountSummaryMarkdown(h);
      await backend.write(accountsPath, accountsContent);
      files.push({ path: accountsPath, content: accountsContent });
      counts.documents += 1;

      if (h.emails.length > 0) {
        const emailPath = `${folder}/Email Thread.md`;
        const emailContent = buildEmailThreadMarkdown(h);
        await backend.write(emailPath, emailContent);
        files.push({ path: emailPath, content: emailContent });
        counts.documents += 1;
        counts.emailThreads += 1;
      }
    }

    const matter = matterStore.createMatter({
      id: h.id,
      name: h.name,
      client: h.client,
      folderPaths: [`${root}${folder}`],
    });

    if (h.tier === 'full' && h.meeting) {
      const meetingDir = `${folder}/Meetings/${h.meeting.folderName}`;
      const notesMarkdown = buildMeetingNotesMarkdown(h);
      const meetingMeta = buildMeetingMeta(h, matter.id);
      if (meetingMeta) {
        await backend.write(`${meetingDir}/meeting.json`, JSON.stringify(meetingMeta, null, 2));
        await writeDocxFile(backend, `${meetingDir}/notes.docx`, notesMarkdown);
        // Index the notes text too (the docx binary itself isn't indexable here).
        files.push({ path: `${meetingDir}/notes.md`, content: notesMarkdown });
        counts.meetings += 1;
      }
    }

    clientMapStore.setMap(matter.id, buildClientMap(h, matter.id, overviewPath, accountsPath));

    counts.households += 1;
    if (h.tier === 'full') counts.full += 1;
    else counts.light += 1;
    if (counts.households % 10 === 0) {
      console.log(`[web-ui-seed] seeded ${String(counts.households)}/${String(households.length)} households`);
    }
  }

  return { files, counts };
}

export interface WebUiSeedResult {
  service: WorkspaceService;
  counts: SeedCounts;
  alreadySeeded: boolean;
}

/**
 * Idempotently seed (first load / data-version bump only) and always
 * reinstall retrieval, then open the IndexedDB-backed workspace. Call once
 * from App.tsx's dev-only auto-open effect.
 *
 * Single-flight: App.tsx's effect can legitimately fire more than once before
 * the first run finishes (its dependency array includes `handleWorkspaceSelected`,
 * which is not guaranteed referentially stable across renders — the same shape
 * as the pre-existing IS_DEMO_MODE effect it mirrors). Without this guard, a
 * second call while the first is still writing 80 households' worth of files
 * would run the whole (expensive) seed a second time concurrently. Cached at
 * module scope so it also collapses re-renders across the whole page load.
 */
let inFlight: Promise<WebUiSeedResult> | null = null;
export function openWebUiSeedWorkspace(): Promise<WebUiSeedResult> {
  if (!inFlight) {
    inFlight = openWebUiSeedWorkspaceInner().catch((err: unknown) => {
      inFlight = null;
      throw err;
    });
  }
  return inFlight;
}

async function openWebUiSeedWorkspaceInner(): Promise<WebUiSeedResult> {
  const backend = createIndexedDbFSBackend();
  await backend.setRootPath(WEB_UI_SEED_ROOT);

  const alreadySeeded = readSeedVersion() === SEED_VERSION;

  let files: DemoFile[];
  let counts: SeedCounts;

  if (alreadySeeded) {
    // Matters + Client Maps already persisted (zustand/persist) from a prior
    // load; IndexedDB files already on disk. Only rebuild the in-memory
    // retrieval index (never persisted) from the static generated data.
    const rebuilt: DemoFile[] = [];
    const c: SeedCounts = { households: 0, full: 0, light: 0, documents: 0, meetings: 0, emailThreads: 0 };
    for (const h of households) {
      const folder = `/${h.folderName}`;
      rebuilt.push({ path: `${folder}/Household Overview.md`, content: buildHouseholdOverviewMarkdown(h) });
      c.documents += 1;
      if (h.tier === 'full') {
        rebuilt.push({ path: `${folder}/Account Summary.md`, content: buildAccountSummaryMarkdown(h) });
        c.documents += 1;
        if (h.emails.length > 0) {
          rebuilt.push({ path: `${folder}/Email Thread.md`, content: buildEmailThreadMarkdown(h) });
          c.documents += 1;
          c.emailThreads += 1;
        }
        if (h.meeting) {
          rebuilt.push({ path: `${folder}/Meetings/${h.meeting.folderName}/notes.md`, content: buildMeetingNotesMarkdown(h) });
          c.meetings += 1;
        }
        c.full += 1;
      } else {
        c.light += 1;
      }
      c.households += 1;
    }
    files = rebuilt;
    counts = c;
  } else {
    await backend.clearAll();
    const result = await seedHouseholds(backend, WEB_UI_SEED_ROOT);
    files = result.files;
    counts = result.counts;
    writeSeedVersion(SEED_VERSION);
  }

  installDemoRetrieval(files, WEB_UI_SEED_ROOT);

  const service = createWorkspaceService();
  await service.initialize(backend, WEB_UI_SEED_ROOT);

  return { service, counts, alreadySeeded };
}
