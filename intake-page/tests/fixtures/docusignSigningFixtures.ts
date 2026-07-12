import { sealPageJson } from '../../src/pageCrypto';

import type { SignatureLaunchRecord } from '../../../src/platform/intake/docusignSignature/signatureLaunch';

export function syntheticSignatureLaunch(overrides: Partial<SignatureLaunchRecord> = {}): SignatureLaunchRecord {
  const now = Date.now();
  return {
    requestId: 'request-synthetic-signing',
    signatureItemId: 'signature-synthetic',
    recipientViewUrl: 'https://demo.docusign.test/recipient-view/synthetic-one-time-url',
    issuedAt: new Date(now - 60_000).toISOString(),
    expiresAt: new Date(now + 5 * 60_000).toISOString(),
    consumed: false,
    ...overrides,
  };
}

export async function sealedSyntheticSignatureLaunch(
  pageKey: CryptoKey,
  overrides: Partial<SignatureLaunchRecord> = {},
): Promise<string> {
  return sealPageJson(pageKey, syntheticSignatureLaunch(overrides));
}
