import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";

const paths: string[] = [];
afterEach(() => paths.splice(0).forEach((path) => rmSync(path, { force: true })));

const firmApiClientModule = "../../src/platform/firm/FirmApiClient.ts";
const bridgeModule = "../../src/platform/firm/legacyFirmManifestBridge.ts";
const cryptoModule = "../../src/platform/firm/matterCrypto.ts";

function createLegacyRelay(path: string): { adminId: string; memberId: string; walledId: string } {
  const bootstrap = new Store(path);
  const org = bootstrap.createOrg({ name: "Legacy bridge proof", plan: "practice", packs: ["advisor"], seat_limit: 4 });
  bootstrap.db.query("UPDATE orgs SET org_id = 'org' WHERE org_id = ?").run(org.org_id);
  const admin = bootstrap.createUser({ org_id: "org", email: "admin@bridge.test", password_hash: "x", role: "admin" });
  const member = bootstrap.createUser({ org_id: "org", email: "member@bridge.test", password_hash: "x", role: "member" });
  const walled = bootstrap.createUser({ org_id: "org", email: "walled@bridge.test", password_hash: "x", role: "member" });
  bootstrap.close();

  const db = new Database(path);
  db.exec(`
    PRAGMA foreign_keys = OFF;
    DROP TABLE firm_relay_migration_manifest_acknowledgements;
    DROP TABLE firm_relay_migration_manifest;
    DROP TABLE wrapped_matter_keys;
    DROP TABLE matter_updates;
    DROP TABLE ethical_walls;
    DROP TABLE matter_members;
    DROP TABLE matter_streams;
    DROP TABLE matters;
    CREATE TABLE matters (matter_id TEXT PRIMARY KEY, org_id TEXT, client_name TEXT, status TEXT, key_epoch INTEGER, created_at TEXT);
    CREATE TABLE matter_members (matter_id TEXT, user_id TEXT, org_id TEXT, role TEXT, created_at TEXT);
    CREATE TABLE ethical_walls (matter_id TEXT, user_id TEXT, org_id TEXT, reason TEXT, created_by TEXT, created_at TEXT);
    CREATE TABLE matter_updates (id INTEGER PRIMARY KEY, matter_id TEXT, org_id TEXT, doc_id TEXT, blob_id TEXT, ciphertext BLOB, author_seat TEXT, key_epoch INTEGER, created_at TEXT);
    CREATE TABLE wrapped_matter_keys (matter_id TEXT, epoch INTEGER, user_id TEXT, device_id TEXT, wrapped_key_b64 TEXT, published_by TEXT, created_at TEXT);
  `);
  for (const legacyMatterId of ["legacy-admin", "legacy-member", "legacy-walled"]) {
    db.query("INSERT INTO matters VALUES (?, 'org', 'never leaves this device', 'active', 1, 'now')").run(legacyMatterId);
  }
  // The admin-created record has no membership row. The relay's admin policy,
  // rather than a lucky membership row, is what must make it migratable.
  db.query("INSERT INTO matter_members VALUES ('legacy-member', ?, 'org', 'owner', 'now')").run(member.user_id);
  db.query("INSERT INTO matter_members VALUES ('legacy-walled', ?, 'org', 'owner', 'now')").run(walled.user_id);
  db.query("INSERT INTO ethical_walls VALUES ('legacy-walled', ?, 'org', 'screened', ?, 'now')").run(walled.user_id, admin.user_id);
  db.close();
  return { adminId: admin.user_id, memberId: member.user_id, walledId: walled.user_id };
}

function legacyLocalMatter(id: string, legacyFirmMatterId: string) {
  return {
    id,
    name: `${id} household`,
    client: `${id} private client`,
    folderPaths: [],
    mailFolderPaths: [],
    createdAt: "2026-01-01T00:00:00Z",
    firmMatterId: legacyFirmMatterId,
    shared: true,
  };
}

