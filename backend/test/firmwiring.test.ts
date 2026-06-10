/**
 * Phase 1 firm desktop wiring — backend tests.
 *
 * Covers:
 *   - POST /device/register           (happy path + validation adversarials)
 *   - POST /org/users/devices         (admin + same-org guard)
 *   - POST /matter/:id/keys/publish   (happy path + stale epoch + walled skip)
 *   - POST /matter/:id/keys/fetch     (happy path + 403 walled + 403 non-member
 *                                      + the explicit member-AND-walled 403 case
 *                                      + 404 not published)
 *   - POST /matter/mine               (member ∧ ¬walled; walled excluded)
 *   - POST /org/claim                 (happy path + already-claimed 409 + wrong-key 404
 *                                      + tokens usable on /auth/me)
 *   - POST /webhooks/lemonsqueezy     (bad sig 401 + duplicate idempotency + quantity
 *                                      clamped to 3 + non-Firm ignored + Firm provisioned)
 *   - member-remove purges wrapped keys + old epoch; remaining member gets 404
 *     until re-publish at new epoch
 */

import { test, expect, describe, beforeAll } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import { hmacHash, generateLicenseKey, signAccessJwt, base64urlEncode } from "../src/lib/crypto.ts";
import { buildServeOptions } from "../src/server.ts";
import { fanout } from "../src/lib/matters.ts";
import { createHmac, randomBytes } from "node:crypto";
import { config } from "../src/lib/config.ts";
import { Database } from "bun:sqlite";
import { tmpdir } from "node:os";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeStore() {
  return new Store(":memory:");
}

function seedOrg(store: Store) {
  const org = store.createOrg({ name: "Test Firm LLP", plan: "practice", packs: ["legal"], seat_limit: 5 });
  const admin = store.createUser({ org_id: org.org_id, email: "admin@firm.test", password_hash: "x", role: "admin" });
  const member = store.createUser({ org_id: org.org_id, email: "member@firm.test", password_hash: "x", role: "member" });
  const member2 = store.createUser({ org_id: org.org_id, email: "member2@firm.test", password_hash: "x", role: "member" });
  return { org, admin, member, member2 };
}

function adminBearer(store: Store, admin: ReturnType<typeof seedOrg>["admin"]): string {
  return issueAuthTokens(store, admin).access_token;
}

function memberBearer(store: Store, user: ReturnType<typeof Store.prototype.getUser>): string {
  return issueAuthTokens(store, user!).access_token;
}

function activeSeatToken(store: Store, user: ReturnType<typeof Store.prototype.getUser>, org: ReturnType<typeof Store.prototype.getOrg>): string {
  const seat = store.activateSeat({
    org_id: org!.org_id,
    user_id: user!.user_id,
    machine_id: "machine-" + user!.user_id,
    machine_label: null,
    seat_limit: org!.seat_limit,
  });
  if (!seat.ok) throw new Error("seat activation failed");
  return mintSeatToken(org!, user!, seat.seat).token;
}

/** Minimal valid EC P-256 public JWK (no `d`). */
const VALID_PUBKEY_JWK = {
  kty: "EC",
  crv: "P-256",
  x: "f83OJ3D2xF1Bg8vub9tLe1gHMzV76e8Tus9uPHvRVEU",
  y: "x_FEzRu9m36HLN_tue659LNpXW6pCyStikYjKIWI5a0",
};

/** Boot an in-process server on an ephemeral port for HTTP integration tests. */
function bootServer(store: Store) {
  return Bun.serve(buildServeOptions(store, fanout));
}

async function post(server: ReturnType<typeof Bun.serve>, path: string, body: unknown, headers?: Record<string, string>) {
  const url = `http://127.0.0.1:${server.port}${path}`;
  const resp = await fetch(url, {
    method: "POST",
    headers: { "content-type": "application/json", ...(headers ?? {}) },
    body: JSON.stringify(body),
  });
  return { status: resp.status, body: await resp.json() as Record<string, unknown> };
}

// LS webhook signing helper
function lsSign(body: string, secret: string): string {
  return createHmac("sha256", secret).update(body).digest("hex");
}

function makeLsPayload(opts?: {
  eventName?: string;
  webhookId?: string;
  variantName?: string;
  variantId?: string | number;
  quantity?: number;
  licenseKey?: string;
  subscriptionId?: string;
}) {
  const payload = {
    meta: {
      event_name: opts?.eventName ?? "subscription_created",
      webhook_id: opts?.webhookId ?? "evt-test-001",
      custom_data: opts?.licenseKey ? { license_key: opts.licenseKey } : undefined,
    },
    data: {
      // LS subscription resource id — used for second-level idempotency.
      id: opts?.subscriptionId ?? `sub-${opts?.webhookId ?? "evt-test-001"}`,
      attributes: {
        first_subscription_item: {
          variant_id: opts?.variantId ?? "999",
          variant_name: opts?.variantName ?? "Keepance Firm Annual",
          quantity: opts?.quantity ?? 3,
        },
        customer_name: "Law LLC",
        user_email: "buyer@lawfirm.test",
      },
    },
  };
  return JSON.stringify(payload);
}

// ---------------------------------------------------------------------------
// 1. POST /device/register
// ---------------------------------------------------------------------------

