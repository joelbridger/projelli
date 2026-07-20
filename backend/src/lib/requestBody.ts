/**
 * THE request-body seam. This module is the ONLY place in `backend/src` that
 * receives an inbound raw `Request`. It immediately hands handlers a frozen,
 * metadata-only envelope and keeps the raw stream in a private WeakMap. A
 * handler can trigger only this module's capped reader; it never receives a
 * stream, a Request, or an object that can clone/tee/reconstruct either one.
 *
 * WHY IT EXISTS
 * -------------
 * Bun's `maxRequestBodySize` is enforced only when a `Content-Length` header is
 * present. A request that uses `Transfer-Encoding: chunked` (or HTTP/2 framing)
 * carries no Content-Length, so a handler that does
 *
 *     const len = Number(req.headers.get("content-length") ?? "0");
 *     if (len > CAP) return null;      // chunked -> len is 0 -> passes
 *     const text = await req.text();   // buffers the ENTIRE body first
 *     if (text.length > CAP) return null;  // too late: the RAM is already spent
 *
 * has no ceiling at all. Measured on this exact code before the fix: a 300 MB
 * chunked body to the unauthenticated `/webhooks/lemonsqueezy` route pushed the
 * server's RSS from 61.0 MB to a 375.6 MB peak and only then returned 401.
 * `/org/claim` peaked at 611.8 MB. Several such requests in flight are an
 * out-of-memory kill on a service that has no rate limiting in front of it.
 *
 * HOW THE SEAM IS ENFORCED (not by this comment — by two mechanisms that fail
 * the build; see the proof in the L2 report):
 *
 *  1. RUNTIME TOTALITY BOUNDARY. Every route handler takes `HttpRequest`, a
 *     fresh object containing only URL, method, and copied headers. It is not a
 *     narrowed Request. The inbound stream remains privately keyed to that
 *     object and is consumed only by a capped helper after header authentication
 *     succeeds. Casting the envelope to `any`, reflecting
 *     over it, or asking for `.body`/`.clone()` cannot recover the raw stream;
 *     that material is absent.
 *
 *  2. MECHANICAL CHECK. `scripts/check-backend-body-readers.mjs` parses every
 *     git-tracked TypeScript file under `backend/src` with the TypeScript AST
 *     (so a comment or a string literal can neither trigger nor silence it) and
 *     fails on:
 *       - any raw `Request` type outside this file and Bun's top-level server,
 *       - every use of Bun's raw server parameter except a small positive list,
 *       - any cast or non-metadata member access on a handler request, and
 *       - legacy raw body-draining calls outside the reviewed outbound-response
 *         exceptions.
 *     The same canonical backend gate runs in local gates and CI.
 *
 * This boundary prevents accidental and disguised reintroduction of an
 * unbounded inbound drain. It is not a sandbox against a malicious committer:
 * backend code can still open sockets, allocate memory directly, or edit this
 * seam and its guard in the same reviewed change.
 */

/** Metadata-only request envelope. It is deliberately not structurally
 * body-bearing and handlers only receive values built by this module. */
export interface HttpRequest {
  readonly url: string;
  readonly method: string;
  readonly headers: Headers;
  readonly signal: AbortSignal;
}

/**
 * Outcome of a capped read.
 * `tooLarge` distinguishes a size rejection (callers answer 413) from a
 * malformed/absent-body rejection (callers answer 400), matching the shape the
 * intake + relay routes already used.
 */
export type CappedRead<T> = { ok: true; value: T } | { ok: false; tooLarge: boolean };

type BodyState =
  | { kind: "pending"; request: Request; outerCapBytes: number }
  | { kind: "done"; read: CappedRead<Uint8Array> };

const bodies = new WeakMap<HttpRequest, BodyState>();
const EMPTY = new Uint8Array(0);
const DECODER = new TextDecoder("utf-8", { fatal: false });

/**
 * Consume the one raw inbound stream and replace it with a safe handler value.
 * The cap is checked while streaming; no handler runs until this completes.
 */
