import { describe, expect, test } from "bun:test";
import { createHmac, generateKeyPairSync } from "node:crypto";
import { Store } from "../src/lib/db.ts";
import { hmacHash } from "../src/lib/crypto.ts";
import { mintSeatToken } from "../src/lib/services.ts";
import {
  handleAckSignatureWakeups,
  handleDeleteSignatureLaunch,
  handleDocusignConnectEvent,
  handleGetSignatureLaunch,
  handleIssueSigningCapability,
  handleListSignatureWakeups,
  handlePutSignatureLaunch,
  type DocusignSigningDependencies,
} from "../src/routes/docusignSigning.ts";
import { BlindSigningBrokerStore, MAX_SIGNATURE_LAUNCH_BYTES } from "../src/lib/docusignSigning/store.ts";
import type { DocusignSigningGrantConfig, HttpPostForm } from "../src/lib/docusignSigning/jwtGrant.ts";

function fixture() {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: `Broker ${crypto.randomUUID()}`, plan: "practice", packs: ["advisor"], seat_limit: 2 });
  const user = store.createUser({ org_id: org.org_id, email: `broker-${crypto.randomUUID()}@test.invalid`, password_hash: "x", role: "admin" });
  const activated = store.activateSeat({ org_id: org.org_id, user_id: user.user_id, machine_id: crypto.randomUUID(), machine_label: "test", seat_limit: 2 });
  if (!activated.ok) throw new Error("fixture seat failed");
  const intakeId = `intake-${crypto.randomUUID()}`;
  const publicToken = `public-${crypto.randomUUID()}`;
  store.createIntake({
    intake_id: intakeId,
    org_id: org.org_id,
    user_id: user.user_id,
    seat_id: activated.seat.seat_id,
    token_hash: hmacHash(publicToken),
    expires_at: new Date(Date.now() + 60_000).toISOString(),
    checklist_ciphertext: new Uint8Array([1]),
    state_ciphertext: new Uint8Array([2]),
  });
  return { store, intakeId, publicToken, seatToken: mintSeatToken(org, user, activated.seat).token };
}

const rsa = generateKeyPairSync("rsa", { modulusLength: 2048 }).privateKey;

function signingConfig(environment: "demo" | "production" = "demo"): DocusignSigningGrantConfig & { connectKey: string } {
  return {
    environment,
    productionReleaseEnabled: environment === "production",
    integrationKey: "integration-key",
    impersonatedUserId: "sender-user",
    accountId: "account-id",
    apiBaseUri: environment === "demo" ? "https://demo.docusign.net/restapi" : "https://na3.docusign.net/restapi",
    privateKey: rsa,
    allowedReturnUrl: "https://intake.lantern.test/signing-return",
    oauthTokenEndpoint: environment === "demo" ? "https://account-d.docusign.com/oauth/token" : "https://account.docusign.com/oauth/token",
    jwtAudience: environment === "demo" ? "account-d.docusign.com" : "account.docusign.com",
    connectKey: "connect-test-key",
  };
}

function deps(overrides: Partial<DocusignSigningDependencies> = {}): DocusignSigningDependencies {
  return { brokerStore: new BlindSigningBrokerStore(), signingConfig: signingConfig(), now: () => Date.now(), ...overrides };
}

function advisorRequest(path: string, seatToken: string, method: string, body?: unknown): Request {
  return new Request(`https://broker.test${path}`, {
    method,
    headers: { "x-seat-token": seatToken, ...(body !== undefined ? { "content-type": "application/json" } : {}) },
    body: body === undefined ? undefined : JSON.stringify(body),
  });
}

function publicRequest(path: string, token: string): Request {
  return new Request(`https://broker.test${path}`, { headers: { authorization: `Bearer ${token}` } });
}

async function response(res: Response) {
  return { status: res.status, body: await res.json() as Record<string, unknown> };
}

