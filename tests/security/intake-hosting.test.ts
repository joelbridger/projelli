import { afterEach, beforeAll, describe, expect, it } from 'vitest';
import { generateKeyPairSync } from 'node:crypto';
import { spawn, spawnSync } from 'node:child_process';
import {
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { tmpdir } from 'node:os';
// prettier-ignore
// @ts-expect-error The intake deploy helpers are plain Node ESM scripts.
import { buildIntakeSecurityHeaders, DEFAULT_INTAKE_STAGING_RELAY_ORIGIN, findThirdPartyOriginTokens, parseCsp, validateIntakePageHeaders } from '../../infra/intake/headers.mjs';
// @ts-expect-error The intake deploy helpers are plain Node ESM scripts.
import { buildStaticBundle } from '../../infra/intake/build-static-bundle.mjs';
// @ts-expect-error The intake deploy helpers are plain Node ESM scripts.
import { startDryRunServer } from '../../infra/intake/deploy-staging.mjs';
// @ts-expect-error The intake deploy helpers are plain Node ESM scripts.
import { verifyServedBundle } from '../../infra/intake/verify-served-bundle.mjs';
// @ts-expect-error The intake deploy helpers are plain Node ESM scripts.
import { runFragmentNeverLoggedCheck } from '../../infra/intake/fragment-never-logged-check.mjs';

const repoRoot = process.cwd();
const tempDirs: string[] = [];

// The compiled intake client page. The "signs the compiled Vite output" test
// reuses this instead of spawning tsc+vite inside vitest (which exhausts
// process/file handles under the concurrent gate). The gate pre-builds it
// serially; this beforeAll is the standalone/pre-push fallback — one build,
// before the tests run, only if dist is missing.
const intakePageDist = path.join(repoRoot, 'intake-page', 'dist');
const intakePageRoot = path.join(repoRoot, 'intake-page');
beforeAll(() => {
  if (!existsSync(path.join(intakePageDist, 'index.html'))) {
    // Launch npm's JavaScript entry point through Node, rather than its
    // Windows-only .cmd wrapper. Calling the wrapper from Vitest made this
    // fallback depend on shell quoting and PATH resolution.
    const npmCli = process.env['npm_execpath'];
    if (!npmCli) {
      throw new Error('Cannot find npm CLI for the intake-page build fallback.');
    }
    const result = spawnSync(process.execPath, [npmCli, 'run', 'build'], {
      cwd: intakePageRoot,
      stdio: 'inherit',
    });
    if (result.status !== 0) {
      const detail = result.error?.message ?? `exit status ${String(result.status)}`;
      throw new Error(`Failed to build intake-page/dist for the hosting security tests: ${detail}`);
    }
  }
}, 180_000);

afterEach(() => {
  while (tempDirs.length) {
    const dir = tempDirs.pop();
    if (dir) rmSync(dir, { recursive: true, force: true });
  }
});

function makeTempDir(): string {
  const dir = mkdtempSync(path.join(tmpdir(), 'intake-hosting-'));
  tempDirs.push(dir);
  return dir;
}

function makeSigningKeys(): { privateKeyPem: string; publicKeyPem: string } {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey
      .export({ type: 'pkcs8', format: 'pem' })
      .toString(),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }).toString(),
  };
}

function runNode(
  args: string[],
  env: Record<string, string | undefined>
): Promise<{ status: number | null; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const child = spawn(process.execPath, args, {
      cwd: repoRoot,
      env,
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    let stdout = '';
    let stderr = '';
    child.stdout.setEncoding('utf8');
    child.stderr.setEncoding('utf8');
    child.stdout.on('data', (chunk) => {
      stdout += chunk;
    });
    child.stderr.on('data', (chunk) => {
      stderr += chunk;
    });
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });
}

