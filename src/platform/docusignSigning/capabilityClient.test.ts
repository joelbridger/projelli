import { describe, expect, it, vi } from 'vitest';

import { createDocusignAuthorizationProvider } from './capabilityClient';
import { registerDocusignEnvelope } from './envelopeRegistration';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: vi.fn() }));

describe('DocuSign broker capability clients', () => {
  it('uses the authenticated opaque capability contract without sending client data', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'short', account_id: 'account', base_uri: 'https://demo.docusign.net', expires_at: '2026-12-01T00:00:00.000Z', return_url: 'https://lantern.test/return' }), { status: 200 }));
    vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock);
    await expect(createDocusignAuthorizationProvider({ intakeId: 'intake-1', seatToken: 'seat', accessToken: 'access', baseUrl: 'https://relay.test', templateId: 'approved-template' })()).resolves.toMatchObject({ accountId: 'account', baseUri: 'https://demo.docusign.net', allowedReturnUrl: 'https://lantern.test/return' });
    const [url, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(url).toBe('https://relay.test/docusign-signing/intake-1/capability');
    expect(init.headers).toMatchObject({ 'X-Seat-Token': 'seat', Authorization: 'Bearer access' });
    expect(init.body).toBe(JSON.stringify({ template_id: 'approved-template' }));
  });

  it('rejects a capability response that omits the broker return URL', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ access_token: 'short', account_id: 'account', base_uri: 'https://demo.docusign.net', expires_at: '2026-12-01T00:00:00.000Z' }), { status: 200 }));
    vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock);

    await expect(createDocusignAuthorizationProvider({ intakeId: 'intake-1', seatToken: 'seat', baseUrl: 'https://relay.test' })()).rejects.toThrow('DocuSign authorization response was incomplete.');
  });

  it('registers just the opaque envelope id and fails closed on broker errors', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(null, { status: 204 }));
    vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock);
    await registerDocusignEnvelope({ intakeId: 'intake-1', seatToken: 'seat', baseUrl: 'https://relay.test', envelopeId: 'env-1' });
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ method: 'POST', body: JSON.stringify({ envelope_id: 'env-1' }) });
  });
});
