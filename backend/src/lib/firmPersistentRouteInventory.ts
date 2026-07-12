/**
 * Executable inventory for non-v2 firm routes which persist client input.
 *
 * These routes are deliberately kept beside the v2 relay inventory: a new
 * persisted firm input must be named here before its handler can read it.
 */
import { readJson } from "./http.ts";

export type FirmPersistentRouteId =
  | "deviceRegister" | "activateSeat" | "transferSeat" | "orgClaim"
  | "revokeSeat" | "deprovisionUser" | "createUser" | "createOrg"
  | "setSsoConfig" | "deleteSsoConfig" | "setProviderKey" | "deleteProviderKey"
  | "webhook" | "authLogin" | "authRefresh" | "authLogout" | "ssoStart"
  | "ssoCallback" | "ssoExchange" | "seatHeartbeat" | "assuredInfer";

export interface FirmPersistentRouteSpec {
  id: FirmPersistentRouteId;
  method: "GET" | "POST";
  path: string;
  bodyKeys: readonly string[];
  inputs: readonly { name: string; classification: "strict-opaque-handle" | "server-minted" | "verified-never-stored" | "fixed-enum"; rule: string }[];
}

export const FIRM_PERSISTENT_ROUTE_SPECS: readonly FirmPersistentRouteSpec[] = [
  {
    id: "deviceRegister", method: "POST", path: "/device/register",
    bodyKeys: ["device_id", "machine_id", "pubkey_jwk"],
    inputs: [
      { name: "device_id", classification: "strict-opaque-handle", rule: "Client-generated UUID; readable text is rejected." },
      { name: "machine_id", classification: "strict-opaque-handle", rule: "Client-generated UUID; readable text is rejected." },
      { name: "pubkey_jwk", classification: "verified-never-stored", rule: "Validated public P-256 key material only; private material is rejected." },
      { name: "label", classification: "verified-never-stored", rule: "Not accepted. Device names stay on the device and are never sent to, stored by, or returned from the relay." },
    ],
  },
  {
    id: "activateSeat", method: "POST", path: "/org/activate",
    bodyKeys: ["license_key", "machine_id"],
    inputs: [
      { name: "license_key", classification: "server-minted", rule: "Verified by keyed hash; plaintext is never stored." },
      { name: "machine_id", classification: "strict-opaque-handle", rule: "Client-generated UUID; readable text is rejected." },
      { name: "machine_label", classification: "verified-never-stored", rule: "Not accepted. Device names stay local and cannot enter the relay." },
    ],
  },
  {
    id: "transferSeat", method: "POST", path: "/org/seats/transfer",
    bodyKeys: ["from_seat_id", "to_user_id", "to_machine_id"],
    inputs: [
      { name: "from_seat_id", classification: "server-minted", rule: "Must resolve to an existing seat in the administrator's org." },
      { name: "to_user_id", classification: "server-minted", rule: "Must resolve to an existing active user in the administrator's org." },
      { name: "to_machine_id", classification: "strict-opaque-handle", rule: "Client-generated UUID; readable text is rejected." },
      { name: "to_machine_label", classification: "verified-never-stored", rule: "Not accepted. Device names stay local and cannot enter the relay." },
    ],
  },
  {
    id: "orgClaim", method: "POST", path: "/org/claim",
    bodyKeys: ["license_key", "email", "password"],
    inputs: [
      { name: "license_key", classification: "server-minted", rule: "Matched by keyed hash; plaintext is never stored." },
      { name: "email", classification: "verified-never-stored", rule: "Must be a syntactically valid account email before the server creates the account record." },
      { name: "password", classification: "verified-never-stored", rule: "Must meet the password policy and is persisted only as a password hash." },
      { name: "org_name", classification: "verified-never-stored", rule: "Not accepted. The provisioned billing-side firm name cannot be overwritten by a caller." },
    ],
  },
  { id: "revokeSeat", method: "POST", path: "/org/seat/revoke", bodyKeys: ["seat_id", "reason_code"], inputs: [
    { name: "seat_id", classification: "server-minted", rule: "Must resolve to a seat in the administrator's org." },
    { name: "reason_code", classification: "fixed-enum", rule: "Optional closed revocation code: admin_revoked, device_lost, or security_incident. Arbitrary reason text is rejected." },
  ] },
  { id: "deprovisionUser", method: "POST", path: "/org/user/deprovision", bodyKeys: ["user_id"], inputs: [{ name: "user_id", classification: "server-minted", rule: "Must resolve to a user in the administrator's org." }] },
  { id: "createUser", method: "POST", path: "/org/users", bodyKeys: ["email", "password", "role"], inputs: [
    { name: "email", classification: "verified-never-stored", rule: "Validated account email; stored only as the account identifier." },
    { name: "password", classification: "verified-never-stored", rule: "Policy-validated then persisted only as a password hash." },
    { name: "role", classification: "fixed-enum", rule: "Only admin or member; the server canonicalizes the default." },
  ] },
  { id: "createOrg", method: "POST", path: "/admin/org", bodyKeys: ["name", "plan", "packs", "seat_limit", "admin_email", "admin_password", "billing_customer_id"], inputs: [
    { name: "name", classification: "verified-never-stored", rule: "Billing-controlled organization label, capped at 200 characters; this protected provisioning route is not a client-workspace channel." },
    { name: "plan", classification: "fixed-enum", rule: "Closed subscription-plan enum." },
    { name: "packs", classification: "fixed-enum", rule: "Closed professional-pack enum." },
    { name: "seat_limit", classification: "fixed-enum", rule: "Bounded integer." },
    { name: "admin_email", classification: "verified-never-stored", rule: "Validated account email." },
    { name: "admin_password", classification: "verified-never-stored", rule: "Persisted only as a password hash." },
    { name: "billing_customer_id", classification: "server-minted", rule: "Bounded billing-system identifier, not client content." },
  ] },
  { id: "setSsoConfig", method: "POST", path: "/org/sso/config/set", bodyKeys: [], inputs: [{ name: "OIDC configuration", classification: "verified-never-stored", rule: "Strict OIDC URL/client configuration; no client-workspace text is accepted." }] },
  { id: "deleteSsoConfig", method: "POST", path: "/org/sso/config/delete", bodyKeys: [], inputs: [] },
  { id: "setProviderKey", method: "POST", path: "/assured/keys/set", bodyKeys: ["provider", "api_key"], inputs: [{ name: "provider", classification: "fixed-enum", rule: "anthropic, openai, or google only." }, { name: "api_key", classification: "verified-never-stored", rule: "Provider credential is encrypted before persistence and never logged or returned." }] },
  { id: "deleteProviderKey", method: "POST", path: "/assured/keys/delete", bodyKeys: ["provider"], inputs: [{ name: "provider", classification: "fixed-enum", rule: "anthropic, openai, or google only." }] },
  { id: "webhook", method: "POST", path: "/webhooks/lemonsqueezy", bodyKeys: [], inputs: [{ name: "signed webhook body", classification: "verified-never-stored", rule: "Signature-verified billing event; only fixed subscription metadata is persisted." }] },
  { id: "authLogin", method: "POST", path: "/auth/login", bodyKeys: [], inputs: [{ name: "credentials", classification: "verified-never-stored", rule: "Email is validated; password is verified and never stored or audited." }] },
  { id: "authRefresh", method: "POST", path: "/auth/refresh", bodyKeys: [], inputs: [{ name: "refresh_token", classification: "server-minted", rule: "Stored and compared only as a keyed hash." }] },
  { id: "authLogout", method: "POST", path: "/auth/logout", bodyKeys: [], inputs: [{ name: "refresh_token", classification: "server-minted", rule: "Stored and compared only as a keyed hash." }] },
  { id: "ssoStart", method: "POST", path: "/auth/sso/start", bodyKeys: [], inputs: [{ name: "OIDC redirect metadata", classification: "verified-never-stored", rule: "Strict provider configuration and server-minted state only." }] },
  { id: "ssoCallback", method: "POST", path: "/auth/sso/callback", bodyKeys: [], inputs: [{ name: "OIDC callback", classification: "verified-never-stored", rule: "Provider-signed identity assertions only; no workspace content is persisted." }] },
  { id: "ssoExchange", method: "POST", path: "/auth/sso/exchange", bodyKeys: [], inputs: [{ name: "OIDC exchange", classification: "server-minted", rule: "Server-minted one-time state only." }] },
  { id: "seatHeartbeat", method: "POST", path: "/seat/heartbeat", bodyKeys: [], inputs: [{ name: "seat token", classification: "server-minted", rule: "Verified token; only server time is persisted." }] },
  { id: "assuredInfer", method: "POST", path: "/assured/infer", bodyKeys: [], inputs: [{ name: "inference body", classification: "verified-never-stored", rule: "Opaque stream is forwarded, never parsed, persisted, audited, or logged." }, { name: "provider and model headers", classification: "fixed-enum", rule: "Provider is closed enum; model is retained only as bounded billing metadata." }] },
] as const;

