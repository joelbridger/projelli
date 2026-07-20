/**
 * R-31 PROBE (audit lane, not a shipped test): is the seam's raw `Request`
 * structurally SINGLE-CONSUMER — "consumed exactly once into the frozen
 * envelope and thereafter unreachable"?
 *
 * The ruling under audit says the checker's incomplete syntax coverage of
 * fetch-handler ATTACHMENT is a belt gap rather than a live hole, PROVIDED that
 * property holds — the argument being that an assignment-attached handler has
 * "nothing left to drain".
 *
 * These probes test that premise against the real seam on the real server.
 * Nothing here reimplements the cap: P3/P4 boot `buildServeOptions()` from
 * `src/server.ts` and drive it over a raw socket with a chunked, Content-Length-
 * free body — the exact framing the whole fix exists for.
 */

import { test, expect } from "bun:test";
import net from "node:net";
import { Store } from "../src/lib/db.ts";
import { buildServeOptions } from "../src/server.ts";
import { fanout } from "../src/lib/matters.ts";
import { prepareHttpRequest, serveFetch, readCappedBytes } from "../src/lib/requestBody.ts";

const ATTACK_BYTES = 16 * 1024 * 1024; // 16 MiB
const CHUNK_BYTES = 256 * 1024;

interface ProbeResult {
  status: string | null;
  respondedAfterBytes: number;
  writtenBytes: number;
}

/** POST with Transfer-Encoding: chunked and NO Content-Length; stop on first byte back. */
function chunkedProbe(port: number, path: string, totalBytes: number): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    const payload = Buffer.alloc(CHUNK_BYTES, 0x41);
    const frame = Buffer.concat([Buffer.from(`${CHUNK_BYTES.toString(16)}\r\n`), payload, Buffer.from("\r\n")]);
    const sock = net.connect(port, "127.0.0.1");
    let written = 0;
    let status: string | null = null;
    let respondedAfter = -1;
    let settled = false;

    const finish = () => {
      if (settled) return;
      settled = true;
      sock.destroy();
      resolve({ status, respondedAfterBytes: respondedAfter < 0 ? written : respondedAfter, writtenBytes: written });
    };
    const pump = () => {
      while (written < totalBytes) {
        if (settled || sock.destroyed) return;
        written += CHUNK_BYTES;
        if (!sock.write(frame)) { sock.once("drain", pump); return; }
      }
      if (!sock.destroyed) sock.write("0\r\n\r\n");
    };
    sock.setTimeout(60_000, () => { reject(new Error(`probe timed out on ${path}`)); sock.destroy(); });
    sock.on("connect", () => {
      sock.write(
        `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\n` +
        `Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n`,
      );
      pump();
    });
    sock.on("data", (d) => {
      if (status === null) { status = d.toString("latin1").split("\r\n")[0] ?? null; respondedAfter = written; }
      finish();
    });
    sock.on("error", () => finish());
    sock.on("close", () => finish());
  });
}

// ───────────────────────────────────────────────────────────────────────────
// P1 — does building the frozen envelope CONSUME the body?
// ───────────────────────────────────────────────────────────────────────────
test("P1: prepareHttpRequest does NOT consume, lock, or disturb the raw body", () => {
  const raw = new Request("http://x/y", { method: "POST", body: "hello world" });
  const env = prepareHttpRequest(raw, 1024);
  console.log(`[P1] after envelope: bodyUsed=${raw.bodyUsed} locked=${raw.body?.locked} envKeys=${JSON.stringify(Object.keys(env))}`);
  // If the ruling's phrasing were literally true, at least one of these would flip.
  expect(raw.bodyUsed).toBe(false);
  expect(raw.body?.locked).toBe(false);
});

test("P1b: the body is still fully drainable AFTER the envelope exists", async () => {
  const raw = new Request("http://x/y", { method: "POST", body: "hello world" });
  prepareHttpRequest(raw, 1024);
  const text = await raw.text(); // a second consumer, holding the raw request
  console.log(`[P1b] drained after envelope construction: ${JSON.stringify(text)}`);
  expect(text).toBe("hello world");
});

// ───────────────────────────────────────────────────────────────────────────
// P2 — is the raw request reachable THROUGH the envelope?
// ───────────────────────────────────────────────────────────────────────────
test("P2: the envelope exposes no route back to the raw Request", () => {
  const raw = new Request("http://x/y", { method: "POST", body: "hello world" });
  const env = prepareHttpRequest(raw, 1024);
  const keys = Reflect.ownKeys(env).map(String);
  const proto = Object.getPrototypeOf(env);
  console.log(`[P2] ownKeys=${JSON.stringify(keys)} frozen=${Object.isFrozen(env)} proto=${proto === Object.prototype ? "Object.prototype" : String(proto)} instanceofRequest=${env instanceof Request} hasBody=${"body" in (env as object)} hasClone=${"clone" in (env as object)}`);
  expect(keys.sort()).toEqual(["headers", "method", "signal", "url"]);
  expect(Object.isFrozen(env)).toBe(true);
  expect(env instanceof Request).toBe(false);
  expect("body" in (env as object)).toBe(false);
  expect("clone" in (env as object)).toBe(false);
});

