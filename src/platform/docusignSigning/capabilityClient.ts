import { getFirmApiBase } from '@/platform/firm/firmConfig';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';

import type { DocusignAuthorizationProvider } from './docusignAdapter';

export interface DocusignCapabilityOptions {
  intakeId: string;
  seatToken: string;
  accessToken?: string | null;
  baseUrl?: string;
  templateId?: string;
}

function validText(value: unknown): value is string { return typeof value === 'string' && value.trim().length > 0; }

/** Gets a fresh, short-lived DocuSign credential. This request contains no client data or document bytes. */
export function createDocusignAuthorizationProvider(options: DocusignCapabilityOptions): DocusignAuthorizationProvider {
  const baseUrl = (options.baseUrl ?? getFirmApiBase()).replace(/\/+$/u, '');
  return async () => {
    const fetchFn = await getCorsSafeFetch({ signalEgress: false });
    const response = await fetchFn(`${baseUrl}/docusign-signing/${encodeURIComponent(options.intakeId)}/capability`, {
      method: 'POST',
      headers: {
        'X-Seat-Token': options.seatToken,
        ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
        'Content-Type': 'application/json',
      },
      body: JSON.stringify(options.templateId === undefined ? {} : { template_id: options.templateId }),
    });
    if (!response.ok) throw new Error(`DocuSign authorization request failed with HTTP ${String(response.status)}.`);
    const body: unknown = await response.json();
    if (!body || typeof body !== 'object') throw new Error('DocuSign authorization response was malformed.');
    const parsed = body as Record<string, unknown>;
    if (!validText(parsed['access_token']) || !validText(parsed['account_id']) || !validText(parsed['base_uri']) || !validText(parsed['expires_at']) || !validText(parsed['return_url'])) {
      throw new Error('DocuSign authorization response was incomplete.');
    }
    return { accessToken: parsed['access_token'], accountId: parsed['account_id'], baseUri: parsed['base_uri'], expiresAt: parsed['expires_at'], allowedReturnUrl: parsed['return_url'] };
  };
}
