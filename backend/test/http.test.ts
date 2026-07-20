/**
 * End-to-end HTTP test against the real Bun.serve server. Exercises the full
 * firm lifecycle over the wire:
 *
 *   provision org+admin (+license)  →  admin login  →  activate a seat
 *   →  validate the seat token  →  heartbeat  →  hit the seat_limit (N+1 → 409)
 *   →  admin revokes a seat  →  validation now fails
 *   →  bad-credential login rejected.
 *
 * Importing ../src/server.ts boots the listener (port from the test env / default).
 */

import { test, expect, describe, beforeAll, afterAll } from "bun:test";
import { server } from "../src/server.ts";
import { sanitizePacks } from "../src/lib/http.ts";

const BASE = () => `http://${server.hostname}:${server.port}`;

async function post(path: string, body: unknown, bearer?: string) {
  const res = await fetch(`${BASE()}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", ...(bearer ? { authorization: `Bearer ${bearer}` } : path === "/admin/org" ? { authorization: `Bearer ${process.env.ADMIN_PROVISION_SECRET}` } : {}) },
    body: JSON.stringify(body),
  });
  return { status: res.status, json: (await res.json()) as Record<string, any> };
}

afterAll(() => {
  server.stop(true);
});

describe("full HTTP lifecycle", () => {
  let adminAccess = "";
  let memberAccess: string[] = [];
  let licenseKey = "";
  let orgId = "";
  let firstSeatId = "";
  let firstSeatToken = "";

  test("health endpoint responds", async () => {
    const res = await fetch(`${BASE()}/healthz`);
    expect(res.status).toBe(200);
    const body = (await res.json()) as { ok: boolean };
    expect(body.ok).toBe(true);
  });

  test("seat public key is published for the client to embed", async () => {
    const res = await fetch(`${BASE()}/.well-known/seat-pubkey`);
    expect(res.status).toBe(200);
    const pem = await res.text();
    expect(pem).toContain("BEGIN PUBLIC KEY");
  });

  test("advisor survives profession-pack sanitization", () => {
    expect(sanitizePacks(["advisor", "legal", "bad-pack", 42])).toEqual(["advisor", "legal"]);
  });

  test("provision an org + admin + license key", async () => {
    const r = await post("/admin/org", {
      name: `Acme Law ${crypto.randomUUID()}`,
      plan: "practice",
      packs: ["advisor"],
      seat_limit: 2,
      admin_email: `admin-${crypto.randomUUID()}@acme.test`,
      admin_password: "admin-password-1234",
    });
    expect(r.status).toBe(201);
    expect(r.json.license_key).toMatch(/^KEEP-/);
    expect(r.json.org.packs).toEqual(["advisor"]);
    licenseKey = r.json.license_key;
    orgId = r.json.org.org_id;
    // login as admin
    const login = await post("/auth/login", { email: r.json.admin.email, password: "admin-password-1234" });
    expect(login.status).toBe(200);
    expect(typeof login.json.access_token).toBe("string");
    adminAccess = login.json.access_token;
  });

  test("/auth/me returns the admin identity", async () => {
    const me = await fetch(`${BASE()}/auth/me`, { headers: { authorization: `Bearer ${adminAccess}` } });
    expect(me.status).toBe(200);
    const body = (await me.json()) as { user: { role: string }; org: { org_id: string } };
    expect(body.user.role).toBe("admin");
    expect(body.org.org_id).toBe(orgId);
  });

  test("admin creates two member users", async () => {
    for (let i = 0; i < 2; i++) {
      const email = `member-${crypto.randomUUID()}@acme.test`;
      const create = await post("/org/users", { email, password: "member-password-123" }, adminAccess);
      expect(create.status).toBe(201);
      const login = await post("/auth/login", { email, password: "member-password-123" });
      expect(login.status).toBe(200);
      memberAccess.push(login.json.access_token);
    }
  });

  test("member 0 activates a seat and gets a signed seat token", async () => {
    const r = await post("/org/activate", { license_key: licenseKey, machine_id: "machine-0", machine_label: "Laptop 0" }, memberAccess[0]);
    expect(r.status).toBe(200);
    expect(r.json.tier).toBe("practice");
    expect(r.json.packs).toEqual(["advisor"]);
    expect(r.json.seats).toBe(2);
    expect(typeof r.json.token).toBe("string");
    firstSeatId = r.json.seat_id;
    firstSeatToken = r.json.token;
  });

  test("the seat token validates and reports used=1", async () => {
    const v = await post("/seat/validate", { seat_token: firstSeatToken });
    expect(v.status).toBe(200);
    expect(v.json.valid).toBe(true);
    expect(v.json.seats_used).toBe(1);
    expect(v.json.tier).toBe("practice");
    expect(v.json.packs).toEqual(["advisor"]);
  });

  test("heartbeat works and reports correct plan/used", async () => {
    const h = await post("/seat/heartbeat", { seat_token: firstSeatToken });
    expect(h.status).toBe(200);
    expect(h.json.valid).toBe(true);
    expect(h.json.seats_used).toBe(1);
  });

  test("member 1 activates the second seat", async () => {
    const r = await post("/org/activate", { license_key: licenseKey, machine_id: "machine-1" }, memberAccess[1]);
    expect(r.status).toBe(200);
    expect(r.json.seats).toBe(2);
  });

  test("the N+1 activation (admin on a 3rd machine) is rejected with 409", async () => {
    const r = await post("/org/activate", { license_key: licenseKey, machine_id: "machine-2" }, adminAccess);
    expect(r.status).toBe(409);
    expect(r.json.error).toBe("seat_limit_exceeded");
    expect(Array.isArray(r.json.seats)).toBe(true);
    expect(r.json.seats.length).toBe(2);
  });

  test("activation without a bearer token is unauthorized", async () => {
    const r = await post("/org/activate", { license_key: licenseKey, machine_id: "machine-x" });
    expect(r.status).toBe(401);
  });

  test("admin revokes seat 0; validation then fails", async () => {
    const revoke = await post("/org/seat/revoke", { seat_id: firstSeatId, reason: "test-revoke" }, adminAccess);
    expect(revoke.status).toBe(200);
    expect(revoke.json.revoked).toBe(true);

    const v = await post("/seat/validate", { seat_token: firstSeatToken });
    expect(v.json.valid).toBe(false);
    expect(v.json.reason).toBe("revoked");
  });

  test("a non-admin cannot list seats or revoke", async () => {
    const list = await post("/org/seats", {}, memberAccess[1]);
    expect(list.status).toBe(403);
  });

  test("admin can list seats and see used count", async () => {
    const list = await post("/org/seats", {}, adminAccess);
    expect(list.status).toBe(200);
    expect(list.json.seat_limit).toBe(2);
    // seat 0 revoked, seat 1 active → used = 1
    expect(list.json.seats_used).toBe(1);
  });

  test("bad-credential login is rejected with 401", async () => {
    const r = await post("/admin/org", {
      name: `Beta ${crypto.randomUUID()}`,
      plan: "personal",
      seat_limit: 1,
      admin_email: `beta-${crypto.randomUUID()}@beta.test`,
      admin_password: "beta-password-1234",
    });
    expect(r.status).toBe(201);
    const bad = await post("/auth/login", { email: r.json.admin.email, password: "wrong-password!!" });
    expect(bad.status).toBe(401);
    expect(bad.json.error).toBe("invalid_credentials");
  });

  test("audit log records the licensing events", async () => {
    const a = await post("/org/audit", {}, adminAccess);
    expect(a.status).toBe(200);
    const actions = (a.json.events as Array<{ action: string }>).map((e) => e.action);
    expect(actions).toContain("seat.activate");
    expect(actions).toContain("seat.revoke");
    expect(actions).toContain("org.create");
  });
});
