import { beforeEach, describe, expect, it, vi } from 'vitest';

import { getCorsSafeFetch } from '@/platform/providers/fetchUtils';
import { IntakeRelayClient } from './IntakeRelayClient';

vi.mock('@/platform/providers/fetchUtils', () => ({
  getCorsSafeFetch: vi.fn(),
}));

const fetchMock = vi.fn();

function jsonResponse(body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status: 200,
    headers: { 'content-type': 'application/json' },
  });
}

describe('IntakeRelayClient inbox methods', () => {
  beforeEach(() => {
    fetchMock.mockReset();
    vi.mocked(getCorsSafeFetch).mockResolvedValue(fetchMock as unknown as typeof fetch);
  });

  it('fetches the advisor inbox and maps the relay page to the sync page shape', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({
      intake_id: 'intake-1',
      cursor: 22,
      latest_cursor: 25,
      has_more: true,
      submissions: [{
        cursor: 22,
        intake_id: 'intake-1',
        item_id: 'ssn',
        submission_id: 'submission-1',
        submitted_at: '2026-07-10T00:00:00.000Z',
        manifest_ciphertext_b64: 'manifest',
        wrapped_content_key_b64: 'wrapped',
        chunks: [],
      }],
    }));

    const client = new IntakeRelayClient({
      baseUrl: 'https://relay.example.test/',
      seatToken: 'seat-token',
      accessToken: 'access-token',
    });

    await expect(client.fetchInbox('intake-1', 14)).resolves.toEqual({
      cursor: 22,
      has_more: true,
      submissions: [{
        cursor: 22,
        intake_id: 'intake-1',
        item_id: 'ssn',
        submission_id: 'submission-1',
        submitted_at: '2026-07-10T00:00:00.000Z',
        manifest_ciphertext_b64: 'manifest',
        wrapped_content_key_b64: 'wrapped',
        chunks: [],
      }],
    });
    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.example.test/intake/intake-1/inbox?since=14',
      expect.objectContaining({
        method: 'GET',
        headers: {
          'X-Seat-Token': 'seat-token',
          Authorization: 'Bearer access-token',
        },
      }),
    );
  });

  it('acks a routed submission with the existing relay ack contract', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse({ ok: true }));
    const client = new IntakeRelayClient({
      baseUrl: 'https://relay.example.test',
      seatToken: 'seat-token',
    });

    await client.ackSubmission('intake-1', 'submission-1', 22);

    expect(fetchMock).toHaveBeenCalledWith(
      'https://relay.example.test/intake/intake-1/ack',
      expect.objectContaining({
        method: 'POST',
        headers: {
          'X-Seat-Token': 'seat-token',
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          submission_ids: ['submission-1'],
          cursor: 22,
        }),
      }),
    );
  });
});
