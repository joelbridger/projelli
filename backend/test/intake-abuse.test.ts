import { afterEach, beforeEach, describe, expect, test } from "bun:test";

import { hmacHash } from "../src/lib/crypto.ts";
import {
  INTAKE_EXPIRY_CIPHERTEXT_GRACE_MS,
  Store,
} from "../src/lib/db.ts";
import { config } from "../src/lib/config.ts";
import { MAX_INTAKE_FILE_BYTES, MAX_INTAKE_SUBMISSIONS, MAX_INTAKE_TOTAL_BYTES } from "../src/lib/intake.ts";
import { getIntakeAbuseTelemetry, resetIntakeAbuseTelemetryForTests } from "../src/lib/intakeTelemetry.ts";
import {
  handleIntakeBundle,
  handleSubmitIntakeItem,
  handleUploadIntakeChunk,
} from "../src/routes/intake.ts";
import { b64, seedAdvisor } from "./intakeFlowHarness.ts";

const mutableConfig = config as {
  intakePublicIpRateLimitMax: number;
  intakePublicIpRateLimitWindowSeconds: number;
  intakePublicIntakeRateLimitMax: number;
  intakePublicIntakeRateLimitWindowSeconds: number;
};
const originalLimits = { ...mutableConfig };

beforeEach(() => resetIntakeAbuseTelemetryForTests());

afterEach(() => {
  Object.assign(mutableConfig, originalLimits);
  resetIntakeAbuseTelemetryForTests();
});

function seedIntake(store: Store, intakeId = "abuse-intake", token = "right-token") {
  const advisor = seedAdvisor(store);
  store.createIntake({
    intake_id: intakeId,
    org_id: advisor.org.org_id,
    user_id: advisor.user.user_id,
    seat_id: advisor.seat.seat_id,
    token_hash: hmacHash(token),
    expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
    checklist_ciphertext: new Uint8Array([1]),
    state_ciphertext: new Uint8Array([2]),
  });
  return { advisor, token };
}

function auth(token: string): Record<string, string> {
  return { authorization: `Bearer ${token}`, "content-type": "application/json" };
}

function chunkRequest(token: string, intakeId = "abuse-intake", itemId = "item", submissionId = "submission", bytes = new Uint8Array([7])): Request {
  return new Request(`http://relay.test/intake/${intakeId}/item/${itemId}/chunk`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      intake_id: intakeId,
      item_id: itemId,
      submission_id: submissionId,
      index: 0,
      ciphertext_b64: b64(bytes),
    }),
  });
}

function submitRequest(token: string, intakeId = "abuse-intake", submissionId = "submission"): Request {
  return new Request(`http://relay.test/intake/${intakeId}/item/item/submit`, {
    method: "POST",
    headers: auth(token),
    body: JSON.stringify({
      intake_id: intakeId,
      item_id: "item",
      submission_id: submissionId,
      manifest_ciphertext_b64: b64(new Uint8Array([1])),
      wrapped_content_key_b64: b64(new Uint8Array([2])),
    }),
  });
}

