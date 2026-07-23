import { describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { hmacHash, verifyAccessJwt, signAccessJwt } from "../src/lib/crypto.ts";
import { authenticate } from "../src/lib/http.ts";
import { issueAuthTokens, refreshAuthTokens } from "../src/lib/services.ts";
import { SyncTicketStore } from "../src/lib/syncTickets.ts";
import { authorizeSyncConnect } from "../src/routes/matters.ts";
import type { AccessTokenClaims, User } from "../src/lib/types.ts";

function bearer(token: string): Request {
  return new Request("http://firm.test/protected", { headers: { authorization: `Bearer ${token}` } });
}

function seed(): { store: Store; org: ReturnType<Store["createOrg"]>; user: User } {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Live Authority", plan: "practice", packs: [], seat_limit: 4 });
  const user = store.createUser({ org_id: org.org_id, email: "admin@live.test", password_hash: "not-used", role: "admin" });
  return { store, org, user };
}

function sid(token: string): string {
  const decoded = verifyAccessJwt<AccessTokenClaims>(token);
  expect(decoded.valid).toBe(true);
  if (!decoded.valid) throw new Error("test token did not verify");
  return decoded.payload.sid;
}

describe("live access-session authority boundary", () => {
  test("logout, rotation, explicit revocation, deprovisioning, and suspension deny an already-issued access token", () => {
    const cases: Array<{ name: string; invalidate: (store: Store, user: User, access: string, refresh: string) => void }> = [
      { name: "logout", invalidate: (store, _user, _access, refresh) => store.revokeRefreshToken(store.getRefreshTokenByHash(hmacHash(refresh))!.token_id) },
      { name: "rotation", invalidate: (store, _user, _access, refresh) => { expect(refreshAuthTokens(store, refresh).ok).toBe(true); } },
      { name: "explicit session revocation", invalidate: (store, _user, access) => store.revokeRefreshToken(sid(access)) },
      { name: "deprovisioning", invalidate: (store, user) => store.setUserStatus(user.user_id, "deprovisioned") },
      { name: "firm suspension", invalidate: (store, user) => store.setOrgStatus(user.org_id, "suspended") },
    ];

    for (const c of cases) {
      const { store, user } = seed();
      const tokens = issueAuthTokens(store, user);
      expect(authenticate(bearer(tokens.access_token), store).ok, c.name).toBe(true);
      c.invalidate(store, user, tokens.access_token, tokens.refresh_token);
      expect(authenticate(bearer(tokens.access_token), store).ok, c.name).toBe(false);
    }
  });

  test("uses the current live role instead of the role captured in the JWT", () => {
    const { store, user } = seed();
    const tokens = issueAuthTokens(store, user);
    store.db.query("UPDATE users SET role = 'member' WHERE user_id = ?").run(user.user_id);
    const auth = authenticate(bearer(tokens.access_token), store);
    expect(auth.ok).toBe(true);
    if (auth.ok) expect(auth.claims.role).toBe("member");
  });

  test("fails closed for a sid-less old access token and for an authority-store read failure", () => {
    const { store, user } = seed();
    const now = Math.floor(Date.now() / 1000);
    const legacy = signAccessJwt({ sub: user.user_id, org_id: user.org_id, role: "admin", email: user.email, iss: "keepance-firm", iat: now, exp: now + 300, typ: "access" });
    expect(authenticate(bearer(legacy), store).ok).toBe(false);

    const tokens = issueAuthTokens(store, user);
    const original = store.getRefreshTokenById.bind(store);
    store.getRefreshTokenById = (() => { throw new Error("read unavailable"); }) as Store["getRefreshTokenById"];
    expect(authenticate(bearer(tokens.access_token), store).ok).toBe(false);
    store.getRefreshTokenById = original;
  });

  test("login-equivalent issuance and refresh refuse inactive organizations", () => {
    const { store, org, user } = seed();
    const first = issueAuthTokens(store, user);
    store.setOrgStatus(org.org_id, "suspended");
    expect(refreshAuthTokens(store, first.refresh_token)).toMatchObject({ ok: false, reason: "org_inactive" });
    expect(() => issueAuthTokens(store, user)).toThrow("inactive_auth_subject");
  });

  test("a sync ticket minted before session revocation cannot connect", () => {
    const { store, org, user } = seed();
    const matter = store.createMatter({ org_id: org.org_id, client_name: "Retired household" });
    store.addMatterMember({ matter_id: matter.matter_id, user_id: user.user_id, org_id: org.org_id, role: "owner" });
    const tokens = issueAuthTokens(store, user);
    const tickets = new SyncTicketStore();
    const ticket = tickets.mint({ matterId: matter.matter_id, orgId: org.org_id, userId: user.user_id, seatId: "seat", role: "admin", sid: sid(tokens.access_token) }).ticket;
    store.revokeRefreshToken(sid(tokens.access_token));
    const result = authorizeSyncConnect(new Request(`http://firm.test/matter/${matter.matter_id}/sync?ticket=${ticket}`, { headers: { upgrade: "websocket" } }), store, matter.matter_id, tickets);
    expect(result.ok).toBe(false);
  });
});
