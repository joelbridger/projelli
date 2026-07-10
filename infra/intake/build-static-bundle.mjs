#!/usr/bin/env node
import {
  cpSync,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  buildIntakeCsp,
  DEFAULT_INTAKE_STAGING_RELAY_ORIGIN,
  normalizeOrigin,
} from './headers.mjs';
import {
  buildUnsignedManifest,
  generateEphemeralManifestKeypair,
  MANIFEST_FILE,
  readPrivateKeyFromEnv,
  signManifest,
} from './manifest.mjs';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const REPO_ROOT = path.resolve(__dirname, '../..');
const DEFAULT_PAGE_DIR = path.join(REPO_ROOT, 'intake-page');
const DEFAULT_SOURCE_DIR = path.join(DEFAULT_PAGE_DIR, 'dist');
const DEFAULT_OUT_DIR = path.join(REPO_ROOT, 'dist/intake-staging');

function parseArgs(argv) {
  const options = {
    sourceDir: undefined,
    outDir: DEFAULT_OUT_DIR,
    relayOrigin:
      process.env.INTAKE_STAGING_RELAY_ORIGIN ??
      DEFAULT_INTAKE_STAGING_RELAY_ORIGIN,
    environment: 'staging',
    allowEphemeralSigningKey: false,
    buildPage: true,
    printJson: false,
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    const next = () => {
      const value = argv[i + 1];
      if (!value) throw new Error(`Missing value for ${arg}.`);
      i += 1;
      return value;
    };

    if (arg === '--source-dir') options.sourceDir = path.resolve(next());
    else if (arg === '--out-dir') options.outDir = path.resolve(next());
    else if (arg === '--relay-origin') options.relayOrigin = next();
    else if (arg === '--environment') options.environment = next();
    else if (arg === '--no-page-build') options.buildPage = false;
    else if (arg === '--allow-ephemeral-signing-key')
      options.allowEphemeralSigningKey = true;
    else if (arg === '--print-json') options.printJson = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function htmlEscape(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;');
}

function replacePlaceholders(filePath, replacements) {
  const textExtensions = new Set([
    '.html',
    '.js',
    '.mjs',
    '.css',
    '.json',
    '.txt',
    '.svg',
  ]);
  if (!textExtensions.has(path.extname(filePath).toLowerCase())) return;
  const original = readFileSync(filePath, 'utf8');
  let updated = original;
  for (const [token, value] of Object.entries(replacements)) {
    updated = updated.split(token).join(value);
  }
  if (updated !== original) writeFileSync(filePath, updated);
}

function walkFiles(dir) {
  const entries = [];
  for (const name of readdirSync(dir).sort()) {
    const fullPath = path.join(dir, name);
    const stat = statSync(fullPath);
    if (stat.isDirectory()) entries.push(...walkFiles(fullPath));
    else if (stat.isFile()) entries.push(fullPath);
  }
  return entries;
}

function runIntakePageBuild(pageDir = DEFAULT_PAGE_DIR) {
  const result = spawnSync('npm', ['--prefix', pageDir, 'run', 'build'], {
    cwd: REPO_ROOT,
    stdio: 'inherit',
    env: process.env,
  });
  if (result.error) throw result.error;
  if (result.status !== 0) {
    throw new Error(
      `intake-page build failed with exit code ${String(result.status)}.`
    );
  }
}

function getSigningKeys(options) {
  const privateKeyPem = readPrivateKeyFromEnv();
  if (privateKeyPem) {
    return { privateKeyPem, publicKeyPem: undefined, ephemeral: false };
  }
  if (!options.allowEphemeralSigningKey) {
    throw new Error(
      'Missing manifest signing key. Set INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM or INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PATH.'
    );
  }
  const keys = generateEphemeralManifestKeypair();
  return { ...keys, ephemeral: true };
}

export function buildStaticBundle(rawOptions = {}) {
  const defaults = {
    sourceDir: undefined,
    outDir: DEFAULT_OUT_DIR,
    relayOrigin:
      process.env.INTAKE_STAGING_RELAY_ORIGIN ??
      DEFAULT_INTAKE_STAGING_RELAY_ORIGIN,
    environment: 'staging',
    allowEphemeralSigningKey: false,
    buildPage: undefined,
  };
  const options = { ...defaults };
  for (const [key, value] of Object.entries(rawOptions)) {
    if (value !== undefined) options[key] = value;
  }

  const sourceDir = path.resolve(options.sourceDir ?? DEFAULT_SOURCE_DIR);
  const outDir = path.resolve(options.outDir);
  const relayOrigin = normalizeOrigin(options.relayOrigin);
  const csp = buildIntakeCsp(relayOrigin);
  const shouldBuildPage = options.buildPage ?? options.sourceDir === undefined;

  if (shouldBuildPage) runIntakePageBuild();

  if (!existsSync(sourceDir)) {
    throw new Error(`Intake page build folder does not exist: ${sourceDir}`);
  }

  mkdirSync(outDir, { recursive: true });
  const tmpDir = path.join(outDir, `.tmp-${process.pid}-${Date.now()}`);
  rmSync(tmpDir, { recursive: true, force: true });
  mkdirSync(tmpDir, { recursive: true });
  cpSync(sourceDir, tmpDir, {
    recursive: true,
    dereference: true,
    filter: (src) => !src.includes(`${path.sep}node_modules${path.sep}`),
  });

  const replacements = {
    __INTAKE_RELAY_ORIGIN__: relayOrigin,
    __INTAKE_CSP__: htmlEscape(csp),
  };
  for (const filePath of walkFiles(tmpDir))
    replacePlaceholders(filePath, replacements);

  const unsignedManifest = buildUnsignedManifest({
    rootDir: tmpDir,
    relayOrigin,
    environment: options.environment,
  });
  const signing = getSigningKeys(options);
  const manifest = signManifest(unsignedManifest, signing.privateKeyPem);

  writeFileSync(
    path.join(tmpDir, MANIFEST_FILE),
    `${JSON.stringify(manifest, null, 2)}\n`
  );

  const releasesDir = path.join(outDir, 'releases');
  const finalDir = path.join(releasesDir, manifest.version);
  mkdirSync(releasesDir, { recursive: true });
  rmSync(finalDir, { recursive: true, force: true });
  renameSync(tmpDir, finalDir);

  const result = {
    version: manifest.version,
    bundleHash: manifest.bundle_hash_sha256,
    releaseDir: finalDir,
    manifestPath: path.join(finalDir, MANIFEST_FILE),
    relayOrigin,
    manifest,
    publicKeyPemForDryRun: signing.ephemeral ? signing.publicKeyPem : undefined,
    usedEphemeralSigningKey: signing.ephemeral,
  };
  return result;
}

function printResult(result, printJson) {
  if (printJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Intake staging bundle built\n`);
  process.stdout.write(`Version: ${result.version}\n`);
  process.stdout.write(`Bundle hash: ${result.bundleHash}\n`);
  process.stdout.write(`Release dir: ${result.releaseDir}\n`);
  process.stdout.write(`Manifest: ${result.manifestPath}\n`);
  if (result.usedEphemeralSigningKey) {
    process.stdout.write(
      `Signing key: ephemeral dry-run key (not for staging deploy)\n`
    );
  }
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = buildStaticBundle(options);
  printResult(result, options.printJson);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  });
}