describe("firm relay legacy bridge proof", () => {
  test("real client and bridge honor seat auth plus the admin-or-member-and-not-walled rule", async () => {
    const path = `/tmp/firm-relay-bridge-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const ids = createLegacyRelay(path);
    const store = new Store(path);
    const admin = store.getUser(ids.adminId)!;
    const member = store.getUser(ids.memberId)!;
    const walled = store.getUser(ids.walledId)!;
    const org = store.getOrg("org")!;
    const adminSeat = store.activateSeat({ org_id: "org", user_id: admin.user_id, machine_id: "admin-device", machine_label: null, seat_limit: 4 });
    const memberSeat = store.activateSeat({ org_id: "org", user_id: member.user_id, machine_id: "member-device", machine_label: null, seat_limit: 4 });
    const walledSeat = store.activateSeat({ org_id: "org", user_id: walled.user_id, machine_id: "walled-device", machine_label: null, seat_limit: 4 });
    if (!adminSeat.ok || !memberSeat.ok || !walledSeat.ok) throw new Error("test seat activation failed");
    const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
    const base = `http://${server.hostname}:${server.port}`;
    const priorBase = process.env.VITE_FIRM_API_BASE;
    process.env.VITE_FIRM_API_BASE = base;

    try {
      const [{ FirmApiClient }, { runLegacyFirmManifestBridge }, { generateMatterKey }] = await Promise.all([
        import(firmApiClientModule),
        import(bridgeModule),
        import(cryptoModule),
      ]);
      const tokenFor = (user: typeof admin) => issueAuthTokens(store, user).access_token;
      const adminSeatToken = mintSeatToken(org, admin, adminSeat.seat).token;
      const memberSeatToken = mintSeatToken(org, member, memberSeat.seat).token;
      const walledSeatToken = mintSeatToken(org, walled, walledSeat.seat).token;
      const clientFor = (token: string) => new FirmApiClient({ getAccessToken: () => token, refreshAccessToken: async () => null });

      const adminClient = clientFor(tokenFor(admin));
      const memberClient = clientFor(tokenFor(member));
      const walledClient = clientFor(tokenFor(walled));

      // The real HTTP client must carry a seat token to the real Bun handler.
      await expect(adminClient.migrationManifest("")).rejects.toMatchObject({ status: 401, code: "seat_required" });
      await expect(adminClient.migrationManifest(adminSeatToken)).resolves.toMatchObject({
        matters: expect.arrayContaining([expect.objectContaining({ legacy_matter_id: "legacy-admin" })]),
      });
      await expect(memberClient.migrationManifest(memberSeatToken)).resolves.toEqual({
        matters: [expect.objectContaining({ legacy_matter_id: "legacy-member" })],
      });
      await expect(walledClient.migrationManifest(walledSeatToken)).resolves.toEqual({ matters: [] });

      let adminMatters = [legacyLocalMatter("admin-local", "legacy-admin")];
      const adminResult = await runLegacyFirmManifestBridge({
        client: adminClient,
        seatToken: adminSeatToken,
        getMatters: () => adminMatters,
        saveMatter: (matter: typeof adminMatters[number]) => { adminMatters = adminMatters.map((current) => current.id === matter.id ? matter : current); },
        createPlaceholder: () => undefined,
        loadLegacyMatterKey: async () => generateMatterKey(),
        storeOpaqueMatterKey: async () => undefined,
        clearLegacyMatterKey: async () => undefined,
      });
      let memberMatters = [legacyLocalMatter("member-local", "legacy-member")];
      const memberResult = await runLegacyFirmManifestBridge({
        client: memberClient,
        seatToken: memberSeatToken,
        getMatters: () => memberMatters,
        saveMatter: (matter: typeof memberMatters[number]) => { memberMatters = memberMatters.map((current) => current.id === matter.id ? matter : current); },
        createPlaceholder: () => undefined,
        loadLegacyMatterKey: async () => generateMatterKey(),
        storeOpaqueMatterKey: async () => undefined,
        clearLegacyMatterKey: async () => undefined,
      });

      expect(adminResult).toMatchObject({ status: "completed", migratedMatterIds: ["admin-local"] });
      expect(memberResult).toMatchObject({ status: "completed", migratedMatterIds: ["member-local"] });
      // The previously missing admin-created link now stays linked. Neither
      // authorized device is stripped simply because it lacks a member row.
      for (const matter of [...adminMatters, ...memberMatters]) {
        expect(matter.shared).toBe(true);
        expect(matter.firmMatterId).toMatch(/^mh2_/);
        expect(matter).not.toHaveProperty("legacyFirmMatterId");
      }
      const acknowledgements = store.db.query("SELECT matter_handle, user_id FROM firm_relay_migration_manifest_acknowledgements ORDER BY user_id, matter_handle").all() as Array<{ matter_handle: string; user_id: string }>;
      expect(acknowledgements.filter((ack) => ack.user_id === admin.user_id)).toHaveLength(3);
      expect(acknowledgements.filter((ack) => ack.user_id === member.user_id)).toHaveLength(1);
      expect(acknowledgements.some((ack) => ack.user_id === walled.user_id)).toBe(false);
    } finally {
      server.stop(true);
      store.close();
      if (priorBase === undefined) delete process.env.VITE_FIRM_API_BASE;
      else process.env.VITE_FIRM_API_BASE = priorBase;
    }
  });
});
