/**
 * E2E test for the Templates Marketplace flow (Stream C1 Group IX, Task 9.2).
 *
 * Drives the real React UI through Browse → Install → Switch to Installed →
 * Open WorkflowPanel → see community template.
 *
 * Why we don't run the live install pipeline:
 *
 * The dev server has no Tauri runtime, so `invoke('extract_tarball')` and
 * `invoke('sha256_file')` throw before the FS shim ever gets a chance to
 * persist the tarball. Faking enough of Tauri to drive the real Rust
 * extractor in browser is wildly out of proportion for a UI smoke test.
 *
 * Instead, the spec uses the test seam exposed by App.tsx
 * (`window.__templatesMarketplaceStore`) to seed a `MarketplaceService` that
 * is wired to an in-browser FSBackend stub. The spec pre-loads:
 *   - one catalog entry (browse view)
 *   - the `installed.json` index (after click [Install])
 *   - the manifest.json + workflow.json on the fake FS so the
 *     `TemplateMetadataReader.list()` call from WorkflowPanel surfaces the
 *     installed template under the Community section
 *
 * The user-visible flow (click cards, see badges, switch tabs) is exercised
 * by the real components — only the FS + network layer is mocked.
 */

import { test, expect, type Page } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const TEMPLATE_ID = 'kickoff-lite';
const TEMPLATE_NAME = 'Kickoff Lite';

