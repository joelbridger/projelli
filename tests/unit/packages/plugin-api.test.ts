// Smoke test for the @projelli/plugin-api package.
//
// The package is types-only; there is no runtime to assert against. Instead we
// verify two things:
//   1. The build artifact exists and exports the expected type names.
//   2. The TypeScript types compile against a representative plugin source
//      (synthesized inline below) without errors.
//
// (2) is implemented by spawning a one-off `tsc --noEmit` against a temp
// fixture that imports from the built dist. If tsc reports any error, the
// test fails. This guards against accidental drift between the app source
// types and the published surface.

import { existsSync, readFileSync, mkdtempSync, writeFileSync, rmSync, mkdirSync, readdirSync, statSync, copyFileSync } from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'vitest';

const PKG_ROOT = resolve(__dirname, '..', '..', '..', 'packages', 'plugin-api');
const DIST_INDEX = resolve(PKG_ROOT, 'dist', 'index.d.ts');

function ensureBuilt(): void {
  if (existsSync(DIST_INDEX)) return;
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: PKG_ROOT,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('Failed to build @projelli/plugin-api before tests');
  }
}

describe('@projelli/plugin-api package', () => {
  beforeAll(() => {
    ensureBuilt();
  });

  it('emits a non-empty dist/index.d.ts', () => {
    expect(existsSync(DIST_INDEX)).toBe(true);
    const contents = readFileSync(DIST_INDEX, 'utf8');
    expect(contents.length).toBeGreaterThan(0);
  });

  it('re-exports the canonical plugin type names', () => {
    const contents = readFileSync(DIST_INDEX, 'utf8');
    const expectedExports = [
      'PluginAPI',
      'PluginManifest',
      'PluginPermission',
      'ToolbarButtonSpec',
      'SidebarPanelSpec',
      'SettingsPageSpec',
      'CommandSpec',
      'PluginModule',
    ];
    for (const name of expectedExports) {
      expect(contents).toContain(name);
    }
  });

  it('the emitted plugin.d.ts preserves the 6 declarable permissions', () => {
    const pluginTypes = readFileSync(
      resolve(PKG_ROOT, 'dist', '_app-types', 'plugin.d.ts'),
      'utf8',
    );
    const permissions = [
      "'workspace:read'",
      "'workspace:write'",
      "'editor:selection'",
      "'editor:write'",
      "'ai:invoke'",
      "'network'",
    ];
    for (const p of permissions) {
      expect(pluginTypes).toContain(p);
    }
  });

  it('a representative plugin author file typechecks against the dist types', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'projelli-plugin-api-'));
    try {
      mkdirSync(join(tmp, 'node_modules', '@projelli'), { recursive: true });
      // Symlink would be cleaner but we copy for portability across FSes used
      // in CI containers.
      const linkTarget = join(tmp, 'node_modules', '@projelli', 'plugin-api');
      mkdirSync(linkTarget, { recursive: true });

      // Copy the package.json + dist into the fixture's node_modules.
      const pkgJson = readFileSync(join(PKG_ROOT, 'package.json'), 'utf8');
      writeFileSync(join(linkTarget, 'package.json'), pkgJson, 'utf8');

      // Recursively copy the dist tree.
      const copyDir = (src: string, dst: string): void => {
        mkdirSync(dst, { recursive: true });
        for (const entry of readdirSync(src)) {
          const s = join(src, entry);
          const d = join(dst, entry);
          if (statSync(s).isDirectory()) copyDir(s, d);
          else copyFileSync(s, d);
        }
      };
      copyDir(resolve(PKG_ROOT, 'dist'), join(linkTarget, 'dist'));

      const sample = `
import type { PluginModule, PluginAPI, PluginManifest, PluginPermission } from '@projelli/plugin-api';

const _manifest: PluginManifest = {
  id: 'sample.plugin',
  name: 'Sample Plugin',
  version: '0.1.0',
  apiVersion: '1.0.0',
  author: { name: 'Test' },
  description: 'sample',
  main: 'index.js',
  permissions: [],
  minProjelliVersion: '2.0.0',
  category: 'utility',
  tags: [],
};

const _perm: PluginPermission = 'editor:selection';

const plugin: PluginModule = {
  activate(api: PluginAPI) {
    api.commands.register('sample.cmd', () => api.notify.info('hi'));
  },
};

export { plugin, _manifest, _perm };
`;
      writeFileSync(join(tmp, 'plugin.ts'), sample, 'utf8');
      writeFileSync(
        join(tmp, 'tsconfig.json'),
        JSON.stringify({
          compilerOptions: {
            target: 'ES2022',
            module: 'ESNext',
            moduleResolution: 'bundler',
            strict: true,
            exactOptionalPropertyTypes: true,
            noEmit: true,
            skipLibCheck: true,
            isolatedModules: true,
            lib: ['ES2022', 'DOM', 'DOM.Iterable'],
          },
          include: ['plugin.ts'],
        }),
        'utf8',
      );

      const result = spawnSync(
        'npx',
        ['--no-install', 'tsc', '-p', tmp],
        { cwd: PKG_ROOT, encoding: 'utf8' },
      );
      if (result.status !== 0) {
        throw new Error(
          `tsc reported errors in fixture:\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
        );
      }
      expect(result.status).toBe(0);
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);
});
