/**
 * v1.5 regression guard — `scripts/build-mcpb.mjs` main-check.
 *
 * Background: v1.5-rc.7 silently skipped the Windows .mcpb build
 * because the main-check used `import.meta.url === \`file://${argv[1]}\``
 * which is case-sensitive and Windows path-style-sensitive. Node on
 * Windows serves argv[1] as `D:\...\build-mcpb.mjs`, so the string
 * comparison returned `false` and `main()` never ran — the script
 * exited clean with no output. The CI upload step then failed because
 * the expected `.mcpb` file didn't exist.
 *
 * Fix (rc.8): compare via `fileURLToPath(import.meta.url)` so both sides
 * are canonical absolute paths before string-equality.
 *
 * This spec runs the shipped `build-mcpb.mjs` as a subprocess with two
 * kinds of invalid input and verifies the exit codes we expect:
 *
 *   - No args at all → exit code 1, error message from `parseArgs`.
 *   - Valid arg shape but binary doesn't exist → exit code 2, error
 *     message from `main()`.
 *
 * Both cases require `main()` to have actually been invoked. If the
 * `fileURLToPath` check regresses again, `main()` will silently no-op
 * and we'll see exit code 0 with no output — both tests below fail.
 */

import { test, expect } from '@playwright/test';
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import { dirname, join } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const scriptPath = join(__dirname, '..', '..', 'scripts', 'build-mcpb.mjs');

test.describe('v1.5 regression — build-mcpb.mjs main-check', () => {
  test('no args: main() runs parseArgs and exits 1 with usage message', async () => {
    const result = spawnSync('node', [scriptPath], {
      encoding: 'utf8',
      timeout: 10_000,
    });

    // The main-check MUST execute. If it doesn't, exit code is 0 and
    // stderr is empty — both would fail the assertions below.
    expect(result.status).toBe(1);
    expect(result.stderr).toContain('missing required args');
    expect(result.stderr).toContain('usage: build-mcpb.mjs');
  });

  test('valid args with nonexistent binary: main() runs and exits 2', async () => {
    const result = spawnSync(
      'node',
      [
        scriptPath,
        '--binary',
        '/tmp/keepance-regression-nonexistent',
        '--target',
        'x86_64-pc-windows-msvc',
        '--output',
        '/tmp/keepance-regression-output.mcpb',
      ],
      {
        encoding: 'utf8',
        timeout: 10_000,
      }
    );

    // Exit code 2 comes from main() where `statSync(binary, ...)`
    // returns undefined for a nonexistent path. If main() never ran we'd
    // see 0.
    expect(result.status).toBe(2);
    expect(result.stderr).toContain('binary not found');
  });

  test('--help-like flag surfaces the unknown-arg handler (defensive)', async () => {
    // Not a real --help flag, but --help hits the default branch in
    // parseArgs and exits 1 with the unknown-arg message. This test
    // guards the "main ran" path via a different argv shape than the
    // other two tests.
    const result = spawnSync('node', [scriptPath, '--help'], {
      encoding: 'utf8',
      timeout: 10_000,
    });

    expect(result.status).toBe(1);
    expect(result.stderr).toContain('unknown arg: --help');
  });
});