async function seedMarketplaceForTest(page: Page) {
  await page.evaluate(
    ({ templateId, templateName }) => {
      // ----- in-browser FSBackend stub -----
      const files = new Map<string, string>();
      const fs = {
        async read(p: string) {
          const v = files.get(p);
          if (v === undefined) throw new Error(`ENOENT: ${p}`);
          return v;
        },
        async write(p: string, c: string) {
          files.set(p, c);
        },
        async readBinary(p: string) {
          const v = files.get(p);
          return v ? new TextEncoder().encode(v).buffer : new ArrayBuffer(0);
        },
        async writeBinary(p: string, b: ArrayBuffer) {
          files.set(p, new TextDecoder().decode(b));
        },
        async exists(p: string) {
          return files.has(p);
        },
        async delete(p: string) {
          files.delete(p);
        },
        async move(from: string, to: string) {
          const v = files.get(from);
          if (v !== undefined) {
            files.set(to, v);
            files.delete(from);
          }
        },
        async copy() {},
        async rename() {},
        async mkdir() {},
        async list() {
          return [];
        },
        async stat() {
          return { type: 'file' };
        },
        async isSymlink() {
          return false;
        },
        async resolveSymlink(p: string) {
          return p;
        },
        getRootPath() {
          return '/test-workspace';
        },
        async setRootPath() {},
      };

      // ----- catalog entry (the only thing in the catalog) -----
      const entry = {
        id: templateId,
        name: templateName,
        description: 'A lightweight kickoff workflow for community testing.',
        version: '1.0.0',
        author: { name: 'Community', githubUser: 'community' },
        category: 'kickoff',
        tags: ['kickoff', 'community'],
        installUrl: 'https://example.test/kickoff-lite-1.0.0.tar.gz',
        manifestUrl: 'https://example.test/kickoff-lite-1.0.0/manifest.json',
        minKeepanceVersion: '2.0.0',
        publishedAt: '2026-04-28T00:00:00.000Z',
        updatedAt: '2026-04-28T00:00:00.000Z',
        checksum: 'fakehash',
      };

      // Seed manifest + workflow on the fake FS so when the user clicks
      // Install, the metadata reader can produce a valid WorkflowTemplate.
      const installRoot = '/test-workspace/.keepance/templates';
      const installDir = `${installRoot}/${templateId}`;
      const manifest = {
        id: templateId,
        name: templateName,
        version: '1.0.0',
        apiVersion: '1.0',
        author: { name: 'Community' },
        description: 'A lightweight kickoff workflow for community testing.',
        category: 'kickoff',
        tags: ['kickoff'],
        files: [
          { path: 'manifest.json', type: 'markdown' },
          { path: 'workflow.json', type: 'workflow-definition' },
        ],
        minKeepanceVersion: '2.0.0',
      };
      const workflow = {
        name: templateName,
        description: 'A lightweight kickoff workflow for community testing.',
        version: '1.0.0',
        category: 'kickoff',
        steps: [
          {
            id: 'interview',
            type: 'interview',
            name: 'Collect inputs',
            config: {
              questions: [
                {
                  id: 'idea',
                  question: 'What is your business idea?',
                  type: 'text',
                  required: true,
                },
              ],
            },
          },
        ],
        requiredInputs: ['idea'],
        outputs: [],
      };
      files.set(`${installDir}/manifest.json`, JSON.stringify(manifest));
      files.set(`${installDir}/workflow.json`, JSON.stringify(workflow));

      // ----- import the marketplace module via the global Vite/React tree -----
      // We can't `import` here, so the spec stashes the necessary classes on
      // `window` from a small bootstrap below. Construct + seed the service:
      type StoreApi = {
        setMarketplace: (svc: unknown, reader: unknown) => void;
        setCacheStatus: (s: 'fresh' | 'stale' | 'offline') => void;
      };
      const storeRef = (
        window as unknown as {
          __templatesMarketplaceStore?: { getState: () => StoreApi };
          __marketplaceTestKit?: {
            buildService: (opts: {
              fs: unknown;
              catalog: unknown[];
              installRoot: string;
            }) => unknown;
            buildReader: (opts: { fs: unknown }) => unknown;
            seedInstalledIndex: (
              fs: unknown,
              installRoot: string,
              entries: unknown[],
            ) => Promise<void>;
            installedEntryFor: (
              entry: unknown,
              installedPath: string,
            ) => unknown;
          };
        }
      ).__templatesMarketplaceStore;

      const kit = (
        window as unknown as {
          __marketplaceTestKit?: {
            buildService: (opts: {
              fs: unknown;
              catalog: unknown[];
              installRoot: string;
            }) => unknown;
            buildReader: (opts: { fs: unknown }) => unknown;
            seedInstalledIndex: (
              fs: unknown,
              installRoot: string,
              entries: unknown[],
            ) => Promise<void>;
            installedEntryFor: (
              entry: unknown,
              installedPath: string,
            ) => unknown;
          };
        }
      ).__marketplaceTestKit;

      if (!storeRef || !kit) {
        throw new Error(
          '[e2e] Test seam missing — make sure App is mounted and __marketplaceTestKit is exposed.',
        );
      }

      const service = kit.buildService({
        fs,
        catalog: [entry],
        installRoot,
      });
      const reader = kit.buildReader({ fs });
      storeRef.getState().setMarketplace(service, reader);
      storeRef.getState().setCacheStatus('fresh');

      // Also stash on window so subsequent steps (install / uninstall) can
      // reach the service + fs without re-importing.
      (
        window as unknown as {
          __marketplaceE2ECtx?: {
            service: unknown;
            fs: unknown;
            installRoot: string;
            entry: unknown;
            installedPath: string;
          };
        }
      ).__marketplaceE2ECtx = {
        service,
        fs,
        installRoot,
        entry,
        installedPath: installDir,
      };
    },
    { templateId: TEMPLATE_ID, templateName: TEMPLATE_NAME },
  );
}

/**
 * Inject a small bootstrap that re-exports the marketplace classes onto
 * `window.__marketplaceTestKit`. We do this from inside the running app via
 * an `addInitScript` that runs before the React mount and reads the modules
 * once App has imported them. This avoids forcing the spec to know module
 * paths.
 *
 * The simplest path that still works in Vite dev: piggy-back on the test seam
 * App.tsx exposes (`window.__templatesMarketplaceStore`) and dynamically
 * import the marketplace barrel from the running module graph. We can't
 * `import()` arbitrary paths in the page context without Vite's module
 * resolver, so instead the spec relies on the marketplace store's existence
 * and constructs services via plain JS by reaching into the real module
 * cache that the app already loaded.
 */
