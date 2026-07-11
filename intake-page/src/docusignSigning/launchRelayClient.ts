import { RelayError } from '../relayClient';

export interface SigningLaunchResponse {
  launch_ciphertext_b64: string | null;
}

/** Public relay call only. The sealed launch is opened locally with the existing page key. */
export class SigningLaunchRelayClient {
  private inFlight: Promise<string | null> | null = null;

  constructor(
    private readonly intakeId: string,
    private readonly tokenB64: string,
  ) {}

  async fetchLaunch(): Promise<string | null> {
    if (this.inFlight) return this.inFlight;
    const request = this.requestLaunch();
    this.inFlight = request;
    try {
      return await request;
    } finally {
      this.inFlight = null;
    }
  }

  /** Server-side one-time consumption. The launch is removed before any ceremony navigation. */
  async consumeLaunch(): Promise<void> {
    const response = await fetch(`/docusign-signing/${encodeURIComponent(this.intakeId)}/launch`, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${this.tokenB64}` },
    });
    if (!response.ok) throw new RelayError(`Signing launch consumption failed with ${String(response.status)}.`);
  }

  private async requestLaunch(): Promise<string | null> {
    const response = await fetch(`/docusign-signing/${encodeURIComponent(this.intakeId)}/launch`, {
      headers: { Authorization: `Bearer ${this.tokenB64}` },
    });
    if (response.status === 404) return null;
    if (!response.ok) throw new RelayError(`Signing launch request failed with ${String(response.status)}.`);
    const body = await response.json() as SigningLaunchResponse;
    if (!body || typeof body !== 'object' || (body.launch_ciphertext_b64 !== null && typeof body.launch_ciphertext_b64 !== 'string')) {
      throw new RelayError('Signing launch response was not valid.');
    }
    return body.launch_ciphertext_b64;
  }
}
