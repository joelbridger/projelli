/**
 * Executable inventory for non-v2 firm routes which persist client input.
 *
 * These routes are deliberately kept beside the v2 relay inventory: a new
 * persisted firm input must be named here before its handler can read it.
 */
import { readJson } from "./http.ts";

export type FirmPersistentRouteId = "deviceRegister" | "activateSeat" | "transferSeat" | "orgClaim";

export interface FirmPersistentRouteSpec {
  id: FirmPersistentRouteId;
  method: "POST";
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
] as const;

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