function signedConnect(body: unknown, key = "connect-test-key"): Request {
  const raw = JSON.stringify(body);
  const signature = createHmac("sha256", key).update(raw).digest("base64");
  return new Request("https://broker.test/webhooks/docusign-signing", {
    method: "POST",
    headers: { "x-docusign-signature-1": signature, "content-type": "application/json" },
    body: raw,
  });
}

function validEvent(overrides: Record<string, unknown> = {}) {
  return {
    event_id: `event-${crypto.randomUUID()}`,
    envelope_id: `envelope-${crypto.randomUUID()}`,
    event_type: "completed",
    occurred_at: new Date().toISOString(),
    environment: "demo",
    nonce: `nonce-${crypto.randomUUID()}`,
    ...overrides,
  };
}

describe("DocuSign signing launch relay", () => {
  test("round-trips opaque bytes, clears them, and returns null before launch", async () => {
    const f = fixture();
    const d = deps();
    expect((await response(await handleGetSignatureLaunch(publicRequest(`/docusign-signing/${f.intakeId}/launch`, f.publicToken), f.store, f.intakeId, "127.0.0.1", d))).body).toEqual({ launch_ciphertext_b64: null });
    const ciphertext = Buffer.from("sealed launch record, deliberately unreadable to broker").toString("base64");
    expect((await response(await handlePutSignatureLaunch(advisorRequest(`/docusign-signing/${f.intakeId}/launch`, f.seatToken, "PUT", { launch_ciphertext_b64: ciphertext }), f.store, f.intakeId, d))).status).toBe(200);
    expect((await response(await handleGetSignatureLaunch(publicRequest(`/docusign-signing/${f.intakeId}/launch`, f.publicToken), f.store, f.intakeId, "127.0.0.1", d))).body).toEqual({ launch_ciphertext_b64: ciphertext });
    expect((await response(await handleDeleteSignatureLaunch(advisorRequest(`/docusign-signing/${f.intakeId}/launch`, f.seatToken, "DELETE"), f.store, f.intakeId, d))).status).toBe(200);
    expect((await response(await handleGetSignatureLaunch(publicRequest(`/docusign-signing/${f.intakeId}/launch`, f.publicToken), f.store, f.intakeId, "127.0.0.1", d))).body).toEqual({ launch_ciphertext_b64: null });
  });

  test("rejects oversized and unknown launches before storage, including a nonexistent intake", async () => {
    const f = fixture();
    const d = deps();
    const tooLarge = Buffer.alloc(MAX_SIGNATURE_LAUNCH_BYTES + 1).toString("base64");
    expect((await response(await handlePutSignatureLaunch(advisorRequest(`/docusign-signing/${f.intakeId}/launch`, f.seatToken, "PUT", { launch_ciphertext_b64: tooLarge }), f.store, f.intakeId, d))).status).toBe(400);
    for (const field of ["document_bytes", "recipient_name", "recipient_email", "matter_id", "filename", "file_path", "ceremony_url", "envelope_metadata"]) {
      expect((await response(await handlePutSignatureLaunch(advisorRequest(`/docusign-signing/${f.intakeId}/launch`, f.seatToken, "PUT", { [field]: "forbidden" }), f.store, f.intakeId, d))).status).toBe(400);
    }
    expect((await response(await handlePutSignatureLaunch(advisorRequest("/docusign-signing/missing/launch", f.seatToken, "PUT", { launch_ciphertext_b64: "AQ==" }), f.store, "missing", d))).status).toBe(404);
    expect(d.brokerStore!.getLaunch(f.intakeId)).toBeNull();
  });

  test("rejects multipart bodies on each launch endpoint before touching its store", async () => {
    const f = fixture();
    const d = deps();
    const multipartHeaders = { "x-seat-token": f.seatToken, "content-type": "multipart/form-data; boundary=x" };
    expect((await response(await handlePutSignatureLaunch(new Request(`https://broker.test/docusign-signing/${f.intakeId}/launch`, { method: "PUT", headers: multipartHeaders, body: "--x" }), f.store, f.intakeId, d))).status).toBe(400);
    expect((await response(await handleGetSignatureLaunch(new Request(`https://broker.test/docusign-signing/${f.intakeId}/launch`, { headers: { authorization: `Bearer ${f.publicToken}`, "content-type": "multipart/form-data; boundary=x" } }), f.store, f.intakeId, "127.0.0.1", d))).status).toBe(400);
    expect((await response(await handleDeleteSignatureLaunch(new Request(`https://broker.test/docusign-signing/${f.intakeId}/launch`, { method: "DELETE", headers: multipartHeaders, body: "--x" }), f.store, f.intakeId, d))).status).toBe(400);
    expect(d.brokerStore!.getLaunch(f.intakeId)).toBeNull();
  });
});