describe("POST /device/register", () => {
  test("happy path: registers a device and returns {ok}", async () => {
    const store = makeStore();
    const { org, admin } = seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/device/register", {
        device_id: "dev-001",
        machine_id: "mac-001",
        label: "Work MacBook",
        pubkey_jwk: VALID_PUBKEY_JWK,
      }, { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(200);
      expect(resp.body.ok).toBe(true);
      // Verify persisted
      const dev = store.getDevice("dev-001", admin.user_id);
      expect(dev).not.toBeNull();
      expect(dev?.label).toBe("Work MacBook");
      expect(dev?.org_id).toBe(org.org_id);
    } finally { server.stop(true); }
  });

  test("upsert: re-registering same device_id updates label+key", async () => {
    const store = makeStore();
    const { admin } = seedOrg(store);
    const server = bootServer(store);
    try {
      await post(server, "/device/register", {
        device_id: "dev-001", machine_id: "mac-001", label: "Old Label", pubkey_jwk: VALID_PUBKEY_JWK,
      }, { authorization: `Bearer ${adminBearer(store, admin)}` });
      await post(server, "/device/register", {
        device_id: "dev-001", machine_id: "mac-001", label: "New Label", pubkey_jwk: { ...VALID_PUBKEY_JWK, x: "aaaa" },
      }, { authorization: `Bearer ${adminBearer(store, admin)}` });
      const dev = store.getDevice("dev-001", admin.user_id);
      expect(dev?.label).toBe("New Label");
    } finally { server.stop(true); }
  });

  test("rejects: missing device_id → 400", async () => {
    const store = makeStore();
    const { admin } = seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/device/register", {
        machine_id: "mac-001", label: "L", pubkey_jwk: VALID_PUBKEY_JWK,
      }, { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(400);
    } finally { server.stop(true); }
  });

  test("rejects: private key field `d` present → 400", async () => {
    const store = makeStore();
    const { admin } = seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/device/register", {
        device_id: "dev-priv", machine_id: "m", label: "L",
        pubkey_jwk: { ...VALID_PUBKEY_JWK, d: "secret" },
      }, { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(400);
      expect(String(resp.body.error)).toContain("invalid_pubkey_jwk");
    } finally { server.stop(true); }
  });

  test("rejects: wrong curve (P-384) → 400", async () => {
    const store = makeStore();
    const { admin } = seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/device/register", {
        device_id: "dev-384", machine_id: "m", label: "L",
        pubkey_jwk: { kty: "EC", crv: "P-384", x: "abc", y: "def" },
      }, { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(400);
    } finally { server.stop(true); }
  });

  test("rejects: unauthenticated → 401", async () => {
    const store = makeStore();
    seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/device/register", {
        device_id: "d", machine_id: "m", label: "l", pubkey_jwk: VALID_PUBKEY_JWK,
      });
      expect(resp.status).toBe(401);
    } finally { server.stop(true); }
  });
});

// ---------------------------------------------------------------------------
// 2. POST /org/users/devices
// ---------------------------------------------------------------------------

describe("POST /org/users/devices", () => {
  test("admin gets devices for own-org users", async () => {
    const store = makeStore();
    const { admin, member } = seedOrg(store);
    store.upsertDevice({ device_id: "dA", user_id: admin.user_id, org_id: admin.org_id, machine_id: "m1", label: "Admin device", pubkey_jwk: JSON.stringify(VALID_PUBKEY_JWK) });
    store.upsertDevice({ device_id: "dM", user_id: member.user_id, org_id: member.org_id, machine_id: "m2", label: "Member device", pubkey_jwk: JSON.stringify(VALID_PUBKEY_JWK) });
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/users/devices",
        { user_ids: [admin.user_id, member.user_id] },
        { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(200);
      const devices = resp.body.devices as Array<Record<string, unknown>>;
      expect(devices.length).toBe(2);
      const ids = devices.map(d => d.device_id as string).sort();
      expect(ids).toContain("dA");
      expect(ids).toContain("dM");
    } finally { server.stop(true); }
  });

  test("member (non-admin) can list same-org devices (matter owners need them to wrap keys)", async () => {
    const store = makeStore();
    const { admin, member } = seedOrg(store);
    store.upsertDevice({ device_id: "dA", user_id: admin.user_id, org_id: admin.org_id, machine_id: "m1", label: "Admin device", pubkey_jwk: JSON.stringify(VALID_PUBKEY_JWK) });
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/users/devices",
        { user_ids: [admin.user_id] },
        { authorization: `Bearer ${memberBearer(store, member)}` });
      expect(resp.status).toBe(200);
      const devices = resp.body.devices as Array<Record<string, unknown>>;
      expect(devices.length).toBe(1);
      expect(devices[0]?.device_id).toBe("dA");
    } finally { server.stop(true); }
  });

  test("member listing a cross-org user still rejected", async () => {
    const store = makeStore();
    const { member } = seedOrg(store);
    const orgB = store.createOrg({ name: "Other Firm", plan: "practice", packs: [], seat_limit: 3 });
    const outsider = store.createUser({ org_id: orgB.org_id, email: "outsider2@other.test", password_hash: "x", role: "member" });
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/users/devices",
        { user_ids: [outsider.user_id] },
        { authorization: `Bearer ${memberBearer(store, member)}` });
      expect(resp.status).toBe(403);
    } finally { server.stop(true); }
  });
});

// ---------------------------------------------------------------------------
// 2b. POST /org/admins
// ---------------------------------------------------------------------------

describe("POST /org/admins", () => {
  test("member sees the org's active admins only", async () => {
    const store = makeStore();
    const { admin, member } = seedOrg(store);
    const secondAdmin = store.createUser({ org_id: admin.org_id, email: "admin2@firm.test", password_hash: "x", role: "admin" });
    const deprovisioned = store.createUser({ org_id: admin.org_id, email: "gone@firm.test", password_hash: "x", role: "admin" });
    store.setUserStatus(deprovisioned.user_id, "deprovisioned");
    const orgB = store.createOrg({ name: "Other Firm", plan: "practice", packs: [], seat_limit: 3 });
    store.createUser({ org_id: orgB.org_id, email: "adminB@other.test", password_hash: "x", role: "admin" });
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/admins", {},
        { authorization: `Bearer ${memberBearer(store, member)}` });
      expect(resp.status).toBe(200);
      const admins = resp.body.admins as Array<Record<string, unknown>>;
      const ids = admins.map(a => a.user_id as string).sort();
      expect(ids).toContain(admin.user_id);
      expect(ids).toContain(secondAdmin.user_id);
      expect(ids).not.toContain(deprovisioned.user_id);
      expect(ids.length).toBe(2); // never another org's admins
      expect(admins.every(a => typeof a.email === "string" && (a.email as string).length > 0)).toBe(true);
    } finally { server.stop(true); }
  });

  test("unauthenticated → 401", async () => {
    const store = makeStore();
    seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/admins", {}, {});
      expect(resp.status).toBe(401);
    } finally { server.stop(true); }
  });
});

