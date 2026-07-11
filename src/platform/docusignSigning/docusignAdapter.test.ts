import { beforeEach, describe, expect, it, vi } from 'vitest';

import { DirectDocusignAdapter } from './docusignAdapter';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: vi.fn() }));
vi.mock('@/platform/privacy/localOnlyGuard', () => ({ assertLocalOnlyAllowsExternal: vi.fn() }));

const fetchMock = vi.fn();
const tabMap = { signatureTab: { page: 1, rect: { x: 0.1, y: 0.1, width: 0.2, height: 0.1 } }, dateSignedTab: { page: 1, rect: { x: 0.1, y: 0.2, width: 0.2, height: 0.1 } }, signerNameTab: { page: 1, rect: { x: 0.1, y: 0.3, width: 0.2, height: 0.1 } } };

describe('direct DocuSign adapter', () => {
  beforeEach(() => { vi.clearAllMocks(); vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock); });
  it('uses the broker-provided account URI and sends the exact completed bytes only to DocuSign', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ envelopeId: 'env-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://demo.docusign.net/Signing/view' }), { status: 201 }));
    const adapter = new DirectDocusignAdapter(async () => ({ accessToken: 'short-lived', accountId: 'acct-1', baseUri: 'https://demo.docusign.net', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    const pdf = new TextEncoder().encode('exact flattened bytes');
    await expect(adapter.createEnvelopeAndRecipientView({ pdfBytes: pdf, signerName: 'Synthetic Signer', signerEmail: 'synthetic@example.test', requestId: 'request-1', signatureItemId: 'signature-1', clientUserId: 'lantern-abcd', tabMap, returnUrl: 'https://lantern.test/return' })).resolves.toEqual({ envelopeId: 'env-1', recipientViewUrl: 'https://demo.docusign.net/Signing/view' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://demo.docusign.net/restapi/v2.1/accounts/acct-1/envelopes');
    const body = JSON.parse(String(init.body));
    expect(atob(body.documents[0].documentBase64)).toBe('exact flattened bytes');
    expect(body.recipients.signers[0].clientUserId).toBe('lantern-abcd');
    expect(body.recipients.signers[0].tabs).toEqual(expect.objectContaining({ signHereTabs: expect.any(Array), dateSignedTabs: expect.any(Array), fullNameTabs: expect.any(Array) }));
    expect(fetchMock.mock.calls.every(([callUrl]) => new URL(String(callUrl)).hostname.endsWith('.docusign.net'))).toBe(true);
  });

  it('does not allow a second recipient-view URL for one envelope', async () => {
    fetchMock.mockResolvedValueOnce(new Response(JSON.stringify({ envelopeId: 'env-1' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ url: 'https://demo.docusign.net/Signing/view' }), { status: 201 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ envelopeId: 'env-1' }), { status: 201 }));
    const adapter = new DirectDocusignAdapter(async () => ({ accessToken: 'short-lived', accountId: 'acct-1', baseUri: 'https://demo.docusign.net', expiresAt: new Date(Date.now() + 60_000).toISOString() }));
    const input = { pdfBytes: new TextEncoder().encode('pdf'), signerName: 'Signer', signerEmail: 's@example.test', requestId: 'r', signatureItemId: 's', clientUserId: 'client', tabMap, returnUrl: 'https://lantern.test/return' };
    await adapter.createEnvelopeAndRecipientView(input);
    await expect(adapter.createEnvelopeAndRecipientView(input)).rejects.toThrow(/already generated/iu);
  });
});
