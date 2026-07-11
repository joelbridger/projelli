/**
 * Strict request envelopes for the opaque firm-relay API.
 *
 * The relay must never become a convenient place to smuggle client metadata.
 * Keep this check shared so a new v2 route cannot accidentally accept a legacy
 * descriptor just because its handler does not otherwise need a request body.
 */
import { config } from "./config.ts";

const FORBIDDEN_RELAY_KEYS = new Set([
  "client_name",
  "matter_id",
  "doc_id",
  "name",
  "display_name",
  "title",
  "filename",
  "path",
]);

const MAX_BODY_BYTES = 2 * 1024 * 1024;
const MAX_JSON_DEPTH = 256;

function* ownEnumerableKeys(value: V2Payload): IterableIterator<string> {
  for (const key in value) {
    if (Object.prototype.hasOwnProperty.call(value, key)) yield key;
  }
}

export type V2Payload = Record<string, unknown>;
export type V2RelayBoundaryError = "invalid_v2_payload" | "invalid_v2_query";

function isPlainObject(value: unknown): value is V2Payload {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/**
 * True when a prohibited client/document descriptor appears at any depth.
 *
 * This is deliberately iterative. The request boundary is reachable before
 * authentication, so an attacker must not be able to turn a deeply nested
 * (but otherwise valid) JSON value into a call-stack overflow.
 */
export function hasForbiddenV2RelayKey(value: unknown): boolean {
  // Do not push all children of a wide array at once. This code runs before
  // authentication, so its working memory must be tied to nesting depth, not
  // to attacker-controlled width. `for..in` is wrapped in an iterator so an
  // object is likewise advanced one entry at a time.
  type Frame = { value: unknown; depth: number } | { object: V2Payload; keys: IterableIterator<string>; depth: number } | { array: unknown[]; index: number; depth: number };
  const pending: Frame[] = [{ value, depth: 0 }];
  let visited = 0;
  while (pending.length > 0) {
    const frame = pending.pop()!;
    if ("value" in frame) {
      if (++visited > config.v2PayloadNodeBudget || frame.depth > MAX_JSON_DEPTH) return true;
      if (Array.isArray(frame.value)) {
        pending.push({ array: frame.value, index: 0, depth: frame.depth + 1 });
      } else if (isPlainObject(frame.value)) {
        pending.push({ object: frame.value, keys: ownEnumerableKeys(frame.value), depth: frame.depth + 1 });
      }
      continue;
    }
    if ("array" in frame) {
      if (frame.index >= frame.array.length) continue;
      const child = frame.array[frame.index++];
      pending.push(frame, { value: child, depth: frame.depth });
      continue;
    }
    const next = frame.keys.next();
    if (next.done) continue;
    const key = next.value;
    if (FORBIDDEN_RELAY_KEYS.has(key.toLowerCase())) return true;
    pending.push(frame, { value: frame.object[key], depth: frame.depth });
  }
  return false;
}

function declaredContentLength(req: Request): number | null {
  const raw = req.headers.get("content-length");
  if (raw === null || !/^\d+$/.test(raw)) return null;
  const length = Number(raw);
  return Number.isSafeInteger(length) ? length : null;
}

async function cancelBody(req: Request): Promise<void> {
  try {
    await req.body?.cancel();
  } catch {
    // A failed cancellation is still safe: the capped reader below has stopped.
  }
}

/**
 * Read at most MAX_BODY_BYTES from a request body. This never calls text(),
 * because text() buffers an unknown-length stream before we can enforce the
 * cap. A declared oversized body is rejected before it is cloned or read.
 */
async function readBodyWithinLimit(req: Request, clone: boolean): Promise<string | null> {
  const length = declaredContentLength(req);
  if (length !== null && length > MAX_BODY_BYTES) {
    void cancelBody(req);
    return null;
  }

  const source = clone ? req.clone() : req;
  if (!source.body) return "";
  const reader = source.body.getReader();
  const chunks: Uint8Array[] = [];
  let total = 0;
  const deadline = Date.now() + config.v2PayloadReadTimeoutMs;
  try {
    while (true) {
      const remaining = deadline - Date.now();
      if (remaining <= 0) {
        void reader.cancel().catch(() => undefined);
        void cancelBody(req);
        return null;
      }
      let timer: ReturnType<typeof setTimeout> | undefined;
      const timeout = new Promise<null>((resolve) => { timer = setTimeout(() => resolve(null), remaining); });
      const next = await Promise.race([reader.read(), timeout]);
      if (timer !== undefined) clearTimeout(timer);
      if (next === null) {
        // Cancel both branches: `source` may be a clone and cancelling only
        // that tee branch can leave the original unauthenticated request open.
        void reader.cancel().catch(() => undefined);
        void cancelBody(req);
        return null;
      }
      const { done, value } = next;
      if (done) break;
      total += value.byteLength;
      if (total > MAX_BODY_BYTES) {
        // Do not wait for a peer to finish cancelling its tee branch: this is
        // an unauthenticated rejection path and must return promptly.
        void reader.cancel().catch(() => undefined);
        void cancelBody(req);
        return null;
      }
      chunks.push(value);
    }
  } catch {
    return null;
  }

  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return new TextDecoder().decode(bytes);
}

/** Read a clone at the server boundary so prohibited fields die before routing. */
export async function requestHasForbiddenV2RelayKey(req: Request): Promise<boolean> {
  const raw = await readBodyWithinLimit(req, true);
  // A body that exceeds the cap is invalid, not merely free of forbidden keys.
  if (raw === null) return true;
  if (!raw.trim()) return false;
  try {
    return hasForbiddenV2RelayKey(JSON.parse(raw));
  } catch {
    return false;
  }
}

const STREAM_PULL_PATH = /^\/v2\/firm\/streams\/[^/]+\/updates$/;
const SYNC_SOCKET_PATH = "/v2/firm/sync";
const CURSOR = /^(?:0|[1-9]\d*)$/;
const SYNC_TICKET = /^[a-f0-9]{64}$/i;

/**
 * Query strings are a privacy boundary too: reverse proxies frequently retain
 * complete URLs. The relay has only two deliberately narrow exceptions.
 */
function hasValidV2RelayQuery(url: URL, method: string): boolean {
  const entries = [...url.searchParams.entries()];
  if (entries.length === 0) return !(
    (method === "GET" && STREAM_PULL_PATH.test(url.pathname)) ||
    (method === "GET" && url.pathname === SYNC_SOCKET_PATH)
  );

  if (method === "GET" && STREAM_PULL_PATH.test(url.pathname)) {
    if (entries.length !== 1 || entries[0]![0] !== "since") return false;
    const since = entries[0]![1];
    return CURSOR.test(since) && Number.isSafeInteger(Number(since));
  }
  if (method === "GET" && url.pathname === SYNC_SOCKET_PATH) {
    return entries.length === 1 && entries[0]![0] === "ticket" && SYNC_TICKET.test(entries[0]![1]);
  }
  return false;
}

function queryMethodForRequest(req: Request): string | null {
  if (req.method !== "OPTIONS") return req.method;
  const requested = req.headers.get("access-control-request-method");
  if (!requested) return null;
  const method = requested.toUpperCase();
  return method === "GET" || method === "POST" || method === "OPTIONS" ? method : null;
}

/**
 * One fail-closed boundary for every v2 firm route. Keep query and body
 * validation together so a new route cannot accidentally protect one while
 * forgetting the other.
 */
export async function validateV2RelayBoundary(req: Request): Promise<V2RelayBoundaryError | null> {
  const queryMethod = queryMethodForRequest(req);
  if (!hasValidV2RelayQuery(new URL(req.url), queryMethod ?? "")) return "invalid_v2_query";
  // Preflights do not carry application payloads. Never read one before auth.
  if (req.method === "OPTIONS") return null;
  return await requestHasForbiddenV2RelayKey(req) ? "invalid_v2_payload" : null;
}

/**
 * Read a v2 JSON object and require exactly the route's declared top-level
 * fields. An absent body is equivalent to `{}` for bodyless POST endpoints.
 * Invalid input deliberately has no diagnostic detail: never reflect a value
 * that might itself be confidential client metadata.
 */
export async function readStrictV2Payload(
  req: Request,
  allowedKeys: readonly string[],
): Promise<V2Payload | null> {
  const raw = await readBodyWithinLimit(req, false);
  if (raw === null) return null;

  let value: unknown = {};
  if (raw.trim()) {
    try {
      value = JSON.parse(raw);
    } catch {
      return null;
    }
  }

  if (!isPlainObject(value) || hasForbiddenV2RelayKey(value)) return null;
  const allowed = new Set(allowedKeys);
  if (Object.keys(value).some((key) => !allowed.has(key))) return null;
  return value;
}
