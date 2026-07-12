import type { BundleResponse, ChunkUpload, StateBlob, SubmitManifest } from '@/platform/intake/intakeContract';

export class RelayError extends Error {
  override name = 'RelayError';
}

export class RelayClient {
  constructor(
    private readonly intakeId: string,
    private readonly tokenB64: string,
  ) {}

  async fetchBundle(): Promise<BundleResponse> {
    return this.requestJson<BundleResponse>(`/intake/${encodeURIComponent(this.intakeId)}/bundle`);
  }

  async saveState(state: StateBlob): Promise<void> {
    await this.requestVoid(`/intake/${encodeURIComponent(this.intakeId)}/state`, {
      method: 'PUT',
      body: JSON.stringify(state),
    });
  }

  async fetchUploadedIndexes(itemId: string, submissionId: string): Promise<number[]> {
    const query = new URLSearchParams({ submission_id: submissionId });
    const body = await this.requestJson<{ uploaded_indexes: number[] }>(
      `/intake/${encodeURIComponent(this.intakeId)}/item/${encodeURIComponent(itemId)}/chunks?${query.toString()}`,
    );
    return Array.isArray(body.uploaded_indexes) ? body.uploaded_indexes : [];
  }

  async uploadChunk(itemId: string, chunk: ChunkUpload): Promise<void> {
    await this.requestVoid(
      `/intake/${encodeURIComponent(this.intakeId)}/item/${encodeURIComponent(itemId)}/chunk`,
      {
        method: 'POST',
        body: JSON.stringify(chunk),
      },
    );
  }

  async submitManifest(itemId: string, manifest: SubmitManifest): Promise<void> {
    await this.requestVoid(
      `/intake/${encodeURIComponent(this.intakeId)}/item/${encodeURIComponent(itemId)}/submit`,
      {
        method: 'POST',
        body: JSON.stringify(manifest),
      },
    );
  }

  private headers(): HeadersInit {
    return {
      Authorization: `Bearer ${this.tokenB64}`,
      'Content-Type': 'application/json',
    };
  }

  private async requestJson<T>(url: string, init: RequestInit = {}): Promise<T> {
    const response = await fetch(url, { ...init, headers: { ...this.headers(), ...init.headers } });
    if (!response.ok) throw new RelayError(`Relay request failed with ${String(response.status)}.`);
    return (await response.json()) as T;
  }

  private async requestVoid(url: string, init: RequestInit): Promise<void> {
    const response = await fetch(url, { ...init, headers: { ...this.headers(), ...init.headers } });
    if (!response.ok) throw new RelayError(`Relay request failed with ${String(response.status)}.`);
  }
}