/**
 * The server's complete non-v2 firm route table.  `persists` is deliberately
 * attached to the executable route declaration, not inferred from a review of
 * source files.  Server construction rejects any writer without an inventory
 * entry, and the request gate rejects any path absent from this table.
 */
export interface FirmServerRoute {
  id: string;
  method: "GET" | "POST";
  path: string;
  persists: boolean;
  inventoryId?: FirmPersistentRouteId;
}

export const FIRM_SERVER_ROUTE_TABLE: readonly FirmServerRoute[] = [
  { id: "health", method: "GET", path: "/healthz", persists: false }, { id: "seatPublicKey", method: "GET", path: "/.well-known/seat-pubkey", persists: false },
  { id: "authLogin", method: "POST", path: "/auth/login", persists: true, inventoryId: "authLogin" }, { id: "authRefresh", method: "POST", path: "/auth/refresh", persists: true, inventoryId: "authRefresh" }, { id: "authLogout", method: "POST", path: "/auth/logout", persists: true, inventoryId: "authLogout" }, { id: "authMe", method: "GET", path: "/auth/me", persists: false },
  { id: "ssoStart", method: "POST", path: "/auth/sso/start", persists: true, inventoryId: "ssoStart" }, { id: "ssoCallback", method: "GET", path: "/auth/sso/callback", persists: true, inventoryId: "ssoCallback" }, { id: "ssoExchange", method: "POST", path: "/auth/sso/exchange", persists: true, inventoryId: "ssoExchange" },
  { id: "deviceRegister", method: "POST", path: "/device/register", persists: true, inventoryId: "deviceRegister" }, { id: "activateSeat", method: "POST", path: "/org/activate", persists: true, inventoryId: "activateSeat" }, { id: "orgClaim", method: "POST", path: "/org/claim", persists: true, inventoryId: "orgClaim" },
  { id: "seatValidate", method: "POST", path: "/seat/validate", persists: false }, { id: "seatHeartbeat", method: "POST", path: "/seat/heartbeat", persists: true, inventoryId: "seatHeartbeat" },
  { id: "listSeats", method: "POST", path: "/org/seats", persists: false }, { id: "revokeSeat", method: "POST", path: "/org/seat/revoke", persists: true, inventoryId: "revokeSeat" }, { id: "deprovisionUser", method: "POST", path: "/org/user/deprovision", persists: true, inventoryId: "deprovisionUser" }, { id: "transferSeat", method: "POST", path: "/org/seats/transfer", persists: true, inventoryId: "transferSeat" },
  { id: "createUser", method: "POST", path: "/org/users", persists: true, inventoryId: "createUser" }, { id: "listUsers", method: "POST", path: "/org/users/list", persists: false }, { id: "audit", method: "GET", path: "/org/audit", persists: false }, { id: "auditPost", method: "POST", path: "/org/audit", persists: false },
  { id: "setSsoConfig", method: "POST", path: "/org/sso/config/set", persists: true, inventoryId: "setSsoConfig" }, { id: "getSsoConfig", method: "POST", path: "/org/sso/config/get", persists: false }, { id: "deleteSsoConfig", method: "POST", path: "/org/sso/config/delete", persists: true, inventoryId: "deleteSsoConfig" },
  { id: "assuredInfer", method: "POST", path: "/assured/infer", persists: true, inventoryId: "assuredInfer" }, { id: "setProviderKey", method: "POST", path: "/assured/keys/set", persists: true, inventoryId: "setProviderKey" }, { id: "listProviderKeys", method: "POST", path: "/assured/keys/list", persists: false }, { id: "deleteProviderKey", method: "POST", path: "/assured/keys/delete", persists: true, inventoryId: "deleteProviderKey" }, { id: "inferenceBilling", method: "POST", path: "/assured/billing", persists: false },
  { id: "listDevices", method: "POST", path: "/org/users/devices", persists: false }, { id: "listAdmins", method: "POST", path: "/org/admins", persists: false }, { id: "webhook", method: "POST", path: "/webhooks/lemonsqueezy", persists: true, inventoryId: "webhook" }, { id: "createOrg", method: "POST", path: "/admin/org", persists: true, inventoryId: "createOrg" },
] as const;

