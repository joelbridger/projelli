import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';

import { loadDocusignSandboxCredentials } from './docusignSandboxCreds';

const tempDirectories: string[] = [];

async function credentialsFile(body: string): Promise<string> {
  const directory = await mkdtemp(join(tmpdir(), 'docusign-sandbox-creds-'));
  tempDirectories.push(directory);
  const keyPath = join(directory, 'private-key.pem');
  await writeFile(keyPath, 'not-a-real-key');
  const envPath = join(directory, 'signing.env');
  await writeFile(envPath, body);
  return envPath;
}

const valid = [
  'DOCUSIGN_SIGNING_ENVIRONMENT=demo',
  'DOCUSIGN_SIGNING_INTEGRATION_KEY=fake-integration-key',
  'DOCUSIGN_SIGNING_IMPERSONATED_USER_ID=fake-user-id',
  'DOCUSIGN_SIGNING_ACCOUNT_ID=fake-account-id',
  'DOCUSIGN_SIGNING_ALLOWED_RETURN_URL=http://127.0.0.1:4319/return',
  'DOCUSIGN_SIGNING_CONNECT_KEY=fake-connect-key',
  'DOCUSIGN_SIGNING_PRIVATE_KEY_PATH=private-key.pem',
].join('\n');

afterEach(async () => {
  await Promise.all(tempDirectories.splice(0).map((directory) => rm(directory, { recursive: true, force: true })));
});

describe('loadDocusignSandboxCredentials', () => {
  it('returns null when credentials have not been produced yet', () => {
    expect(loadDocusignSandboxCredentials(join(tmpdir(), 'not-a-real-docusign-sandbox-creds.env'))).toBeNull();
  });

  it('parses a valid demo-only credentials file and applies the demo API default', async () => {
    const path = await credentialsFile(valid);
    expect(loadDocusignSandboxCredentials(path)).toMatchObject({
      path,
      DOCUSIGN_SIGNING_ENVIRONMENT: 'demo',
      DOCUSIGN_SIGNING_INTEGRATION_KEY: 'fake-integration-key',
      DOCUSIGN_SIGNING_DEMO_API_BASE_URI: 'https://demo.docusign.net',
      DOCUSIGN_SIGNING_PRIVATE_KEY_PATH: join(dirname(path), 'private-key.pem'),
    });
  });

  it('rejects a file that claims production', async () => {
    const path = await credentialsFile(valid.replace('DOCUSIGN_SIGNING_ENVIRONMENT=demo', 'DOCUSIGN_SIGNING_ENVIRONMENT=production'));
    expect(() => loadDocusignSandboxCredentials(path)).toThrow(/ENVIRONMENT=demo/u);
  });

  it('rejects every production-flavored variable before backend boot', async () => {
    const path = await credentialsFile(`${valid}\nDOCUSIGN_SIGNING_PRODUCTION_RELEASE=false`);
    expect(() => loadDocusignSandboxCredentials(path)).toThrow(/PRODUCTION_RELEASE/u);
  });
});
