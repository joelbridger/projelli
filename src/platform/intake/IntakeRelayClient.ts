import { getFirmApiBase } from '@/platform/firm/firmConfig';
import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import type { IntakeInboxPage, IntakeInboxSubmission } from './IntakeSyncClient';
import type { ChunkUpload } from './intakeContract';

export interface IntakeCreateRequest {
  intake_id: string;
  matter_id: string;
  auth_token: string;
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

interface IntakeRelayInboxResponse {
  intake_id: string;
  cursor: number;
  latest_cursor: number;
  has_more: boolean;
  submissions: IntakeRelayInboxSubmission[];
}

export interface GrantedIntakeRoute {
  intake_id: string;
  matter_id: string;
  epoch: number;
}

interface IntakeRelayBlobRef {
  blob_id: number;
  index: number;
  size: number;
}

interface IntakeRelayInboxSubmission extends Omit<IntakeInboxSubmission, 'chunks'> {
  chunk_count: number;
  blobs: IntakeRelayBlobRef[];
}

function bytesToB64(bytes: Uint8Array): string {
  let bin = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    bin += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(bin);
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

  private authHeaders(hasBody = false): Record<string, string> {
    const headers: Record<string, string> = { 'X-Seat-Token': this.seatToken };
    if (this.accessToken) headers['Authorization'] = `Bearer ${this.accessToken}`;
    if (hasBody) headers['Content-Type'] = 'application/json';
    return headers;
  }

  private async responseError(res: Response): Promise<Error> {
    let text = '';
    try {
      text = await res.text();
    } catch (error) {
      console.warn(
        '[IntakeRelayClient] Failed to read error response body:',
        error
      );
    }
    return new Error(
      text || `Intake relay request failed with HTTP ${String(res.status)}.`
    );
  }

  private async request<T>(
    path: string,
    init: { method: string; body?: unknown; headers?: Record<string, string> }
  ): Promise<T> {
    const fetchFn = await getCorsSafeFetch({ signalEgress: false });
    const res = await fetchFn(`${this.baseUrl}${path}`, {
      method: init.method,
      headers: { ...this.authHeaders(init.body !== undefined), ...init.headers },
      ...(init.body !== undefined ? { body: JSON.stringify(init.body) } : {}),
    });
    if (!res.ok) {
      throw await this.responseError(res);
    }
    const text = await res.text();
    return (text ? JSON.parse(text) : { ok: true }) as T;
  }

  private async fetchBlobCiphertextB64(
    intakeId: string,
    blobId: number
  ): Promise<string> {
    const fetchFn = await getCorsSafeFetch({ signalEgress: false });
    const res = await fetchFn(
      `${this.baseUrl}/intake/${encodeURIComponent(intakeId)}/blob/${encodeURIComponent(String(blobId))}`,
      {
        method: 'GET',
        headers: this.authHeaders(),
      }
    );
    if (!res.ok) throw await this.responseError(res);
    // LANE0-FIX-BLOB-ASSEMBLE
    return bytesToB64(new Uint8Array(await res.arrayBuffer()));
  }

  private async assembleInboxSubmission(
    submission: IntakeRelayInboxSubmission
  ): Promise<IntakeInboxSubmission> {
    const chunks: ChunkUpload[] = await Promise.all(
      [...submission.blobs]
        .sort((a, b) => a.index - b.index)
        .map(async (blob) => ({
          intake_id: submission.intake_id,
          item_id: submission.item_id,
          submission_id: submission.submission_id,
          index: blob.index,
          ciphertext_b64: await this.fetchBlobCiphertextB64(
            submission.intake_id,
            blob.blob_id
          ),
        }))
    );
    return {
      cursor: submission.cursor,
      intake_id: submission.intake_id,
      item_id: submission.item_id,
      submission_id: submission.submission_id,
      submitted_at: submission.submitted_at,
      manifest_ciphertext_b64: submission.manifest_ciphertext_b64,
      wrapped_content_key_b64: submission.wrapped_content_key_b64,
      chunks,
    };
  }

  createIntake(body: IntakeCreateRequest): Promise<IntakeCreateResponse> {
    return this.request<IntakeCreateResponse>('/intake', {
      method: 'POST',
      body,
    });
  }

  extendIntake(
    intakeId: string,
    expiresAt: string
  ): Promise<{ ok: true; expires_at: string }> {
    return this.request<{ ok: true; expires_at: string }>(
      `/intake/${encodeURIComponent(intakeId)}/extend`,
      {
        method: 'POST',
        body: { expires_at: expiresAt },
      }
    );
  }

  revokeIntake(intakeId: string): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(
      `/intake/${encodeURIComponent(intakeId)}/revoke`,
      {
        method: 'POST',
      }
    );
  }

  regenerateIntake(
    intakeId: string,
    body: IntakeUpdateBundleRequest
  ): Promise<{ ok: true }> {
    return this.request<{ ok: true }>(
      `/intake/${encodeURIComponent(intakeId)}/regenerate`,
      {
        method: 'POST',
        body,
      }
    );
  }

  async fetchInbox(
    intakeId: string,
    sinceCursor: number
  ): Promise<IntakeInboxPage> {
    const page = await this.request<IntakeRelayInboxResponse>(
      `/intake/${encodeURIComponent(intakeId)}/inbox?cursor=${encodeURIComponent(String(sinceCursor))}`,
      {
        method: 'GET',
      }
    );
    return {
      cursor: page.cursor,
      has_more: page.has_more,
      submissions: await Promise.all(
        page.submissions.map((submission) =>
          this.assembleInboxSubmission(submission)
        )
      ),
    };
  }

  listGrantedIntakes(deviceId: string): Promise<{ intakes: GrantedIntakeRoute[] }> {
    return this.request<{ intakes: GrantedIntakeRoute[] }>('/intake/granted', {
      method: 'GET',
      headers: { 'X-Device-Id': deviceId },
    });
  }

  async ackSubmission(
    intakeId: string,
    submissionId: string,
    cursor: number
  ): Promise<void> {
    await this.request<{ ok: true }>(
      `/intake/${encodeURIComponent(intakeId)}/ack`,
      {
        method: 'POST',
        body: {
          submission_ids: [submissionId],
          cursor,
        },
      }
    );
  }
}
