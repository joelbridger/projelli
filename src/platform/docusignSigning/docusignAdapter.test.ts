import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectDocusignAdapter } from './docusignAdapter';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: vi.fn() }));
vi.mock('@/platform/privacy/localOnlyGuard', () => ({ assertLocalOnlyAllowsExternal: vi.fn() }));

const fetchMock = vi.fn();
const tabMap = { signatureTab: { page: 1, xPosition: 61, yPosition: 79, width: 122, height: 79 }, dateSignedTab: { page: 1, xPosition: 61, yPosition: 158, width: 122, height: 79 }, signerNameTab: { page: 1, xPosition: 61, yPosition: 238, width: 122, height: 79 } };

interface DocusignEnvelopeRequest {
  documents: Array<{ documentBase64: string }>;
  recipients: {
    signers: Array<{
      clientUserId: string;
      routingOrder: string;
      deliveryMethod: string;
      tabs: {
        signHereTabs: unknown[];
        dateSignedTabs: unknown[];
        fullNameTabs: unknown[];
      };
    }>;
  };
}

function parseEnvelopeRequest(init: RequestInit): DocusignEnvelopeRequest {
  if (typeof init.body !== 'string') throw new Error('Expected the DocuSign request body to be JSON text.');
  return JSON.parse(init.body) as DocusignEnvelopeRequest;
}

describe('direct DocuSign adapter', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock); });
  it('uses the broker-provided account URI and sends the exact completed bytes only to DocuSign', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ envelopeId: 'env-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://demo.docusign.net/Signing/view' }), { status: 201 }));
    const adapter = new DirectDocusignAdapter(() => Promise.resolve({ accessToken: 'short-lived', accountId: 'acct-1', baseUri: 'https://demo.docusign.net', expiresAt: new Date(Date.now() + 60_000).toISOString(), allowedReturnUrl: 'https://lantern.test/return' }));
    const pdf = new TextEncoder().encode('exact flattened bytes');
    await expect(adapter.createEnvelopeAndRecipientView({ pdfBytes: pdf, signerName: 'Synthetic Signer', signerEmail: 'synthetic@example.test', requestId: 'request-1', signatureItemId: 'signature-1', clientUserId: 'lantern-abcd', tabMap, returnUrl: 'https://lantern.test/return' })).resolves.toEqual({ envelopeId: 'env-1', recipientViewUrl: 'https://demo.docusign.net/Signing/view' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://demo.docusign.net/restapi/v2.1/accounts/acct-1/envelopes');
    const body = parseEnvelopeRequest(init);
    const [document] = body.documents;
    const [signer] = body.recipients.signers;
    if (!document || !signer) throw new Error('Expected exactly one document and one signer.');
    expect(atob(document.documentBase64)).toBe('exact flattened bytes');
    expect(signer.clientUserId).toBe('lantern-abcd');
    expect(signer.routingOrder).toBe('1');
    expect(signer.deliveryMethod).toBe('email');
    expect(signer.tabs.signHereTabs).toHaveLength(1);
    expect(signer.tabs.dateSignedTabs).toHaveLength(1);
    expect(signer.tabs.fullNameTabs).toHaveLength(1);
    expect(fetchMock.mock.calls.every(([callUrl]) => new URL(String(callUrl)).hostname.endsWith('.docusign.net'))).toBe(true);
  });

  it('does not allow a second recipient-view URL for one envelope', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ envelopeId: 'env-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://demo.docusign.net/Signing/view' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ envelopeId: 'env-1' }), { status: 201 }));
    const adapter = new DirectDocusignAdapter(() => Promise.resolve({ accessToken: 'short-lived', accountId: 'acct-1', baseUri: 'https://demo.docusign.net', expiresAt: new Date(Date.now() + 60_000).toISOString(), allowedReturnUrl: 'https://lantern.test/return' }));
    const input = { pdfBytes: new TextEncoder().encode('pdf'), signerName: 'Signer', signerEmail: 's@example.test', requestId: 'r', signatureItemId: 's', clientUserId: 'client', tabMap, returnUrl: 'https://lantern.test/return' };
    await adapter.createEnvelopeAndRecipientView(input);
    await expect(adapter.createEnvelopeAndRecipientView(input)).rejects.toThrow(/already generated/iu);
  });

  it('refuses a return URL that does not exactly match the broker pin before contacting DocuSign', async () => {
    const adapter = new DirectDocusignAdapter(() => Promise.resolve({ accessToken: 'short-lived', accountId: 'acct-1', baseUri: 'https://demo.docusign.net', expiresAt: new Date(Date.now() + 60_000).toISOString(), allowedReturnUrl: 'https://lantern.test/return' }));
    const input = { pdfBytes: new TextEncoder().encode('pdf'), signerName: 'Signer', signerEmail: 's@example.test', requestId: 'r', signatureItemId: 's', clientUserId: 'client', tabMap, returnUrl: 'https://untrusted.test/return' };

    await expect(adapter.createEnvelopeAndRecipientView(input)).rejects.toThrow('DocuSign return URL is not the broker-allowed URL.');
    expect(fetchMock).not.toHaveBeenCalled();
  });

  it('refuses a mismatched return URL on the standalone recipient-view path too, before contacting DocuSign', async () => {
    const adapter = new DirectDocusignAdapter(() => Promise.resolve({ accessToken: 'short-lived', accountId: 'acct-1', baseUri: 'https://demo.docusign.net', expiresAt: new Date(Date.now() + 60_000).toISOString(), allowedReturnUrl: 'https://lantern.test/return' }));
    const input = { envelopeId: 'env-1', signerName: 'Signer', signerEmail: 's@example.test', clientUserId: 'client', returnUrl: 'https://untrusted.test/return' };

    await expect(adapter.createRecipientView(input)).rejects.toThrow('DocuSign return URL is not the broker-allowed URL.');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
