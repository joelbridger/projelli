/**
 * The complete public input inventory for the opaque v2 firm relay.
 *
 * This is deliberately executable documentation. Route handlers ask this
 * table for their allowed JSON keys, and the hostile-client proof imports the
 * same table. Do not add a v2 route or client field without adding it here.
 */
export type V2InputClass =
  | "strict-opaque-handle"
  | "opaque-idempotency-token"
  | "numeric"
  | "server-derived"
  | "server-minted"
  | "verified-never-stored"
  | "binary-envelope";

export type V2InputLocation = "path" | "query" | "header" | "body" | "websocket-frame";

export interface V2RouteInput {
  location: V2InputLocation;
  name: string;
  classification: V2InputClass;
  /** Plain-language reason this value cannot become readable relay metadata. */
  rule: string;
}

export interface V2FirmRouteSpec {
  id: V2FirmRouteId;
  method: "GET" | "POST";
  path: string;
  bodyKeys: readonly string[];
  inputs: readonly V2RouteInput[];
}

/** Headers that apply to every HTTP v2 route unless the route says otherwise. */
export const V2_FIRM_SHARED_INPUTS = [
  { location: "header", name: "authorization (name)", classification: "verified-never-stored", rule: "Only the exact Authorization header is read; all other header names are ignored." },
  { location: "header", name: "authorization (Bearer access JWT value)", classification: "server-minted", rule: "Signature, type, expiry, and claims are verified; the raw token is never stored or logged." },
  { location: "header", name: "content-type (name and value)", classification: "verified-never-stored", rule: "Transport metadata only; never stored, audited, or logged." },
  { location: "header", name: "x-seat-token (name)", classification: "verified-never-stored", rule: "Only this exact header name is read on seat-gated routes." },
  { location: "header", name: "x-seat-token (value)", classification: "server-minted", rule: "Seat signature and active owner are verified; raw token is never stored or logged." },
  { location: "header", name: "all other header names and values", classification: "verified-never-stored", rule: "Ignored by relay routing and persistence; never copied into an audit or log." },
] as const satisfies readonly V2RouteInput[];

/** Rejection rules shared by every v2 route; the proof drives both key and value. */
export const V2_FIRM_REJECTED_INPUTS = [
  { location: "query", name: "all unlisted query keys and values", classification: "verified-never-stored", rule: "Every query is rejected except pull.since and sync.ticket listed below." },
  { location: "body", name: "all unlisted body keys and values", classification: "verified-never-stored", rule: "Each route accepts only its exact bodyKeys schema; unknown keys are rejected before handlers." },
] as const satisfies readonly V2RouteInput[];

const matterPath: V2RouteInput = { location: "path", name: "matter_handle", classification: "strict-opaque-handle", rule: "Exactly mh2_ plus 43 URL-safe base64 characters; raw segment is never decoded." };
const streamPath: V2RouteInput = { location: "path", name: "stream_handle", classification: "strict-opaque-handle", rule: "Exactly sh2_ plus 43 URL-safe base64 characters; raw segment is never decoded." };
const intakePath: V2RouteInput = { location: "path", name: "intake_handle", classification: "strict-opaque-handle", rule: "Exactly ih2_ plus 43 URL-safe base64 characters; raw segment is never decoded." };
const emptyBody: readonly V2RouteInput[] = [];
const numberEpoch: V2RouteInput = { location: "body", name: "epoch", classification: "numeric", rule: "Positive integer only." };
const userId: V2RouteInput = { location: "body", name: "user_id", classification: "server-minted", rule: "Must resolve to an existing user in the authenticated org." };
const role: V2RouteInput = { location: "body", name: "role", classification: "server-derived", rule: "The server accepts only owner/editor/viewer and persists its own canonical authorization enum, never arbitrary text." };

export type V2FirmRouteId =
  | "matterMine" | "listMatters" | "createMatter" | "activateMatter" | "archiveMatter"
  | "releaseMatterStream" | "listMatterStreams" | "addMatterMember" | "removeMatterMember" | "listMatterMembers"
  | "setWall" | "clearWall" | "publishMatterKeys" | "fetchMatterKey" | "publishIntakeKeys" | "fetchIntakeKeys" | "pushUpdate"
  | "pullUpdates" | "syncTicket" | "syncSocket";

