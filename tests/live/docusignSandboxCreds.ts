import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, resolve } from 'node:path';

const DEFAULT_CREDS_PATH = resolve(homedir(), 'lantern-plus/demo-creds/docusign/signing.env');
const DEFAULT_DEMO_API_BASE_URI = 'https://demo.docusign.net';

const REQUIRED_KEYS = [
  'DOCUSIGN_SIGNING_ENVIRONMENT',
  'DOCUSIGN_SIGNING_INTEGRATION_KEY',
  'DOCUSIGN_SIGNING_IMPERSONATED_USER_ID',
  'DOCUSIGN_SIGNING_ACCOUNT_ID',
  'DOCUSIGN_SIGNING_ALLOWED_RETURN_URL',
  'DOCUSIGN_SIGNING_CONNECT_KEY',
  'DOCUSIGN_SIGNING_PRIVATE_KEY_PATH',
] as const;

type RequiredCredentialKey = (typeof REQUIRED_KEYS)[number];

export interface DocusignSandboxCredentials {
  readonly path: string;
  readonly DOCUSIGN_SIGNING_ENVIRONMENT: 'demo';
  readonly DOCUSIGN_SIGNING_INTEGRATION_KEY: string;
  readonly DOCUSIGN_SIGNING_IMPERSONATED_USER_ID: string;
  readonly DOCUSIGN_SIGNING_ACCOUNT_ID: string;
  readonly DOCUSIGN_SIGNING_DEMO_API_BASE_URI: string;
  readonly DOCUSIGN_SIGNING_ALLOWED_RETURN_URL: string;
  readonly DOCUSIGN_SIGNING_CONNECT_KEY: string;
  readonly DOCUSIGN_SIGNING_PRIVATE_KEY_PATH: string;
}

function parseEnv(source: string): Record<string, string> {
  const values: Record<string, string> = {};
  for (const rawLine of source.split(/\r?\n/u)) {
    const line = rawLine.trim();
    if (!line || line.startsWith('#')) continue;
    const match = line.match(/^(?:export\s+)?([A-Za-z_][A-Za-z0-9_]*)=(.*)$/u);
    if (!match) throw new Error('DocuSign sandbox credentials contain an invalid .env line.');
    const [, key, rawValue] = match;
    if (!key || rawValue === undefined) throw new Error('DocuSign sandbox credentials contain an invalid .env line.');
    const value = rawValue.trim();
    if (value.length >= 2 && ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'")))) {
      values[key] = value.slice(1, -1);
    } else {
      values[key] = value.replace(/\s+#.*$/u, '');
    }
  }
  return values;
}

function requireValue(values: Record<string, string>, key: RequiredCredentialKey): string {
  const value = values[key]?.trim();
  if (!value) throw new Error(`DocuSign sandbox credentials are missing ${key}.`);
  return value;
}

/**
 * Loads the deliberately demo-only signing credentials. Returning null is the
 * expected state until the separate credential-production step is complete.
 */
export function loadDocusignSandboxCredentials(
  credsPath = process.env['DOCUSIGN_SANDBOX_CREDS_PATH'] ?? DEFAULT_CREDS_PATH,
): DocusignSandboxCredentials | null {
  const path = resolve(credsPath);
  if (!existsSync(path)) return null;

  const values = parseEnv(readFileSync(path, 'utf8'));
  if (values['DOCUSIGN_SIGNING_ENVIRONMENT'] !== 'demo') {
    throw new Error('DocuSign sandbox credentials must set DOCUSIGN_SIGNING_ENVIRONMENT=demo exactly.');
  }
  for (const forbidden of ['DOCUSIGN_SIGNING_PRODUCTION_RELEASE', 'DOCUSIGN_SIGNING_PRODUCTION_API_BASE_URI']) {
    if (Object.hasOwn(values, forbidden)) {
      throw new Error(`DocuSign sandbox credentials must not contain ${forbidden}.`);
    }
  }
  if (Object.hasOwn(values, 'DOCUSIGN_SIGNING_PRIVATE_KEY_PEM')) {
    throw new Error('DocuSign sandbox credentials must use DOCUSIGN_SIGNING_PRIVATE_KEY_PATH, never inline a private key.');
  }

  const privateKeyPath = requireValue(values, 'DOCUSIGN_SIGNING_PRIVATE_KEY_PATH');
  const resolvedPrivateKeyPath = resolve(dirname(path), privateKeyPath);
  if (resolvedPrivateKeyPath !== resolve(dirname(path), 'private-key.pem')) {
    throw new Error('DOCUSIGN_SIGNING_PRIVATE_KEY_PATH must point to the sibling private-key.pem file.');
  }

  return {
    path,
    DOCUSIGN_SIGNING_ENVIRONMENT: 'demo',
    DOCUSIGN_SIGNING_INTEGRATION_KEY: requireValue(values, 'DOCUSIGN_SIGNING_INTEGRATION_KEY'),
    DOCUSIGN_SIGNING_IMPERSONATED_USER_ID: requireValue(values, 'DOCUSIGN_SIGNING_IMPERSONATED_USER_ID'),
    DOCUSIGN_SIGNING_ACCOUNT_ID: requireValue(values, 'DOCUSIGN_SIGNING_ACCOUNT_ID'),
    DOCUSIGN_SIGNING_DEMO_API_BASE_URI: values['DOCUSIGN_SIGNING_DEMO_API_BASE_URI']?.trim() || DEFAULT_DEMO_API_BASE_URI,
    DOCUSIGN_SIGNING_ALLOWED_RETURN_URL: requireValue(values, 'DOCUSIGN_SIGNING_ALLOWED_RETURN_URL'),
    DOCUSIGN_SIGNING_CONNECT_KEY: requireValue(values, 'DOCUSIGN_SIGNING_CONNECT_KEY'),
    DOCUSIGN_SIGNING_PRIVATE_KEY_PATH: resolvedPrivateKeyPath,
  };
}

export const DOCUSIGN_SANDBOX_DEFAULT_CREDS_PATH = DEFAULT_CREDS_PATH;
