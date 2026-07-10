/**
 * Intake relay tests.
 *
 * These pin the mailbox rules: the relay stores only opaque encrypted bytes,
 * rejects replay with durable database state, and gives the same neutral answer
 * for every unusable public link.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { hmacHash } from "../src/lib/crypto.ts";
import { mintSeatToken } from "../src/lib/services.ts";
import {
  MAX_INTAKE_CHUNK_BYTES,
  MAX_INTAKE_STATE_BYTES,
} from "../src/lib/intake.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";

const servers: Array<Bun.Server<SyncSocketData>> = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()!.stop(true);
});

function b64(value: string | Uint8Array): string {
  return Buffer.from(typeof value === "string" ? value : value).toString("base64");
}

function makeServer() {
  const store = new Store(":memory:");
  const srv = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
  servers.push(srv);
  return { store, base: `http://${srv.hostname}:${srv.port}` };
}

function seedAdvisor(store: Store) {
  const org = store.createOrg({
    name: `Acme Advice ${crypto.randomUUID()}`,
    plan: "practice",
    packs: ["advisor"],
    seat_limit: 5,
  });
  const user = store.createUser({
    org_id: org.org_id,
    email: `advisor-${crypto.randomUUID()}@acme.test`,
    password_hash: "x",
    role: "admin",
  });
  const seat = store.activateSeat({
    org_id: org.org_id,
    user_id: user.user_id,
    machine_id: `machine-${crypto.randomUUID()}`,
    machine_label: "Test machine",
    seat_limit: org.seat_limit,
  });
  if (!seat.ok) throw new Error("fixture seat activation failed");
  return { org, user, seat: seat.seat, seatToken: mintSeatToken(org, user, seat.seat).token };
}

async function parse(res: Response) {
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

async function createIntake(
  ctx: ReturnType<typeof makeServer>,
  seatToken: string,
  opts?: {
    intakeId?: string;
    authToken?: string;
    expiresAt?: string;
    checklist?: Uint8Array | string;
    state?: Uint8Array | string;
  },
) {
  const intakeId = opts?.intakeId ?? `intake-${crypto.randomUUID()}`;
  const authToken = opts?.authToken ?? `auth-${crypto.randomUUID()}`;
  const res = await fetch(`${ctx.base}/intake`, {
    method: "POST",
    headers: { "content-type": "application/json", "x-seat-token": seatToken },
    body: JSON.stringify({
      intake_id: intakeId,
      auth_token: authToken,
      expires_at: opts?.expiresAt ?? new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      checklist_ciphertext_b64: b64(opts?.checklist ?? new Uint8Array([1, 2, 3])),
      state_ciphertext_b64: b64(opts?.state ?? new Uint8Array([4, 5, 6])),
    }),
  });
  const out = await parse(res);
  expect(out.status).toBe(201);
  return { intakeId, authToken, body: out.body };
}

async function publicJson(
  ctx: ReturnType<typeof makeServer>,
  path: string,
  authToken: string,
  method: string,
  body?: unknown,
) {
  return parse(
    await fetch(`${ctx.base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${authToken}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

async function advisorJson(
  ctx: ReturnType<typeof makeServer>,
  path: string,
  seatToken: string,
  method: string,
  body?: unknown,
) {
  return parse(
    await fetch(`${ctx.base}${path}`, {
      method,
      headers: {
        "x-seat-token": seatToken,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

async function uploadChunk(
  ctx: ReturnType<typeof makeServer>,
  intakeId: string,
  authToken: string,
  itemId: string,
  submissionId: string,
  index: number,
  bytes: Uint8Array,
) {
  return publicJson(ctx, `/intake/${encodeURIComponent(intakeId)}/item/${encodeURIComponent(itemId)}/chunk`, authToken, "POST", {
    intake_id: intakeId,
    item_id: itemId,
    submission_id: submissionId,
    index,
    ciphertext_b64: b64(bytes),
  });
}

async function submitItem(
  ctx: ReturnType<typeof makeServer>,
  intakeId: string,
  authToken: string,
  itemId: string,
  submissionId: string,
) {
  return publicJson(ctx, `/intake/${encodeURIComponent(intakeId)}/item/${encodeURIComponent(itemId)}/submit`, authToken, "POST", {
    intake_id: intakeId,
    item_id: itemId,
    submission_id: submissionId,
    manifest_ciphertext_b64: b64(`sealed-manifest-${submissionId}`),
    wrapped_content_key_b64: b64(`wrapped-key-${submissionId}`),
  });
}

describe("public intake gate", () => {
  test("expired, revoked, unknown, and wrong-token links have one neutral 410 shape", async () => {
    const ctx = makeServer();
    const advisor = seedAdvisor(ctx.store);
    const active = await createIntake(ctx, advisor.seatToken, { intakeId: "intake-active", authToken: "right-token" });
    const expired = await createIntake(ctx, advisor.seatToken, {
      intakeId: "intake-expired",
      authToken: "expired-token",
      expiresAt: new Date(Date.now() - 60_000).toISOString(),
    });
    const revoked = await createIntake(ctx, advisor.seatToken, { intakeId: "intake-revoked", authToken: "revoked-token" });
    expect((await advisorJson(ctx, `/intake/${revoked.intakeId}/revoke`, advisor.seatToken, "POST")).status).toBe(200);

    const cases = [
      await publicJson(ctx, `/intake/${active.intakeId}/bundle`, "wrong-token", "GET"),
      await publicJson(ctx, `/intake/${expired.intakeId}/bundle`, expired.authToken, "GET"),
      await publicJson(ctx, `/intake/${revoked.intakeId}/bundle`, revoked.authToken, "GET"),
      await publicJson(ctx, "/intake/no-such-intake/bundle", "any-token", "GET"),
    ];

    const shapes = cases.map((c) => JSON.stringify({ status: c.status, body: c.body }));
    expect(new Set(shapes).size).toBe(1);
    expect(cases[0]!.status).toBe(410);
    expect(cases[0]!.body).toEqual({ error: "intake_unavailable" });
  });

  test("bundle finalized_item_ids come from finalization rows, not writable state", async () => {
    const ctx = makeServer();
    const advisor = seedAdvisor(ctx.store);
    const { intakeId, authToken } = await createIntake(ctx, advisor.seatToken, {
      state: JSON.stringify({ finalized_item_ids: ["forged-from-state"] }),
    });

    const before = await publicJson(ctx, `/intake/${intakeId}/bundle`, authToken, "GET");
    expect(before.status).toBe(200);
    expect(before.body.finalized_item_ids).toEqual([]);

    expect((await uploadChunk(ctx, intakeId, authToken, "item-real", "sid-real", 0, new Uint8Array([9, 8, 7]))).status).toBe(201);
    expect((await submitItem(ctx, intakeId, authToken, "item-real", "sid-real")).status).toBe(201);

    const after = await publicJson(ctx, `/intake/${intakeId}/bundle`, authToken, "GET");
    expect(after.status).toBe(200);
    expect(after.body.finalized_item_ids).toEqual(["item-real"]);
  });
});

describe("intake mailbox storage", () => {
  test("ack deletes acked ciphertext chunks", async () => {
    const ctx = makeServer();
    const advisor = seedAdvisor(ctx.store);
    const { intakeId, authToken } = await createIntake(ctx, advisor.seatToken);

    expect((await uploadChunk(ctx, intakeId, authToken, "item-tax", "sid-ack", 0, new Uint8Array([1, 2, 3]))).status).toBe(201);
    expect((await submitItem(ctx, intakeId, authToken, "item-tax", "sid-ack")).status).toBe(201);
    expect(ctx.store.countIntakeChunks(intakeId)).toBe(1);

    const ack = await advisorJson(ctx, `/intake/${intakeId}/ack`, advisor.seatToken, "POST", {
      submission_ids: ["sid-ack"],
    });
    expect(ack.status).toBe(200);
    expect(ctx.store.countIntakeChunks(intakeId)).toBe(0);
  });

  test("two submissions to one item can both use chunk index 0", async () => {
    const ctx = makeServer();
    const advisor = seedAdvisor(ctx.store);
    const { intakeId, authToken } = await createIntake(ctx, advisor.seatToken);

    const a = await uploadChunk(ctx, intakeId, authToken, "item-license", "sid-device-a", 0, new Uint8Array([1]));
    const b = await uploadChunk(ctx, intakeId, authToken, "item-license", "sid-device-b", 0, new Uint8Array([2]));

    expect(a.status).toBe(201);
    expect(b.status).toBe(201);
    expect(ctx.store.countIntakeChunks(intakeId)).toBe(2);
  });

  test("oversized state and oversized chunk are rejected at the cap", async () => {
    const ctx = makeServer();
    const advisor = seedAdvisor(ctx.store);
    const { intakeId, authToken } = await createIntake(ctx, advisor.seatToken);

    const tooBigState = await publicJson(ctx, `/intake/${intakeId}/state`, authToken, "PUT", {
      ciphertext_b64: b64(new Uint8Array(MAX_INTAKE_STATE_BYTES + 1)),
    });
    expect(tooBigState.status).toBe(413);

    const tooBigChunk = await uploadChunk(
      ctx,
      intakeId,
      authToken,
      "item-big",
      "sid-big",
      0,
      new Uint8Array(MAX_INTAKE_CHUNK_BYTES + 1),
    );
    expect(tooBigChunk.status).toBe(413);
  });

  test("duplicate submission_id is rejected and stays rejected after Store reopen", () => {
    const dir = mkdtempSync(join(tmpdir(), "lantern-intake-"));
    const dbPath = join(dir, "relay.sqlite");
    try {
      const firstStore = new Store(dbPath);
      const advisor = seedAdvisor(firstStore);
      firstStore.createIntake({
        intake_id: "durable-intake",
        org_id: advisor.org.org_id,
        user_id: advisor.user.user_id,
        seat_id: advisor.seat.seat_id,
        token_hash: hmacHash("durable-token"),
        expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        checklist_ciphertext: new Uint8Array([1]),
        state_ciphertext: new Uint8Array([2]),
      });
      expect(
        firstStore.finalizeIntakeSubmission({
          intake_id: "durable-intake",
          item_id: "item-a",
          submission_id: "sid-replay",
          manifest_ciphertext: new Uint8Array([3]),
          wrapped_content_key: new Uint8Array([4]),
        }).ok,
      ).toBe(true);
      firstStore.close();

      const reopened = new Store(dbPath);
      const replay = reopened.finalizeIntakeSubmission({
        intake_id: "durable-intake",
        item_id: "item-b",
        submission_id: "sid-replay",
        manifest_ciphertext: new Uint8Array([5]),
        wrapped_content_key: new Uint8Array([6]),
      });
      expect(replay).toEqual({ ok: false, reason: "duplicate_submission_id" });
      reopened.close();
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
  });
});

describe("advisor seat gate", () => {
  test("advisor endpoints reject missing or invalid seat tokens", async () => {
    const ctx = makeServer();
    const body = {
      intake_id: "seat-gate",
      auth_token: "auth",
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      checklist_ciphertext_b64: b64("sealed-checklist"),
      state_ciphertext_b64: b64("sealed-state"),
    };

    const missing = await parse(
      await fetch(`${ctx.base}/intake`, {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify(body),
      }),
    );
    expect(missing.status).toBe(401);

    const invalid = await parse(
      await fetch(`${ctx.base}/intake`, {
        method: "POST",
        headers: { "content-type": "application/json", "x-seat-token": "not-a-real-seat-token" },
        body: JSON.stringify(body),
      }),
    );
    expect(invalid.status).toBe(401);
  });
});
