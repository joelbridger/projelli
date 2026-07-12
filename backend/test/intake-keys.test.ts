import { afterEach, describe, expect, test } from 'bun:test';
import { Store } from '../src/lib/db.ts';
import { FanoutHub } from '../src/lib/matters.ts';
import { hmacHash } from '../src/lib/crypto.ts';
import { issueAuthTokens, mintSeatToken } from '../src/lib/services.ts';
import { buildServeOptions, type SyncSocketData } from '../src/server.ts';

const servers: Array<Bun.Server<SyncSocketData>> = [];
afterEach(() => { while (servers.length) servers.pop()!.stop(true); });

function makeUser(store: Store, orgId: string, role: 'admin' | 'member') {
  const user = store.createUser({ org_id: orgId, email: `${role}-${crypto.randomUUID()}@test.invalid`, password_hash: 'x', role });
  const org = store.getOrg(orgId)!;
  const activated = store.activateSeat({ org_id: orgId, user_id: user.user_id, machine_id: crypto.randomUUID(), machine_label: 'test', seat_limit: org.seat_limit });
  if (!activated.ok) throw new Error('seat activation failed');
  return {
    user,
    seatToken: mintSeatToken(org, user, activated.seat).token,
    accessToken: issueAuthTokens(store, user).access_token,
  };
}

function headers(identity: ReturnType<typeof makeUser>, deviceId?: string): Record<string, string> {
  return { authorization: `Bearer ${identity.accessToken}`, 'x-seat-token': identity.seatToken, ...(deviceId ? { 'x-device-id': deviceId } : {}) };
}

