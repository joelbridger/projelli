/**
 * E2E test for the Plugins Marketplace flow (Stream C4 Group VII, Task 7.2).
 *
 * Drives the real React UI through Browse → click Install → see consent
 * dialog → Approve → see success outcome → switch to Installed subtab → see
 * the entry → Uninstall.
 *
 * Why we don't run the live install pipeline:
 *
 * The dev server has no Tauri runtime, so `invoke('extract_tarball')` and
 * `invoke('sha256_file')` throw before the FS shim ever gets a chance to
 * persist the tarball. Faking enough of Tauri to drive the real Rust extractor
 * in browser is wildly out of proportion for a UI smoke test.
 *
 * Instead, the spec uses the test seam exposed by App.tsx
 * (`window.__pluginsMarketplaceStore`) to seed a `MarketplaceService` that is
 * wired to an in-browser FSBackend stub. The user-visible flow (click cards,
 * see the consent dialog, approve, switch subtabs) is exercised by the real
 * components; only the FS + network + Tauri layers are stubbed.
 *
 * This spec mirrors the C1 templates-marketplace.spec.ts structure 1:1; the
 * only differences are (a) the consent dialog step in the middle and (b) the
 * permission badge on the catalog card.
 */

import { test, expect, type Page } from '@playwright/test';
import { hardClick, waitForTestModeLoad } from './helpers/test-utils';

const PLUGIN_ID = 'word-counter';
const PLUGIN_NAME = 'Word Counter';

