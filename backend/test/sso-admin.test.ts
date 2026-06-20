import { test, expect, beforeAll } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { buildServeOptions } from "../src/server.ts";
import { fanout } from "../src/lib/matters.ts";
import { issueAuthTokens } from "../src/lib/services.ts";
import { hashPassword } from "../src/lib/crypto.ts";

let base: string; let adminToken: string; let memberToken: string; let orgId: string;

beforeAll(async () => {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Weston", plan: "practice", packs: ["legal"], seat_limit: 5 });
  orgId = org.org_id;
  const admin = store.createUser({ org_id: org.org_id, email: "admin@weston.com", password_hash: await hashPassword("x".repeat(12)), role: "admin" });
  const member = store.createUser({ org_id: org.org_id, email: "m@weston.com", password_hash: await hashPassword("x".repeat(12)), role: "member" });
  adminToken = issueAuthTokens(store, admin).access_token;
  memberToken = issueAuthTokens(store, member).access_token;
  const srv = Bun.serve(buildServeOptions(store, fanout));
  base = `http://${srv.hostname}:${srv.port}`;
});

async function post(path: string, body: unknown, token?: string) {
  return fetch(base + path, {
    method: "POST",
    headers: { "content-type": "application/json", ...(token ? { authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify(body),
  });
}

test("admin can set, get (secret-free), and delete SSO config; member is forbidden", async () => {
  const set = await post("/org/sso/config/set", {
    provider: "generic", issuer: "https://idp.example.com",
    client_id: "client-abc", client_secret: "super-secret", enabled: true,
  }, adminToken);
  expect(set.status).toBe(200);

  const get = await post("/org/sso/config/get", {}, adminToken);
  expect(get.status).toBe(200);
  const view = await get.json() as any;
  expect(view.configured).toBe(true);
  expect(view.client_id).toBe("client-abc");
  expect(view.has_secret).toBe(true);
  expect(view.redirect_uri).toContain("/auth/sso/callback");
  expect(JSON.stringify(view)).not.toContain("super-secret"); // secret never leaves

  const memberForbidden = await post("/org/sso/config/get", {}, memberToken);
  expect(memberForbidden.status).toBe(403);
  // Members cannot mutate config either, and unauthenticated callers are rejected.
  expect((await post("/org/sso/config/set", { provider: "generic", issuer: "https://idp.example.com", client_id: "x", client_secret: "y", enabled: true }, memberToken)).status).toBe(403);
  expect((await post("/org/sso/config/delete", {}, memberToken)).status).toBe(403);
  expect((await post("/org/sso/config/get", {})).status).toBe(401);

  const del = await post("/org/sso/config/delete", {}, adminToken);
  expect(del.status).toBe(200);
  const get2 = await post("/org/sso/config/get", {}, adminToken);
  expect((await get2.json() as any).configured).toBe(false);
});

test("update SSO config without client_secret keeps the existing secret (keep-existing path)", async () => {
  // First-time setup with a secret.
  const set1 = await post("/org/sso/config/set", {
    provider: "entra", issuer: "https://login.microsoftonline.com/tenant/v2.0",
    client_id: "client-keep", client_secret: "original-secret", enabled: true,
  }, adminToken);
  expect(set1.status).toBe(200);

  // Confirm secret is saved.
  const view1 = await (await post("/org/sso/config/get", {}, adminToken)).json() as any;
  expect(view1.has_secret).toBe(true);
  expect(view1.enabled).toBe(true);

  // Update: same provider/issuer/client_id, flip enabled, NO client_secret.
  const set2 = await post("/org/sso/config/set", {
    provider: "entra", issuer: "https://login.microsoftonline.com/tenant/v2.0",
    client_id: "client-keep", enabled: false,
    // client_secret intentionally omitted
  }, adminToken);
  expect(set2.status).toBe(200);

  // The secret must still be present and enabled must have changed.
  const view2 = await (await post("/org/sso/config/get", {}, adminToken)).json() as any;
  expect(view2.has_secret).toBe(true);
  expect(view2.enabled).toBe(false);
  expect(view2.client_id).toBe("client-keep");

  // Same test with an explicit empty string for client_secret.
  const set3 = await post("/org/sso/config/set", {
    provider: "entra", issuer: "https://login.microsoftonline.com/tenant/v2.0",
    client_id: "client-keep", client_secret: "", enabled: true,
  }, adminToken);
  expect(set3.status).toBe(200);

  const view3 = await (await post("/org/sso/config/get", {}, adminToken)).json() as any;
  expect(view3.has_secret).toBe(true);
  expect(view3.enabled).toBe(true);

  // Cleanup.
  await post("/org/sso/config/delete", {}, adminToken);
});

test("first-time SSO setup with no client_secret returns 400 invalid_client_secret", async () => {
  // Ensure no config exists for this org (deleted in previous test).
  const check = await (await post("/org/sso/config/get", {}, adminToken)).json() as any;
  expect(check.configured).toBe(false);

  // First-time setup without a secret — must be rejected.
  const res = await post("/org/sso/config/set", {
    provider: "generic", issuer: "https://idp.example.com",
    client_id: "client-first", enabled: true,
    // client_secret omitted
  }, adminToken);
  expect(res.status).toBe(400);
  const body = await res.json() as any;
  expect(body.error).toBe("invalid_client_secret");

  // Same with explicit empty string.
  const res2 = await post("/org/sso/config/set", {
    provider: "generic", issuer: "https://idp.example.com",
    client_id: "client-first", client_secret: "", enabled: true,
  }, adminToken);
  expect(res2.status).toBe(400);
  expect((await res2.json() as any).error).toBe("invalid_client_secret");

  // Same with whitespace-only.
  const res3 = await post("/org/sso/config/set", {
    provider: "generic", issuer: "https://idp.example.com",
    client_id: "client-first", client_secret: "   ", enabled: true,
  }, adminToken);
  expect(res3.status).toBe(400);
  expect((await res3.json() as any).error).toBe("invalid_client_secret");
});