describe("JWT capability broker", () => {
  test("uses only the environment's token endpoint and mints fresh uncached capabilities", async () => {
    const f = fixture();
    const urls: string[] = [];
    let sequence = 0;
    const postForm: HttpPostForm = async (url) => ({ status: 200, json: { access_token: `token-${++sequence}`, expires_in: 300 } });
    const d = deps({ postForm });
    const original = d.postForm!;
    d.postForm = async (url, form) => { urls.push(url); return original(url, form); };
    const one = await response(await handleIssueSigningCapability(advisorRequest(`/docusign-signing/${f.intakeId}/capability`, f.seatToken, "POST", {}), f.store, f.intakeId, d));
    const two = await response(await handleIssueSigningCapability(advisorRequest(`/docusign-signing/${f.intakeId}/capability`, f.seatToken, "POST", {}), f.store, f.intakeId, d));
    expect(one.body.capability).toBe("token-1");
    expect(two.body.capability).toBe("token-2");
    expect(urls).toEqual(["https://account-d.docusign.com/oauth/token", "https://account-d.docusign.com/oauth/token"]);
    expect(d.brokerStore!.listWakeups()).toEqual([]);
  });

  test("isolates production and translates a missing consent without leaking upstream detail", async () => {
    const f = fixture();
    const urls: string[] = [];
    const production = signingConfig("production");
    const d = deps({ signingConfig: production, postForm: async (url) => { urls.push(url); return { status: 400, json: { error: "consent_required", internal: "do-not-leak" } }; } });
    const out = await response(await handleIssueSigningCapability(advisorRequest(`/docusign-signing/${f.intakeId}/capability`, f.seatToken, "POST", {}), f.store, f.intakeId, d));
    expect(urls).toEqual(["https://account.docusign.com/oauth/token"]);
    expect(out).toEqual({ status: 403, body: { error: "docusign_consent_required", detail: "DocuSign consent is required for this signing integration." } });
    expect(JSON.stringify(out)).not.toContain("do-not-leak");
  });

  test("rejects forbidden body fields before the HTTP seam is called", async () => {
    const f = fixture();
    let calls = 0;
    const d = deps({ postForm: async () => { calls++; return { status: 200, json: { access_token: "token", expires_in: 300 } }; } });
    for (const field of ["document_bytes", "recipient_name", "recipient_email", "matter_id", "filename", "file_path", "ceremony_url", "envelope_metadata"]) {
      const out = await response(await handleIssueSigningCapability(advisorRequest(`/docusign-signing/${f.intakeId}/capability`, f.seatToken, "POST", { [field]: "forbidden" }), f.store, f.intakeId, d));
      expect(out.status).toBe(400);
    }
    expect(calls).toBe(0);
  });

  test("fails closed for an unusable private key or an endpoint that disagrees with its environment", async () => {
    const f = fixture();
    let calls = 0;
    const base = signingConfig();
    const badKey = { ...base, privateKey: null };
    const badHost = { ...base, oauthTokenEndpoint: "https://account.docusign.com/oauth/token" };
    const postForm: HttpPostForm = async () => { calls++; return { status: 200, json: { access_token: "forbidden", expires_in: 300 } }; };
    expect((await response(await handleIssueSigningCapability(advisorRequest(`/docusign-signing/${f.intakeId}/capability`, f.seatToken, "POST", {}), f.store, f.intakeId, deps({ signingConfig: badKey, postForm })))).status).toBe(503);
    expect((await response(await handleIssueSigningCapability(advisorRequest(`/docusign-signing/${f.intakeId}/capability`, f.seatToken, "POST", {}), f.store, f.intakeId, deps({ signingConfig: badHost, postForm })))).status).toBe(503);
    expect(calls).toBe(0);
  });
});