describe("POST /org/users/devices (guards)", () => {
  test("cross-org user_id in list → 403", async () => {
    const store = makeStore();
    const { admin } = seedOrg(store);
    const orgB = store.createOrg({ name: "Other Firm", plan: "practice", packs: [], seat_limit: 3 });
    const outsider = store.createUser({ org_id: orgB.org_id, email: "outsider@other.test", password_hash: "x", role: "member" });
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/users/devices",
        { user_ids: [outsider.user_id] },
        { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(403);
    } finally { server.stop(true); }
  });

  test("empty user_ids → {devices:[]}", async () => {
    const store = makeStore();
    const { admin } = seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/users/devices",
        { user_ids: [] },
        { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(200);
      expect((resp.body.devices as unknown[]).length).toBe(0);
    } finally { server.stop(true); }
  });
});

// ---------------------------------------------------------------------------
// 3. POST /matter/:id/keys/publish + /keys/fetch
// ---------------------------------------------------------------------------

describe("matter key publish + fetch", () => {
  function seedMatterScene() {
    const store = makeStore();
    const { org, admin, member, member2 } = seedOrg(store);
    const matter = store.createMatter({ org_id: org.org_id, client_name: "Client A" });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member.user_id, org_id: org.org_id, role: "editor" });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member2.user_id, org_id: org.org_id, role: "editor" });

    // Register a device for member
    store.upsertDevice({ device_id: "dev-m", user_id: member.user_id, org_id: org.org_id, machine_id: "mm", label: "Member PC", pubkey_jwk: JSON.stringify(VALID_PUBKEY_JWK) });
    // Register a device for member2
    store.upsertDevice({ device_id: "dev-m2", user_id: member2.user_id, org_id: org.org_id, machine_id: "mm2", label: "Member2 PC", pubkey_jwk: JSON.stringify(VALID_PUBKEY_JWK) });

    return { store, org, admin, member, member2, matter };
  }

  test("admin publishes keys → {ok, stored}", async () => {
    const { store, admin, member, matter } = seedMatterScene();
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/keys/publish`, {
        epoch: 1,
        wrapped: [
          { user_id: member.user_id, device_id: "dev-m", wrapped_key_b64: "AAAA" },
        ],
      }, { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(200);
      expect(resp.body.ok).toBe(true);
      expect(resp.body.stored).toBe(1);
    } finally { server.stop(true); }
  });

  test("member (owner) can publish keys", async () => {
    const { store, admin, member, matter } = seedMatterScene();
    // Elevate member to owner
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member.user_id, org_id: admin.org_id, role: "owner" });
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/keys/publish`, {
        epoch: 1,
        wrapped: [{ user_id: member.user_id, device_id: "dev-m", wrapped_key_b64: "BBBB" }],
      }, { authorization: `Bearer ${memberBearer(store, member)}` });
      expect(resp.status).toBe(200);
      expect(resp.body.stored).toBe(1);
    } finally { server.stop(true); }
  });

  test("non-owner member cannot publish → 403", async () => {
    const { store, member, matter } = seedMatterScene();
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/keys/publish`, {
        epoch: 1,
        wrapped: [{ user_id: member.user_id, device_id: "dev-m", wrapped_key_b64: "CCCC" }],
      }, { authorization: `Bearer ${memberBearer(store, member)}` });
      expect(resp.status).toBe(403);
    } finally { server.stop(true); }
  });

  test("stale epoch → 409", async () => {
    const { store, admin, member, matter } = seedMatterScene();
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/keys/publish`, {
        epoch: 99, // wrong
        wrapped: [{ user_id: member.user_id, device_id: "dev-m", wrapped_key_b64: "DDDD" }],
      }, { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(409);
      expect(String(resp.body.error)).toBe("stale_epoch");
    } finally { server.stop(true); }
  });

  test("walled member entries are skipped (not stored), stored count reflects it", async () => {
    const { store, admin, member, member2, matter } = seedMatterScene();
    // Wall member2
    store.setEthicalWall({ matter_id: matter.matter_id, user_id: member2.user_id, org_id: admin.org_id, reason: "conflict", created_by: admin.user_id });
    // After wall the epoch bumps, so reset to epoch 2
    store.bumpMatterKeyEpoch(matter.matter_id); // now epoch=2
    const updatedMatter = store.getMatter(matter.matter_id)!;
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/keys/publish`, {
        epoch: updatedMatter.key_epoch,
        wrapped: [
          { user_id: member.user_id, device_id: "dev-m", wrapped_key_b64: "EEEE" },
          { user_id: member2.user_id, device_id: "dev-m2", wrapped_key_b64: "FFFF" }, // should be skipped
        ],
      }, { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(200);
      expect(resp.body.stored).toBe(1); // only member
      // Verify member2's key was NOT stored
      const walled = store.getWrappedMatterKey(matter.matter_id, updatedMatter.key_epoch, member2.user_id, "dev-m2");
      expect(walled).toBeNull();
    } finally { server.stop(true); }
  });

  test("member fetches their key at current epoch → {epoch, wrapped_key_b64}", async () => {
    const { store, admin, member, matter, org } = seedMatterScene();
    const seatToken = activeSeatToken(store, member, org);
    // Admin publishes
    store.upsertWrappedMatterKey({ matter_id: matter.matter_id, epoch: 1, user_id: member.user_id, device_id: "dev-m", wrapped_key_b64: "MYMKEY", published_by: admin.user_id });
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/keys/fetch`,
        { device_id: "dev-m" },
        {
          authorization: `Bearer ${memberBearer(store, member)}`,
          "x-seat-token": seatToken,
        });
      expect(resp.status).toBe(200);
      expect(resp.body.epoch).toBe(1);
      expect(resp.body.wrapped_key_b64).toBe("MYMKEY");
    } finally { server.stop(true); }
  });

  test("ADVERSARIAL: member AND walled → 403 (deny-overrides-allow)", async () => {
    const { store, admin, member, matter, org } = seedMatterScene();
    const seatToken = activeSeatToken(store, member, org);
    // Publish a key for member
    store.upsertWrappedMatterKey({ matter_id: matter.matter_id, epoch: 1, user_id: member.user_id, device_id: "dev-m", wrapped_key_b64: "KEY", published_by: admin.user_id });
    // Then wall them
    store.setEthicalWall({ matter_id: matter.matter_id, user_id: member.user_id, org_id: org.org_id, reason: "conflict", created_by: admin.user_id });
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/keys/fetch`,
        { device_id: "dev-m" },
        {
          authorization: `Bearer ${memberBearer(store, member)}`,
          "x-seat-token": seatToken,
        });
      expect(resp.status).toBe(403);
    } finally { server.stop(true); }
  });

  test("non-member → 403", async () => {
    const { store, org, admin, member2, matter } = seedMatterScene();
    // member2 is a matter member in seedMatterScene; create a fresh outsider
    const outsider = store.createUser({ org_id: org.org_id, email: "outsider@firm.test", password_hash: "x", role: "member" });
    const seatToken = activeSeatToken(store, outsider, org);
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/keys/fetch`,
        { device_id: "dev-x" },
        {
          authorization: `Bearer ${memberBearer(store, outsider)}`,
          "x-seat-token": seatToken,
        });
      expect(resp.status).toBe(403);
    } finally { server.stop(true); }
  });

  test("published key not found for device → 404", async () => {
    const { store, admin, member, matter, org } = seedMatterScene();
    const seatToken = activeSeatToken(store, member, org);
    // Do NOT publish any key
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/keys/fetch`,
        { device_id: "dev-unknown" },
        {
          authorization: `Bearer ${memberBearer(store, member)}`,
          "x-seat-token": seatToken,
        });
      expect(resp.status).toBe(404);
    } finally { server.stop(true); }
  });
});

// ---------------------------------------------------------------------------
// 4. member-remove purges wrapped keys + old epoch; remaining member 404
// ---------------------------------------------------------------------------

describe("member-remove purges wrapped keys", () => {
  test("ADVERSARIAL: remove member → purges their keys + old epoch; remaining member gets 404 until new publish", async () => {
    const store = makeStore();
    const { org, admin, member, member2 } = seedOrg(store);
    const matter = store.createMatter({ org_id: org.org_id, client_name: "Purge Test" });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member.user_id, org_id: org.org_id, role: "editor" });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member2.user_id, org_id: org.org_id, role: "editor" });

    store.upsertDevice({ device_id: "dR", user_id: member.user_id, org_id: org.org_id, machine_id: "mr", label: "Removed", pubkey_jwk: JSON.stringify(VALID_PUBKEY_JWK) });
    store.upsertDevice({ device_id: "dK", user_id: member2.user_id, org_id: org.org_id, machine_id: "mk", label: "Kept", pubkey_jwk: JSON.stringify(VALID_PUBKEY_JWK) });

    // Publish epoch=1 keys for both
    store.upsertWrappedMatterKey({ matter_id: matter.matter_id, epoch: 1, user_id: member.user_id, device_id: "dR", wrapped_key_b64: "KEY_R", published_by: admin.user_id });
    store.upsertWrappedMatterKey({ matter_id: matter.matter_id, epoch: 1, user_id: member2.user_id, device_id: "dK", wrapped_key_b64: "KEY_K", published_by: admin.user_id });

    const server = bootServer(store);
    const seatTokenM2 = activeSeatToken(store, member2, org);

    try {
      // Remove member via the API (which calls bumpMatterKeyEpoch + purge)
      const removeResp = await post(server, `/matter/${matter.matter_id}/members/remove`,
        { user_id: member.user_id },
        { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(removeResp.status).toBe(200);
      const newEpoch = removeResp.body.key_epoch as number;
      expect(newEpoch).toBe(2);

      // Removed member's key must be gone (all epochs)
      const removedKey = store.getWrappedMatterKey(matter.matter_id, 1, member.user_id, "dR");
      expect(removedKey).toBeNull();

      // Old epoch (1) set must be purged — member2's epoch-1 key also gone
      const oldKey = store.getWrappedMatterKey(matter.matter_id, 1, member2.user_id, "dK");
      expect(oldKey).toBeNull();

      // Remaining member2 fetch at new epoch (2) → 404 (not published yet)
      const fetchBeforeResp = await post(server, `/matter/${matter.matter_id}/keys/fetch`,
        { device_id: "dK" },
        {
          authorization: `Bearer ${memberBearer(store, member2)}`,
          "x-seat-token": seatTokenM2,
        });
      expect(fetchBeforeResp.status).toBe(404);

      // Admin re-publishes at epoch 2 → member2 can now fetch
      store.upsertWrappedMatterKey({ matter_id: matter.matter_id, epoch: 2, user_id: member2.user_id, device_id: "dK", wrapped_key_b64: "KEY_K_NEW", published_by: admin.user_id });
      const fetchAfterResp = await post(server, `/matter/${matter.matter_id}/keys/fetch`,
        { device_id: "dK" },
        {
          authorization: `Bearer ${memberBearer(store, member2)}`,
          "x-seat-token": seatTokenM2,
        });
      expect(fetchAfterResp.status).toBe(200);
      expect(fetchAfterResp.body.wrapped_key_b64).toBe("KEY_K_NEW");
    } finally { server.stop(true); }
  });
});

// ---------------------------------------------------------------------------
// 5. POST /matter/mine
// ---------------------------------------------------------------------------

describe("POST /matter/mine", () => {
  test("returns member matters, excludes walled ones", async () => {
    const store = makeStore();
    const { org, admin, member } = seedOrg(store);
    const m1 = store.createMatter({ org_id: org.org_id, client_name: "Client 1" });
    const m2 = store.createMatter({ org_id: org.org_id, client_name: "Client 2" });
    store.addMatterMember({ matter_id: m1.matter_id, user_id: member.user_id, org_id: org.org_id, role: "editor" });
    store.addMatterMember({ matter_id: m2.matter_id, user_id: member.user_id, org_id: org.org_id, role: "viewer" });
    // Wall m2
    store.setEthicalWall({ matter_id: m2.matter_id, user_id: member.user_id, org_id: org.org_id, reason: null, created_by: admin.user_id });
    const seatToken = activeSeatToken(store, member, org);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/matter/mine", {},
        {
          authorization: `Bearer ${memberBearer(store, member)}`,
          "x-seat-token": seatToken,
        });
      expect(resp.status).toBe(200);
      const matters = resp.body.matters as Array<Record<string, unknown>>;
      // Only m1 (not walled)
      expect(matters.length).toBe(1);
      expect(matters[0]!.matter_id).toBe(m1.matter_id);
      expect(matters[0]!.role).toBe("editor");
    } finally { server.stop(true); }
  });

  test("ADVERSARIAL: walled matter not in /matter/mine", async () => {
    const store = makeStore();
    const { org, admin, member } = seedOrg(store);
    const matter = store.createMatter({ org_id: org.org_id, client_name: "Secret" });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member.user_id, org_id: org.org_id, role: "editor" });
    store.setEthicalWall({ matter_id: matter.matter_id, user_id: member.user_id, org_id: org.org_id, reason: null, created_by: admin.user_id });
    const seatToken = activeSeatToken(store, member, org);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/matter/mine", {},
        {
          authorization: `Bearer ${memberBearer(store, member)}`,
          "x-seat-token": seatToken,
        });
      expect(resp.status).toBe(200);
      expect((resp.body.matters as unknown[]).length).toBe(0);
    } finally { server.stop(true); }
  });

  test("missing seat token → 401", async () => {
    const store = makeStore();
    const { member } = seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/matter/mine", {},
        { authorization: `Bearer ${memberBearer(store, member)}` });
      expect(resp.status).toBe(401);
    } finally { server.stop(true); }
  });
});

// ---------------------------------------------------------------------------
// 6. POST /org/claim
// ---------------------------------------------------------------------------

describe("POST /org/claim", () => {
  function seedUnclaimed(store: Store) {
    const licenseKey = generateLicenseKey();
    const org = store.createOrg({ name: "Unclaimed Firm", plan: "practice", packs: ["legal"], seat_limit: 3 });
    store.setOrgStatus(org.org_id, "unclaimed");
    store.createLicenseKey({ org_id: org.org_id, key_hash: hmacHash(licenseKey), plan: "practice", packs: ["legal"], seat_limit: 3 });
    return { org, licenseKey };
  }

  test("happy path: claim provisions admin + returns tokens usable on /auth/me", async () => {
    const store = makeStore();
    const { licenseKey } = seedUnclaimed(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/claim", {
        license_key: licenseKey,
        email: "founder@firm.test",
        password: "strongpassword123",
        org_name: "My Law Firm",
      });
      expect(resp.status).toBe(200);
      expect(resp.body.org).toBeDefined();
      expect((resp.body.org as Record<string, unknown>).name).toBe("My Law Firm");
      expect(resp.body.user).toBeDefined();
      expect(resp.body.access_token).toBeDefined();
      expect(resp.body.refresh_token).toBeDefined();

      // Use the access token on /auth/me
      const meResp = await fetch(`http://127.0.0.1:${server.port}/auth/me`, {
        headers: { authorization: `Bearer ${resp.body.access_token as string}` },
      });
      const meJson = await meResp.json() as Record<string, unknown>;
      expect(meResp.status).toBe(200);
      expect((meJson.user as Record<string, unknown>).email).toBe("founder@firm.test");
      expect((meJson.user as Record<string, unknown>).role).toBe("admin");
    } finally { server.stop(true); }
  });

  test("second claim → 409 already_claimed", async () => {
    const store = makeStore();
    const { licenseKey } = seedUnclaimed(store);
    const server = bootServer(store);
    try {
      await post(server, "/org/claim", {
        license_key: licenseKey,
        email: "first@firm.test",
        password: "strongpassword123",
      });
      const resp2 = await post(server, "/org/claim", {
        license_key: licenseKey,
        email: "second@firm.test",
        password: "strongpassword456",
      });
      expect(resp2.status).toBe(409);
      expect(String(resp2.body.error)).toBe("already_claimed");
    } finally { server.stop(true); }
  });

  test("unknown license key → 404", async () => {
    const store = makeStore();
    seedUnclaimed(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/claim", {
        license_key: "made-up-key-9999",
        email: "x@firm.test",
        password: "strongpassword123",
      });
      expect(resp.status).toBe(404);
    } finally { server.stop(true); }
  });

  test("invalid email → 400", async () => {
    const store = makeStore();
    const { licenseKey } = seedUnclaimed(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/claim", {
        license_key: licenseKey,
        email: "not-an-email",
        password: "strongpassword123",
      });
      expect(resp.status).toBe(400);
    } finally { server.stop(true); }
  });

  test("password too short → 400", async () => {
    const store = makeStore();
    const { licenseKey } = seedUnclaimed(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/claim", {
        license_key: licenseKey,
        email: "x@firm.test",
        password: "short",
      });
      expect(resp.status).toBe(400);
    } finally { server.stop(true); }
  });

  test("ATOMIC: claim with email already in another org → 409 email_taken, org stays unclaimed, correct claim succeeds after", async () => {
    const store = makeStore();
    // Seed a second org with an existing user so the email is taken globally.
    const orgA = store.createOrg({ name: "Org A", plan: "practice", packs: [], seat_limit: 3 });
    store.createUser({ org_id: orgA.org_id, email: "taken@firm.test", password_hash: "x", role: "admin" });

    // Seed the unclaimed org we want to claim.
    const { licenseKey, org: unclaimedOrg } = seedUnclaimed(store);
    const server = bootServer(store);
    try {
      // Attempt to claim using the already-taken email.
      const resp1 = await post(server, "/org/claim", {
        license_key: licenseKey,
        email: "taken@firm.test",
        password: "strongpassword123",
      });
      expect(resp1.status).toBe(409);
      expect(String(resp1.body.error)).toBe("email_taken");

      // Org must still be unclaimed (not partially activated).
      const orgAfterFailedClaim = store.getOrg(unclaimedOrg.org_id);
      expect(orgAfterFailedClaim?.status).toBe("unclaimed");

      // A subsequent claim with a fresh email must succeed.
      const resp2 = await post(server, "/org/claim", {
        license_key: licenseKey,
        email: "fresh@firm.test",
        password: "strongpassword123",
      });
      expect(resp2.status).toBe(200);
      expect(resp2.body.access_token).toBeDefined();
      // Org now active.
      const orgFinal = store.getOrg(unclaimedOrg.org_id);
      expect(orgFinal?.status).toBe("active");
    } finally { server.stop(true); }
  });
});

