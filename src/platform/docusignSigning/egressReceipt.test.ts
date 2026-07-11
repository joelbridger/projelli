import { describe, expect, it, vi } from 'vitest';

import { createDocusignEgressReceipt } from './egressReceipt';
import { DocusignLaunchRelayClient } from './launchRelayClient';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';

vi.mock('@/platform/providers/fetchUtils', () => ({ getCorsSafeFetch: vi.fn() }));

describe('DocuSign egress and relay boundary', () => {
  it('records the explicit direct-to-DocuSign data boundary', () => {
    expect(createDocusignEgressReceipt({ host: 'demo.docusign.net', requestId: 'request-1', signatureItemId: 'signature-1', outcome: 'allowed', at: '2026-07-11T00:00:00.000Z' })).toMatchObject({ destinationClass: 'docusign', dataCategories: ['completed_pdf', 'signer_name', 'signer_email'], userConfirmed: true, outcome: 'allowed' });
  });
  it('puts only ciphertext on the Lantern launch relay', async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify({ ok: true }), { status: 200 }));
    vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock);
    await new DocusignLaunchRelayClient({ baseUrl: 'https://firm.example', seatToken: 'seat' }).putLaunch('intake-1', 'ciphertext-only');
    expect(fetchMock).toHaveBeenCalledWith('https://firm.example/docusign-signing/intake-1/launch', expect.objectContaining({ body: JSON.stringify({ launch_ciphertext_b64: 'ciphertext-only' }) }));
    expect(JSON.stringify(fetchMock.mock.calls)).not.toContain('signer');
  });
});
