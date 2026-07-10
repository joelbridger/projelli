#!/usr/bin/env node
import { createHash } from 'node:crypto';
import { pathToFileURL } from 'node:url';
import {
  bundleHashForAssets,
  readPublicKeyFromEnv,
  verifyManifestSignature,
} from './manifest.mjs';
import { normalizeOrigin, validateIntakePageHeaders } from './headers.mjs';

function parseArgs(argv) {
  const options = {
    baseUrl: process.env.INTAKE_STAGING_BASE_URL,
    manifestPath: '/manifest.json',
    relayOrigin: process.env.INTAKE_STAGING_RELAY_ORIGIN,
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

    if (arg === '--base-url') options.baseUrl = next();
    else if (arg === '--manifest-path') options.manifestPath = next();
    else if (arg === '--relay-origin') options.relayOrigin = next();
    else if (arg === '--print-json') options.printJson = true;
    else throw new Error(`Unknown argument: ${arg}`);
  }

  return options;
}

function sha256Hex(bytes) {
  return createHash('sha256').update(bytes).digest('hex');
}

function headersToObject(headers) {
  const out = {};
  headers.forEach((value, key) => {
    out[key] = value;
  });
  return out;
}

function makeAssetUrl(baseUrl, assetPath) {
  const base = baseUrl.endsWith('/') ? baseUrl : `${baseUrl}/`;
  const cleanPath = assetPath.replace(/^\/+/u, '');
  return new URL(cleanPath, base).toString();
}

async function fetchOrFail(url) {
  const response = await fetch(url, { cache: 'no-store', redirect: 'error' });
  if (!response.ok) {
    throw new Error(`Fetch failed for ${url}: HTTP ${String(response.status)}`);
  }
  return response;
}

export async function verifyServedBundle(rawOptions = {}) {
  const baseUrlRaw = rawOptions.baseUrl;
  if (!baseUrlRaw)
    throw new Error('Missing --base-url or INTAKE_STAGING_BASE_URL.');
  const baseUrl = new URL(baseUrlRaw);
  if (baseUrl.hash) throw new Error('Base URL must not include a fragment.');
  baseUrl.hash = '';

  const manifestPath = rawOptions.manifestPath ?? '/manifest.json';
  const manifestUrl = makeAssetUrl(baseUrl.toString(), manifestPath);
  const manifestResponse = await fetchOrFail(manifestUrl);
  const manifestHeaders = headersToObject(manifestResponse.headers);
  const manifest = await manifestResponse.json();

  const relayOrigin = normalizeOrigin(
    rawOptions.relayOrigin ?? manifest.relay_origin
  );
  const headerCheck = validateIntakePageHeaders(manifestHeaders, relayOrigin);
  if (!headerCheck.ok) {
    throw new Error(
      `Served headers failed security check:\n${headerCheck.errors.join('\n')}`
    );
  }

  const publicKeyPem = rawOptions.publicKeyPem ?? readPublicKeyFromEnv();
  if (!publicKeyPem) {
    throw new Error(
      'Missing manifest verification key. Set INTAKE_MANIFEST_VERIFY_PUBLIC_KEY_PEM or INTAKE_MANIFEST_VERIFY_PUBLIC_KEY_PATH.'
    );
  }
  const signatureCheck = verifyManifestSignature(manifest, publicKeyPem);
  if (!signatureCheck.ok) throw new Error(signatureCheck.error);

  const expectedBundleHash = bundleHashForAssets(manifest.assets ?? []);
  if (manifest.bundle_hash_sha256 !== expectedBundleHash) {
    throw new Error(
      `Manifest bundle hash mismatch: manifest ${manifest.bundle_hash_sha256}, computed ${expectedBundleHash}.`
    );
  }

  const checkedAssets = [];
  for (const asset of manifest.assets ?? []) {
    const assetUrl = makeAssetUrl(baseUrl.toString(), asset.path);
    const response = await fetchOrFail(assetUrl);
    const bytes = Buffer.from(await response.arrayBuffer());
    const actualHash = sha256Hex(bytes);
    if (actualHash !== asset.sha256) {
      throw new Error(
        `Integrity mismatch for ${asset.path}: manifest ${asset.sha256}, served ${actualHash}.`
      );
    }
    checkedAssets.push({
      path: asset.path,
      bytes: bytes.length,
      sha256: actualHash,
    });
  }

  return {
    ok: true,
    version: manifest.version,
    bundleHash: manifest.bundle_hash_sha256,
    manifestUrl,
    checkedAssets,
  };
}

async function main() {
  const options = parseArgs(process.argv.slice(2));
  const result = await verifyServedBundle(options);
  if (options.printJson) {
    process.stdout.write(`${JSON.stringify(result, null, 2)}\n`);
    return;
  }
  process.stdout.write(`Served intake bundle verified\n`);
  process.stdout.write(`Version: ${result.version}\n`);
  process.stdout.write(`Bundle hash: ${result.bundleHash}\n`);
  process.stdout.write(
    `Assets checked: ${String(result.checkedAssets.length)}\n`
  );
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? '').href) {
  main().catch((err) => {
    process.stderr.write(
      `${err instanceof Error ? err.message : String(err)}\n`
    );
    process.exit(1);
  });
}
