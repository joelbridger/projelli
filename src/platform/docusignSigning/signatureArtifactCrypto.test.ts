import { describe, expect, it } from 'vitest';

import { generateContentKey } from '@/platform/intake/intakeCrypto';
import { decryptSignatureArtifact, encryptSignatureArtifact } from './signatureWorkflow';

const record = { requestId: 'request-1', signatureItemId: 'signature-1', sourcePdfFillItemId: 'pdf-1', sourceTemplateVersion: 1, sourceTemplateSha256: 'a'.repeat(64), wave8CompletedSha256: 'b'.repeat(64), envelopeId: 'env-1', requestSlug: 'request-a1', matterFolderPath: '/workspace/client', status: 'completion_pending' as const, events: [] };

describe('signed artifact encryption', () => {
  it('writes AES-GCM ciphertext rather than plaintext and decrypts exactly with the protected record key', async () => {
    const plaintext = new TextEncoder().encode('signed synthetic PDF bytes');
    const key = await generateContentKey();
    const ciphertext = await encryptSignatureArtifact(key, record, 'signed-pdf', plaintext);
    expect(ciphertext).not.toEqual(plaintext);
    expect(Array.from(await decryptSignatureArtifact(key, record, 'signed-pdf', ciphertext))).toEqual(Array.from(plaintext));
  });
});