// ---------------------------------------------------------------------------
// 7. POST /webhooks/lemonsqueezy
// ---------------------------------------------------------------------------

describe("POST /webhooks/lemonsqueezy", () => {
  const WEBHOOK_SECRET = "test-webhook-secret-abc123";

  function setWebhookSecret() {
    // We need to temporarily set the env var that config reads. Since config is
    // already initialized, we manipulate lemonSqueezyWebhookSecret directly on
    // the config object via a workaround — but the config is `as const`. So we
    // rely on env set in setup.ts (not possible mid-test). Instead, we test the
    // signature path by constructing a server that uses our in-memory store and
    // setting process.env before the config is re-read.
    //
    // Simpler approach: set the env before module cache is loaded. Since config
    // is already loaded in this process, we set it directly using Object.assign
    // to override the readonly config for test purposes.
    (config as unknown as Record<string, unknown>)["lemonSqueezyWebhookSecret"] = WEBHOOK_SECRET;
  }

  beforeAll(() => {
    setWebhookSecret();
  });

  test("bad signature → 401", async () => {
    const store = makeStore();
    const server = bootServer(store);
    const body = makeLsPayload();
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": "badhex000000000000000000000000000000000000000000000000000000000000" },
        body,
      });
      expect(resp.status).toBe(401);
    } finally { server.stop(true); }
  });

  test("non-Firm product → 200 ignored", async () => {
    const store = makeStore();
    const server = bootServer(store);
    const body = makeLsPayload({ variantName: "Keepance Professional", variantId: "111" });
    const sig = lsSign(body, WEBHOOK_SECRET);
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig },
        body,
      });
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.ignored).toBe(true);
    } finally { server.stop(true); }
  });

  test("Firm product by name → grants exactly the seats purchased (charge-aligned)", async () => {
    const store = makeStore();
    const server = bootServer(store);
    const licenseKey = "ls-test-key-1234567890";
    const body = makeLsPayload({
      variantName: "Keepance Firm Annual",
      quantity: 1, // a buyer who reduced the prefilled-3 cart to 1 gets exactly 1
      licenseKey,
    });
    const sig = lsSign(body, WEBHOOK_SECRET);
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig },
        body,
      });
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.ok).toBe(true);
      expect(json.seat_limit).toBe(1); // grant equals quantity paid for, never inflated

      // Org must be unclaimed
      const orgId = json.org_id as string;
      const org = store.getOrg(orgId);
      expect(org?.status).toBe("unclaimed");
      expect(org?.plan).toBe("practice");
      expect(org?.seat_limit).toBe(1);

      // License key hash stored
      const found = store.findOrgByLicenseKeyHash(hmacHash(licenseKey));
      expect(found?.org.org_id).toBe(orgId);
    } finally { server.stop(true); }
  });

  test("quantity > 3 → seat_limit = quantity", async () => {
    const store = makeStore();
    const server = bootServer(store);
    const body = makeLsPayload({ variantName: "Firm", quantity: 7, webhookId: "evt-qty-7" });
    const sig = lsSign(body, WEBHOOK_SECRET);
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig },
        body,
      });
      const json = await resp.json() as Record<string, unknown>;
      expect(json.seat_limit).toBe(7);
    } finally { server.stop(true); }
  });

  test("ADVERSARIAL: duplicate event id processed once (idempotent)", async () => {
    const store = makeStore();
    const server = bootServer(store);
    const licenseKey1 = "ls-dup-key-aaa";
    const licenseKey2 = "ls-dup-key-bbb";
    const body1 = makeLsPayload({ variantName: "Firm", webhookId: "evt-dup-001", licenseKey: licenseKey1 });
    const body2 = makeLsPayload({ variantName: "Firm", webhookId: "evt-dup-001", licenseKey: licenseKey2 }); // same event id
    const sig1 = lsSign(body1, WEBHOOK_SECRET);
    const sig2 = lsSign(body2, WEBHOOK_SECRET);
    try {
      const r1 = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig1 },
        body: body1,
      });
      const r2 = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig2 },
        body: body2,
      });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      const j1 = await r1.json() as Record<string, unknown>;
      const j2 = await r2.json() as Record<string, unknown>;
      // First call creates the org; second is a duplicate
      expect(j1.duplicate).toBeUndefined();
      expect(j2.duplicate).toBe(true);
      // Only ONE org should exist for the key
      const orgCount = (store as unknown as { db: { query: (s: string) => { all: () => unknown[] } } }).db.query("SELECT * FROM orgs WHERE status = 'unclaimed'").all().length;
      expect(orgCount).toBe(1); // only one org created
    } finally { server.stop(true); }
  });

  // Fix: order_created must NOT provision an org (webhook 109091 delivers
  // both subscription_created and order_created for one purchase).
  test("order_created → 200 ignored (no provisioning)", async () => {
    const store = makeStore();
    const server = bootServer(store);
    const body = makeLsPayload({
      eventName: "order_created",
      variantName: "Firm",
      webhookId: "evt-order-001",
      licenseKey: "ls-order-key-xyz",
    });
    const sig = lsSign(body, WEBHOOK_SECRET);
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig },
        body,
      });
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      expect(json.ignored).toBe(true);
      expect(json.reason).toBe("order_created_no_provision");
      // No org should have been created
      const orgCount = (store as unknown as { db: { query: (s: string) => { all: () => unknown[] } } }).db.query("SELECT * FROM orgs").all().length;
      expect(orgCount).toBe(0);
    } finally { server.stop(true); }
  });

  // Fix: same subscription id arriving under a different webhook_id must
  // provision only once (simulates order_created arriving after subscription_created
  // with a different webhook_id but same underlying subscription).
  test("ADVERSARIAL: duplicate subscription_id under different webhook_ids provisions once", async () => {
    const store = makeStore();
    const server = bootServer(store);
    const SHARED_SUB_ID = "sub-shared-12345";
    // Two subscription_created deliveries, same subscriptionId, different webhook_ids.
    const body1 = makeLsPayload({
      variantName: "Firm",
      webhookId: "evt-sub-001",
      licenseKey: "ls-key-sub-001",
      subscriptionId: SHARED_SUB_ID,
    });
    const body2 = makeLsPayload({
      variantName: "Firm",
      webhookId: "evt-sub-002", // different webhook delivery id
      licenseKey: "ls-key-sub-002",
      subscriptionId: SHARED_SUB_ID, // same subscription
    });
    const sig1 = lsSign(body1, WEBHOOK_SECRET);
    const sig2 = lsSign(body2, WEBHOOK_SECRET);
    try {
      const r1 = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig1 },
        body: body1,
      });
      const r2 = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig2 },
        body: body2,
      });
      expect(r1.status).toBe(200);
      expect(r2.status).toBe(200);
      const j1 = await r1.json() as Record<string, unknown>;
      const j2 = await r2.json() as Record<string, unknown>;
      expect(j1.ok).toBe(true);
      expect(j1.duplicate).toBeUndefined();
      // Second delivery with same subscription_id is a duplicate
      expect(j2.duplicate).toBe(true);
      // Only ONE org created
      const orgCount = (store as unknown as { db: { query: (s: string) => { all: () => unknown[] } } }).db.query("SELECT * FROM orgs WHERE status = 'unclaimed'").all().length;
      expect(orgCount).toBe(1);
    } finally { server.stop(true); }
  });

  test("audit detail carries key_source='payload' when LS provides a key", async () => {
    const store = makeStore();
    const server = bootServer(store);
    const licenseKey = "ls-audit-key-source-payload";
    const body = makeLsPayload({
      variantName: "Firm",
      webhookId: "evt-audit-payload",
      licenseKey,
    });
    const sig = lsSign(body, WEBHOOK_SECRET);
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig },
        body,
      });
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      const orgId = json.org_id as string;
      const events = store.listAudit(orgId);
      const webhookEvent = events.find((e) => e.action === "webhook.lemonsqueezy");
      expect(webhookEvent).toBeDefined();
      const detail = JSON.parse(webhookEvent!.detail ?? "{}") as Record<string, unknown>;
      expect(detail.key_source).toBe("payload");
    } finally { server.stop(true); }
  });

  test("audit detail carries key_source='generated_fallback' when no key in payload", async () => {
    const store = makeStore();
    const server = bootServer(store);
    // No licenseKey in the payload — triggers fallback generation.
    const body = makeLsPayload({
      variantName: "Firm",
      webhookId: "evt-audit-fallback",
      // licenseKey deliberately omitted
    });
    const sig = lsSign(body, WEBHOOK_SECRET);
    try {
      const resp = await fetch(`http://127.0.0.1:${server.port}/webhooks/lemonsqueezy`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-signature": sig },
        body,
      });
      expect(resp.status).toBe(200);
      const json = await resp.json() as Record<string, unknown>;
      const orgId = json.org_id as string;
      const events = store.listAudit(orgId);
      const webhookEvent = events.find((e) => e.action === "webhook.lemonsqueezy");
      expect(webhookEvent).toBeDefined();
      const detail = JSON.parse(webhookEvent!.detail ?? "{}") as Record<string, unknown>;
      expect(detail.key_source).toBe("generated_fallback");
    } finally { server.stop(true); }
  });
});

