/**
 * THE request-body seam. This module is the ONLY place in `backend/src` that
 * may touch a raw `Request` body (`.body`, `.text()`, `.json()`,
 * `.arrayBuffer()`, `.blob()`, `.formData()`, `.bytes()`, `.clone()`).
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
 *  1. TYPE BOUNDARY. Every route handler takes `HttpRequest`, which is `Request`
 *     with every body-draining member removed. `req.text()` inside a handler is
 *     a *compile error* ("Property 'text' does not exist on type
 *     'HttpRequest'"), so `npm run typecheck` / `tsc --noEmit` fails. The
 *     compiler enumerates every offending caller at once instead of us patching
 *     sites one round at a time.
 *
 *  2. MECHANICAL CHECK. `scripts/check-backend-body-readers.mjs` parses every
 *     git-tracked TypeScript file under `backend/src` with the TypeScript AST
 *     (so a comment or a string literal can neither trigger nor silence it) and
 *     fails on:
 *       - the type name `Request` / `new Request` outside this file and the one
 *         Bun-fixed handler signature in `server.ts` (closes the "declare it as
 *         a full Request, or cast back to one" bypass), and
 *       - a raw body-draining call outside this file, except a short allowlist
 *         of *outbound-response* reads carrying a written justification.
 *     It runs as a blocking step in `scripts/gate.sh` and as
 *     `npm run backend:body-readers:check`.
 *
 * A new caller cannot quietly bypass this seam: it either imports a
 * `readCapped*` function from here, or it fails to compile and fails the gate.
 */

/**
 * A `Request` with every body-draining member removed.
 *
 * A real `Request` is structurally assignable to `HttpRequest`, so `server.ts`
 * hands Bun's request straight to a handler and tests keep constructing plain
 * `new Request(...)` objects — but inside a handler the body APIs are simply
 * not on the type. `clone()` and `bodyUsed` are stripped too: `clone()` would
 * hand back a full `Request` (and buffers the body to do it), and `bodyUsed`
 * only means anything to code that reads the body itself.
 */
export type HttpRequest = Omit<
  Request,
  "body" | "bodyUsed" | "text" | "json" | "arrayBuffer" | "blob" | "formData" | "bytes" | "clone"
>;

/**
 * Outcome of a capped read.
 * `tooLarge` distinguishes a size rejection (callers answer 413) from a
 * malformed/absent-body rejection (callers answer 400), matching the shape the
 * intake + relay routes already used.
 */
export type CappedRead<T> = { ok: true; value: T } | { ok: false; tooLarge: boolean };

/**
 * Does this request carry a body at all? Cheap, non-draining — used by handlers
 * that must reject an unexpected body without reading a single byte of it.
 */
export function hasRequestBody(req: HttpRequest): boolean {
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > 0) return true;
  return rawBody(req) !== null;
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
  // Belt: an honest Content-Length lets us reject before opening the stream.
  const declared = Number(req.headers.get("content-length") ?? "0");
  if (Number.isFinite(declared) && declared > maxBytes) return { ok: false, tooLarge: true };

  const stream = rawBody(req);
  if (stream === null) return { ok: true, value: EMPTY };

  const reader = stream.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (!value) continue;
      total += value.byteLength;
      // Braces: cap crossed -> stop reading and drop the connection. This is
      // the whole point of the module; never move it after the loop.
      if (total > maxBytes) {
        await reader.cancel();
        return { ok: false, tooLarge: true };
      }
      chunks.push(value);
    }
  } catch {
    // Transport failure mid-read (client vanished, framing error).
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

const EMPTY = new Uint8Array(0);
const DECODER = new TextDecoder("utf-8", { fatal: false });

/**
 * The ONE blessed widening back to a full `Request`. Every other file in
 * `backend/src` is forbidden (by `scripts/check-backend-body-readers.mjs`) from
 * naming `Request` in a type position, so this is the single point at which the
 * raw stream is reachable.
 */
function rawBody(req: HttpRequest): ReadableStream<Uint8Array> | null {
  return (req as Request).body;
}
