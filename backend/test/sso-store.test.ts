// backend/test/sso-store.test.ts
import { test, expect } from "bun:test";
import { Store } from "../src/lib/db.ts";

function freshStore(): Store {
  return new Store(":memory:");
}

test("upsert + get org idp config round-trips and overwrites", () => {
  const store = freshStore();
  const org = store.createOrg({ name: "Weston LLP", plan: "practice", packs: ["legal"], seat_limit: 5 });

  expect(store.getOrgIdpConfig(org.org_id)).toBeNull();

  store.upsertOrgIdpConfig({
    org_id: org.org_id,
    provider: "entra",
    issuer: "https://login.microsoftonline.com/tenant-123/v2.0",
    client_id: "client-abc",
    client_secret_enc: "v1:iv:ct",
    enabled: true,
  });

  const cfg = store.getOrgIdpConfig(org.org_id);
  expect(cfg).not.toBeNull();
  expect(cfg!.provider).toBe("entra");
  expect(cfg!.issuer).toBe("https://login.microsoftonline.com/tenant-123/v2.0");
  expect(cfg!.client_id).toBe("client-abc");
  expect(cfg!.client_secret_enc).toBe("v1:iv:ct");
  expect(cfg!.enabled).toBe(true);

  // Overwrite (upsert is keyed on org_id).
  store.upsertOrgIdpConfig({
    org_id: org.org_id,
    provider: "google",
    issuer: "https://accounts.google.com",
    client_id: "client-xyz",
    client_secret_enc: "v1:iv2:ct2",
    enabled: false,
  });
  const cfg2 = store.getOrgIdpConfig(org.org_id);
  expect(cfg2!.provider).toBe("google");
  expect(cfg2!.enabled).toBe(false);

  store.deleteOrgIdpConfig(org.org_id);
  expect(store.getOrgIdpConfig(org.org_id)).toBeNull();
});

test("getUserByEmailNorm finds an active user case-insensitively", async () => {
  const store = freshStore();
  const org = store.createOrg({ name: "Weston LLP", plan: "practice", packs: ["legal"], seat_limit: 5 });
  store.createUser({ org_id: org.org_id, email: "Jane@Weston-LLP.com", password_hash: "x", role: "member" });

  const u = store.getUserByEmailNorm("jane@weston-llp.com");
  expect(u).not.toBeNull();
  expect(u!.org_id).toBe(org.org_id);
  expect(store.getUserByEmailNorm("nobody@weston-llp.com")).toBeNull();
});