async function exposeMarketplaceTestKit(page: Page) {
  await page.evaluate(async () => {
    // Vite serves source modules over HTTP; we can use Vite's module graph
    // to fetch the marketplace barrel in dev. The dev URL pattern matches
    // the Vite default for src/ modules.
    const m = (await import(
      /* @vite-ignore */ '/src/features/workflows/marketplace/svc/index.ts'
    )) as {
      MarketplaceService: new (opts: {
        repoUrl: string;
        catalogPath: string;
        cachePath: string;
        installRoot: string;
        fs: unknown;
        provenance?: string;
      }) => unknown;
      TemplateMetadataReader: new (opts: { fs: unknown }) => unknown;
    };

    (
      window as unknown as {
        __marketplaceTestKit: {
          buildService: (opts: {
            fs: unknown;
            catalog: unknown[];
            installRoot: string;
          }) => unknown;
          buildReader: (opts: { fs: unknown }) => unknown;
          seedInstalledIndex: (
            fs: unknown,
            installRoot: string,
            entries: unknown[],
          ) => Promise<void>;
          installedEntryFor: (entry: unknown, installedPath: string) => unknown;
        };
      }
    ).__marketplaceTestKit = {
      buildService: ({ fs, catalog, installRoot }) => {
        const svc = new m.MarketplaceService({
          repoUrl: 'https://example.test',
          catalogPath: 'catalog.json',
          cachePath: '/test-workspace/.keepance/cache/templates.json',
          installRoot,
          fs,
          provenance: 'community',
        });
        // Pre-seed in-memory cache so list() resolves without a network
        // round-trip. Mark cache as fresh so checkForUpdates short-circuits.
        const internal = svc as unknown as {
          cache: unknown[];
          lastFetchedAt: string;
          lastFetchFailed: boolean;
        };
        internal.cache = catalog;
        internal.lastFetchedAt = new Date().toISOString();
        internal.lastFetchFailed = false;
        return svc;
      },
      buildReader: ({ fs }) => new m.TemplateMetadataReader({ fs }),
      seedInstalledIndex: async (fsAny, installRoot, entries) => {
        const fs = fsAny as { write: (p: string, c: string) => Promise<void> };
        await fs.write(
          `${installRoot}/.installed.json`,
          JSON.stringify({ entries }, null, 2),
        );
      },
      installedEntryFor: (entryAny, installedPath) => {
        const entry = entryAny as Record<string, unknown>;
        return {
          ...entry,
          installedAt: new Date().toISOString(),
          installedPath,
          provenance: 'community',
          manifestVersion: '1.0',
        };
      },
    };
  });
}

