import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { Store } from "../src/lib/db.ts";
import { buildServeOptions } from "../src/server.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import { config } from "../src/lib/config.ts";

const paths: string[] = [];
afterEach(() => paths.splice(0).forEach((path) => {
  rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true });
}));

describe("durable migration manifest bridge", () => {
  test("keeps the shared bridge through per-user acknowledgements, then purges it only at expiry", async () => {
    const path = `/tmp/firm-relay-manifest-${crypto.randomUUID()}.sqlite`; paths.push(path);
    let store = new Store(path);
    const orgA = store.createOrg({ name: "A", plan: "practice", packs: ["advisor"], seat_limit: 3 });
    const orgB = store.createOrg({ name: "B", plan: "practice", packs: ["advisor"], seat_limit: 3 });
    const userA = store.createUser({ org_id: orgA.org_id, email: "a@firm.test", password_hash: "x", role: "member" });
    const userA2 = store.createUser({ org_id: orgA.org_id, email: "a2@firm.test", password_hash: "x", role: "member" });
    const userB = store.createUser({ org_id: orgB.org_id, email: "b@firm.test", password_hash: "x", role: "member" });
    const sealed = store.createMatter({ org_id: orgA.org_id });
    const unsealed = store.createMatter({ org_id: orgA.org_id });
    const other = store.createMatter({ org_id: orgB.org_id });
    for (const [matter, user, org] of [[sealed, userA, orgA], [sealed, userA2, orgA], [unsealed, userA, orgA], [other, userB, orgB]] as const) {
      store.addMatterMember({ matter_handle: matter.matter_handle, user_id: user.user_id, org_id: org.org_id, role: "owner" });
      store.setMatterStatus(matter.matter_handle, "active");
    }
    const insert = store.db.query("INSERT INTO firm_relay_migration_manifest (legacy_matter_id,matter_handle,root_stream_handle,streams_json,expires_at) VALUES (?,?,?,?,?)");
    // A row created an hour ago must still be served during the default 7-day
    // bridge. This catches accidental seconds-vs-milliseconds conversion.
    expect(config.migrationManifestTtlMs).toBe(7 * 24 * 60 * 60 * 1_000);
    const expiry = new Date(Date.now() - 60 * 60 * 1_000 + config.migrationManifestTtlMs).toISOString();
    insert.run("LEGACY_A_SEALED", sealed.matter_handle, sealed.root_stream_handle, JSON.stringify({ _notes: sealed.root_stream_handle }), expiry);
    insert.run("LEGACY_A_UNSEALED", unsealed.matter_handle, unsealed.root_stream_handle, JSON.stringify({ _notes: unsealed.root_stream_handle }), expiry);
    insert.run("LEGACY_B_OTHER_ORG", other.matter_handle, other.root_stream_handle, JSON.stringify({ _notes: other.root_stream_handle }), expiry);
    // This user remains a member, but the ethical wall must win just as it
    // does for every normal relay route.
    store.setEthicalWall({ matter_handle: unsealed.matter_handle, user_id: userA.user_id, org_id: orgA.org_id, created_by: userA2.user_id });

    // The bridge survives the actual durable-store lifecycle, not merely a Map.
    store.close(); store = new Store(path);
    const seatA = store.activateSeat({ org_id: orgA.org_id, user_id: userA.user_id, machine_id: "a", machine_label: null, seat_limit: 3 });
    const seatA2 = store.activateSeat({ org_id: orgA.org_id, user_id: userA2.user_id, machine_id: "a2", machine_label: null, seat_limit: 3 });
    const seatB = store.activateSeat({ org_id: orgB.org_id, user_id: userB.user_id, machine_id: "b", machine_label: null, seat_limit: 3 });
    if (!seatA.ok || !seatA2.ok || !seatB.ok) throw new Error("seat activation failed");
    const tokenA = issueAuthTokens(store, userA).access_token;
    const tokenA2 = issueAuthTokens(store, userA2).access_token;
    const tokenB = issueAuthTokens(store, userB).access_token;
    const seatTokenA = mintSeatToken(store.getOrg(orgA.org_id)!, userA, seatA.seat).token;
    const seatTokenA2 = mintSeatToken(store.getOrg(orgA.org_id)!, userA2, seatA2.seat).token;
    const seatTokenB = mintSeatToken(store.getOrg(orgB.org_id)!, userB, seatB.seat).token;
    const server = Bun.serve(buildServeOptions(store, new FanoutHub()));
    const base = `http://${server.hostname}:${server.port}`;
    const post = async (route: string, token: string, seat: string, body: unknown = {}) => {
      const response = await fetch(`${base}${route}`, { method: "POST", headers: { authorization: `Bearer ${token}`, "x-seat-token": seat, "content-type": "application/json" }, body: JSON.stringify(body) });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    };
    try {
      const first = await post("/v2/firm/migration-manifest", tokenA, seatTokenA);
      const second = await post("/v2/firm/migration-manifest", tokenA, seatTokenA);
      const otherOrg = await post("/v2/firm/migration-manifest", tokenB, seatTokenB);
      expect(first).toEqual(second);
      expect(JSON.stringify(first.body)).toContain("LEGACY_A_SEALED");
      expect(JSON.stringify(first.body)).not.toContain("LEGACY_A_UNSEALED");
      expect(JSON.stringify(first.body)).not.toContain("LEGACY_B_OTHER_ORG");
      expect(JSON.stringify(otherOrg.body)).toContain("LEGACY_B_OTHER_ORG");
      expect(JSON.stringify(otherOrg.body)).not.toContain("LEGACY_A_SEALED");

      expect(await post("/v2/firm/migration-complete", tokenA, seatTokenA)).toMatchObject({ status: 200, body: { ok: true } });
      const afterAck = await post("/v2/firm/migration-manifest", tokenA, seatTokenA);
      const afterAckAgain = await post("/v2/firm/migration-manifest", tokenA, seatTokenA);
      const afterAckSecondUser = await post("/v2/firm/migration-manifest", tokenA2, seatTokenA2);
      expect(JSON.stringify(afterAck.body)).toContain("LEGACY_A_SEALED");
      expect(afterAckAgain).toEqual(afterAck);
      expect(JSON.stringify(afterAckSecondUser.body)).toContain("LEGACY_A_SEALED");
      expect(store.db.query("SELECT matter_handle, user_id FROM firm_relay_migration_manifest_acknowledgements WHERE matter_handle = ?").all(sealed.matter_handle)).toEqual([{ matter_handle: sealed.matter_handle, user_id: userA.user_id }]);

      store.db.query("UPDATE firm_relay_migration_manifest SET expires_at = ?").run(new Date(Date.now() - 1).toISOString());
      expect((await post("/v2/firm/migration-manifest", tokenA, seatTokenA)).body).toEqual({ matters: [] });
      expect((await post("/v2/firm/migration-manifest", tokenB, seatTokenB)).body).toEqual({ matters: [] });
      expect(store.db.query("SELECT * FROM firm_relay_migration_manifest_acknowledgements").all()).toEqual([]);

      const normal = await post("/v2/firm/matters/mine", tokenA, seatTokenA);
      const visibleOutsideManifest = JSON.stringify({ normal, audit: store.listAudit(orgA.org_id) });
      expect(visibleOutsideManifest).not.toMatch(/LEGACY_A_SEALED|LEGACY_A_UNSEALED|LEGACY_B_OTHER_ORG/);
      for (const sentinel of ["LEGACY_A_SEALED", "LEGACY_A_UNSEALED", "LEGACY_B_OTHER_ORG"]) {
        const hits = store.db.query(`SELECT 'audit' AS source FROM audit_events WHERE target = ? OR detail = ?
          UNION ALL SELECT name AS source FROM sqlite_master WHERE type = 'table' AND name <> 'firm_relay_migration_manifest'
            AND 0`).all(sentinel, sentinel);
        expect(hits).toEqual([]);
      }
    } finally { server.stop(true); store.close(); }
  });
});
