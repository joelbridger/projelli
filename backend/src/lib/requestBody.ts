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

/**
 * The two Bun server APIs that genuinely need the concrete inbound `Request`.
 *
 * Declared STRUCTURALLY and kept inside this file on purpose: it is what lets
 * `server.ts` hand the seam Bun's server handle without ever naming, holding, or
 * passing a `Request` itself. `Bun.Server<T>` satisfies this shape, so the real
 * server is accepted with no cast at the call site.
 */
export interface RawRequestServer<D> {
  requestIP(request: Request): { readonly address: string } | null;
  upgrade(request: Request, options: { data: D }): boolean;
}

/**
 * What the seam remembers about a live request. `peer` and `upgrade` are
 * CLOSURES captured at the fetch boundary, not the server object itself: they
 * are the only two operations that need the concrete `Request`, so binding them
 * here means the raw object never has to be handed back out to satisfy them.
 */
type BodyState =
  | {
      kind: "pending";
      request: Request;
      peer: () => string | undefined;
      upgrade: (data: unknown) => boolean;
      outerCapBytes: number;
    }
  | { kind: "done"; read: CappedRead<Uint8Array> };

const NO_SERVER = {
  peer: () => undefined,
  upgrade: () => false,
} as const;

const bodies = new WeakMap<HttpRequest, BodyState>();
const EMPTY = new Uint8Array(0);
const DECODER = new TextDecoder("utf-8", { fatal: false });

/**
 * Replace the one raw inbound Request with a safe handler value.
 *
 * Returns the envelope DIRECTLY, not a result union: this function cannot fail.
 * It deliberately does not pull the body — protected routes must reject bad
 * credentials before reading one byte — so there is no size or parse outcome to
 * report here. (An earlier signature returned `CappedRead<HttpRequest>`, which
 * gave `server.ts` a 413/400 branch that could never execute and misled a reader
 * about where the cap is enforced. It is enforced at the first `readCapped*`
 * call, by `bodyFor`, using the tighter of the route and caller caps.)
 */
export function prepareHttpRequest(
  req: Request,
  maxBytes: number,
  bound: { peer: () => string | undefined; upgrade: (data: unknown) => boolean } = NO_SERVER,
): HttpRequest {
  const safe = metadataEnvelope(req);
  bodies.set(safe, { kind: "pending", request: req, peer: bound.peer, upgrade: bound.upgrade, outerCapBytes: maxBytes });
  return safe;
}

/**
 * THE FETCH BOUNDARY. This is why `Request` exists in exactly one file.
 *
 * Bun's `fetch` callback is handed a real, drainable `Request`. Rather than let
 * `server.ts` receive it and promise to be careful, the seam OWNS the callback:
 * it takes the raw request, keeps it private, and calls the application's router
 * with the metadata-only envelope. `server.ts` therefore never declares, names,
 * casts to, constructs, or receives a `Request` at all — which is the property
 * `scripts/check-backend-body-readers.mjs` enforces as a totality (no `Request`
 * and no `ReadableStream` anywhere under `backend/src` outside this file and the
 * two reviewed OUTBOUND response readers).
 *
 * `capFor` is the per-route outer cap chooser. It is given the path and method
 * only, never the request, so the caller cannot smuggle the raw object out
 * through the callback.
 */
export function serveFetch<D>(
  capFor: (path: string, method: string) => number,
  route: (req: HttpRequest) => Promise<Response | undefined>,
): (raw: Request, server: RawRequestServer<D>) => Promise<Response | undefined> {
  return async (raw, server) => {
    const cap = capFor(new URL(raw.url).pathname, raw.method);
    let upgraded = false;
    const bound = {
      peer: () => server.requestIP(raw)?.address ?? undefined,
      // The socket-data type is checked where `upgradeWebSocket` is CALLED (the
      // caller annotates it), then erased through the private WeakMap, which is
      // keyed by envelope and cannot carry `D`. This is the one unchecked hop
      // and it is inside the seam by design.
      upgrade: (data: unknown) => {
        const ok = server.upgrade(raw, { data: data as D });
        if (ok) upgraded = true;
        return ok;
      },
    };
    const safe = prepareHttpRequest(raw, cap, bound);
    try {
      return await route(safe);
    } finally {
      // R-31 EXPERIMENT: make the seam's consumption UNCONDITIONAL. Without
      // this the seam only drains when a route asks it to, so on any route that
      // never reads (404, GET, an early auth refusal) the raw body is still
      // fully drainable when control leaves the seam.
      if (!upgraded) sealBody(safe);
    }
  };
}

/**
 * End the raw request's readable lifetime at the seam boundary, whether or not
 * a route read it. After this the stream is cancelled and the WeakMap entry is
 * `done`, so nothing can obtain bytes from it.
 */
function sealBody(req: HttpRequest): void {
  const state = bodies.get(req);
  if (state?.kind !== "pending") return;
  bodies.set(req, { kind: "done", read: { ok: false, tooLarge: false } });
  const body = state.request.body;
  if (body === null || body.locked) return;
  void body.cancel().catch(() => { /* peer already gone */ });
}

/**
 * The peer address Bun saw for this request, or `undefined`.
 *
 * The seam redeems the private raw request itself; callers hold only the
 * envelope, so `srv.requestIP(rawReq)` never appears outside this file.
 */
export function peerAddress(req: HttpRequest): string | undefined {
  const state = bodies.get(req);
  if (state?.kind !== "pending") return undefined;
  return state.peer();
}

/**
 * Hand this connection to Bun's WebSocket machinery.
 *
 * Same reason as `peerAddress`: `srv.upgrade()` needs the concrete `Request`, so
 * the seam performs the upgrade against its private copy. Fails CLOSED — an
 * envelope this module did not prepare, or one whose body has already been
 * consumed, cannot be upgraded.
 */
export function upgradeWebSocket<T>(req: HttpRequest, data: T): boolean {
  const state = bodies.get(req);
  if (state?.kind !== "pending") return false;
  return state.upgrade(data);
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

/** Locking the stream can throw (already-locked). Return null instead. */
function acquireReader(body: ReadableStream<Uint8Array>) {
  try {
    return body.getReader();
  } catch {
    return null;
  }
}

async function readRawBodyCapped(req: Request, maxBytes: number): Promise<CappedRead<Uint8Array>> {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, tooLarge: true };
  if (req.body === null) return { ok: true, value: EMPTY };

  // `getReader()` itself can throw — a second concurrent read of the same
  // envelope finds the stream already locked. Acquiring it INSIDE a guard turns
  // that into a clean 400-shaped refusal instead of an escaped rejection that
  // `server.ts` answers with a 500. Fail closed, not fail loud.
  const reader = acquireReader(req.body);
  if (reader === null) return { ok: false, tooLarge: false };
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
