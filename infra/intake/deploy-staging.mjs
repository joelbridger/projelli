#!/usr/bin/env node
import { createServer } from 'node:http';
import {
  cpSync,
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  readlinkSync,
  rmSync,
  symlinkSync,
} from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { buildStaticBundle } from './build-static-bundle.mjs';
import {
  buildIntakeSecurityHeaders,
  DEFAULT_INTAKE_STAGING_RELAY_ORIGIN,
  normalizeOrigin,
} from './headers.mjs';
import { contentTypeForPath, readPublicKeyFromEnv } from './manifest.mjs';
import { verifyServedBundle } from './verify-served-bundle.mjs';

function parseArgs(argv) {
  const options = {
    dryRun: false,
    sourceDir: undefined,
    outDir: undefined,
    relayOrigin:
      process.env.INTAKE_STAGING_RELAY_ORIGIN ??
      DEFAULT_INTAKE_STAGING_RELAY_ORIGIN,
    stagingWebRoot: process.env.INTAKE_STAGING_WEB_ROOT,
    stagingBaseUrl: process.env.INTAKE_STAGING_BASE_URL,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}.`);
      i += 1;
      return value;
    };

    if (arg === '--dry-run') options.dryRun = true;
    else if (arg === '--source-dir') options.sourceDir = path.resolve(next());
    else if (arg === '--out-dir') options.outDir = path.resolve(next());
    else if (arg === '--relay-origin') options.relayOrigin = next();
    else if (arg === '--staging-web-root')
      options.stagingWebRoot = path.resolve(next());
    else if (arg === '--staging-base-url') options.stagingBaseUrl = next();
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function assertStagingTarget({ stagingWebRoot, stagingBaseUrl }) {
  if (!stagingWebRoot)
    throw new Error('Missing INTAKE_STAGING_WEB_ROOT or --staging-web-root.');
  if (!stagingBaseUrl)
    throw new Error('Missing INTAKE_STAGING_BASE_URL or --staging-base-url.');

  const url = new URL(stagingBaseUrl);
  const safeHost =
    /\b(staging|stage|test)\b/iu.test(url.hostname) ||
    url.hostname === 'localhost';
  const safePath = /\b(staging|stage|test)\b/iu.test(stagingWebRoot);
  if (!safeHost || !safePath) {
    throw new Error(
      `Refusing non-staging target. Host and web root must clearly contain staging/stage/test. Got ${url.hostname} and ${stagingWebRoot}.`
    );
  }
}

function publishReleaseToLocalStagingWebRoot(
  releaseDir,
  version,
  stagingWebRoot
) {
  const releasesDir = path.join(stagingWebRoot, 'releases');
  const destReleaseDir = path.join(releasesDir, version);
  mkdirSync(releasesDir, { recursive: true });
  rmSync(destReleaseDir, { recursive: true, force: true });
  cpSync(releaseDir, destReleaseDir, { recursive: true, dereference: true });
  return { destReleaseDir };
}

function currentTarget(stagingWebRoot) {
  const currentLink = path.join(stagingWebRoot, 'current');
  if (!existsSync(currentLink)) return null;
  if (!lstatSync(currentLink).isSymbolicLink()) return null;
  return readlinkSync(currentLink);
}

function activateRelease(stagingWebRoot, destReleaseDir) {
  const currentLink = path.join(stagingWebRoot, 'current');
  const target = path.relative(stagingWebRoot, destReleaseDir);
  rmSync(currentLink, { recursive: true, force: true });
  symlinkSync(target, currentLink, 'dir');
  return { currentLink, target };
}

function restoreCurrent(stagingWebRoot, previousTarget) {
  const currentLink = path.join(stagingWebRoot, 'current');
  rmSync(currentLink, { recursive: true, force: true });
  if (previousTarget) symlinkSync(previousTarget, currentLink, 'dir');
}

function urlJoin(baseUrl, relativePath) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  return new URL(relativePath, base).toString();
}

function safePathForRequest(rootDir, requestUrl) {
  const url = new URL(requestUrl, 'http://127.0.0.1');
  const pathname = decodeURIComponent(url.pathname);
  const requestedPath = pathname === '/' ? '/index.html' : pathname;
  const fullPath = path.resolve(rootDir, `.${requestedPath}`);
  const relative = path.relative(path.resolve(rootDir), fullPath);
  if (relative.startsWith('..') || path.isAbsolute(relative))
    return path.join(rootDir, 'index.html');
  if (existsSync(fullPath) && lstatSync(fullPath).isFile()) return fullPath;
  return path.join(rootDir, 'index.html');
}

export function startDryRunServer(rootDir, relayOrigin) {
  const headers = buildIntakeSecurityHeaders(relayOrigin);
  const server = createServer((req, res) => {
    const filePath = safePathForRequest(rootDir, req.url ?? '/');
    for (const [name, value] of Object.entries(headers))
      res.setHeader(name, value);
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('Content-Type', contentTypeForPath(filePath));
    res.end(readFileSync(filePath));
  });

  return new Promise((resolve, reject) => {
    server.once('error', reject);
    server.listen(0, '127.0.0.1', () => {
      const address = server.address();
      if (!address || typeof address === 'string') {
        reject(new Error('Could not allocate dry-run server port.'));
        return;
      }
      resolve({
        server,
        baseUrl: `http://127.0.0.1:${String(address.port)}/`,
      });
    });
  });
}