test.describe('Templates Marketplace E2E', () => {
  test('browse → install → installed list → WorkflowPanel community section', async ({
    page,
  }) => {
    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    // Wire the in-browser test kit (imports the real marketplace classes via
    // Vite's dev-served module graph) and seed a synthetic catalog +
    // installed FS state.
    await exposeMarketplaceTestKit(page);
    await seedMarketplaceForTest(page);

    // ---- Step 1: open Settings → Marketplace → Templates ----
    await hardClick(page.getByTestId('settings-gear'));
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await hardClick(page.getByTestId('settings-category-marketplace'));
    await expect(page.getByTestId('marketplace-tab')).toBeVisible();

    // Templates subtab should be the default; verify the catalog grid renders.
    await expect(page.getByTestId('marketplace-subtab-templates')).toBeVisible();
    await expect(page.getByTestId('templates-tab')).toBeVisible();

    // ---- Step 2: see catalog tile ----
    const card = page.getByTestId(`template-catalog-card-${TEMPLATE_ID}`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // ---- Step 3: open detail view ----
    await hardClick(card);
    await expect(page.getByTestId('template-detail-view')).toBeVisible();
    await expect(page.getByTestId('template-detail-name')).toContainText(
      TEMPLATE_NAME,
    );

    // ---- Step 4: click [Install] ----
    // The real install would call Tauri invoke (which throws in dev). For the
    // E2E we patch service.install in-place to bypass the Tauri pipeline and
    // synthesize the installed.json + emit a success outcome through the
    // same code path the user sees.
    await page.evaluate(async () => {
      const ctx = (
        window as unknown as {
          __marketplaceE2ECtx: {
            service: {
              install: (
                id: string,
                opts?: unknown,
              ) => Promise<unknown>;
            };
            fs: unknown;
            installRoot: string;
            entry: unknown;
            installedPath: string;
          };
          __marketplaceTestKit: {
            seedInstalledIndex: (
              fs: unknown,
              installRoot: string,
              entries: unknown[],
            ) => Promise<void>;
            installedEntryFor: (
              entry: unknown,
              installedPath: string,
            ) => unknown;
          };
        }
      ).__marketplaceE2ECtx;
      const kit = (
        window as unknown as {
          __marketplaceTestKit: {
            seedInstalledIndex: (
              fs: unknown,
              installRoot: string,
              entries: unknown[],
            ) => Promise<void>;
            installedEntryFor: (
              entry: unknown,
              installedPath: string,
            ) => unknown;
          };
        }
      ).__marketplaceTestKit;
      const installedEntry = kit.installedEntryFor(ctx.entry, ctx.installedPath);
      // Override install() so the click dispatches through real React state.
      ctx.service.install = async () => {
        await kit.seedInstalledIndex(ctx.fs, ctx.installRoot, [installedEntry]);
        // Drop the in-memory installed cache on the service so the next
        // listInstalled() call hits the freshly-written index.
        (
          ctx.service as unknown as { installedCache: unknown }
        ).installedCache = null;
        return installedEntry;
      };
    });

    await hardClick(page.getByTestId('template-detail-install'));

    // ---- Step 5: see success outcome panel ----
    await expect(
      page.getByTestId('template-detail-outcome-success'),
    ).toBeVisible({ timeout: 10_000 });

    // Back to catalog grid.
    await hardClick(page.getByTestId('template-detail-back'));

    // ---- Step 6: switch to Installed subtab and see the entry ----
    await hardClick(page.getByTestId('templates-tab-subview-installed'));
    // The InstalledTemplatesList renders one row per installed entry; we
    // assert the entry's name shows up somewhere inside the modal.
    await expect(page.getByTestId('settings-modal')).toContainText(
      TEMPLATE_NAME,
    );

    // ---- Step 7: close Settings, open WorkflowPanel ----
    await page.keyboard.press('Escape');
    await expect(page.getByTestId('settings-modal')).toBeHidden();

    // The marketplace store ticked updateCount → 0 after install (no updates
    // available because installed.version === catalog.version). Re-trigger
    // a community-list re-read so WorkflowPanel picks up the freshly
    // installed template. Easiest signal that's already a re-render trigger
    // is `setUpdateCount` to a new value then back.
    await page.evaluate(() => {
      const store = (
        window as unknown as {
          __templatesMarketplaceStore: {
            getState: () => { setUpdateCount: (n: number) => void };
          };
        }
      ).__templatesMarketplaceStore.getState();
      store.setUpdateCount(0);
      store.setUpdateCount(1);
      store.setUpdateCount(0);
    });

    // Switch the sidebar to Workflows tab so WorkflowPanel mounts.
    await hardClick(page.getByTestId('sidebar-tab-workflows'));
    await expect(page.getByTestId('workflows-panel')).toBeVisible();

    // Community section + community provenance badge for our template.
    await expect(page.getByTestId('workflows-group-community')).toBeVisible({
      timeout: 10_000,
    });
    const communityBadge = page.getByTestId(
      `workflow-card-provenance-community:${TEMPLATE_ID}`,
    );
    await expect(communityBadge).toBeVisible();
    await expect(communityBadge).toContainText(/community/i);

    // The card itself appears under the community group.
    await expect(
      page.getByTestId(`workflow-card-community:${TEMPLATE_ID}`),
    ).toBeVisible();
  });
});
