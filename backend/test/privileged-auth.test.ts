/** Behavioural proof for the privileged-route front door. */

import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import net from "node:net";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";
import { createPrivilegedRoutes } from "../src/routes/privileged.ts";
import { handleCreateOrg } from "../src/routes/admin.ts";
import { issueAuthTokens } from "../src/lib/services.ts";
import type { HttpRequest } from "../src/lib/requestBody.ts";

const store = new Store(":memory:");
const routes = createPrivilegedRoutes(store);
const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
const base = `http://127.0.0.1:${server.port}`;

const materialize = (path: string): string => path.replace(":matterId", "missing-target");
const count = (table: "orgs" | "users"): number => (store.db.query(`SELECT COUNT(*) AS n FROM ${table}`).get() as { n: number }).n;

async function request(method: string, path: string, bearer?: string, body: unknown = {}): Promise<{ status: number; text: string; json: Record<string, any> }> {
  const response = await fetch(`${base}${path}`, {
    method,
    headers: {
      ...(method === "GET" ? {} : { "content-type": "application/json" }),
      ...(bearer ? { authorization: `Bearer ${bearer}` } : {}),
    },
    ...(method === "GET" ? {} : { body: JSON.stringify(body) }),
  });
  const text = await response.text();
  return { status: response.status, text, json: JSON.parse(text) as Record<string, any> };
}

/**
 * Send headers declaring a chunked body, then deliberately send zero body
 * bytes. A route that tries to read/validate the body will wait and time out;
 * a pre-body auth gate answers immediately.
 */
function stalledBodyProbe(path: string, bearer?: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const socket = net.connect(server.port!, "127.0.0.1");
    const timer = setTimeout(() => {
      socket.destroy();
      reject(new Error(`privileged route waited for an unauthenticated body: ${path}`));
    }, 2_000);
    socket.on("connect", () => {
      socket.write(
        `POST ${path} HTTP/1.1\r\nHost: 127.0.0.1:${server.port}\r\nContent-Type: application/json\r\n` +
        (bearer ? `Authorization: Bearer ${bearer}\r\n` : "") +
        "Transfer-Encoding: chunked\r\nConnection: close\r\n\r\n",
      );
    });
    socket.on("data", (data) => {
      clearTimeout(timer);
      socket.destroy();
      resolve(data.toString("latin1").split("\r\n")[0] ?? "");
    });
    socket.on("error", (cause) => {
      clearTimeout(timer);
      reject(cause);
    });
  });
}

afterAll(() => server.stop(true));

describe("privileged routes are auth-by-construction", () => {
  test("registry enumerates 27 unique privileged route methods with declared auth", () => {
    expect(routes).toHaveLength(27);
    expect(new Set(routes.map((route) => `${route.method} ${route.path}`)).size).toBe(27);
    expect(routes.filter((route) => route.auth === "provisioning").map((route) => `${route.method} ${route.path}`)).toEqual(["POST /admin/org"]);
    expect(routes.filter((route) => route.auth === "admin")).toHaveLength(26);
    expect(routes.every((route) => route.purpose.length > 10)).toBe(true);
  });

  test("every privileged method refuses unauthenticated requests without creating an org or user", async () => {
    expect(count("orgs")).toBe(0);
    expect(count("users")).toBe(0);
    for (const route of routes) {
      const result = await request(route.method, materialize(route.path));
      expect(result.status, `${route.method} ${route.path}`).toBe(401);
      expect(result.text, `${route.method} ${route.path}`).toBe('{"error":"unauthorized"}');
    }
    expect(count("orgs")).toBe(0);
    expect(count("users")).toBe(0);
  });

  test("wrong credentials are refused before every POST body is read", async () => {
    const postRoutes = routes.filter((route) => route.method === "POST");
    expect(postRoutes).toHaveLength(26);
    for (const route of postRoutes) {
      const status = await stalledBodyProbe(materialize(route.path), "wrong-credential");
      expect(status, `${route.method} ${route.path}`).toContain(" 401 ");
    }
    expect(count("orgs")).toBe(0);
    expect(count("users")).toBe(0);
  });

  test("the provisioning handler itself refuses before touching its body", async () => {
    let bodyPulled = false;
    const requestWithTrap = {
      url: "http://127.0.0.1/admin/org",
      method: "POST",
      headers: new Headers({ "content-type": "application/json" }),
      signal: new AbortController().signal,
      get body() {
        bodyPulled = true;
        throw new Error("body must not be pulled before provisioning auth");
      },
    } as unknown as HttpRequest;
    const response = await handleCreateOrg(requestWithTrap, store);
    expect(response.status).toBe(401);
    expect(bodyPulled).toBe(false);
  });

  test("valid identity but missing seat is refused before checkpoint and notification bodies", async () => {
    const org = store.createOrg({ name: "Header Gate Test", plan: "practice", packs: [], seat_limit: 2 });
    const admin = store.createUser({ org_id: org.org_id, email: `header-admin-${crypto.randomUUID()}@test.invalid`, password_hash: "unused", role: "admin" });
    const access = issueAuthTokens(store, admin).access_token;
    const paths = [
      "/matter/missing/checkpoints/chunks",
      "/matter/missing/checkpoints/manifest",
      "/matter/missing/checkpoints/receipt",
      "/matter/missing/checkpoints/prune",
      "/notify/send",
      "/notify/ack",
      "/notify/sync-ticket",
      "/notify/terminal",
    ];
    for (const path of paths) {
      expect(await stalledBodyProbe(path, access), path).toContain(" 401 ");
    }
    expect(await stalledBodyProbe("/matter/missing/updates", "wrong-access-token")).toContain(" 401 ");
  });

  test("a correctly authenticated provisioning request still creates an org and admin", async () => {
    const orgsBefore = count("orgs");
    const usersBefore = count("users");
    const email = `provisioned-${crypto.randomUUID()}@test.invalid`;
    const result = await request("POST", "/admin/org", process.env.ADMIN_PROVISION_SECRET, {
      name: "Provisioned Test Firm",
      plan: "practice",
      packs: ["advisor"],
      seat_limit: 3,
      admin_email: email,
      admin_password: "provisioned-password-123",
    });
    expect(result.status).toBe(201);
    expect(result.json.admin.email).toBe(email);
    expect(result.json.license_key).toMatch(/^KEEP-/);
    expect(count("orgs")).toBe(orgsBefore + 1);
    expect(count("users")).toBe(usersBefore + 1);

    const login = await request("POST", "/auth/login", undefined, { email, password: "provisioned-password-123" });
    expect(login.status).toBe(200);
    const audit = await request("POST", "/org/audit", login.json.access_token, {});
    expect(audit.status).toBe(200);
    expect((audit.json.events as unknown[]).length).toBeGreaterThan(0);
  });

  test("a member gets the same refusal for an existing and missing target", async () => {
    const org = store.createOrg({ name: "Member Test", plan: "practice", packs: [], seat_limit: 2 });
    const memberEmail = `member-${crypto.randomUUID()}@test.invalid`;
    const member = store.createUser({ org_id: org.org_id, email: memberEmail, password_hash: "unused", role: "member" });
    const tokens = issueAuthTokens(store, member);
    const matter = store.createMatter({ org_id: org.org_id, client_name: "Existing" });

    const existing = await request("POST", `/matter/${matter.matter_id}/archive`, tokens.access_token);
    const missing = await request("POST", "/matter/no-such-matter/archive", tokens.access_token);
    expect(existing.status).toBe(403);
    expect(missing.status).toBe(403);
    expect(existing.text).toBe('{"error":"forbidden"}');
    expect(missing.text).toBe(existing.text);
  });
});