async function exposePluginsMarketplaceTestKit(page: Page) {
  await page.evaluate(async () => {
    const m = (await import(
      /* @vite-ignore */ '/src/modules/marketplace/index.ts'
    )) as {
      MarketplaceService: new (opts: {
        repoUrl: string;
        catalogPath: string;
        cachePath: string;
        installRoot: string;
        fs: unknown;
        provenance?: string;
        validator?: unknown;
        auditEmitter?: unknown;
      }) => unknown;
    };

    (
      window as unknown as {
        __pluginsMarketplaceTestKit: {
          buildService: (opts: {
            fs: unknown;
            catalog: unknown[];
            installRoot: string;
            validator: unknown;
            auditEmitter: unknown;
          }) => unknown;
          installedEntryFor: (entry: unknown, installedPath: string) => unknown;
        };
      }
    ).__pluginsMarketplaceTestKit = {
      buildService: ({ fs, catalog, installRoot, validator, auditEmitter }) => {
        const svc = new m.MarketplaceService({
          repoUrl: 'https://example.test',
          catalogPath: 'catalog.json',
          cachePath: '/test-workspace/.projelli/cache/plugins.json',
          installRoot,
          fs,
          provenance: 'community',
          validator,
          auditEmitter,
        });
        // Pre-seed the in-memory catalog cache so list() resolves without a
        // network round-trip and cacheStatus() returns 'fresh'.
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
      installedEntryFor: (entryAny, installedPath) => {
        const entry = entryAny as Record<string, unknown>;
        return {
          ...entry,
          installedAt: new Date().toISOString(),
          installedPath,
          provenance: 'community',
          manifestVersion: '2.0.0',
        };
      },
    };
  });
}

async function seedMarketplaceForTest(page: Page) {
  await page.evaluate(
    ({ pluginId, pluginName }) => {
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

      // ----- catalog entry -----
      const entry = {
        id: pluginId,
        name: pluginName,
        description: 'Counts words and characters in the active editor.',
        version: '1.0.0',
        author: { name: 'Projelli Examples' },
        category: 'writing',
        tags: ['editor', 'writing', 'stats'],
        installUrl: 'https://example.test/word-counter-1.0.0.tar.gz',
        manifestUrl: 'https://example.test/word-counter-1.0.0/manifest.json',
        minProjelliVersion: '2.0.0',
        publishedAt: '2026-04-28T00:00:00.000Z',
        updatedAt: '2026-04-28T00:00:00.000Z',
        checksum: 'fakehash',
      };

      // ----- on-disk manifest so the detail view's manifest fetch resolves -
      // The detail view fetches `entry.manifestUrl` to learn the permissions
      // before showing the consent dialog. We intercept the fetch with the
      // page.route() handler set up in the spec; here we keep the manifest
      // shape consistent with what the route returns.
      const manifest = {
        id: pluginId,
        name: pluginName,
        version: '1.0.0',
        apiVersion: '2.0.0',
        author: { name: 'Projelli Examples' },
        description: 'Counts words and characters in the active editor.',
        main: 'index.js',
        permissions: ['editor:selection'],
        minProjelliVersion: '2.0.0',
        category: 'writing',
        tags: ['editor', 'writing', 'stats'],
        license: 'MIT',
      };

      const installRoot = '/test-workspace/.projelli/plugins';
      const installDir = `${installRoot}/${pluginId}`;
      files.set(`${installDir}/manifest.json`, JSON.stringify(manifest));
      files.set(`${installDir}/index.js`, '// noop in e2e');

      // ----- plugin manifest validator (passed to MarketplaceService) -----
      // The MarketplaceService default validator is the templates one; we
      // need to supply the plugin validator. We can't import it from the
      // page scope without going through Vite's module graph, so we inline
      // a permissive shim that returns the manifest as-is. The e2e test is
      // exercising the UI flow, not the schema.
      const validator = (raw: unknown) => {
        const r = raw as { apiVersion?: string };
        return { ok: true, manifest: { apiVersion: r.apiVersion ?? '2.0.0' } };
      };
      const auditEmitter = {
        installSucceeded: () => {},
        installFailed: () => {},
        uninstalled: () => {},
        updated: () => {},
      };

      const storeRef = (
        window as unknown as {
          __pluginsMarketplaceStore?: {
            getState: () => {
              seed: (svc: unknown) => void;
              setCacheStatus: (s: 'fresh' | 'stale' | 'offline') => void;
            };
          };
          __pluginsMarketplaceTestKit?: {
            buildService: (opts: {
              fs: unknown;
              catalog: unknown[];
              installRoot: string;
              validator: unknown;
              auditEmitter: unknown;
            }) => unknown;
            installedEntryFor: (entry: unknown, installedPath: string) => unknown;
          };
        }
      ).__pluginsMarketplaceStore;

      const kit = (
        window as unknown as {
          __pluginsMarketplaceTestKit?: {
            buildService: (opts: {
              fs: unknown;
              catalog: unknown[];
              installRoot: string;
              validator: unknown;
              auditEmitter: unknown;
            }) => unknown;
            installedEntryFor: (entry: unknown, installedPath: string) => unknown;
          };
        }
      ).__pluginsMarketplaceTestKit;

      if (!storeRef || !kit) {
        throw new Error(
          '[e2e] plugins marketplace test seam missing. Make sure App is mounted.',
        );
      }

      const service = kit.buildService({
        fs,
        catalog: [entry],
        installRoot,
        validator,
        auditEmitter,
      });
      storeRef.getState().seed(service);
      storeRef.getState().setCacheStatus('fresh');

      (
        window as unknown as {
          __pluginsMarketplaceE2ECtx?: {
            service: unknown;
            fs: unknown;
            installRoot: string;
            entry: unknown;
            installedPath: string;
          };
        }
      ).__pluginsMarketplaceE2ECtx = {
        service,
        fs,
        installRoot,
        entry,
        installedPath: installDir,
      };
    },
    { pluginId: PLUGIN_ID, pluginName: PLUGIN_NAME },
  );
}

test.describe('Plugins Marketplace E2E', () => {
  test('browse → install (with consent) → installed list → uninstall from installed list', async ({
    page,
  }) => {
    // Intercept the manifest fetch so the detail view's consent prep works
    // without hitting example.test. Set up BEFORE navigation so the route
    // matches the React effect that fires on mount.
    await page.route(
      'https://example.test/**',
      async (route) => {
        const url = route.request().url();
        if (url.endsWith('manifest.json')) {
          await route.fulfill({
            status: 200,
            contentType: 'application/json',
            body: JSON.stringify({
              id: PLUGIN_ID,
              name: PLUGIN_NAME,
              version: '1.0.0',
              apiVersion: '2.0.0',
              author: { name: 'Projelli Examples' },
              description:
                'Counts words and characters in the active editor.',
              main: 'index.js',
              permissions: ['editor:selection'],
              minProjelliVersion: '2.0.0',
              category: 'writing',
              tags: ['editor', 'writing', 'stats'],
              license: 'MIT',
            }),
          });
          return;
        }
        // Anything else (catalog.json, tarball) is handled by the seeded
        // service's in-memory cache; deny by default.
        await route.abort();
      },
    );

    await page.goto('/?testMode=true');
    await waitForTestModeLoad(page);

    await exposePluginsMarketplaceTestKit(page);
    await seedMarketplaceForTest(page);

    // ---- Step 1: open Settings → Marketplace → Plugins ----
    await hardClick(page.getByTestId('settings-gear'));
    await expect(page.getByTestId('settings-modal')).toBeVisible();
    await hardClick(page.getByTestId('settings-category-marketplace'));
    await expect(page.getByTestId('marketplace-tab')).toBeVisible();

    // Switch to Plugins subtab.
    await hardClick(page.getByTestId('marketplace-subtab-plugins'));
    await expect(page.getByTestId('plugins-tab')).toBeVisible();

    // ---- Step 2: see catalog tile ----
    const card = page.getByTestId(`plugin-catalog-card-${PLUGIN_ID}`);
    await expect(card).toBeVisible({ timeout: 10_000 });

    // ---- Step 3: open detail view ----
    await hardClick(card);
    await expect(page.getByTestId('plugin-detail-view')).toBeVisible();
    await expect(page.getByTestId('plugin-detail-name')).toContainText(
      PLUGIN_NAME,
    );

    // Permissions list is fetched + rendered before the consent dialog opens.
    await expect(
      page.getByTestId('plugin-detail-permissions'),
    ).toBeVisible();

    // ---- Step 4: stub the install pipeline + click [Install] ----
    // The real install would call Tauri invoke (which throws in dev). For
    // the E2E we patch service.install in-place to bypass the Tauri pipeline
    // and synthesize the installed.json + emit a success outcome through
    // the same code path the user sees.
    await page.evaluate(() => {
      const ctx = (
        window as unknown as {
          __pluginsMarketplaceE2ECtx: {
            service: {
              install: (id: string, opts?: unknown) => Promise<unknown>;
              uninstall: (id: string) => Promise<void>;
              listInstalled: () => Promise<unknown[]>;
            };
            fs: { write: (p: string, c: string) => Promise<void> };
            installRoot: string;
            entry: unknown;
            installedPath: string;
          };
          __pluginsMarketplaceTestKit: {
            installedEntryFor: (entry: unknown, installedPath: string) => unknown;
          };
        }
      ).__pluginsMarketplaceE2ECtx;
      const kit = (
        window as unknown as {
          __pluginsMarketplaceTestKit: {
            installedEntryFor: (entry: unknown, installedPath: string) => unknown;
          };
        }
      ).__pluginsMarketplaceTestKit;

      const installedEntry = kit.installedEntryFor(ctx.entry, ctx.installedPath);
      const installedRef: { entry: unknown | null } = { entry: installedEntry };

      ctx.service.install = async () => {
        await ctx.fs.write(
          `${ctx.installRoot}/.installed.json`,
          JSON.stringify({ entries: [installedRef.entry] }, null, 2),
        );
        (
          ctx.service as unknown as { installedCache: unknown }
        ).installedCache = null;
        installedRef.entry = installedEntry;
        return installedEntry;
      };

      ctx.service.uninstall = async () => {
        await ctx.fs.write(
          `${ctx.installRoot}/.installed.json`,
          JSON.stringify({ entries: [] }, null, 2),
        );
        (
          ctx.service as unknown as { installedCache: unknown }
        ).installedCache = null;
        installedRef.entry = null;
      };
    });

    await hardClick(page.getByTestId('plugin-detail-install'));

    // ---- Step 5: see consent dialog with permissions, click Approve ----
    await expect(page.getByTestId('plugin-consent-dialog')).toBeVisible({
      timeout: 10_000,
    });
    await expect(page.getByTestId('plugin-consent-dialog-title')).toContainText(
      PLUGIN_NAME,
    );
    await hardClick(page.getByTestId('plugin-consent-dialog-approve'));

    // ---- Step 6: see success outcome panel ----
    await expect(
      page.getByTestId('plugin-detail-outcome-success'),
    ).toBeVisible({ timeout: 10_000 });

    // Back to catalog grid.
    await hardClick(page.getByTestId('plugin-detail-back'));

    // ---- Step 7: switch to Installed subtab and see the entry ----
    await hardClick(page.getByTestId('plugins-tab-subview-installed'));
    await expect(page.getByTestId('settings-modal')).toContainText(PLUGIN_NAME);

    // ---- Step 8: uninstall from the Installed list ----
    // The InstalledPluginsList renders an Uninstall button per row. Test it
    // without going through the detail view (the dual-entry-point invariant:
    // both the detail view and the installed list must drive uninstall).
    const uninstallButton = page.getByTestId(
      `installed-plugin-uninstall-${PLUGIN_ID}`,
    );
    await expect(uninstallButton).toBeVisible();
    await hardClick(uninstallButton);

    // Confirm dialog: matched by its title + button text since the shared
    // ConfirmDialog has no testid hooks.
    await expect(page.getByRole('alertdialog')).toBeVisible();
    await expect(
      page.getByRole('alertdialog').getByText('Uninstall plugin?'),
    ).toBeVisible();
    await hardClick(
      page.getByRole('alertdialog').getByRole('button', { name: 'Uninstall' }),
    );

    // ---- Step 9: verify removal from the Installed list ----
    await expect(
      page.getByTestId(`installed-plugin-uninstall-${PLUGIN_ID}`),
    ).toBeHidden({ timeout: 10_000 });
  });
});
