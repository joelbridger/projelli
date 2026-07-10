import { getFirmApiBase } from '@/platform/firm/firmConfig';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';

export interface IntakeCreateRequest {
  intake_id: string;
  matter_id: string;
  token_b64: string;
  expires_at: string;
  checklist_ciphertext_b64: string;
  state_ciphertext_b64: string;
  checklist_version: number;
}

export interface IntakeCreateResponse {
  ok: true;
  intake_id: string;
  expires_at: string;
}

export interface IntakeUpdateBundleRequest {
  token_b64: string;
  checklist_ciphertext_b64: string;
  state_ciphertext_b64: string;
}

export interface IntakeRelayClientOptions {
  baseUrl?: string;
  seatToken: string;
  accessToken?: string | null;
}

export class IntakeRelayClient {
  private readonly baseUrl: string;
  private readonly seatToken: string;
  private readonly accessToken: string | null;

  constructor(options: IntakeRelayClientOptions) {
    this.baseUrl = (options.baseUrl ?? getFirmApiBase()).replace(/\/+$/u, '');
    this.seatToken = options.seatToken;
    this.accessToken = options.accessToken ?? null;
  }

  private async request<T>(path: string, init: { method: string; body?: unknown }): Promise<T> {
    const fetchFn = await getCorsSafeFetch({ signalEgress: false });
    const headers: Record<string, string> = { 'X-Seat-Token': this.seatToken };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    if (init.body !== undefined) headers['Content-Type'] = 'application/json';
    const res = await fetchFn(`${this.baseUrl}${path}`, {
      method: init.method,
      headers,
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      const text = await res.text().catch(() => '');
      throw new Error(text || `Intake relay request failed with HTTP ${String(res.status)}.`);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : { ok: true }) as T;
  }

  createIntake(body: IntakeCreateRequest): Promise<IntakeCreateResponse> {
    return this.request<IntakeCreateResponse>('/intake', { method: 'POST', body });
  }

  extendIntake(intakeId: string, expiresAt: string): Promise<{ ok: true; expires_at: string }> {
    return this.request<{ ok: true; expires_at: string }>(`/intake/${encodeURIComponent(intakeId)}/extend`, {
      method: 'POST',
      body: { expires_at: expiresAt },
    });
  }

  revokeIntake(intakeId: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(`/intake/${encodeURIComponent(intakeId)}/revoke`, {
      method: 'POST',
    });
  }

  regenerateIntake(intakeId: string, body: IntakeUpdateBundleRequest): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(`/intake/${encodeURIComponent(intakeId)}/regenerate`, {
      method: 'POST',
      body,
    });
  }
}