export function assertFirmPersistentRouteInventoryComplete(routes: readonly FirmServerRoute[] = FIRM_SERVER_ROUTE_TABLE): void {
  const ids = new Set(FIRM_PERSISTENT_ROUTE_SPECS.map((spec) => spec.id));
  for (const route of routes) {
    if (route.persists && (!route.inventoryId || !ids.has(route.inventoryId))) {
      throw new Error(`undeclared_persisting_firm_route:${route.id}`);
    }
  }
}

export function isDeclaredFirmServerRoute(path: string, method: string): boolean {
  return FIRM_SERVER_ROUTE_TABLE.some((route) => route.path === path && route.method === method);
}

const SPECS = new Map(FIRM_PERSISTENT_ROUTE_SPECS.map((spec) => [spec.id, spec]));
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function isOpaqueUuid(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

/** Read only the exact keys named in the executable inventory. */
export async function readFirmPersistentPayload(req: Request, id: FirmPersistentRouteId): Promise<Record<string, unknown> | null> {
  const body = await readJson<Record<string, unknown>>(req);
  if (!body || Array.isArray(body) || typeof body !== "object") return null;
  const spec = SPECS.get(id);
  if (!spec) throw new Error("missing_firm_persistent_route_inventory_entry");
  return Object.keys(body).every((key) => spec.bodyKeys.includes(key)) ? body : null;
}

/** Test and router guard: there can be no unlisted persisted firm route. */
export function isDeclaredFirmPersistentRoute(path: string, method: string): boolean {
  return FIRM_PERSISTENT_ROUTE_SPECS.some((spec) => spec.path === path && spec.method === method);
}