// ---------------------------------------------------------------------------
// DB migration: old-schema boot (no subscription_id column) succeeds
// ---------------------------------------------------------------------------

describe("DB migration: old-schema boot succeeds + dedupe works", () => {
  test("Store boots on a DB missing subscription_id column and dedupe still works", () => {
    // Simulate an old-schema database by creating a bun:sqlite DB with the
    // old webhook_events table (no subscription_id column) and then booting
    // Store on that file.
    const OLD_SCHEMA = `
      CREATE TABLE IF NOT EXISTS orgs (
        org_id TEXT PRIMARY KEY, name TEXT NOT NULL, billing_customer_id TEXT,
        plan TEXT NOT NULL, packs TEXT NOT NULL DEFAULT '[]', seat_limit INTEGER NOT NULL,
        status TEXT NOT NULL DEFAULT 'active', created_at TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS users (
        user_id TEXT PRIMARY KEY, org_id TEXT NOT NULL, email TEXT NOT NULL,
        email_norm TEXT NOT NULL, password_hash TEXT NOT NULL,
        role TEXT NOT NULL DEFAULT 'member', status TEXT NOT NULL DEFAULT 'active',
        created_at TEXT NOT NULL
      );
      CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_norm ON users(email_norm);
      CREATE TABLE IF NOT EXISTS webhook_events (
        event_id TEXT PRIMARY KEY,
        processed_at TEXT NOT NULL
        -- NO subscription_id column (old schema)
      );
    `;

    const dbPath = join(tmpdir(), `keepance-migration-test-${randomBytes(4).toString("hex")}.db`);
    // Create the old-schema file.
    const oldDb = new Database(dbPath, { create: true });
    oldDb.exec(OLD_SCHEMA);
    // Insert one webhook row without subscription_id (old format).
    oldDb.exec(`INSERT INTO webhook_events (event_id, processed_at) VALUES ('old-evt-1', '2026-01-01T00:00:00.000Z')`);
    oldDb.close();

    // Boot Store on the existing file — must not throw.
    let store: Store | null = null;
    expect(() => {
      store = new Store(dbPath);
    }).not.toThrow();
    expect(store).not.toBeNull();

    // Verify the migration added the column + index: dedup with subscription_id works.
    const first = store!.recordWebhookEventWithSubscription("new-evt-1", "sub-abc");
    expect(first).toBe(true);
    const dup = store!.recordWebhookEventWithSubscription("new-evt-2", "sub-abc"); // same sub
    expect(dup).toBe(false);

    store!.close();
  });
});

