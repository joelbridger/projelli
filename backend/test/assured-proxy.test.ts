/**
 * ASSURED ZERO-RETENTION INFERENCE PROXY — E2E + the zero-retention GUARD.
 *
 * Boots TWO isolated servers on ephemeral ports, both via real Bun.serve:
 *   1. A FAKE UPSTREAM PROVIDER (stands in for Anthropic/OpenAI/Google) so NO
 *      real API calls are made. It records the request body it received (to
 *      prove the proxy forwarded it), echoes a sentinel back in its streamed
 *      completion, and reports provider-shaped `usage` numbers.
 *   2. The real firm backend (buildServeOptions) with its own in-memory Store +
 *      hub — the SAME routes as production.
 *
 * Then it drives the full firm flow over the wire and asserts:
 *   - a valid firm seat can infer and gets the streamed response back verbatim
 *   - the proxy actually forwarded the request body to the provider
 *   - an invalid / missing / cross-user seat is rejected (401)
 *   - inference with no managed key configured is rejected (409)
 *   - the metadata-only billing row is written with the provider's token counts
 *   - **THE ZERO-RETENTION GUARD**: a unique sentinel fed as the prompt (and
 *     echoed in the completion) appears in NEITHER the DB (any table/column) NOR
 *     any captured server log output after the round-trip completes. The billing
 *     row has only metadata (no body fields).
 *   - a STATIC check: the proxy data-path source has no body-write/body-log call.
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { buildServeOptions } from "../src/server.ts";
import type { SyncSocketData } from "../src/server.ts";
import { encryptSecret, decryptSecret } from "../src/lib/crypto.ts";
import { OpaqueBody, ASSURED_PROVIDERS } from "../src/lib/assured-types.ts";
import { scanUsage } from "../src/lib/assured.ts";
import { readFileSync } from "node:fs";
import { join } from "node:path";

// ---------------------------------------------------------------------------
// Fake upstream provider. Anthropic-shaped SSE by default; records each request
// body so we can prove the proxy forwarded the prompt. Echoes a sentinel in the
// completion text and reports usage numbers the proxy must scan out.
// ---------------------------------------------------------------------------
interface CapturedUpstream {
  url: string;
  authHeader: string | null;
  apiKeyHeader: string | null;
  bodyText: string;
}
const captured: CapturedUpstream[] = [];

// Tunable per-test so we can exercise error/timeout paths.
let fakeMode: "ok" | "500" | "hang" = "ok";
let usageIn = 1234;
let usageOut = 567;

const fake = Bun.serve({
  port: 0,
  idleTimeout: 30,
  async fetch(req) {
    const url = new URL(req.url);
    const bodyText = await req.text(); // the fake CAN read it; the proxy never does
    captured.push({
      url: req.url,
      authHeader: req.headers.get("authorization"),
      apiKeyHeader: req.headers.get("x-api-key"),
      bodyText,
    });

    if (fakeMode === "500") {
      return new Response(JSON.stringify({ error: { message: "upstream boom" } }), { status: 500, headers: { "content-type": "application/json" } });
    }
    if (fakeMode === "hang") {
      // Never send response headers at all — simulates a provider that accepts
      // the connection but never replies. The proxy's upstream timeout must
      // fire and abort the fetch (hitting the catch -> 504). We await an
      // abortable promise so the handler unwinds when the client/proxy aborts.
      await new Promise<void>((resolve) => {
        if (req.signal.aborted) return resolve();
        req.signal.addEventListener("abort", () => resolve());
      });
      return new Response(null, { status: 499 });
    }

    // Echo a sentinel pulled from the forwarded prompt back in the completion,
    // so the guard also proves the COMPLETION is not retained. We parse the
    // forwarded body (we're the provider; we're allowed to) to find it.
    let echo = "hello";
    try {
      const parsed = JSON.parse(bodyText);
      echo = parsed?.messages?.[0]?.content ?? parsed?.sentinel ?? "hello";
    } catch {
      /* ignore */
    }

    // Anthropic-shaped SSE: message_start carries input usage; deltas carry
    // text; message_delta carries output usage.
    const enc = new TextEncoder();
    const frames = [
      `event: message_start\ndata: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: usageIn, output_tokens: 0 } } })}\n\n`,
      `event: content_block_delta\ndata: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: echo } })}\n\n`,
      `event: message_delta\ndata: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: usageOut } })}\n\n`,
      `data: [DONE]\n\n`,
    ];
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const f of frames) controller.enqueue(enc.encode(f));
        controller.close();
      },
    });
    return new Response(stream, { status: 200, headers: { "content-type": "text/event-stream" } });
  },
});
const FAKE_BASE = `http://${fake.hostname}:${fake.port}`;

