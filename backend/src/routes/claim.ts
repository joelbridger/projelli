/**
 * Org claim route — self-serve activation of a provisioned-but-unclaimed org.
 *
 *   POST /org/claim   (no auth)
 *       { license_key, email, password }
 *       -> { org, user, access_token, refresh_token, ... }
 *
 * When LemonSqueezy processes a Firm purchase, the webhook handler creates an
 * Org with status='unclaimed' and stores the license-key hash. The buyer then
 * calls /org/claim with the license key (from the LS order confirmation), an
 * email + password for their admin account, and an optional org name.
 *
 * On success:
 *   - Org status → 'active'; optionally renamed.
 *   - An admin user is created.
 *   - Auth tokens are issued (same shape as /auth/login).
 *
 * Error cases:
 *   - 404 if the license key is unknown.
 *   - 409 if the org is already active/suspended (already claimed).
 *   - 400 for missing / invalid fields.
 */

import { json, error, isEmail, isValidPassword } from "../lib/http.ts";
import { hashPassword, hmacHash } from "../lib/crypto.ts";
import { issueAuthTokens, publicUser } from "../lib/services.ts";
import { readFirmPersistentPayload } from "../lib/firmPersistentRouteInventory.ts";
import type { Store } from "../lib/db.ts";

export async function handleOrgClaim(req: Request, store: Store): Promise<Response> {
  const body = await readFirmPersistentPayload(req, "orgClaim");
  if (!body) return error("invalid_json", 400);
  if (typeof body.license_key !== "string" || body.license_key.trim().length === 0) {
    return error("missing_fields", 400, "license_key");
  }
  if (!isEmail(body.email)) return error("missing_fields", 400, "email");
  if (!isValidPassword(body.password)) {
    return error("invalid_password", 400, "password must be 12-200 chars");
  }

  const keyHash = hmacHash(body.license_key.trim());
  const found = store.findOrgByLicenseKeyHash(keyHash);
  if (!found) return error("license_key_not_found", 404);

  const { org, licenseKey } = found;

  // Only unclaimed orgs can be claimed.
  if (org.status !== "unclaimed") {
    return error("already_claimed", 409, `org is already ${org.status}`);
  }

  // Pre-validate: reject globally-duplicate email before any mutation.
  // Matches the admin.ts:137 convention (check first, error on conflict).
  if (store.getUserByEmailWithHash(body.email)) {
    return error("email_taken", 409);
  }

  // The storage layer keeps claiming the org and creating its first admin in
  // one transaction, so a failed account cannot leave a claimed empty org.
  const passwordHash = await hashPassword(body.password);
  const adminUser = store.claimOrgAndCreateAdmin({
    org_id: org.org_id,
    email: (body.email as string).trim(),
    password_hash: passwordHash,
  });

  store.audit({
    org_id: org.org_id,
    actor_user_id: adminUser.user_id,
    action: "org.claim",
    target: org.org_id,
    detail: { email: adminUser.email },
  });

  // Issue tokens exactly like /auth/login does.
  const tokens = issueAuthTokens(store, adminUser);

  // Return the freshly-activated org shape.
  const updatedOrg = store.getOrg(org.org_id)!;
  return json({
    org: {
      org_id: updatedOrg.org_id,
      name: updatedOrg.name,
      plan: updatedOrg.plan,
      packs: updatedOrg.packs,
      seat_limit: updatedOrg.seat_limit,
    },
    user: publicUser(adminUser),
    ...tokens,
  });
}
