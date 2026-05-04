// Smoke test for the create-projelli-plugin CLI.
//
// Verifies that:
//   1. Running `node bin/create.js <name> --no-install` in a temp dir produces
//      every expected file with placeholders substituted.
//   2. The scaffolded plugin's vite build produces a non-empty IIFE bundle
//      after wiring the local @projelli/plugin-api into node_modules.
//
// `--no-install` is used because the @projelli/plugin-api package is not
// published to npm yet; we link it locally for the build step.

import {
  existsSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  mkdirSync,
  symlinkSync,
} from 'node:fs';
import { resolve, join } from 'node:path';
import { tmpdir } from 'node:os';
import { spawnSync } from 'node:child_process';
import { describe, it, expect, beforeAll } from 'vitest';

const REPO_ROOT = resolve(__dirname, '..', '..', '..');
const CLI_BIN = resolve(REPO_ROOT, 'packages', 'create-projelli-plugin', 'bin', 'create.js');
const PLUGIN_API_DIR = resolve(REPO_ROOT, 'packages', 'plugin-api');
const PLUGIN_API_DIST = resolve(PLUGIN_API_DIR, 'dist', 'index.d.ts');

function ensurePluginApiBuilt(): void {
  if (existsSync(PLUGIN_API_DIST)) return;
  const result = spawnSync('npm', ['run', 'build'], {
    cwd: PLUGIN_API_DIR,
    stdio: 'inherit',
  });
  if (result.status !== 0) {
    throw new Error('Failed to build @projelli/plugin-api before tests');
  }
}

describe('create-projelli-plugin CLI', () => {
  beforeAll(() => {
    ensurePluginApiBuilt();
  });

  it('scaffolds the expected file tree with placeholders substituted', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cpp-scaffold-'));
    try {
      const result = spawnSync('node', [CLI_BIN, 'demo-plugin', '--no-install'], {
        cwd: tmp,
        encoding: 'utf8',
      });
      expect(result.status).toBe(0);
      expect(result.stdout).toContain('Scaffolded demo-plugin');

      const target = join(tmp, 'demo-plugin');
      const expectedFiles = [
        'manifest.json',
        'package.json',
        'tsconfig.json',
        'vite.config.ts',
        'README.md',
        'LICENSE',
        '.gitignore',
        'src/index.ts',
      ];
      for (const f of expectedFiles) {
        expect(existsSync(join(target, f)), `missing scaffolded file: ${f}`).toBe(true);
      }

      const manifest = JSON.parse(readFileSync(join(target, 'manifest.json'), 'utf8')) as {
        id: string;
        name: string;
        permissions: string[];
      };
      expect(manifest.id).toBe('demo-plugin');
      expect(manifest.name).toBe('Demo Plugin');
      expect(Array.isArray(manifest.permissions)).toBe(true);

      const indexTs = readFileSync(join(target, 'src/index.ts'), 'utf8');
      expect(indexTs).toContain("'demo-plugin.greet'");
      expect(indexTs).not.toContain('__PLUGIN_ID__');

      const pkgJson = JSON.parse(readFileSync(join(target, 'package.json'), 'utf8')) as {
        name: string;
        devDependencies: Record<string, string>;
      };
      expect(pkgJson.name).toBe('demo-plugin');
      expect(pkgJson.devDependencies['@projelli/plugin-api']).toBeDefined();
      expect(pkgJson.devDependencies['vite']).toBeDefined();
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 30_000);

  it('rejects invalid names', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cpp-invalid-'));
    try {
      const result = spawnSync('node', [CLI_BIN, 'BadName', '--no-install'], {
        cwd: tmp,
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('invalid name');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 15_000);

  it('refuses to overwrite a non-empty directory without --force', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cpp-overwrite-'));
    try {
      const target = join(tmp, 'collide');
      mkdirSync(target);
      // Drop a file in it.
      mkdirSync(join(target, 'something'));
      const result = spawnSync('node', [CLI_BIN, 'collide', '--no-install'], {
        cwd: tmp,
        encoding: 'utf8',
      });
      expect(result.status).not.toBe(0);
      expect(result.stderr).toContain('not empty');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 15_000);

  it('the scaffolded plugin builds with vite to a non-empty IIFE bundle', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'cpp-build-'));
    try {
      // 1. Scaffold.
      const scaffold = spawnSync('node', [CLI_BIN, 'build-test', '--no-install'], {
        cwd: tmp,
        encoding: 'utf8',
      });
      expect(scaffold.status).toBe(0);

      const target = join(tmp, 'build-test');

      // 2. Wire up node_modules so vite can resolve plugin-api + its own deps.
      mkdirSync(join(target, 'node_modules', '@projelli'), { recursive: true });
      symlinkSync(
        PLUGIN_API_DIR,
        join(target, 'node_modules', '@projelli', 'plugin-api'),
        'dir',
      );

      // 3. Install vite + typescript locally. Use --no-save since this is a
      //    throwaway fixture; we don't want to mutate the scaffolded
      //    package.json.
      const install = spawnSync(
        'npm',
        ['install', '--no-save', '--no-audit', '--no-fund', 'vite@^6.0.5', 'typescript@^5.6.2'],
        { cwd: target, encoding: 'utf8' },
      );
      if (install.status !== 0) {
        throw new Error(`npm install failed:\n${install.stdout}\n${install.stderr}`);
      }

      // 4. Build.
      const build = spawnSync('npx', ['vite', 'build'], {
        cwd: target,
        encoding: 'utf8',
      });
      if (build.status !== 0) {
        throw new Error(`vite build failed:\n${build.stdout}\n${build.stderr}`);
      }

      // 5. Verify dist/index.js exists and looks like an IIFE bundle.
      const distPath = join(target, 'dist', 'index.js');
      expect(existsSync(distPath)).toBe(true);
      const distContents = readFileSync(distPath, 'utf8');
      expect(distContents.length).toBeGreaterThan(0);
      // Vite wraps IIFE bundles in `var <name> = (function() { ... })()`.
      expect(distContents).toMatch(/var\s+ProjelliPlugin\s*=/);
      // The user's command id should be preserved in the output.
      expect(distContents).toContain('build-test.greet');
    } finally {
      rmSync(tmp, { recursive: true, force: true });
    }
  }, 180_000);
});
