import { getFirmApiBase } from '@/platform/firm/firmConfig';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';

export interface DocusignLaunchRelayOptions { seatToken: string; accessToken?: string | null; baseUrl?: string; }

/** Narrow ciphertext-only mailbox. This module deliberately has no readable launch fields. */
export class DocusignLaunchRelayClient {
  private readonly baseUrl: string;
  constructor(private readonly options: DocusignLaunchRelayOptions) { this.baseUrl = (options.baseUrl ?? getFirmApiBase()).replace(/\/+$/u, ''); }
  private headers(): HeadersInit { return { 'X-Seat-Token': this.options.seatToken, ...(this.options.accessToken ? { Authorization: `Bearer ${this.options.accessToken}` } : {}), 'Content-Type': 'application/json' }; }
  async putLaunch(intakeId: string, launchCiphertextB64: string): Promise<void> {
    const fetchFn = await getCorsSafeFetch({ signalEgress: false });
    const response = await fetchFn(`${this.baseUrl}/docusign-signing/${encodeURIComponent(intakeId)}/launch`, { method: 'PUT', headers: this.headers(), body: JSON.stringify({ launch_ciphertext_b64: launchCiphertextB64 }) });
    if (!response.ok) throw new Error(`Signature launch relay failed with HTTP ${String(response.status)}.`);
  }
  async deleteLaunch(intakeId: string): Promise<void> {
    const fetchFn = await getCorsSafeFetch({ signalEgress: false });
    const response = await fetchFn(`${this.baseUrl}/docusign-signing/${encodeURIComponent(intakeId)}/launch`, { method: 'DELETE', headers: this.headers() });
    if (!response.ok) throw new Error(`Signature launch removal failed with HTTP ${String(response.status)}.`);
  }
}
