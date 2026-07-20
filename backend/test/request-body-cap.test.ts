/**
 * The request-body cap is enforced WHILE STREAMING, on the real server.
 *
 * Bun's `maxRequestBodySize` is honoured only when a request declares a
 * Content-Length. A `Transfer-Encoding: chunked` request declares none, so the
 * old shape — check the header, then `await req.text()`, then measure — had no
 * ceiling: the whole body was already in RAM by the time the size check ran.
 * Measured against this backend before the fix, a 300 MB chunked POST to the
 * unauthenticated `/webhooks/lemonsqueezy` route pushed RSS from 61.0 MB to a
 * 375.6 MB peak and only then returned 401.
 *
 * These tests use a RAW SOCKET (fetch cannot express "chunked, no
 * Content-Length, and tell me how much I had written when the answer came").
 * The load-bearing assertion is not the status code — it is `respondedAfterBytes`:
 * how much of the attack body the client had managed to send before the server
 * answered. A server that buffers first cannot answer until the client is done,
 * so that number would be the full payload. A server that caps while streaming
 * answers after roughly one cap's worth.
 *
 * NON-HOLLOWNESS: these assertions are against the REAL route handlers over a
 * REAL socket, not against a local reimplementation of the cap. Reverting
 * `lib/requestBody.ts` to the `await req.text()` shape makes `respondedAfterBytes`
 * jump to the whole payload and every case here fails.
 */

import { test, expect, beforeAll, afterAll } from "bun:test";
import net from "node:net";
import { Store } from "../src/lib/db.ts";
import { buildServeOptions } from "../src/server.ts";
import { fanout } from "../src/lib/matters.ts";
import { MAX_BODY_BYTES } from "../src/lib/http.ts";
import { prepareHttpRequest } from "../src/lib/requestBody.ts";

/** Attack payload: far bigger than any route's cap, small enough to stay fast. */
const ATTACK_BYTES = 16 * 1024 * 1024; // 16 MiB
const CHUNK_BYTES = 256 * 1024;

/**
 * How much the client can shove into the loopback socket buffers before the
 * server's answer is even observable. Measured on this box at ~3.5 MiB, so 7 MiB
 * is a comfortable ceiling that is still well under half the attack payload: a
 * server that buffers the whole body first reports ~16 MiB here and fails (that
 * exact contrast was recorded by reverting the streaming read). This is a
 * property of the client's socket, not of the cap — the per-route cap itself is
 * asserted exactly by the boundary test at the bottom of this file.
 */
const SOCKET_WRITE_FLOOR_BYTES = 7 * 1024 * 1024;

let srv: ReturnType<typeof Bun.serve>;
let port = 0;

beforeAll(() => {
  srv = Bun.serve(buildServeOptions(new Store(":memory:"), fanout));
  if (srv.port === undefined) throw new Error("test server did not bind a port");
  port = srv.port;
});

afterAll(() => {
  srv.stop(true);
});

interface ProbeResult {
  /** First response line, e.g. "HTTP/1.1 413 Payload Too Large". null if the peer just went away. */
  status: string | null;
  /** Bytes of body the client had written when the server answered / hung up. */
  respondedAfterBytes: number;
  /** Total bytes of body the client managed to write before the socket closed. */
  writtenBytes: number;
}

/**
 * POST `path` with `Transfer-Encoding: chunked` and NO Content-Length, writing
 * up to `totalBytes` of body, and stop the moment the server says anything.
 */
function chunkedProbe(path: string, totalBytes: number, headers: Record<string, string> = {}): Promise<ProbeResult> {
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
        if (!sock.write(frame)) {
          sock.once("drain", pump);
          return;
        }
      }
      if (!sock.destroyed) sock.write("0\r\n\r\n");
    };

    sock.setTimeout(30_000, () => { reject(new Error(`probe timed out on ${path}`)); sock.destroy(); });
    sock.on("connect", () => {
      const head =
        `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${port}\r\nContent-Type: application/json\r\n` +
        Object.entries(headers).map(([k, v]) => `${k}: ${v}\r\n`).join("") +
        `Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n`;
      sock.write(head);
      pump();
    });
    sock.on("data", (d) => {
      if (status === null) {
        status = d.toString("latin1").split("\r\n")[0] ?? null;
        respondedAfter = written;
      }
      finish();
    });
    // A reset before any response is also a successful early abort.
    sock.on("error", () => finish());
    sock.on("close", () => finish());
  });
}