// Point the proxy's upstreams at the fake. `baseUrlFor` reads these at REQUEST
// time, so setting them here (after imports) is fine. (The upstream timeout, by
// contrast, is read at config import time, so it lives in test/setup.ts.)
process.env.ASSURED_ANTHROPIC_BASE_URL = FAKE_BASE;
process.env.ASSURED_OPENAI_BASE_URL = FAKE_BASE;
process.env.ASSURED_GOOGLE_BASE_URL = FAKE_BASE;

// The firm backend under test.
const store = new Store(":memory:");
const hub = new FanoutHub();
const srv = Bun.serve<SyncSocketData>(buildServeOptions(store, hub));
const BASE = () => `http://${srv.hostname}:${srv.port}`;

afterAll(() => {
  srv.stop(true);
  fake.stop(true);
});

async function post(path: string, body: unknown, bearer?: string) {
  const res = await fetch(`${BASE()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : path === "/admin/org" ? { authorization: `Bearer ${process.env.ADMIN_PROVISION_SECRET}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json().catch(() => ({}))) as Record<string, any> };
}

/** Send an inference request. Control fields ride in headers; body is the prompt. */
async function infer(opts: { access: string; seat: string; provider?: string; model?: string; promptBody: unknown; stream?: boolean }) {
  const res = await fetch(`${BASE()}/assured/infer`, {
    method: "POST",
    headers: {
      authorization: `Bearer ${opts.access}`,
      "x-seat-token": opts.seat,
      "x-provider": opts.provider ?? "anthropic",
      "x-model": opts.model ?? "claude-sonnet-4-20250514",
      "x-stream": opts.stream === false ? "0" : "1",
      "content-type": "application/json",
    },
    body: JSON.stringify(opts.promptBody),
  });
  const text = await res.text();
  return { status: res.status, headers: res.headers, text };
}

/** Dump EVERY value in EVERY user table to one big string — for the sentinel scan. */
function dumpEntireDb(s: Store): string {
  const tables = (s.db.query(`SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'`).all() as Array<{ name: string }>).map((r) => r.name);
  const chunks: string[] = [];
  for (const t of tables) {
    const rows = s.db.query(`SELECT * FROM ${t}`).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      for (const [k, v] of Object.entries(row)) {
        // Stringify every value, including BLOBs (Uint8Array) decoded as utf8.
        if (v instanceof Uint8Array) {
          chunks.push(`${t}.${k}=${Buffer.from(v).toString("utf8")}`);
          chunks.push(`${t}.${k}.hex=${Buffer.from(v).toString("hex")}`);
        } else {
          chunks.push(`${t}.${k}=${String(v)}`);
        }
      }
    }
  }
  return chunks.join("\n");
}