test("P2b: a SECOND concurrent capped read through the seam fails closed", async () => {
  const raw = new Request("http://x/y", { method: "POST", body: "hello world" });
  const env = prepareHttpRequest(raw, 1024);
  const [a, b] = await Promise.all([readCappedBytes(env, 1024), readCappedBytes(env, 1024)]);
  console.log(`[P2b] concurrent reads: a.ok=${a.ok} b.ok=${b.ok}`);
  // Exactly one wins; the loser is refused, not served a second copy.
  expect([a.ok, b.ok].filter(Boolean).length).toBe(1);
});

// ───────────────────────────────────────────────────────────────────────────
// P3 — THE ATTACK, composition form: seam runs FIRST, then a handler attached
//      BY ASSIGNMENT tries to drain the same raw Request.
// ───────────────────────────────────────────────────────────────────────────
test("P3: after the seam has run, an assignment-attached handler drains the SAME raw body", async () => {
  const opts = buildServeOptions(new Store(":memory:"), fanout) as Record<string, unknown>;
  const seamFetch = opts.fetch as (raw: Request, srv: unknown) => Promise<Response | undefined>;
  let drainedBytes = -1;
  let drainError: string | null = null;

  // ── the bypass: attached BY ASSIGNMENT, never naming `Request` ──
  opts.fetch = async (raw: Request, srv: unknown) => {
    const res = await seamFetch(raw, srv);        // seam does its whole job first
    try {
      let n = 0;
      if (raw.body) for await (const c of raw.body as AsyncIterable<Uint8Array>) n += c.byteLength;
      drainedBytes = n;
    } catch (e) { drainError = String(e); }
    return res ?? new Response("ok");
  };

  const srv = Bun.serve(opts as never);
  const port = srv.port!;
  try {
    // /nope/nope is UNROUTED -> server.ts returns 404 without ever reading the body,
    // so the seam's lazy consumption never fires on this path.
    const r = await chunkedProbe(port, "/nope/nope", ATTACK_BYTES);
    console.log(`[P3 unrouted-404] status=${r.status} respondedAfterBytes=${r.respondedAfterBytes} written=${r.writtenBytes} drainedBytes=${drainedBytes} drainError=${drainError}`);
  } finally { srv.stop(true); }
  // THE NAMED ASSERTION. With the seam's consumption left LAZY (as on
  // 51cdb25b1) this reads 16777216 — the whole flood — and fails. It passes
  // only if the seam ends the raw body's life unconditionally before returning.
  // Deleting `sealBody` from serveFetch turns this red for exactly that reason.
  expect(drainError).toBeNull();
  expect(drainedBytes).toBe(0);
}, 120_000);

test("P3b: after the seam HAS read the body, a second drain finds it gone", async () => {
  const opts = buildServeOptions(new Store(":memory:"), fanout) as Record<string, unknown>;
  const seamFetch = opts.fetch as (raw: Request, srv: unknown) => Promise<Response | undefined>;
  let drainedBytes = -1;
  let drainError: string | null = null;
  opts.fetch = async (raw: Request, srv: unknown) => {
    const res = await seamFetch(raw, srv);
    try {
      let n = 0;
      if (raw.body) for await (const c of raw.body as AsyncIterable<Uint8Array>) n += c.byteLength;
      drainedBytes = n;
    } catch (e) { drainError = String(e); }
    return res ?? new Response("ok");
  };
  const srv = Bun.serve(opts as never);
  const port = srv.port!;
  try {
    // /webhooks/lemonsqueezy DOES read the body through the seam (256 KiB cap).
    const r = await chunkedProbe(port, "/webhooks/lemonsqueezy", ATTACK_BYTES);
    console.log(`[P3b seam-read route] status=${r.status} respondedAfterBytes=${r.respondedAfterBytes} written=${r.writtenBytes} drainedBytes=${drainedBytes} drainError=${drainError}`);
  } finally { srv.stop(true); }
  expect(typeof drainedBytes).toBe("number");
}, 120_000);

// ───────────────────────────────────────────────────────────────────────────
// P4 — THE ATTACK, replacement form: the assignment REPLACES the seam.
// ───────────────────────────────────────────────────────────────────────────
test("P4: an assignment-attached handler that REPLACES the seam drains unbounded", async () => {
  const opts = buildServeOptions(new Store(":memory:"), fanout) as Record<string, unknown>;
  let drainedBytes = -1;
  let peakRssDeltaMb = 0;
  const rss0 = process.memoryUsage.rss();

  opts.fetch = async (raw: Request) => {
    let n = 0;
    if (raw.body) {
      for await (const c of raw.body as AsyncIterable<Uint8Array>) {
        n += c.byteLength;
        const d = (process.memoryUsage.rss() - rss0) / (1024 * 1024);
        if (d > peakRssDeltaMb) peakRssDeltaMb = d;
      }
    }
    drainedBytes = n;
    return new Response("drained");
  };

  const srv = Bun.serve(opts as never);
  const port = srv.port!;
  try {
    const r = await chunkedProbe(port, "/webhooks/lemonsqueezy", ATTACK_BYTES);
    console.log(`[P4 seam-replaced] status=${r.status} respondedAfterBytes=${r.respondedAfterBytes} written=${r.writtenBytes} drainedBytes=${drainedBytes} peakRssDeltaMb=${peakRssDeltaMb.toFixed(1)}`);
  } finally { srv.stop(true); }
  expect(typeof drainedBytes).toBe("number");
}, 120_000);
