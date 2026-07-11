/**
 * Strict request envelopes for the opaque firm-relay API.
 *
 * The relay must never become a convenient place to smuggle client metadata.
 * Keep this check shared so a new v2 route cannot accidentally accept a legacy
 * descriptor just because its handler does not otherwise need a request body.
 */

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

export type V2Payload = Record<string, unknown>;
export type V2RelayBoundaryError = "invalid_v2_payload" | "invalid_v2_query";

function isPlainObject(value: unknown): value is V2Payload {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

/** True when a prohibited client/document descriptor appears at any depth. */
export function hasForbiddenV2RelayKey(value: unknown): boolean {
  if (Array.isArray(value)) return value.some(hasForbiddenV2RelayKey);
  if (!isPlainObject(value)) return false;
  return Object.entries(value).some(([key, child]) =>
    FORBIDDEN_RELAY_KEYS.has(key.toLowerCase()) || hasForbiddenV2RelayKey(child),
  );
}

/** Read a clone at the server boundary so prohibited fields die before routing. */
export async function requestHasForbiddenV2RelayKey(req: Request): Promise<boolean> {
  let raw: string;
  try {
    raw = await req.clone().text();
  } catch {
    return false;
  }
  if (!raw.trim() || raw.length > MAX_BODY_BYTES) return false;
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
    (method === "GET" && STREAM_PULL_PATH.test(url.pathname)) || url.pathname === SYNC_SOCKET_PATH
  );

  if (method === "GET" && STREAM_PULL_PATH.test(url.pathname)) {
    if (entries.length !== 1 || entries[0]![0] !== "since") return false;
    const since = entries[0]![1];
    return CURSOR.test(since) && Number.isSafeInteger(Number(since));
  }
  if (url.pathname === SYNC_SOCKET_PATH) {
    return entries.length === 1 && entries[0]![0] === "ticket" && SYNC_TICKET.test(entries[0]![1]);
  }
  return false;
}

/**
 * One fail-closed boundary for every v2 firm route. Keep query and body
 * validation together so a new route cannot accidentally protect one while
 * forgetting the other.
 */
export async function validateV2RelayBoundary(req: Request): Promise<V2RelayBoundaryError | null> {
  if (!hasValidV2RelayQuery(new URL(req.url), req.method)) return "invalid_v2_query";
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
  const length = Number(req.headers.get("content-length") ?? "0");
  if (!Number.isFinite(length) || length > MAX_BODY_BYTES) return null;

  let raw: string;
  try {
    raw = await req.text();
  } catch {
    return null;
  }
  if (raw.length > MAX_BODY_BYTES) return null;

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