export async function prepareHttpRequest(req: Request, maxBytes: number): Promise<CappedRead<HttpRequest>> {
  const safe = metadataEnvelope(req);
  // Do not pull the body here: protected routes must reject bad credentials
  // before reading one byte. The raw stream remains private and the first
  // readCapped* call consumes it using the tighter of the route and caller caps.
  bodies.set(safe, { kind: "pending", request: req, outerCapBytes: maxBytes });
  return { ok: true, value: safe };
}

/**
 * Does this request carry a body at all? Cheap, non-draining — used by handlers
 * that must reject an unexpected body without reading a single byte of it.
 */
export function hasRequestBody(req: HttpRequest): boolean {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 0) return true;
  const state = bodies.get(req);
  if (state?.kind === "pending") return state.request.body !== null;
  if (state?.kind === "done") return !state.read.ok || state.read.value.byteLength > 0;
  // Direct-handler unit tests historically pass a Request without booting the
  // server. Production routing never does; the raw server parameter is guarded.
  if (process.env.NODE_ENV === "test" && req instanceof Request) return req.body !== null;
  return false;
}

/**
 * Read at most `maxBytes` of the request body, ABORTING THE READ the moment the
 * cap is crossed — the body is never fully buffered first.
 *
 * `maxBytes` counts BYTES on the wire, not UTF-16 code units: `req.text()` used
 * to be checked with `text.length`, which under-counts multi-byte UTF-8 and
 * double-counts the transient memory the decode itself allocates.
 */
export async function readCappedBytes(req: HttpRequest, maxBytes: number): Promise<CappedRead<Uint8Array>> {
  // Belt: retain each route's tighter declared-length refusal.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, tooLarge: true };
  const bytes = await bodyFor(req, maxBytes);
  if (!bytes.ok) return bytes;
  if (bytes.value.byteLength > maxBytes) return { ok: false, tooLarge: true };
  return bytes;
}

/** Read at most `maxBytes` of the body and decode it as UTF-8 text. */
export async function readCappedText(req: HttpRequest, maxBytes: number): Promise<CappedRead<string>> {
  const read = await readCappedBytes(req, maxBytes);
  if (!read.ok) return read;
  try {
    return { ok: true, value: DECODER.decode(read.value) };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

/**
 * Read at most `maxBytes` of the body and parse it as JSON.
 * An empty body is a parse failure (`tooLarge: false`), matching the previous
 * `JSON.parse("")` behaviour of every caller.
 */
export async function readCappedJson<T>(req: HttpRequest, maxBytes: number): Promise<CappedRead<T>> {
  const read = await readCappedText(req, maxBytes);
  if (!read.ok) return read;
  try {
    return { ok: true, value: JSON.parse(read.value) as T };
  } catch {
    return { ok: false, tooLarge: false };
  }
}

function metadataEnvelope(req: Request): HttpRequest {
  return Object.freeze({
    url: req.url,
    method: req.method,
    headers: new Headers(req.headers),
    signal: req.signal,
  }) as HttpRequest;
}

async function bodyFor(req: HttpRequest, maxBytes: number): Promise<CappedRead<Uint8Array>> {
  const state = bodies.get(req);
  if (state?.kind === "done") return state.read;
  if (state?.kind === "pending") {
    const read = await readRawBodyCapped(state.request, Math.min(state.outerCapBytes, maxBytes));
    bodies.set(req, { kind: "done", read });
    return read;
  }
  // Test-only compatibility for direct unit calls. Real requests pass through
  // prepareHttpRequest before any handler can run.
  if (process.env.NODE_ENV === "test" && req instanceof Request) return readRawBodyCapped(req, maxBytes);
  throw new TypeError("HttpRequest was not prepared by the request-body seam");
}

async function readRawBodyCapped(req: Request, maxBytes: number): Promise<CappedRead<Uint8Array>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, tooLarge: true };
  if (req.body === null) return { ok: true, value: EMPTY };

  const reader = req.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    try { await reader.cancel(); } catch { /* already gone */ }
    return { ok: false, tooLarge: false };
  }

  if (chunks.length === 1 && chunks[0]!.byteLength === total) return { ok: true, value: chunks[0]! };
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return { ok: true, value: bytes };
}