describe("intake relay abuse hardening", () => {
  test("burst limits are uniform for real and unknown intake ids", async () => {
    Object.assign(mutableConfig, {
      intakePublicIpRateLimitMax: 1,
      intakePublicIpRateLimitWindowSeconds: 60,
      intakePublicIntakeRateLimitMax: 1,
      intakePublicIntakeRateLimitWindowSeconds: 60,
    });
    const store = new Store(":memory:");
    seedIntake(store);

    const realFirst = handleIntakeBundle(new Request("http://relay.test/intake/abuse-intake/bundle", { headers: auth("wrong") }), store, "abuse-intake", "real-ip");
    const realLimited = handleIntakeBundle(new Request("http://relay.test/intake/abuse-intake/bundle", { headers: auth("wrong") }), store, "abuse-intake", "real-ip");
    const unknownFirst = handleIntakeBundle(new Request("http://relay.test/intake/missing/bundle", { headers: auth("wrong") }), store, "missing", "missing-ip");
    const unknownLimited = handleIntakeBundle(new Request("http://relay.test/intake/missing/bundle", { headers: auth("wrong") }), store, "missing", "missing-ip");

    expect(realFirst.status).toBe(410);
    expect(unknownFirst.status).toBe(410);
    expect(realLimited.status).toBe(429);
    expect(unknownLimited.status).toBe(429);
    expect(await realLimited.text()).toBe(await unknownLimited.text());
    expect(getIntakeAbuseTelemetry()).toMatchObject({ rate_limited: 2, unauthenticated_or_invalid_token: 2 });
  });

  test("rejects an unauthenticated flood before opening its body and never keeps its content", async () => {
    const store = new Store(":memory:");
    seedIntake(store);
    let pulls = 0;
    const req = {
      headers: new Headers({ "content-type": "application/json" }),
      body: {
        getReader() {
          pulls++;
          return {
            async read() {
              return { done: true, value: undefined };
            },
            async cancel() {},
          };
        },
      },
    } as unknown as Request;
    // A structural Request is deliberate: opening this reader is the behavior
    // under test. Bun can eagerly pull a real stream in Request's constructor.

    const response = await handleUploadIntakeChunk(req, store, "abuse-intake", "item", "unauth-ip");
    expect(response.status).toBe(410);
    expect(pulls).toBe(0);
    const telemetry = getIntakeAbuseTelemetry();
    expect(telemetry.unauthenticated_or_invalid_token).toBe(1);
    expect(JSON.stringify(telemetry)).not.toContain("do-not-read-this-secret");
  });

  test("returns 413 for oversize chunk, file quota, total quota, and submission-count exhaustion", async () => {
    const store = new Store(":memory:");
    const { token } = seedIntake(store);

    const tooLargeChunk = chunkRequest(token, "abuse-intake", "oversize", "oversize", new Uint8Array(4 * 1024 * 1024 + 1));
    expect((await handleUploadIntakeChunk(tooLargeChunk, store, "abuse-intake", "oversize", "quota-ip-1")).status).toBe(413);

    expect((await handleUploadIntakeChunk(chunkRequest(token, "abuse-intake", "file", "file-sid"), store, "abuse-intake", "file", "quota-ip-2")).status).toBe(201);
    store.db.query("UPDATE intake_chunks SET size = ? WHERE intake_id = ? AND submission_id = ?").run(MAX_INTAKE_FILE_BYTES, "abuse-intake", "file-sid");
    expect((await handleUploadIntakeChunk(chunkRequest(token, "abuse-intake", "file", "file-sid", new Uint8Array([8])), store, "abuse-intake", "file", "quota-ip-3")).status).toBe(413);

    store.db.query("UPDATE intake_chunks SET size = ? WHERE intake_id = ? AND submission_id = ?").run(MAX_INTAKE_TOTAL_BYTES, "abuse-intake", "file-sid");
    expect((await handleUploadIntakeChunk(chunkRequest(token, "abuse-intake", "total", "total-sid", new Uint8Array([9])), store, "abuse-intake", "total", "quota-ip-4")).status).toBe(413);

    for (let i = 0; i < MAX_INTAKE_SUBMISSIONS; i++) {
      store.db.query(
        "INSERT INTO intake_submissions (intake_id, item_id, submission_id, manifest_ciphertext, wrapped_content_key, chunk_count, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)",
      ).run("abuse-intake", "count", `count-${i}`, new Uint8Array([1]), new Uint8Array([2]), new Date().toISOString());
    }
    expect((await handleSubmitIntakeItem(submitRequest(token, "abuse-intake", "one-too-many"), store, "abuse-intake", "item", "quota-ip-5")).status).toBe(413);
    expect(getIntakeAbuseTelemetry().oversize_or_quota_rejections).toBe(4);
  });

  test("removes all ciphertext after expiry plus grace, retains it inside grace, and keeps ack deletion", () => {
    const store = new Store(":memory:");
    const { advisor } = seedIntake(store, "past-grace", "past-token");
    const sweepAt = Date.now();
    const withinGrace = store.createIntake({
      intake_id: "within-grace",
      org_id: advisor.org.org_id,
      user_id: advisor.user.user_id,
      seat_id: advisor.seat.seat_id,
      token_hash: hmacHash("within-token"),
      expires_at: new Date(sweepAt - INTAKE_EXPIRY_CIPHERTEXT_GRACE_MS + 24 * 60 * 60 * 1000).toISOString(),
      checklist_ciphertext: new Uint8Array([3]),
      state_ciphertext: new Uint8Array([4]),
    });
    store.db.query("UPDATE intakes SET expires_at = ? WHERE intake_id = ?").run(new Date(sweepAt - INTAKE_EXPIRY_CIPHERTEXT_GRACE_MS - 60_000).toISOString(), "past-grace");
    expect(store.appendIntakeChunk({ intake_id: "past-grace", item_id: "item", submission_id: "sid", index: 0, ciphertext: new Uint8Array([9]) }).ok).toBe(true);
    expect(store.finalizeIntakeSubmission({ intake_id: "past-grace", item_id: "item", submission_id: "sid", manifest_ciphertext: new Uint8Array([8]), wrapped_content_key: new Uint8Array([7]) }).ok).toBe(true);

    expect(store.purgeExpiredIntakeCiphertext(sweepAt).deleted_intakes).toBeGreaterThanOrEqual(1);
    expect(store.getIntake("past-grace")).toBeNull();
    expect(store.countIntakeChunks("past-grace")).toBe(0);
    expect(store.getIntake(withinGrace.intake_id)).not.toBeNull();

    expect(store.appendIntakeChunk({ intake_id: withinGrace.intake_id, item_id: "ack", submission_id: "ack-sid", index: 0, ciphertext: new Uint8Array([6]) }).ok).toBe(true);
    expect(store.finalizeIntakeSubmission({ intake_id: withinGrace.intake_id, item_id: "ack", submission_id: "ack-sid", manifest_ciphertext: new Uint8Array([5]), wrapped_content_key: new Uint8Array([4]) }).ok).toBe(true);
    expect(store.ackIntakeCiphertext({ intake_id: withinGrace.intake_id, submission_ids: ["ack-sid"] })).toMatchObject({ deleted_chunks: 1, wiped_submissions: 1 });
    expect(store.countIntakeChunks(withinGrace.intake_id)).toBe(0);
  });
});
