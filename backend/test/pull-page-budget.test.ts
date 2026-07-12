import { afterEach, describe, expect, test } from 'bun:test';
import { Store, MAX_MATTER_PULL_CIPHERTEXT_BYTES } from '../src/lib/db.ts';
import { handlePullUpdates } from '../src/routes/matters.ts';
import { issueAuthTokens, mintSeatToken } from '../src/lib/services.ts';

function fixture() {
  const store = new Store(':memory:');
  const org = store.createOrg({ name: 'Pull Budget', plan: 'practice', packs: ['advisor'], seat_limit: 2 });
  const user = store.createUser({ org_id: org.org_id, email: 'owner@pull-budget.test', password_hash: 'x', role: 'member' });
  const seat = store.activateSeat({ org_id: org.org_id, user_id: user.user_id, machine_id: 'pull-budget-device', machine_label: null, seat_limit: 2 });
  if (!seat.ok) throw new Error('Fixture seat activation failed.');
  const matter = store.createMatter({ org_id: org.org_id });
  store.activateProvisioningMatter(matter.matter_handle);
  store.addMatterMember({ matter_handle: matter.matter_handle, org_id: org.org_id, user_id: user.user_id, role: 'editor' });
  return {
    store,
    org,
    user,
    matter,
    token: issueAuthTokens(store, user).access_token,
    seatToken: mintSeatToken(org, user, seat.seat).token,
  };
}

function pullRequest(token: string, seatToken: string, since: number): Request {
  return new Request(`http://relay.test/v2/firm/streams/opaque/updates?since=${String(since)}`, {
    headers: { authorization: `Bearer ${token}`, 'x-seat-token': seatToken },
  });
}

describe('matter pull page byte budget', () => {
  const stores: Store[] = [];
  afterEach(() => { while (stores.length) stores.pop()?.close(); });

  test('stops at the ciphertext-byte budget, reports more, and retrieves the remaining page', async () => {
    const f = fixture(); stores.push(f.store);
    const ciphertext = new Uint8Array(1024 * 1024);
    for (let index = 0; index < 9; index += 1) {
      f.store.appendMatterUpdate({
        matter_handle: f.matter.matter_handle,
        org_id: f.org.org_id,
        stream_handle: f.matter.root_stream_handle,
        blob_id: `budget-${String(index)}`,
        ciphertext,
        author_seat: 'seat-budget',
        key_epoch: 1,
      });
    }

    const first = await handlePullUpdates(
      pullRequest(f.token, f.seatToken, 0), f.store, f.matter.matter_handle, f.matter.root_stream_handle, 'budget-ip-1',
    );
    const firstBody = await first.json() as { cursor: number; has_more: boolean; updates: Array<{ ciphertext_b64: string }> };
    expect(first.status).toBe(200);
    expect(firstBody.updates).toHaveLength(8);
    expect(firstBody.has_more).toBe(true);
    const returnedCiphertextBytes = firstBody.updates.reduce((total, update) => total + Buffer.from(update.ciphertext_b64, 'base64').byteLength, 0);
    expect(returnedCiphertextBytes).toBeLessThanOrEqual(MAX_MATTER_PULL_CIPHERTEXT_BYTES);

    const second = await handlePullUpdates(
      pullRequest(f.token, f.seatToken, firstBody.cursor), f.store, f.matter.matter_handle, f.matter.root_stream_handle, 'budget-ip-2',
    );
    const secondBody = await second.json() as { has_more: boolean; updates: unknown[] };
    expect(secondBody.updates).toHaveLength(1);
    expect(secondBody.has_more).toBe(false);
  });

  test('keeps the independent 500-row cap when updates are small', async () => {
    const f = fixture(); stores.push(f.store);
    for (let index = 0; index < 501; index += 1) {
      f.store.appendMatterUpdate({
        matter_handle: f.matter.matter_handle,
        org_id: f.org.org_id,
        stream_handle: f.matter.root_stream_handle,
        blob_id: `row-cap-${String(index)}`,
        ciphertext: new Uint8Array([2, index % 255]),
        author_seat: 'seat-row-cap',
        key_epoch: 1,
      });
    }

    const first = await handlePullUpdates(
      pullRequest(f.token, f.seatToken, 0), f.store, f.matter.matter_handle, f.matter.root_stream_handle, 'row-cap-ip-1',
    );
    const firstBody = await first.json() as { cursor: number; has_more: boolean; updates: unknown[] };
    expect(firstBody.updates).toHaveLength(500);
    expect(firstBody.has_more).toBe(true);

    const second = await handlePullUpdates(
      pullRequest(f.token, f.seatToken, firstBody.cursor), f.store, f.matter.matter_handle, f.matter.root_stream_handle, 'row-cap-ip-2',
    );
    const secondBody = await second.json() as { has_more: boolean; updates: unknown[] };
    expect(secondBody.updates).toHaveLength(1);
    expect(secondBody.has_more).toBe(false);
  });
});
