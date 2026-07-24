import { describe, expect, test } from "bun:test";
import { signAccessJwt } from "../src/lib/crypto.ts";
import { authenticate } from "../src/lib/http.ts";
import { issueAuthTokens, refreshAuthTokens } from "../src/lib/services.ts";
import { makeFixture } from "./fixtures.ts";
import { config } from "../src/lib/config.ts";

function request(token: string) { return new Request("http://test/auth/me", { headers: { authorization: `Bearer ${token}` } }); }

describe("live access-session boundary", () => {
  test("accepts a current session but rejects sid-less, revoked, rotated, and suspended identities", () => {
    const { store, org, admin } = makeFixture();
    const first = issueAuthTokens(store, admin);
    expect(authenticate(request(first.access_token), store).ok).toBe(true);
    const now = Math.floor(Date.now() / 1000);
    const sidless = signAccessJwt({ sub: admin.user_id, org_id: org.org_id, role: "admin", email: admin.email, iss: config.issuer, iat: now, exp: now + 60, typ: "access" });
    expect(authenticate(request(sidless), store).ok).toBe(false);
    const rotated = refreshAuthTokens(store, first.refresh_token);
    expect(rotated.ok).toBe(true);
    expect(authenticate(request(first.access_token), store).ok).toBe(false);
    if (rotated.ok) expect(authenticate(request(rotated.tokens.access_token), store).ok).toBe(true);
    store.setOrgStatus(org.org_id, "suspended");
    if (rotated.ok) expect(authenticate(request(rotated.tokens.access_token), store).ok).toBe(false);
  });

  test("uses the current database role instead of a stale signed role", () => {
    const { store, admin } = makeFixture();
    const token = issueAuthTokens(store, admin).access_token;
    store.db.query("UPDATE users SET role = 'member' WHERE user_id = ?").run(admin.user_id);
    const auth = authenticate(request(token), store);
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.claims.role).toBe("member");
  });
});