describe("assured proxy — provisioning + happy path", () => {
  let licenseKey = "";
  let adminAccess = "";
  let aliceAccess = "";
  let aliceSeat = "";

  beforeAll(async () => {
    const prov = await post("/admin/org", {
      name: `Assured Law ${crypto.randomUUID()}`,
      plan: "practice",
      packs: ["legal"],
      seat_limit: 5,
      admin_email: `admin-${crypto.randomUUID()}@assured.test`,
      admin_password: "admin-password-1234",
    });
    expect(prov.status).toBe(201);
    licenseKey = prov.json.license_key;
    const adminLogin = await post("/auth/login", { email: prov.json.admin.email, password: "admin-password-1234" });
    adminAccess = adminLogin.json.access_token;

    // A member with an active seat.
    const email = `alice-${crypto.randomUUID()}@assured.test`;
    await post("/org/users", { email, password: "member-password-123" }, adminAccess);
    const login = await post("/auth/login", { email, password: "member-password-123" });
    aliceAccess = login.json.access_token;
    const act = await post("/org/activate", { license_key: licenseKey, machine_id: `m-${crypto.randomUUID()}` }, aliceAccess);
    expect(act.status).toBe(200);
    aliceSeat = act.json.seat_token;
  });

  test("inference with NO managed key configured is rejected (409)", async () => {
    // Runs before any key is set for THIS provider — but we set keys in a later
    // test, and beforeAll order is fixed, so use a provider with no key here.
    const r = await infer({ access: aliceAccess, seat: aliceSeat, provider: "openai", model: "gpt-4o", promptBody: { messages: [{ role: "user", content: "hi" }] } });
    expect(r.status).toBe(409);
  });

  test("admin sets an org managed key (encrypted at rest; only last4 returned)", async () => {
    const set = await post("/assured/keys/set", { provider: "anthropic", api_key: "sk-ant-SECRETKEY-abcd1234" }, adminAccess);
    expect(set.status).toBe(200);
    expect(set.json.key_last4).toBe("1234");
    // The plaintext key must NOT be in the response anywhere.
    expect(JSON.stringify(set.json)).not.toContain("SECRETKEY");

    // The stored row holds ciphertext (not the plaintext) + last4 only.
    const orgId = await whoamiOrg(adminAccess);
    const row = store.getOrgProviderKey(orgId, "anthropic");
    expect(row).toBeTruthy();
    expect(row!.key_ciphertext).not.toContain("SECRETKEY");
    expect(decryptSecret(row!.key_ciphertext)).toBe("sk-ant-SECRETKEY-abcd1234"); // round-trips for the proxy only

    // keys/list returns metadata only (no secret, no ciphertext).
    const list = await post("/assured/keys/list", {}, adminAccess);
    expect(list.json.keys.find((k: any) => k.provider === "anthropic")?.key_last4).toBe("1234");
    expect(JSON.stringify(list.json)).not.toContain("SECRETKEY");
  });

  test("a valid firm seat can infer and gets the streamed response back verbatim", async () => {
    fakeMode = "ok";
    usageIn = 4242;
    usageOut = 99;
    const prompt = "summarize this MSA";
    const r = await infer({ access: aliceAccess, seat: aliceSeat, promptBody: { messages: [{ role: "user", content: prompt }] } });
    expect(r.status).toBe(200);
    // The customer-verifiable runtime signal is present.
    expect(r.headers.get("x-keepance-no-retention")).toBe("true");
    expect(r.headers.get("x-keepance-request-id")).toBeTruthy();
    // The provider's SSE streamed back verbatim, echoing our prompt in the delta.
    expect(r.text).toContain("content_block_delta");
    expect(r.text).toContain(prompt); // the provider echoed it; proxy passed it through

    // The proxy actually forwarded our request body to the provider with the key.
    const last = captured[captured.length - 1]!;
    expect(last.apiKeyHeader).toBe("sk-ant-SECRETKEY-abcd1234"); // managed key attached
    expect(JSON.parse(last.bodyText).messages[0].content).toBe(prompt); // body forwarded

    // The metadata-only billing row is written with the PROVIDER's token counts.
    // (Give the fire-and-forget usage scan a tick to land.)
    await Bun.sleep(50);
    const rows = store.listInferenceBilling(await whoamiOrg(adminAccess), 50);
    const mine = rows.find((x) => x.request_id === r.headers.get("x-keepance-request-id"));
    expect(mine).toBeTruthy();
    expect(mine!.input_tokens).toBe(4242);
    expect(mine!.output_tokens).toBe(99);
    expect(mine!.provider).toBe("anthropic");
    expect(mine!.status).toBe(200);
    // The billing row has ONLY metadata keys — no body/prompt/completion field.
    expect(Object.keys(mine!).sort()).toEqual(
      ["input_tokens", "latency_ms", "model", "org_id", "output_tokens", "provider", "request_id", "seat_id", "status", "ts"].sort(),
    );
  });

  test("an invalid / missing seat token is rejected (401)", async () => {
    // Missing seat header.
    const noSeat = await fetch(`${BASE()}/assured/infer`, {
      method: "POST",
      headers: { authorization: `Bearer ${aliceAccess}`, "x-provider": "anthropic", "x-model": "claude-x", "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(noSeat.status).toBe(401);

    // Bogus seat token.
    const badSeat = await infer({ access: aliceAccess, seat: "not-a-real-seat", promptBody: { messages: [] } });
    expect(badSeat.status).toBe(401);

    // Missing access JWT entirely.
    const noAuth = await fetch(`${BASE()}/assured/infer`, {
      method: "POST",
      headers: { "x-seat-token": aliceSeat, "x-provider": "anthropic", "x-model": "claude-x", "content-type": "application/json" },
      body: JSON.stringify({ messages: [] }),
    });
    expect(noAuth.status).toBe(401);
  });

  test("a seat from a DIFFERENT user can't be used with this access token (seat/user binding)", async () => {
    // Make a second member + seat.
    const email = `bob-${crypto.randomUUID()}@assured.test`;
    await post("/org/users", { email, password: "member-password-123" }, adminAccess);
    const login = await post("/auth/login", { email, password: "member-password-123" });
    const bobAccess = login.json.access_token;
    const act = await post("/org/activate", { license_key: licenseKey, machine_id: `m-${crypto.randomUUID()}` }, bobAccess);
    const bobSeat = act.json.seat_token;
    // Alice's access JWT + Bob's seat token => rejected (verifyActiveSeat binds them).
    const r = await infer({ access: aliceAccess, seat: bobSeat, promptBody: { messages: [] } });
    expect(r.status).toBe(401);
  });

  test("an unknown provider / missing model is rejected (400)", async () => {
    const badProv = await fetch(`${BASE()}/assured/infer`, {
      method: "POST",
      headers: { authorization: `Bearer ${aliceAccess}`, "x-seat-token": aliceSeat, "x-provider": "acme-llm", "x-model": "x", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(badProv.status).toBe(400);
    const noModel = await fetch(`${BASE()}/assured/infer`, {
      method: "POST",
      headers: { authorization: `Bearer ${aliceAccess}`, "x-seat-token": aliceSeat, "x-provider": "anthropic", "content-type": "application/json" },
      body: JSON.stringify({}),
    });
    expect(noModel.status).toBe(400);
  });

  test("a provider error is surfaced (and recorded as metadata only)", async () => {
    fakeMode = "500";
    const r = await infer({ access: aliceAccess, seat: aliceSeat, promptBody: { messages: [{ role: "user", content: "x" }] } });
    // The upstream 500 is streamed back with its status.
    expect(r.status).toBe(500);
    await Bun.sleep(50);
    const rows = store.listInferenceBilling(await whoamiOrg(adminAccess), 50);
    expect(rows.find((x) => x.request_id === r.headers.get("x-keepance-request-id"))?.status).toBe(500);
    fakeMode = "ok";
  });

  test(
    "a hung upstream is severed by the timeout (504) and recorded as metadata",
    async () => {
      fakeMode = "hang";
      const r = await infer({ access: aliceAccess, seat: aliceSeat, promptBody: { messages: [{ role: "user", content: "x" }] } });
      // The proxy's upstream timeout (800ms in this test) aborts the fetch and
      // returns 504 — the proxy must NOT hang waiting on a dead provider.
      expect(r.status).toBe(504);
      await Bun.sleep(30);
      const rows = store.listInferenceBilling(await whoamiOrg(adminAccess), 50);
      expect(rows.find((x) => x.request_id === r.headers.get("x-keepance-request-id"))?.status).toBe(504);
      fakeMode = "ok";
    },
    4000, // fail fast if the timeout machinery is broken (well under the 5s default)
  );
});

// ===========================================================================
// THE ZERO-RETENTION GUARD — the moat claim, made falsifiable.
// ===========================================================================
describe("assured proxy — ZERO-RETENTION GUARD (sentinel)", () => {
  // Capture ALL server-side log output for the duration of the request.
  const origLog = console.log;
  const origErr = console.error;
  const origWarn = console.warn;
  const origInfo = console.info;
  const origDebug = console.debug;

  test("a unique sentinel prompt (echoed in the completion) is in NEITHER the DB NOR any log", async () => {
    // Fresh isolated backend so the scan is unambiguous.
    const s = new Store(":memory:");
    const h = new FanoutHub();
    const server = Bun.serve<SyncSocketData>(buildServeOptions(s, h));
    const base = `http://${server.hostname}:${server.port}`;

    const P = async (path: string, body: unknown, bearer?: string) => {
      const res = await fetch(`${base}${path}`, { method: "POST", headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : path === "/admin/org" ? { authorization: `Bearer ${process.env.ADMIN_PROVISION_SECRET}` } : {}) }, body: JSON.stringify(body) });
      return (await res.json().catch(() => ({}))) as Record<string, any>;
    };

    try {
      const prov = await P("/admin/org", { name: `Guard ${crypto.randomUUID()}`, plan: "practice", packs: ["legal"], seat_limit: 5, admin_email: `a-${crypto.randomUUID()}@g.test`, admin_password: "admin-password-1234" });
      const adminAccess = (await P("/auth/login", { email: prov.admin.email, password: "admin-password-1234" })).access_token;
      const email = `u-${crypto.randomUUID()}@g.test`;
      await P("/org/users", { email, password: "member-password-123" }, adminAccess);
      const access = (await P("/auth/login", { email, password: "member-password-123" })).access_token;
      const act = await P("/org/activate", { license_key: prov.license_key, machine_id: `m-${crypto.randomUUID()}` }, access);
      const seat = act.seat_token;
      await P("/assured/keys/set", { provider: "anthropic", api_key: "sk-ant-guardkey-zzzz9999" }, adminAccess);

      // The falsifiable bit: a high-entropy sentinel that appears NOWHERE else.
      const SENTINEL = `ZRSENTINEL_${crypto.randomUUID().replace(/-/g, "")}_PRIVILEGED_TEXT`;

      // Start capturing logs ONLY around the inference round-trip.
      const logs: string[] = [];
      const cap = (...args: unknown[]) => {
        logs.push(args.map((a) => (typeof a === "string" ? a : (() => { try { return JSON.stringify(a); } catch { return String(a); } })())).join(" "));
      };
      console.log = cap as typeof console.log;
      console.error = cap as typeof console.error;
      console.warn = cap as typeof console.warn;
      console.info = cap as typeof console.info;
      console.debug = cap as typeof console.debug;

      let requestId = "";
      let responseText = "";
      try {
        fakeMode = "ok";
        const res = await fetch(`${base}/assured/infer`, {
          method: "POST",
          headers: { authorization: `Bearer ${access}`, "x-seat-token": seat, "x-provider": "anthropic", "x-model": "claude-sonnet-4-20250514", "content-type": "application/json" },
          // The sentinel rides as the prompt. The fake echoes it back in the
          // completion, so we also prove the COMPLETION isn't retained.
          body: JSON.stringify({ messages: [{ role: "user", content: SENTINEL }] }),
        });
        requestId = res.headers.get("x-keepance-request-id") ?? "";
        responseText = await res.text();
      } finally {
        // Give the fire-and-forget usage scan + billing write time to complete
        // BEFORE we stop capturing — so if the scan ever logged the body, we'd see it.
        await Bun.sleep(80);
        console.log = origLog;
        console.error = origErr;
        console.warn = origWarn;
        console.info = origInfo;
        console.debug = origDebug;
      }

      // Sanity: the proxy DID forward + stream the sentinel (end-to-end works),
      // so a "clean" DB/log isn't because nothing happened.
      const last = captured[captured.length - 1]!;
      expect(last.bodyText).toContain(SENTINEL); // provider received the prompt
      expect(responseText).toContain(SENTINEL); // client got the completion echo
      expect(requestId).toBeTruthy();

      // (1) The DB contains the sentinel in NO table/column (incl. BLOBs + hex).
      const dump = dumpEntireDb(s);
      expect(dump).not.toContain(SENTINEL);

      // (2) No captured server log line contains the sentinel.
      const allLogs = logs.join("\n");
      expect(allLogs).not.toContain(SENTINEL);

      // (3) The billing row for THIS request exists and is metadata-only.
      const rows = s.listInferenceBilling(prov.org.org_id, 50);
      const mine = rows.find((x) => x.request_id === requestId);
      expect(mine).toBeTruthy();
      expect(mine!.input_tokens).toBeGreaterThan(0);
      // No value on the row is the sentinel or contains it.
      for (const v of Object.values(mine!)) expect(String(v)).not.toContain(SENTINEL);
    } finally {
      // Always restore console even if an assertion threw mid-capture.
      console.log = origLog;
      console.error = origErr;
      console.warn = origWarn;
      console.info = origInfo;
      console.debug = origDebug;
      server.stop(true);
    }
  });

  // STATIC guard: the data-path source has no body-write / body-log call. This
  // is the "readable, falsifiable" assertion a firm's IT can run themselves.
  test("STATIC: the proxy data-path source has no body-write or body-log call", () => {
    const root = join(import.meta.dir, "..", "src");
    const assuredSvc = readFileSync(join(root, "lib", "assured.ts"), "utf8");
    const assuredRoute = readFileSync(join(root, "routes", "assured.ts"), "utf8");

    // The route must NEVER DECODE the inference body to text/JSON — that's the
    // only way prompt content could become a string a logger/serializer touches.
    // (Reading raw bytes via arrayBuffer straight into an OpaqueBody is fine;
    // those bytes are never decoded and the OpaqueBody type blocks logging.)
    expect(assuredRoute).not.toContain("req.text()");
    expect(assuredRoute).not.toContain("req.json()");
    // The prompt must be carried ONLY by the OpaqueBody and leave ONLY via take().
    expect(assuredRoute).toContain("new OpaqueBody(promptBytes)");
    expect(assuredRoute).toContain("promptBody.take()");

    // The ONLY persistence call on the path is the metadata-only recordInference;
    // there is no store.save/store.put-of-body anti-pattern.
    expect(assuredRoute).toContain("store.recordInference(");
    // No log call anywhere on the data path interpolates a body/prompt/completion
    // variable. (By construction there is no promptText/completionText variable.)
    expect(assuredSvc).not.toMatch(/console\.[a-z]+\([^)]*\b(prompt|completion|body)\b/);
    expect(assuredRoute).not.toMatch(/console\.[a-z]+\([^)]*\b(promptBytes|promptBody|outBody)\b/);
  });
});

// ===========================================================================
// Unit tests for the structural primitives (fast, no HTTP).
// ===========================================================================
describe("assured proxy — structural primitives", () => {
  test("OpaqueBody never reveals its content via toString / toJSON / inspect", () => {
    const body = new OpaqueBody(new TextEncoder().encode("SECRET-PROMPT"));
    expect(String(body)).toBe("[OpaqueBody <redacted: zero-retention>]");
    expect(JSON.stringify({ b: body })).not.toContain("SECRET-PROMPT");
    expect(JSON.stringify({ b: body })).toContain("redacted");
    // Spread / keys leak nothing (the bytes are a true #private field).
    expect(Object.keys(body)).toEqual([]);
    expect(JSON.stringify({ ...body })).toBe("{}");
    // util.inspect (what console.log uses) also redacts.
    expect(Bun.inspect(body)).toContain("redacted");
    expect(Bun.inspect(body)).not.toContain("SECRET-PROMPT");
  });

  test("OpaqueBody.take() is one-shot (can't be read twice)", () => {
    const body = new OpaqueBody(new TextEncoder().encode("x"));
    expect(body.present).toBe(true);
    body.take();
    expect(() => body.take()).toThrow();
  });

  test("encryptSecret/decryptSecret round-trips and ciphertext hides the plaintext", () => {
    const secret = "sk-super-secret-API-key-0001";
    const blob = encryptSecret(secret);
    expect(blob).not.toContain(secret);
    expect(blob.startsWith("v1:")).toBe(true);
    expect(decryptSecret(blob)).toBe(secret);
    // A tampered blob fails closed (returns null), never throws.
    expect(decryptSecret(blob.slice(0, -2) + "xy")).toBeNull();
    expect(decryptSecret("garbage")).toBeNull();
  });

  test("scanUsage extracts integer token counts and retains no text (Anthropic SSE)", async () => {
    const enc = new TextEncoder();
    const sse = [
      `data: ${JSON.stringify({ type: "message_start", message: { usage: { input_tokens: 11, output_tokens: 0 } } })}\n\n`,
      `data: ${JSON.stringify({ type: "content_block_delta", delta: { type: "text_delta", text: "SECRET BODY TEXT" } })}\n\n`,
      `data: ${JSON.stringify({ type: "message_delta", usage: { output_tokens: 22 } })}\n\n`,
    ].join("");
    const stream = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(sse)); c.close(); } });
    const usage = await scanUsage(stream, "anthropic");
    expect(usage).toEqual({ input_tokens: 11, output_tokens: 22 });
  });

  test("scanUsage handles OpenAI + Google shapes (streaming + whole-JSON)", async () => {
    const enc = new TextEncoder();
    // OpenAI streaming final-usage chunk.
    const oai = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(`data: ${JSON.stringify({ choices: [{ delta: { content: "hi" } }], usage: { prompt_tokens: 5, completion_tokens: 7 } })}\n\n`)); c.close(); } });
    expect(await scanUsage(oai, "openai")).toEqual({ input_tokens: 5, output_tokens: 7 });
    // Google non-streamed whole-JSON response.
    const g = new ReadableStream<Uint8Array>({ start(c) { c.enqueue(enc.encode(JSON.stringify({ candidates: [], usageMetadata: { promptTokenCount: 8, candidatesTokenCount: 9 } }))); c.close(); } });
    expect(await scanUsage(g, "google")).toEqual({ input_tokens: 8, output_tokens: 9 });
  });

  test("ASSURED_PROVIDERS is exactly the three supported providers", () => {
    expect([...ASSURED_PROVIDERS].sort()).toEqual(["anthropic", "google", "openai"]);
  });
});

// Small helper: resolve the caller's org_id via /auth/me (avoids threading it
// through every test). Defined last so it reads naturally above.
async function whoamiOrg(access: string): Promise<string> {
  const res = await fetch(`${BASE()}/auth/me`, { headers: { authorization: `Bearer ${access}` } });
  const j = (await res.json()) as { org: { org_id: string } | null };
  return j.org!.org_id;
}
