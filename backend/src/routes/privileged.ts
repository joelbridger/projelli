import { hashPassword, hmacEquals, hmacHash } from "../lib/crypto.ts";
import { config } from "../lib/config.ts";
import { error, isValidPassword, json, readJson } from "../lib/http.ts";
import type { Store } from "../lib/db.ts";

const LICENSE_RE = /^[A-Z0-9]{4}(?:-[A-Z0-9]{4}){7}$/;

function provisionAuthorized(req: Request): boolean {
  const supplied = req.headers.get("x-test-firm-provisioning-secret") ?? "";
  // Compare fixed-size keyed hashes; missing, blank, malformed, and wrong all
  // follow this identical pre-body-read refusal path.
  return config.testFirmProvisioningSecret.length > 0 && hmacEquals(hmacHash(supplied), hmacHash(config.testFirmProvisioningSecret));
}

export async function handleTestFirmProvision(req: Request, store: Store): Promise<Response> {
  if (!provisionAuthorized(req)) return error("unauthorized", 401);
  const body = await readJson<{ password?: unknown; license_key?: unknown }>(req);
  if (!body || !isValidPassword(body.password) || typeof body.license_key !== "string" || !LICENSE_RE.test(body.license_key)) return error("invalid_request", 400);
  const result = store.createSarahTestFirm({ password_hash: await hashPassword(body.password), license_hash: hmacHash(body.license_key) });
  // No plaintext, email, or secret-derived material crosses this boundary.
  return json({ ok: true, created: result.created, org_id: result.org_id, user_id: result.user_id || undefined, license_id: result.license_id || undefined }, result.created ? 201 : 200);
}

export function handleTestFirmRetirement(req: Request, store: Store): Response {
  if (!provisionAuthorized(req)) return error("unauthorized", 401);
  const result = store.retireSarahTestFirm();
  return json({ ok: true, retired: result.retired, org_id: result.org_id, counts: { users: result.users, seats: result.seats, sessions: result.sessions, licenses: result.licenses, intakes: result.intakes } });
}
