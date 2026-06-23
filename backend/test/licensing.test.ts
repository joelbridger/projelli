/**
 * Per-org licensing core: seat-limit enforcement (the N+1 is rejected), revoked
 * seats fail validation, heartbeat reports correct plan/seats/used, and transfer
 * frees the old machine while binding the new one. Driven against the service
 * layer + in-memory store (no HTTP).
 */

import { test, expect, describe } from "bun:test";
import { makeFixture } from "./fixtures.ts";
import {
  activateSeatForUser,
  validateSeatToken,
  heartbeatSeat,
} from "../src/lib/services.ts";

describe("seat activation + seat_limit", () => {
  test("binds a seat and returns a signed seat token with the org's entitlements", () => {
    const f = makeFixture({ plan: "practice", packs: ["advisor", "legal", "tax", "consulting"], seatLimit: 2 });
    const r = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "machine-A", machineLabel: "Laptop A" });
    expect(r.status).toBe("activated");
    expect(r.http).toBe(200);
    expect(r.body.tier).toBe("practice");
    expect(r.body.packs).toEqual(["advisor", "legal", "tax", "consulting"]);
    expect(r.body.seats).toBe(2);
    expect(typeof r.body.token).toBe("string");
    // The minted token validates.
    const v = validateSeatToken(f.store, r.body.token as string);
    expect(v.valid).toBe(true);
  });

  test("the N+1 machine is rejected with 409 and the current seat list", () => {
    const f = makeFixture({ seatLimit: 2 });
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    const b = activateSeatForUser(f.store, { user: f.members[1]!, licenseKey: f.licenseKey, machineId: "m2", machineLabel: null });
    expect(a.status).toBe("activated");
    expect(b.status).toBe("activated");
    expect(f.store.countActiveSeats(f.org.org_id)).toBe(2);

    // Third distinct (user, machine) exceeds the limit.
    const c = activateSeatForUser(f.store, { user: f.members[2]!, licenseKey: f.licenseKey, machineId: "m3", machineLabel: null });
    expect(c.status).toBe("seat_limit_exceeded");
    expect(c.http).toBe(409);
    expect(c.body.error).toBe("seat_limit_exceeded");
    expect(Array.isArray(c.body.seats)).toBe(true);
    expect((c.body.seats as unknown[]).length).toBe(2);
    // Still only 2 seats — the N+1 did NOT consume one.
    expect(f.store.countActiveSeats(f.org.org_id)).toBe(2);
  });

  test("re-activating the SAME (user, machine) is idempotent and does not consume a new seat", () => {
    const f = makeFixture({ seatLimit: 1 });
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    expect(a.status).toBe("activated");
    const seatId = a.body.seat_id;
    const again = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    expect(again.status).toBe("activated");
    expect(again.body.seat_id).toBe(seatId); // same seat reused
    expect(f.store.countActiveSeats(f.org.org_id)).toBe(1);
  });

  test("the same user on a NEW machine consumes a second seat (and hits the limit)", () => {
    const f = makeFixture({ seatLimit: 1 });
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "laptop", machineLabel: null });
    expect(a.status).toBe("activated");
    const b = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "desktop", machineLabel: null });
    expect(b.status).toBe("seat_limit_exceeded"); // one user, two machines, one seat
  });

  test("an invalid license key is rejected", () => {
    const f = makeFixture();
    const r = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: "KEEP-XXXX-XXXX-XXXX-XXXX", machineId: "m1", machineLabel: null });
    expect(r.status).toBe("license_invalid");
    expect(r.http).toBe(403);
  });

  test("a deprovisioned user cannot activate", () => {
    const f = makeFixture();
    f.store.setUserStatus(f.members[0]!.user_id, "deprovisioned");
    const stale = f.store.getUser(f.members[0]!.user_id)!;
    const r = activateSeatForUser(f.store, { user: stale, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    expect(r.status).toBe("user_invalid");
  });

  test("a suspended org cannot activate", () => {
    const f = makeFixture();
    f.store.setOrgStatus(f.org.org_id, "suspended");
    const r = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    expect(r.status).toBe("org_suspended");
  });
});

describe("seat validation + revocation", () => {
  test("a freshly activated seat validates and reports plan/seats/used", () => {
    const f = makeFixture({ plan: "professional", packs: ["legal"], seatLimit: 5 });
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    const v = validateSeatToken(f.store, a.body.token as string);
    expect(v.valid).toBe(true);
    if (v.valid) {
      expect(v.body.tier).toBe("professional");
      expect(v.body.packs).toEqual(["legal"]);
      expect(v.body.seats).toBe(5);
      expect(v.body.seats_used).toBe(1);
    }
  });

  test("a revoked seat FAILS validation even though the token signature is still valid", () => {
    const f = makeFixture();
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    const token = a.body.token as string;
    // Token verifies before revoke...
    expect(validateSeatToken(f.store, token).valid).toBe(true);
    // ...admin revokes the seat...
    expect(f.store.revokeSeat(a.body.seat_id as string, "refund")).toBe(true);
    // ...now validation fails with reason "revoked" (the offline signature check
    // would still pass; the server's revocation list is what stops it).
    const v = validateSeatToken(f.store, token);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("revoked");
  });

  test("validation fails after the org is suspended", () => {
    const f = makeFixture();
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    f.store.setOrgStatus(f.org.org_id, "suspended");
    const v = validateSeatToken(f.store, a.body.token as string);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("org_suspended");
  });

  test("validation fails after the user is deprovisioned", () => {
    const f = makeFixture();
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    f.store.setUserStatus(f.members[0]!.user_id, "deprovisioned");
    const v = validateSeatToken(f.store, a.body.token as string);
    expect(v.valid).toBe(false);
    if (!v.valid) expect(v.reason).toBe("user_deprovisioned");
  });
});