export const V2_FIRM_ROUTE_SPECS: readonly V2FirmRouteSpec[] = [
  { id: "matterMine", method: "POST", path: "/v2/firm/matters/mine", bodyKeys: [], inputs: emptyBody },
  { id: "listMatters", method: "POST", path: "/v2/firm/matters/list", bodyKeys: [], inputs: emptyBody },
  { id: "createMatter", method: "POST", path: "/v2/firm/matters", bodyKeys: ["provisioning_nonce"], inputs: [{ location: "body", name: "provisioning_nonce", classification: "opaque-idempotency-token", rule: "Exactly pn2_ plus 43 URL-safe base64 characters. The relay stores only an HMAC of it so a retried provision returns the same opaque shell." }] },
  { id: "activateMatter", method: "POST", path: "/v2/firm/matters/:matter_handle/activate", bodyKeys: [], inputs: [matterPath] },
  { id: "archiveMatter", method: "POST", path: "/v2/firm/matters/:matter_handle/archive", bodyKeys: [], inputs: [matterPath] },
  { id: "releaseMatterStream", method: "POST", path: "/v2/firm/matters/:matter_handle/streams/release", bodyKeys: ["stream_handle"], inputs: [matterPath, { location: "body", name: "stream_handle", classification: "strict-opaque-handle", rule: "Exactly a sh2_ opaque handle owned by this matter." }] },
  { id: "listMatterStreams", method: "POST", path: "/v2/firm/matters/:matter_handle/streams/list", bodyKeys: [], inputs: [matterPath] },
  { id: "addMatterMember", method: "POST", path: "/v2/firm/matters/:matter_handle/members/add", bodyKeys: ["user_id", "role"], inputs: [matterPath, userId, role] },
  { id: "removeMatterMember", method: "POST", path: "/v2/firm/matters/:matter_handle/members/remove", bodyKeys: ["user_id"], inputs: [matterPath, userId] },
  { id: "listMatterMembers", method: "POST", path: "/v2/firm/matters/:matter_handle/members/list", bodyKeys: [], inputs: [matterPath] },
  { id: "setWall", method: "POST", path: "/v2/firm/matters/:matter_handle/wall/set", bodyKeys: ["user_id"], inputs: [matterPath, userId] },
  { id: "clearWall", method: "POST", path: "/v2/firm/matters/:matter_handle/wall/clear", bodyKeys: ["user_id"], inputs: [matterPath, userId] },
  { id: "publishMatterKeys", method: "POST", path: "/v2/firm/matters/:matter_handle/keys/publish", bodyKeys: ["epoch", "wrapped"], inputs: [matterPath, numberEpoch, { location: "body", name: "wrapped (array shape)", classification: "verified-never-stored", rule: "Array entries permit only user_id, device_id, and wrapped_key_b64." }, { location: "body", name: "wrapped[].all unlisted keys and values", classification: "verified-never-stored", rule: "Any nested key other than user_id, device_id, wrapped_key_b64 is rejected before storage." }, { location: "body", name: "wrapped[].user_id", classification: "server-minted", rule: "Must resolve to an existing user in the authenticated org." }, { location: "body", name: "wrapped[].device_id", classification: "server-minted", rule: "Must be a registered device owned by wrapped[].user_id." }, { location: "body", name: "wrapped[].wrapped_key_b64", classification: "binary-envelope", rule: "Canonical base64 of fixed LWK v1 encrypted-key envelope; stored as BLOB only." }] },
  { id: "fetchMatterKey", method: "POST", path: "/v2/firm/matters/:matter_handle/keys/fetch", bodyKeys: ["device_id"], inputs: [matterPath, { location: "body", name: "device_id", classification: "server-minted", rule: "Must be a registered device owned by the authenticated user." }] },
  { id: "publishIntakeKeys", method: "POST", path: "/v2/firm/intake/:intake_handle/keys/publish", bodyKeys: ["matter_handle", "epoch", "wrapped"], inputs: [intakePath, { location: "body", name: "matter_handle", classification: "strict-opaque-handle", rule: "Exactly mh2_ plus 43 URL-safe base64 characters; binds this intake handle to one opaque matter." }, numberEpoch, { location: "body", name: "wrapped (array shape)", classification: "verified-never-stored", rule: "Array entries permit only user_id, device_id, and wrapped_key_b64." }, { location: "body", name: "wrapped[].all unlisted keys and values", classification: "verified-never-stored", rule: "Any nested key other than user_id, device_id, wrapped_key_b64 is rejected before storage." }, { location: "body", name: "wrapped[].user_id", classification: "server-minted", rule: "Must resolve to an existing user in the authenticated org." }, { location: "body", name: "wrapped[].device_id", classification: "server-minted", rule: "Must be a registered device owned by wrapped[].user_id." }, { location: "body", name: "wrapped[].wrapped_key_b64", classification: "binary-envelope", rule: "Canonical base64 of fixed LWK v1 encrypted-key envelope; stored as BLOB only." }] },
  { id: "fetchIntakeKeys", method: "POST", path: "/v2/firm/intake/:intake_handle/keys/fetch", bodyKeys: ["device_id"], inputs: [intakePath, { location: "body", name: "device_id", classification: "server-minted", rule: "Must be a registered device owned by the authenticated user." }] },
  { id: "pushUpdate", method: "POST", path: "/v2/firm/matters/:matter_handle/streams/:stream_handle/updates", bodyKeys: ["blob_id", "ciphertext_b64", "seat_token", "key_epoch"], inputs: [matterPath, streamPath, { location: "body", name: "blob_id", classification: "strict-opaque-handle", rule: "Exactly bh2_ plus 43 URL-safe base64 characters." }, { location: "body", name: "ciphertext_b64", classification: "binary-envelope", rule: "Canonical base64 ciphertext v2 envelope; only bytes are stored and fanned out." }, { location: "body", name: "seat_token", classification: "server-minted", rule: "Verified active-seat token; raw value is never stored or logged." }, { location: "body", name: "key_epoch", classification: "numeric", rule: "Positive integer only." }] },
  { id: "pullUpdates", method: "GET", path: "/v2/firm/streams/:stream_handle/updates", bodyKeys: [], inputs: [streamPath, { location: "query", name: "since (key)", classification: "verified-never-stored", rule: "The sole accepted query key is exact lowercase since." }, { location: "query", name: "since (value)", classification: "numeric", rule: "Safe non-negative integer only." }] },
  { id: "syncTicket", method: "POST", path: "/v2/firm/streams/:stream_handle/sync-ticket", bodyKeys: ["since"], inputs: [streamPath, { location: "body", name: "since", classification: "numeric", rule: "Client's last contiguous applied cursor; safe non-negative integer and never stored outside the short-lived ticket." }] },
  { id: "syncSocket", method: "GET", path: "/v2/firm/sync", bodyKeys: [], inputs: [{ location: "query", name: "ticket (key)", classification: "verified-never-stored", rule: "The sole accepted query key is exact lowercase ticket." }, { location: "query", name: "ticket (value)", classification: "server-minted", rule: "Exactly a server-minted 64-hex single-use ticket." }, { location: "header", name: "upgrade (name and value)", classification: "verified-never-stored", rule: "Only exact websocket upgrade is accepted; no client text is persisted or logged." }, { location: "websocket-frame", name: "inbound frame", classification: "verified-never-stored", rule: "Every inbound frame is rejected by closing the socket; its text is never stored, audited, logged, or echoed." }] },
] as const;

