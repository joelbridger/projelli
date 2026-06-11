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
  const view = await get.json();
  expect(view.configured).toBe(true);
  expect(view.client_id).toBe("client-abc");
  expect(view.has_secret).toBe(true);
  expect(view.redirect_uri).toContain("/auth/sso/callback");
  expect(JSON.stringify(view)).not.toContain("super-secret"); // secret never leaves

  const memberForbidden = await post("/org/sso/config/get", {}, memberToken);
  expect(memberForbidden.status).toBe(403);

  const del = await post("/org/sso/config/delete", {}, adminToken);
  expect(del.status).toBe(200);
  const get2 = await post("/org/sso/config/get", {}, adminToken);
  expect((await get2.json()).configured).toBe(false);
});