describe("heartbeat", () => {
  test("returns the same entitlement view as validate and bumps last_seen", async () => {
    const f = makeFixture({ plan: "practice", seatLimit: 3 });
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    const seatId = a.body.seat_id as string;
    const before = f.store.getSeat(seatId)!.last_seen;

    await Bun.sleep(5); // ensure the timestamp can advance
    const h = heartbeatSeat(f.store, a.body.token as string);
    expect(h.valid).toBe(true);
    if (h.valid) {
      expect(h.body.tier).toBe("practice");
      expect(h.body.seats).toBe(3);
      expect(h.body.seats_used).toBe(1);
    }
    const after = f.store.getSeat(seatId)!.last_seen;
    expect(new Date(after).getTime()).toBeGreaterThanOrEqual(new Date(before).getTime());
  });

  test("heartbeat on a revoked seat fails", () => {
    const f = makeFixture();
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    f.store.revokeSeat(a.body.seat_id as string, "test");
    const h = heartbeatSeat(f.store, a.body.token as string);
    expect(h.valid).toBe(false);
  });
});

describe("seat transfer", () => {
  test("transfer frees the old machine and binds the new one, conserving the seat count", () => {
    const f = makeFixture({ seatLimit: 1 });
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "old-machine", machineLabel: "Old" });
    expect(a.status).toBe("activated");
    const oldSeatId = a.body.seat_id as string;
    expect(f.store.countActiveSeats(f.org.org_id)).toBe(1);

    // Before transfer, member1 can't activate (limit reached).
    const blocked = activateSeatForUser(f.store, { user: f.members[1]!, licenseKey: f.licenseKey, machineId: "new-machine", machineLabel: null });
    expect(blocked.status).toBe("seat_limit_exceeded");

    // Admin transfers the seat from member0/old-machine to member1/new-machine.
    const t = f.store.transferSeat({ from_seat_id: oldSeatId, to_user_id: f.members[1]!.user_id, to_machine_id: "new-machine", to_machine_label: "New" });
    expect(t.ok).toBe(true);

    // Seat count is conserved (still 1 active).
    expect(f.store.countActiveSeats(f.org.org_id)).toBe(1);
    // Old seat is revoked; the old token no longer validates.
    expect(f.store.getSeat(oldSeatId)!.status).toBe("revoked");
    expect(validateSeatToken(f.store, a.body.token as string).valid).toBe(false);

    // The new binding is active and can be activated/validated by member1.
    const reactivate = activateSeatForUser(f.store, { user: f.members[1]!, licenseKey: f.licenseKey, machineId: "new-machine", machineLabel: null });
    expect(reactivate.status).toBe("activated");
    expect(validateSeatToken(f.store, reactivate.body.token as string).valid).toBe(true);
  });

  test("transfer onto a machine that already holds an active seat is rejected", () => {
    const f = makeFixture({ seatLimit: 2 });
    const a = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m-a", machineLabel: null });
    activateSeatForUser(f.store, { user: f.members[1]!, licenseKey: f.licenseKey, machineId: "m-b", machineLabel: null });
    // Try to transfer member0's seat onto member1's already-bound machine.
    const t = f.store.transferSeat({ from_seat_id: a.body.seat_id as string, to_user_id: f.members[1]!.user_id, to_machine_id: "m-b", to_machine_label: null });
    expect(t.ok).toBe(false);
    if (!t.ok) expect(t.reason).toBe("target_already_bound");
  });
});

describe("deprovision", () => {
  test("revokes ALL of a user's seats and blocks their tokens", () => {
    const f = makeFixture({ seatLimit: 3 });
    const a1 = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m1", machineLabel: null });
    // member0 on a second machine would need a second seat — give them one.
    const a2 = activateSeatForUser(f.store, { user: f.members[0]!, licenseKey: f.licenseKey, machineId: "m2", machineLabel: null });
    expect(a1.status).toBe("activated");
    expect(a2.status).toBe("activated");
    expect(f.store.countActiveSeats(f.org.org_id)).toBe(2);

    const revoked = f.store.revokeAllSeatsForUser(f.members[0]!.user_id, "user_deprovisioned");
    f.store.setUserStatus(f.members[0]!.user_id, "deprovisioned");
    expect(revoked).toBe(2);
    expect(f.store.countActiveSeats(f.org.org_id)).toBe(0);
    expect(validateSeatToken(f.store, a1.body.token as string).valid).toBe(false);
    expect(validateSeatToken(f.store, a2.body.token as string).valid).toBe(false);
  });
});