async function verifyDryRunBundle(result, relayOrigin) {
  const dryRunServer = await startDryRunServer(result.releaseDir, relayOrigin);
  try {
    const publicKeyPem = result.publicKeyPemForDryRun ?? readPublicKeyFromEnv();
    return await verifyServedBundle({
      baseUrl: dryRunServer.baseUrl,
      relayOrigin,
      publicKeyPem,
      expectedVersion: result.version,
      expectedBundleHash: result.bundleHash,
    });
  } finally {
    await new Promise((resolve) => dryRunServer.server.close(resolve));
  }
}

export async function deployStaging(rawOptions = {}) {
  const options = {
    dryRun: false,
    relayOrigin:
      process.env.INTAKE_STAGING_RELAY_ORIGIN ??
      DEFAULT_INTAKE_STAGING_RELAY_ORIGIN,
    ...rawOptions,
  };
  const relayOrigin = normalizeOrigin(options.relayOrigin);

  const build = buildStaticBundle({
    sourceDir: options.sourceDir,
    outDir: options.outDir,
    relayOrigin,
    allowEphemeralSigningKey: options.dryRun,
  });

  if (options.dryRun) {
    const verification = await verifyDryRunBundle(build, relayOrigin);
    return {
      mode: 'dry-run',
      published: false,
      build,
      verification,
      note: 'Dry run only. No staging host or production host was changed.',
    };
  }

  assertStagingTarget(options);
  const publish = publishReleaseToLocalStagingWebRoot(
    build.releaseDir,
    build.version,
    options.stagingWebRoot
  );
  const candidateVerification = await verifyServedBundle({
    baseUrl: urlJoin(options.stagingBaseUrl, `_releases/${build.version}/`),
    relayOrigin,
    expectedVersion: build.version,
    expectedBundleHash: build.bundleHash,
  });
  const previousCurrentTarget = currentTarget(options.stagingWebRoot);
  const activate = activateRelease(
    options.stagingWebRoot,
    publish.destReleaseDir
  );
  let verification;
  try {
    verification = await verifyServedBundle({
      baseUrl: options.stagingBaseUrl,
      relayOrigin,
      expectedVersion: build.version,
      expectedBundleHash: build.bundleHash,
    });
  } catch (err) {
    restoreCurrent(options.stagingWebRoot, previousCurrentTarget);
    throw err;
  }

  return {
    mode: 'staging',
    published: true,
    build,
    publish,
    activate,
    candidateVerification,
    verification,
    note: 'Published to staging only. Production cutover is intentionally not supported by this script.',
  };
}

function printableResult(result) {
  return {
    mode: result.mode,
    published: result.published,
    version: result.build.version,
    bundleHash: result.build.bundleHash,
    releaseDir: result.build.releaseDir,
    manifest: result.build.manifest,
    verification: {
      version: result.verification.version,
      checkedAssets: result.verification.checkedAssets.length,
      manifestUrl: result.verification.manifestUrl,
    },
    candidateVerification: result.candidateVerification
      ? {
          version: result.candidateVerification.version,
          checkedAssets: result.candidateVerification.checkedAssets.length,
          manifestUrl: result.candidateVerification.manifestUrl,
        }
      : undefined,
    publish: result.publish,
    activate: result.activate,
    note: result.note,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await deployStaging(options);
  process.stdout.write(`${JSON.stringify(printableResult(result), null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  });
}