describe('intake key relay', () => {
  test('returns only the caller device blob, stores opaque ciphertext, and cuts off removed members', async () => {
    const store = new Store(':memory:');
    const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
    servers.push(server);
    const base = `http://${server.hostname}:${server.port}`;
    const org = store.createOrg({ name: 'Firm', plan: 'practice', packs: [], seat_limit: 4 });
    const admin = makeUser(store, org.org_id, 'admin');
    const member = makeUser(store, org.org_id, 'member');
    const foreignOrg = store.createOrg({ name: 'Elsewhere', plan: 'practice', packs: [], seat_limit: 2 });
    const foreign = makeUser(store, foreignOrg.org_id, 'admin');
    const matter = store.createMatter({ org_id: org.org_id, client_name: 'Private client' });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: admin.user.user_id, org_id: org.org_id, role: 'owner' });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member.user.user_id, org_id: org.org_id, role: 'editor' });
    store.upsertDevice({ device_id: 'admin-device', user_id: admin.user.user_id, org_id: org.org_id, machine_id: 'a', label: 'a', pubkey_jwk: '{}' });
    store.upsertDevice({ device_id: 'member-device', user_id: member.user.user_id, org_id: org.org_id, machine_id: 'm', label: 'm', pubkey_jwk: '{}' });
    store.createIntake({ intake_id: 'intake-key-test', org_id: org.org_id, user_id: admin.user.user_id, seat_id: 'seat', token_hash: hmacHash('token'), expires_at: new Date(Date.now() + 60_000).toISOString(), checklist_ciphertext: new Uint8Array([1]), state_ciphertext: new Uint8Array([2]) });

    const publish = await fetch(`${base}/intake/intake-key-test/keys`, {
      method: 'POST', headers: { ...headers(admin), 'content-type': 'application/json' }, body: JSON.stringify({
        matter_id: matter.matter_id, epoch: 1,
        wrapped: [
          { user_id: admin.user.user_id, device_id: 'admin-device', wrapped_key_b64: 'opaque-admin-ciphertext' },
          { user_id: member.user.user_id, device_id: 'member-device', wrapped_key_b64: 'opaque-member-ciphertext' },
        ],
      }),
    });
    expect(publish.status).toBe(200);
    const own = await fetch(`${base}/intake/intake-key-test/keys`, { headers: headers(member, 'member-device') });
    expect(own.status).toBe(200);
    expect(await own.json()).toEqual({ epoch: 1, wrapped_key_b64: 'opaque-member-ciphertext' });
    expect(JSON.stringify(store.listIntakeWrappedKeys('intake-key-test'))).not.toContain('"d":');

    const outsider = await fetch(`${base}/intake/intake-key-test/keys`, { headers: headers(foreign, 'foreign-device') });
    expect(outsider.status).toBe(404);
    store.removeMatterMember(matter.matter_id, member.user.user_id);
    const removed = await fetch(`${base}/intake/intake-key-test/keys`, { headers: headers(member, 'member-device') });
    expect(removed.status).toBe(404);

    const republish = await fetch(`${base}/intake/intake-key-test/keys`, {
      method: 'POST', headers: { ...headers(admin), 'content-type': 'application/json' }, body: JSON.stringify({
        matter_id: matter.matter_id, epoch: 2,
        wrapped: [{ user_id: admin.user.user_id, device_id: 'admin-device', wrapped_key_b64: 'opaque-current-ciphertext' }],
      }),
    });
    expect(republish.status).toBe(200);
    expect(store.listIntakeWrappedKeys('intake-key-test').map((row) => row.user_id)).toEqual([admin.user.user_id]);
  });

  test('discovers only this device grants and never lets a shared reader acknowledge ciphertext', async () => {
    const store = new Store(':memory:');
    const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
    servers.push(server);
    const base = `http://${server.hostname}:${server.port}`;
    const org = store.createOrg({ name: 'Firm', plan: 'practice', packs: [], seat_limit: 4 });
    const admin = makeUser(store, org.org_id, 'admin');
    const member = makeUser(store, org.org_id, 'member');
    const noGrant = makeUser(store, org.org_id, 'member');
    const matter = store.createMatter({ org_id: org.org_id, client_name: 'Private client' });
    for (const identity of [admin, member, noGrant]) {
      store.addMatterMember({ matter_id: matter.matter_id, user_id: identity.user.user_id, org_id: org.org_id, role: 'editor' });
    }
    store.upsertDevice({ device_id: 'admin-device', user_id: admin.user.user_id, org_id: org.org_id, machine_id: 'a', label: 'a', pubkey_jwk: '{}' });
    store.upsertDevice({ device_id: 'member-device', user_id: member.user.user_id, org_id: org.org_id, machine_id: 'm', label: 'm', pubkey_jwk: '{}' });
    store.upsertDevice({ device_id: 'no-grant-device', user_id: noGrant.user.user_id, org_id: org.org_id, machine_id: 'n', label: 'n', pubkey_jwk: '{}' });
    store.createIntake({ intake_id: 'discoverable-intake', org_id: org.org_id, user_id: admin.user.user_id, seat_id: 'seat', token_hash: hmacHash('token'), expires_at: new Date(Date.now() + 60_000).toISOString(), checklist_ciphertext: new Uint8Array([1]), state_ciphertext: new Uint8Array([2]) });
    store.replaceIntakeWrappedKeys({
      intake_id: 'discoverable-intake', matter_id: matter.matter_id, epoch: 3, published_by: admin.user.user_id,
      wrapped: [
        { user_id: admin.user.user_id, device_id: 'admin-device', wrapped_key_b64: 'admin-wrap' },
        { user_id: member.user.user_id, device_id: 'member-device', wrapped_key_b64: 'member-wrap' },
      ],
    });
    store.appendIntakeChunk({ intake_id: 'discoverable-intake', item_id: 'item', submission_id: 'submission', index: 0, ciphertext: new Uint8Array([9]) });
    store.finalizeIntakeSubmission({ intake_id: 'discoverable-intake', item_id: 'item', submission_id: 'submission', manifest_ciphertext: new Uint8Array([8]), wrapped_content_key: new Uint8Array([7]) });

    const granted = await fetch(`${base}/intake/granted`, { headers: headers(member, 'member-device') });
    expect(granted.status).toBe(200);
    expect(await granted.json()).toEqual({ intakes: [{ intake_id: 'discoverable-intake', matter_id: matter.matter_id, epoch: 3 }] });
    const empty = await fetch(`${base}/intake/granted`, { headers: headers(noGrant, 'no-grant-device') });
    expect(empty.status).toBe(200);
    expect(await empty.json()).toEqual({ intakes: [] });

    const memberAck = await fetch(`${base}/intake/discoverable-intake/ack`, {
      method: 'POST', headers: { ...headers(member, 'member-device'), 'content-type': 'application/json' },
      body: JSON.stringify({ submission_ids: ['submission'] }),
    });
    expect(memberAck.status).toBe(404);
    expect(store.countIntakeChunks('discoverable-intake')).toBe(1);
    expect(store.countIntakeSubmissions('discoverable-intake')).toBe(1);

    const ownerAck = await fetch(`${base}/intake/discoverable-intake/ack`, {
      method: 'POST', headers: { ...headers(admin, 'admin-device'), 'content-type': 'application/json' },
      body: JSON.stringify({ submission_ids: ['submission'] }),
    });
    expect(ownerAck.status).toBe(200);
    expect(store.countIntakeChunks('discoverable-intake')).toBe(0);
    // The durable row remains as an acknowledgement marker, but its encrypted
    // manifest and wrapped content key have been wiped.
    expect(store.sumIntakeSubmissionStoredBytes('discoverable-intake')).toBe(0);
  });
});