describe("DocuSign Connect wake-ups", () => {
  test("accepts one valid completion, makes it pollable, and consumes it", async () => {
    const f = fixture();
    const d = deps();
    const event = validEvent();
    expect((await response(await handleDocusignConnectEvent(signedConnect(event), d))).status).toBe(200);
    const wakeups = await response(await handleListSignatureWakeups(advisorRequest(`/docusign-signing/${f.intakeId}/wakeups`, f.seatToken, "GET"), f.store, f.intakeId, d));
    expect(wakeups.body.wakeups).toEqual([{ event_id: event.event_id, envelope_id: event.envelope_id, event_type: "completed", at: event.occurred_at }]);
    expect((await response(await handleAckSignatureWakeups(advisorRequest(`/docusign-signing/${f.intakeId}/wakeups/ack`, f.seatToken, "POST", { event_ids: [event.event_id] }), f.store, f.intakeId, d))).body).toEqual({ ok: true, consumed: 1 });
    expect((await response(await handleListSignatureWakeups(advisorRequest(`/docusign-signing/${f.intakeId}/wakeups`, f.seatToken, "GET"), f.store, f.intakeId, d))).body).toEqual({ wakeups: [] });
  });

  test("rejects unsigned, invalid, replayed, old, wrong-environment, malformed, and document events", async () => {
    const d = deps();
    const event = validEvent();
    expect((await response(await handleDocusignConnectEvent(new Request("https://broker.test/webhooks/docusign-signing", { method: "POST", body: JSON.stringify(event) }), d))).status).toBe(401);
    expect((await response(await handleDocusignConnectEvent(signedConnect(event, "wrong-key"), d))).status).toBe(401);
    expect((await response(await handleDocusignConnectEvent(signedConnect({ ...event, occurred_at: new Date(Date.now() - 6 * 60_000).toISOString() }), d))).status).toBe(400);
    expect((await response(await handleDocusignConnectEvent(signedConnect({ ...event, environment: "production" }), d))).status).toBe(400);
    expect((await response(await handleDocusignConnectEvent(signedConnect({ ...event, documents: "actual bytes" }), d))).status).toBe(400);
    const raw = "{not-json";
    const malformed = new Request("https://broker.test/webhooks/docusign-signing", { method: "POST", headers: { "x-docusign-signature-1": createHmac("sha256", "connect-test-key").update(raw).digest("base64") }, body: raw });
    expect((await response(await handleDocusignConnectEvent(malformed, d))).status).toBe(400);
    expect((await response(await handleDocusignConnectEvent(signedConnect(event), d))).status).toBe(200);
    expect((await response(await handleDocusignConnectEvent(signedConnect(event), d))).status).toBe(409);
    expect(d.brokerStore!.listWakeups()).toHaveLength(1);
  });

  test("forbidden webhook fields are rejected after HMAC and never create a wake-up or OAuth call", async () => {
    const d = deps();
    for (const field of ["document_content", "recipient_name", "recipient_email", "matter_id", "filename", "file_path", "ceremony_url", "envelope_metadata"]) {
      expect((await response(await handleDocusignConnectEvent(signedConnect(validEvent({ [field]: "forbidden" })), d))).status).toBe(400);
    }
    expect(d.brokerStore!.listWakeups()).toEqual([]);
  });
});
