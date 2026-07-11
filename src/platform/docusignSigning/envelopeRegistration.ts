import { getFirmApiBase } from '@/platform/firm/firmConfig';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';

export interface DocusignEnvelopeRegistrationOptions {
  intakeId: string;
  seatToken: string;
  accessToken?: string | null;
  baseUrl?: string;
  envelopeId: string;
}

/** Registers only the opaque DocuSign envelope id so the broker can route a wake-up to this intake. */
export async function registerDocusignEnvelope(options: DocusignEnvelopeRegistrationOptions): Promise<void> {
  const baseUrl = (options.baseUrl ?? getFirmApiBase()).replace(/\/+$/u, '');
  const fetchFn = await getCorsSafeFetch({ signalEgress: false });
  const response = await fetchFn(`${baseUrl}/docusign-signing/${encodeURIComponent(options.intakeId)}/envelope`, {
    method: 'POST',
    headers: {
      'X-Seat-Token': options.seatToken,
      ...(options.accessToken ? { Authorization: `Bearer ${options.accessToken}` } : {}),
      'Content-Type': 'application/json',
    },
    body: JSON.stringify({ envelope_id: options.envelopeId }),
  });
  if (!response.ok) throw new Error(`DocuSign envelope registration failed with HTTP ${String(response.status)}.`);
}
