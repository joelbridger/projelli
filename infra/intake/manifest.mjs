import {
  createHash,
  createPrivateKey,
  createPublicKey,
  generateKeyPairSync,
  sign,
  verify,
} from 'node:crypto';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { buildIntakeSecurityHeaders, normalizeOrigin } from './headers.mjs';

export const MANIFEST_FILE = 'manifest.json';
export const MANIFEST_SCHEMA_VERSION = 1;

const CONTENT_TYPES = new Map([
  ['.html', 'text/html; charset=utf-8'],
  ['.js', 'text/javascript; charset=utf-8'],
  ['.mjs', 'text/javascript; charset=utf-8'],
  ['.css', 'text/css; charset=utf-8'],
  ['.json', 'application/json; charset=utf-8'],
  ['.svg', 'image/svg+xml'],
  ['.png', 'image/png'],
  ['.jpg', 'image/jpeg'],
  ['.jpeg', 'image/jpeg'],
  ['.webp', 'image/webp'],
  ['.ico', 'image/x-icon'],
  ['.txt', 'text/plain; charset=utf-8'],
  ['.woff2', 'font/woff2'],
]);

export function sha256Hex(data) {
  return createHash('sha256').update(data).digest('hex');
}

export function contentTypeForPath(filePath) {
  return (
    CONTENT_TYPES.get(path.extname(filePath).toLowerCase()) ??
    'application/octet-stream'
  );
}

export function stableStringify(value) {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value))
    return `[${value.map((item) => stableStringify(item)).join(',')}]`;

  const entries = Object.entries(value)
    .filter(([, entryValue]) => entryValue !== undefined)
    .sort(([a], [b]) => a.localeCompare(b));
  return `{${entries
    .map(
      ([key, entryValue]) =>
        `${JSON.stringify(key)}:${stableStringify(entryValue)}`
    )
    .join(',')}}`;
}

export function manifestSigningPayload(manifest) {
  const { signature: _signature, ...unsigned } = manifest;
  return Buffer.from(stableStringify(unsigned), 'utf8');
}

function walkFiles(rootDir, dir = rootDir) {
  const files = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (entry.name === '.DS_Store') continue;
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...walkFiles(rootDir, fullPath));
    } else if (entry.isFile()) {
      const relative = path
        .relative(rootDir, fullPath)
        .split(path.sep)
        .join('/');
      if (relative !== MANIFEST_FILE) files.push(relative);
    }
  }
  return files.sort();
}

export function readAssetList(rootDir) {
  return walkFiles(rootDir).map((assetPath) => {
    const fullPath = path.join(rootDir, assetPath);
    const bytes = readFileSync(fullPath);
    return {
      path: assetPath,
      bytes: statSync(fullPath).size,
      sha256: sha256Hex(bytes),
      content_type: contentTypeForPath(assetPath),
    };
  });
}

export function bundleHashForAssets(assets) {
  const payload = assets
    .map((asset) => `${asset.path}\0${asset.bytes}\0${asset.sha256}`)
    .join('\n');
  return sha256Hex(Buffer.from(payload, 'utf8'));
}

export function buildUnsignedManifest({
  rootDir,
  relayOrigin,
  environment = 'staging',
  generatedAt = new Date().toISOString(),
}) {
  const origin = normalizeOrigin(relayOrigin);
  const headers = buildIntakeSecurityHeaders(origin);
  const assets = readAssetList(rootDir);
  const bundleHash = bundleHashForAssets(assets);

  return {
    schema_version: MANIFEST_SCHEMA_VERSION,
    surface: 'lantern-intake-page',
    environment,
    version: `intake-${bundleHash.slice(0, 16)}`,
    bundle_hash_sha256: bundleHash,
    generated_at: generatedAt,
    relay_origin: origin,
    headers,
    assets,
  };
}

export function publicKeyPemFromPrivate(privateKeyPem) {
  return createPublicKey(createPrivateKey(privateKeyPem)).export({
    type: 'spki',
    format: 'pem',
  });
}

export function publicKeyId(publicKeyPem) {
  const publicKey = createPublicKey(publicKeyPem);
  const der = publicKey.export({ type: 'spki', format: 'der' });
  return `sha256:${sha256Hex(der)}`;
}

export function signManifest(manifest, privateKeyPem) {
  const publicKeyPem = publicKeyPemFromPrivate(privateKeyPem);
  const signedBytes = sign(
    null,
    manifestSigningPayload(manifest),
    privateKeyPem
  );
  return {
    ...manifest,
    signature: {
      algorithm: 'Ed25519',
      key_id: publicKeyId(publicKeyPem),
      signature_b64: signedBytes.toString('base64'),
    },
  };
}

export function verifyManifestSignature(manifest, publicKeyPem) {
  if (!manifest.signature) {
    return { ok: false, error: 'Manifest is missing signature.' };
  }
  if (manifest.signature.algorithm !== 'Ed25519') {
    return {
      ok: false,
      error: `Unsupported manifest signature algorithm: ${manifest.signature.algorithm}.`,
    };
  }

  const expectedKeyId = publicKeyId(publicKeyPem);
  if (manifest.signature.key_id !== expectedKeyId) {
    return {
      ok: false,
      error: `Manifest key id ${manifest.signature.key_id} does not match trusted key ${expectedKeyId}.`,
    };
  }

  const signature = Buffer.from(manifest.signature.signature_b64, 'base64');
  const valid = verify(
    null,
    manifestSigningPayload(manifest),
    publicKeyPem,
    signature
  );
  return valid
    ? { ok: true }
    : { ok: false, error: 'Manifest signature verification failed.' };
}

export function generateEphemeralManifestKeypair() {
  const { privateKey, publicKey } = generateKeyPairSync('ed25519');
  return {
    privateKeyPem: privateKey.export({ type: 'pkcs8', format: 'pem' }),
    publicKeyPem: publicKey.export({ type: 'spki', format: 'pem' }),
  };
}

export function readPrivateKeyFromEnv(env = process.env) {
  if (env.INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM) {
    return env.INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PEM;
  }
  if (env.INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PATH) {
    return readFileSync(env.INTAKE_MANIFEST_SIGNING_PRIVATE_KEY_PATH, 'utf8');
  }
  return undefined;
}

export function readPublicKeyFromEnv(env = process.env) {
  if (env.INTAKE_MANIFEST_VERIFY_PUBLIC_KEY_PEM) {
    return env.INTAKE_MANIFEST_VERIFY_PUBLIC_KEY_PEM;
  }
  if (env.INTAKE_MANIFEST_VERIFY_PUBLIC_KEY_PATH) {
    return readFileSync(env.INTAKE_MANIFEST_VERIFY_PUBLIC_KEY_PATH, 'utf8');
  }
  return undefined;
}