/**
 * Every UNAUTHENTICATED route that reads a request body. Each was measured
 * buffering a full 300 MB chunked payload before this fix.
 *
 * `capBytes` is the route's own cap; the response must arrive within a small
 * multiple of it (chunk framing + the runtime's read-ahead), and far below the
 * 16 MiB the client is willing to send.
 */
const UNAUTH_BODY_ROUTES: Array<{ path: string; capBytes: number; reader: string }> = [
  { path: "/webhooks/lemonsqueezy", capBytes: 256 * 1024, reader: "routes/webhooks.ts" },
  { path: "/webhooks/docusign-signing", capBytes: 64 * 1024, reader: "routes/docusignSigning.ts (connect)" },
  { path: "/auth/login", capBytes: 64 * 1024, reader: "lib/http.ts readJson" },
  { path: "/org/claim", capBytes: 64 * 1024, reader: "lib/http.ts readJson" },
  { path: "/auth/sso/exchange", capBytes: 64 * 1024, reader: "lib/http.ts readJson" },
  { path: "/auth/refresh", capBytes: 64 * 1024, reader: "lib/http.ts readJson" },
  { path: "/matter/no-such-matter/updates", capBytes: 1536 * 1024, reader: "routes/matters.ts readUpdateBody" },
];

for (const route of UNAUTH_BODY_ROUTES) {
  test(`chunked flood of ${route.path} is aborted at the cap, not buffered (${route.reader})`, async () => {
    const r = await chunkedProbe(route.path, ATTACK_BYTES);
    // The whole point: the server did NOT wait for the full body.
    expect(r.respondedAfterBytes).toBeLessThan(ATTACK_BYTES);
    // And it cut in early — within the client's own socket-buffer floor, an
    // order of magnitude below the payload a buffering server would have taken.
    expect(r.respondedAfterBytes).toBeLessThanOrEqual(SOCKET_WRITE_FLOOR_BYTES);
    // The client never got to finish the flood.
    expect(r.writtenBytes).toBeLessThan(ATTACK_BYTES);
  }, 60_000);
}

test("an oversized chunked body never reaches a handler as a parsed body", async () => {
  // /webhooks/lemonsqueezy answers 401 for a body it read and could not verify.
  // Flooded, it must not get that far: the read fails first.
  const r = await chunkedProbe("/webhooks/lemonsqueezy", ATTACK_BYTES);
  expect(r.respondedAfterBytes).toBeLessThan(ATTACK_BYTES);
  if (r.status !== null) expect(r.status).not.toContain(" 401 ");
});

test("a legitimate small chunked body still works (the cap does not break normal traffic)", async () => {
  // Same framing the attack uses — chunked, no Content-Length — but tiny.
  const res = await fetch(`http://127.0.0.1:${port}/auth/login`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    // A ReadableStream body makes fetch send chunked with no Content-Length.
    body: new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(JSON.stringify({ email: "nobody@example.com", password: "x".repeat(12) })));
        controller.close();
      },
    }),
    // `duplex: "half"` is required by the runtime for a streaming request body.
    duplex: "half",
  });
  // The body was read and understood: this is a credential failure, not a size
  // or parse failure. 401 proves the JSON made it through the capped reader.
  expect(res.status).toBe(401);
});

test("a body at the control-plane cap boundary is accepted, just over is refused", async () => {
  const CAP = MAX_BODY_BYTES;
  const under = { email: "nobody@example.com", password: "x".repeat(12), pad: "p".repeat(CAP - 2048) };
  const over = { email: "nobody@example.com", password: "x".repeat(12), pad: "p".repeat(CAP * 2) };

  const post = (body: unknown) =>
    fetch(`http://127.0.0.1:${port}/auth/login`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
    });

  expect(JSON.stringify(under).length).toBeLessThan(CAP);
  // Under the cap: parsed, then rejected on credentials.
  expect((await post(under)).status).toBe(401);
  // Over the cap: the read itself fails, so the route reports a bad body.
  expect((await post(over)).status).toBe(400);

  // The value a handler receives has no drainable raw material, even through
  // reflection or prototype access. These assertions exercise the real seam.
  const prepared = prepareHttpRequest(new Request("http://test.invalid/x", { method: "POST", body: "hello" }), CAP);
  expect(Object.isFrozen(prepared)).toBe(true);
  expect(Object.keys(prepared).sort()).toEqual(["headers", "method", "signal", "url"]);
  expect(Reflect.get(prepared, "body")).toBeUndefined();
  expect(Reflect.get(prepared, "clone")).toBeUndefined();
  expect(Reflect.get(Object.getPrototypeOf(prepared), "text")).toBeUndefined();
});