describe('intake hosting headers', () => {
  it('pins CSP to self and rejects third-party origins', () => {
    const relayOrigin = DEFAULT_INTAKE_STAGING_RELAY_ORIGIN;
    const headers = buildIntakeSecurityHeaders(relayOrigin);
    const csp = parseCsp(headers['Content-Security-Policy']);

    expect(csp.get('default-src')).toEqual(["'none'"]);
    expect(csp.get('connect-src')).toEqual(["'self'"]);
    expect(headers['Referrer-Policy']).toBe('no-referrer');
    expect(headers['X-Content-Type-Options']).toBe('nosniff');
    expect(validateIntakePageHeaders(headers, relayOrigin).errors).toEqual([]);
    expect(findThirdPartyOriginTokens(headers, relayOrigin)).toEqual([]);

    const poisoned = {
      ...headers,
      'Content-Security-Policy': `${headers['Content-Security-Policy']}; img-src https://cdn.example.com`,
    };
    expect(validateIntakePageHeaders(poisoned, relayOrigin).ok).toBe(false);
  });

  it('keeps page hosting same-origin, ordered, and short-retained', () => {
    const pageSnippet = readFileSync(
      path.join(repoRoot, 'infra/intake/Caddyfile.intake-page-staging.snippet'),
      'utf8'
    );
    const relaySnippet = readFileSync(
      path.join(repoRoot, 'infra/intake/Caddyfile.intake-relay-staging.snippet'),
      'utf8'
    );

    expect(pageSnippet).toContain("connect-src 'self'");
    expect(pageSnippet).toContain('reverse_proxy /intake/* 127.0.0.1:5195');
    expect(pageSnippet.indexOf('reverse_proxy /intake/*')).toBeLessThan(
      pageSnippet.indexOf('try_files {path} /index.html')
    );
    expect(pageSnippet.indexOf('handle_path /_releases/*')).toBeLessThan(
      pageSnippet.indexOf('try_files {path} /index.html')
    );
    expect(pageSnippet).toMatch(
      /log @intake_page_staging \{[\s\S]*roll_keep_for 24h/u
    );
    expect(relaySnippet).toMatch(
      /log @intake_relay_staging \{[\s\S]*roll_keep_for 24h/u
    );
  });
});

describe('intake bundle integrity', () => {
  it('default pipeline signs the compiled Vite output, not raw source', () => {
    const temp = makeTempDir();
    const relayOrigin = DEFAULT_INTAKE_STAGING_RELAY_ORIGIN;
    const keys = makeSigningKeys();
    const previousPrivateKey =
      process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'];

    let build: ReturnType<typeof buildStaticBundle>;
    try {
      process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'] =
        keys.privateKeyPem;
      // Reuse the pre-built intake-page/dist (beforeAll ensures it exists) rather
      // than spawning a fresh tsc+vite build inside the concurrent vitest run.
      build = buildStaticBundle({ outDir: temp, relayOrigin, buildPage: false });
    } finally {
      if (previousPrivateKey === undefined)
        delete process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'];
      else
        process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'] =
          previousPrivateKey;
    }

    const assetPaths = build.manifest.assets.map(
      (asset: { path: string }) => asset.path
    );
    expect(assetPaths).toContain('index.html');
    expect(
      assetPaths.some((assetPath: string) =>
        /^assets\/.+\.js$/u.test(assetPath)
      )
    ).toBe(true);
    expect(
      assetPaths.some((assetPath: string) => assetPath.endsWith('.tsx'))
    ).toBe(false);
  });

  it('passes when served bytes match and fails non-zero after an asset is tampered', async () => {
    const temp = makeTempDir();
    const sourceDir = path.join(temp, 'src');
    const outDir = path.join(temp, 'dist');
    const relayOrigin = DEFAULT_INTAKE_STAGING_RELAY_ORIGIN;
    const keys = makeSigningKeys();
    const previousPrivateKey =
      process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'];

    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      path.join(sourceDir, 'index.html'),
      '<!doctype html><html><head><title>Intake</title></head><body><script type="module" src="/app.js"></script></body></html>'
    );
    writeFileSync(
      path.join(sourceDir, 'app.js'),
      'document.body.dataset.ready = "true";\n'
    );

    let build: ReturnType<typeof buildStaticBundle>;
    try {
      process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'] =
        keys.privateKeyPem;
      build = buildStaticBundle({ sourceDir, outDir, relayOrigin });
    } finally {
      if (previousPrivateKey === undefined)
        delete process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'];
      else
        process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'] =
          previousPrivateKey;
    }

    const dryRunServer = await startDryRunServer(build.releaseDir, relayOrigin);
    try {
      const verifyScript = path.join(
        repoRoot,
        'infra/intake/verify-served-bundle.mjs'
      );
      const baseArgs = [
        verifyScript,
        '--base-url',
        dryRunServer.baseUrl,
        '--relay-origin',
        relayOrigin,
      ];
      const env = {
        ...process.env,
        INTAKE_MANIFEST_VERIFY_PUBLIC_KEY_PEM: keys.publicKeyPem,
      };

      const clean = await runNode(baseArgs, env);
      expect(clean.status).toBe(0);

      writeFileSync(
        path.join(build.releaseDir, 'app.js'),
        'document.body.dataset.ready = "tampered";\n'
      );
      const tampered = await runNode(baseArgs, env);
      expect(tampered.status).not.toBe(0);
      expect(tampered.stderr).toContain('Integrity mismatch');
    } finally {
      await new Promise((resolve) => dryRunServer.server.close(resolve));
    }
  });

  it('rejects a stale but valid served release when it is not the just-built bundle', async () => {
    const temp = makeTempDir();
    const sourceDir = path.join(temp, 'src');
    const outDir = path.join(temp, 'dist');
    const relayOrigin = DEFAULT_INTAKE_STAGING_RELAY_ORIGIN;
    const keys = makeSigningKeys();
    const previousPrivateKey =
      process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'];

    mkdirSync(sourceDir, { recursive: true });
    writeFileSync(
      path.join(sourceDir, 'index.html'),
      '<!doctype html><html><head><title>Intake</title></head><body><script type="module" src="/app.js"></script></body></html>'
    );
    writeFileSync(path.join(sourceDir, 'app.js'), 'window.v = "old";\n');

    let oldBuild: ReturnType<typeof buildStaticBundle>;
    let newBuild: ReturnType<typeof buildStaticBundle>;
    try {
      process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'] =
        keys.privateKeyPem;
      oldBuild = buildStaticBundle({ sourceDir, outDir, relayOrigin });
      writeFileSync(path.join(sourceDir, 'app.js'), 'window.v = "new";\n');
      newBuild = buildStaticBundle({ sourceDir, outDir, relayOrigin });
    } finally {
      if (previousPrivateKey === undefined)
        delete process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'];
      else
        process.env['INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM'] =
          previousPrivateKey;
    }

    const dryRunServer = await startDryRunServer(
      oldBuild.releaseDir,
      relayOrigin
    );
    try {
      await expect(
        verifyServedBundle({
          baseUrl: dryRunServer.baseUrl,
          relayOrigin,
          publicKeyPem: keys.publicKeyPem,
          expectedVersion: newBuild.version,
          expectedBundleHash: newBuild.bundleHash,
        })
      ).rejects.toThrow(
        /Served manifest version mismatch|Served bundle hash mismatch/u
      );

      await expect(
        verifyServedBundle({
          baseUrl: dryRunServer.baseUrl,
          relayOrigin,
          publicKeyPem: keys.publicKeyPem,
          expectedVersion: oldBuild.version,
          expectedBundleHash: oldBuild.bundleHash,
        })
      ).resolves.toMatchObject({ ok: true, version: oldBuild.version });
    } finally {
      await new Promise((resolve) => dryRunServer.server.close(resolve));
    }
  });
});

describe('intake fragment logging', () => {
  it('proves URL fragments do not reach HTTP logs and staged config avoids reconstruction', async () => {
    const result = await runFragmentNeverLoggedCheck({
      configDir: path.join(repoRoot, 'infra/intake'),
    });
    expect(result.ok).toBe(true);
    expect(result.capturedUrls.join('\n')).not.toContain('#');
    expect(result.checkedConfigFiles).toContain(
      'Caddyfile.intake-page-staging.snippet'
    );
    expect(result.checkedConfigFiles).toContain(
      'Caddyfile.intake-relay-staging.snippet'
    );
  });
});
