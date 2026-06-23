/**
 * Shared test fixtures: build an in-memory Store seeded with an org, an admin,
 * N members, and a license key. Returns everything tests need to exercise the
 * service layer without HTTP.
 */

import { Store } from "../src/lib/db.ts";
import { hmacHash, generateLicenseKey } from "../src/lib/crypto.ts";
import type { Org, User, Plan, ProfessionPack } from "../src/lib/types.ts";

export interface Fixture {
  store: Store;
  org: Org;
  admin: User;
  members: User[];
  licenseKey: string; // plaintext (for activate calls)
}

export function makeFixture(opts?: {
  plan?: Plan;
  packs?: ProfessionPack[];
  seatLimit?: number;
  memberCount?: number;
}): Fixture {
  const store = new Store(":memory:");
  const plan = opts?.plan ?? "practice";
  const packs = opts?.packs ?? ["advisor", "legal", "tax", "consulting"];
  const seatLimit = opts?.seatLimit ?? 2;
  const memberCount = opts?.memberCount ?? 3;

  const org = store.createOrg({ name: "Acme Law LLP", plan, packs, seat_limit: seatLimit });
  // Password hashes here are placeholders; service-layer tests don't log in.
  const admin = store.createUser({ org_id: org.org_id, email: "admin@acme.test", password_hash: "x", role: "admin" });
  const members: User[] = [];
  for (let i = 0; i < memberCount; i++) {
    members.push(store.createUser({ org_id: org.org_id, email: `member${i}@acme.test`, password_hash: "x", role: "member" }));
  }

  const licenseKey = generateLicenseKey();
  store.createLicenseKey({ org_id: org.org_id, key_hash: hmacHash(licenseKey), plan, packs, seat_limit: seatLimit });

  return { store, org, admin, members, licenseKey };
}
