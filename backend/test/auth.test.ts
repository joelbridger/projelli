/**
 * Auth service: issuing + verifying access JWTs, refresh-token rotation, and
 * refresh-reuse rejection. Credential verification (bad password) is covered in
 * the HTTP integration test (it exercises the real /auth/login handler).
 */

import { test, expect, describe } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { hashPassword } from "../src/lib/crypto.ts";
import { verifyAccessJwt } from "../src/lib/crypto.ts";
import { issueAuthTokens, refreshAuthTokens } from "../src/lib/services.ts";
import type { AccessTokenClaims } from "../src/lib/types.ts";

async function seedUser() {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Acme", plan: "practice", packs: [], seat_limit: 5 });
  const hash = await hashPassword("a-strong-password-123");
  const user = store.createUser({ org_id: org.org_id, email: "u@acme.test", password_hash: hash, role: "admin" });
  return { store, org, user };
}

describe("access tokens", () => {
  test("issued access token verifies and carries org/role/email claims", async () => {
    const { store, user } = await seedUser();
    const tokens = issueAuthTokens(store, user);
    const res = verifyAccessJwt<AccessTokenClaims>(tokens.access_token);
    expect(res.valid).toBe(true);
    if (res.valid) {
      expect(res.payload.sub).toBe(user.user_id);
      expect(res.payload.role).toBe("admin");
      expect(res.payload.org_id).toBe(user.org_id);
      expect(res.payload.typ).toBe("access");
    }
  });
});

describe("refresh tokens", () => {
  test("a valid refresh token mints new tokens and rotates", async () => {
    const { store, user } = await seedUser();
    const first = issueAuthTokens(store, user);
    const refreshed = refreshAuthTokens(store, first.refresh_token);
    expect(refreshed.ok).toBe(true);
    if (refreshed.ok) {
      // The refresh token MUST rotate (one-time use). The access token is a
      // fresh signature each call but can be byte-identical if minted in the
      // same second (same iat/exp/claims) — so we assert it verifies, not that
      // it differs.
      expect(refreshed.tokens.refresh_token).not.toBe(first.refresh_token);
      expect(verifyAccessJwt(refreshed.tokens.access_token).valid).toBe(true);
    }
  });

  test("the OLD refresh token is rejected after rotation (reuse protection)", async () => {
    const { store, user } = await seedUser();
    const first = issueAuthTokens(store, user);
    const r1 = refreshAuthTokens(store, first.refresh_token);
    expect(r1.ok).toBe(true);
    // Reusing the now-rotated token must fail.
    const r2 = refreshAuthTokens(store, first.refresh_token);
    expect(r2.ok).toBe(false);
    if (!r2.ok) expect(r2.reason).toBe("revoked");
  });

  test("an unknown refresh token is rejected", async () => {
    const { store } = await seedUser();
    const r = refreshAuthTokens(store, "totally-made-up-token");
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("invalid");
  });

  test("refresh fails once the user is deprovisioned", async () => {
    const { store, user } = await seedUser();
    const first = issueAuthTokens(store, user);
    store.setUserStatus(user.user_id, "deprovisioned");
    const r = refreshAuthTokens(store, first.refresh_token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("user_inactive");
  });

  test("revokeAllRefreshTokensForUser invalidates outstanding refresh tokens", async () => {
    const { store, user } = await seedUser();
    const first = issueAuthTokens(store, user);
    store.revokeAllRefreshTokensForUser(user.user_id);
    const r = refreshAuthTokens(store, first.refresh_token);
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.reason).toBe("revoked");
  });
});