const SPECS_BY_ID = new Map(V2_FIRM_ROUTE_SPECS.map((spec) => [spec.id, spec]));

export function v2FirmRouteSpec(id: V2FirmRouteId): V2FirmRouteSpec {
  const spec = SPECS_BY_ID.get(id);
  if (!spec) throw new Error("missing_v2_route_inventory_entry");
  return spec;
}

/** A handler must call this rather than spelling its own allowed-key list. */
export function v2BodyKeys(id: V2FirmRouteId): readonly string[] {
  return v2FirmRouteSpec(id).bodyKeys;
}

const MATTER_HANDLE_SEGMENT = "mh2_[A-Za-z0-9_-]{43}";
const STREAM_HANDLE_SEGMENT = "sh2_[A-Za-z0-9_-]{43}";
const INTAKE_HANDLE_SEGMENT = "ih2_[A-Za-z0-9_-]{43}";

/**
 * The router calls this before dispatch. That makes the inventory a real
 * allow-list: a future handler cannot become reachable until it has a table
 * entry (and therefore automatically joins the hostile-client proof).
 */
export function isDeclaredV2FirmRoute(path: string, method: string): boolean {
  return V2_FIRM_ROUTE_SPECS.some((spec) => {
    if (spec.method !== method) return false;
    const expression = `^${spec.path
      .replace(/[.*+?^${}()|[\]\\]/g, "\\$&")
      .replace(":matter_handle", MATTER_HANDLE_SEGMENT)
      .replace(":stream_handle", STREAM_HANDLE_SEGMENT)
      .replace(":intake_handle", INTAKE_HANDLE_SEGMENT)}$`;
    return new RegExp(expression).test(path);
  });
}