// ---------------------------------------------------------------------------
// 8. POST /matter/:id/members/list — includes email (Gap 2)
// ---------------------------------------------------------------------------

describe("POST /matter/:id/members/list — members response includes email", () => {
  test("members/list includes email field for each member", async () => {
    const store = makeStore();
    const { org, admin, member } = seedOrg(store);
    const matter = store.createMatter({ org_id: org.org_id, client_name: "Email Test Matter" });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member.user_id, org_id: org.org_id, role: "editor" });
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/members/list`, {},
        { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(200);
      const members = resp.body.members as Array<Record<string, unknown>>;
      expect(members.length).toBeGreaterThan(0);
      // Every member entry must carry an email field (string or null)
      for (const m of members) {
        expect("email" in m).toBe(true);
      }
      // The seeded member has a real email
      const memberRow = members.find((m) => m.user_id === member.user_id);
      expect(memberRow).toBeDefined();
      expect(memberRow!.email).toBe("member@firm.test");
    } finally { server.stop(true); }
  });

  test("members/list returns all three org members with email when all are added", async () => {
    const store = makeStore();
    const { org, admin, member, member2 } = seedOrg(store);
    const matter = store.createMatter({ org_id: org.org_id, client_name: "Multi-member Test" });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member.user_id, org_id: org.org_id, role: "editor" });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: member2.user_id, org_id: org.org_id, role: "viewer" });
    const server = bootServer(store);
    try {
      const resp = await post(server, `/matter/${matter.matter_id}/members/list`, {},
        { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(200);
      const members = resp.body.members as Array<Record<string, unknown>>;
      expect(members.length).toBe(2);
      const emails = members.map((m) => m.email as string).sort();
      expect(emails).toContain("member@firm.test");
      expect(emails).toContain("member2@firm.test");
    } finally { server.stop(true); }
  });
});

// ---------------------------------------------------------------------------
// 9. POST /org/users/list — admin-only + cross-org isolation (Gap 2)
// ---------------------------------------------------------------------------

describe("POST /org/users/list", () => {
  test("admin gets all own-org users with email+role+status", async () => {
    const store = makeStore();
    const { org, admin, member, member2 } = seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/users/list", {},
        { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(200);
      const users = resp.body.users as Array<Record<string, unknown>>;
      // admin + member + member2 = 3 users in the org
      expect(users.length).toBe(3);
      const emails = users.map((u) => u.email as string).sort();
      expect(emails).toContain(admin.email);
      expect(emails).toContain(member.email);
      expect(emails).toContain(member2.email);
      // Each entry has the expected shape
      for (const u of users) {
        expect(typeof u.user_id).toBe("string");
        expect(typeof u.email).toBe("string");
        expect(typeof u.role).toBe("string");
        expect(typeof u.status).toBe("string");
      }
    } finally { server.stop(true); }
  });

  test("ADVERSARIAL: member (non-admin) gets 403", async () => {
    const store = makeStore();
    const { member } = seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/users/list", {},
        { authorization: `Bearer ${memberBearer(store, member)}` });
      expect(resp.status).toBe(403);
    } finally { server.stop(true); }
  });

  test("ADVERSARIAL: cross-org isolation — admin of org A does not see org B users", async () => {
    const store = makeStore();
    const { admin } = seedOrg(store); // org A
    const orgB = store.createOrg({ name: "Other Firm", plan: "practice", packs: [], seat_limit: 3 });
    store.createUser({ org_id: orgB.org_id, email: "otherb@other.test", password_hash: "x", role: "member" });
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/users/list", {},
        { authorization: `Bearer ${adminBearer(store, admin)}` });
      expect(resp.status).toBe(200);
      const users = resp.body.users as Array<Record<string, unknown>>;
      // Must not include org B's user
      const orgBUser = users.find((u) => u.email === "otherb@other.test");
      expect(orgBUser).toBeUndefined();
    } finally { server.stop(true); }
  });

  test("unauthenticated → 401", async () => {
    const store = makeStore();
    seedOrg(store);
    const server = bootServer(store);
    try {
      const resp = await post(server, "/org/users/list", {}, {});
      expect(resp.status).toBe(401);
    } finally { server.stop(true); }
  });
});
