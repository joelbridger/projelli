import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { Store } from "../src/lib/db.ts";

const paths: string[] = [];
afterEach(() => paths.splice(0).forEach((path) => rmSync(path, { force: true })));

describe("file-backed v1 firm relay reset", () => {
  test("canonicalizes old device JWKs and removes devices with malformed coordinates", () => {
    const path = `/tmp/device-jwk-migration-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const initial = new Store(path);
    const org = initial.createOrg({ name: "Device migration", plan: "practice", packs: [], seat_limit: 2 });
    const user = initial.createUser({ org_id: org.org_id, email: "device-migration@test.invalid", password_hash: "x", role: "member" });
    const matter = initial.createMatter({ org_id: org.org_id });
    initial.upsertDevice({ device_id: "extra-fields", user_id: user.user_id, org_id: org.org_id, machine_id: "extra-machine", pubkey_jwk: "{}" });
    initial.upsertDevice({ device_id: "readable-coordinate", user_id: user.user_id, org_id: org.org_id, machine_id: "readable-machine", pubkey_jwk: "{}" });
    initial.close();

    const coordinate = "A".repeat(43);
    const legacy = new Database(path);
    legacy.query("UPDATE devices SET pubkey_jwk = ? WHERE device_id = ? AND user_id = ?")
      .run(JSON.stringify({ kty: "EC", crv: "P-256", x: coordinate, y: coordinate, note: "CLIENT_SECRET_NIMBUS" }), "extra-fields", user.user_id);
    legacy.query("UPDATE devices SET pubkey_jwk = ? WHERE device_id = ? AND user_id = ?")
      .run(JSON.stringify({ kty: "EC", crv: "P-256", x: "CLIENT_SECRET_NIMBUS", y: coordinate }), "readable-coordinate", user.user_id);
    legacy.query(`INSERT INTO wrapped_matter_keys (matter_handle, epoch, user_id, device_id, wrapped_key, published_by, created_at)
      VALUES (?, 1, ?, ?, ?, ?, ?)`)
      .run(matter.matter_handle, user.user_id, "readable-coordinate", new Uint8Array([1]), user.user_id, "2026-01-01T00:00:00.000Z");
    legacy.close();

    const reopened = new Store(path);
    try {
      expect(reopened.getDevice("extra-fields", user.user_id)?.pubkey_jwk).toBe(JSON.stringify({ kty: "EC", crv: "P-256", x: coordinate, y: coordinate }));
      expect(reopened.getDevice("readable-coordinate", user.user_id)).toBeNull();
      expect(reopened.inspectReadOnly().all("SELECT 1 FROM wrapped_matter_keys WHERE device_id = ? AND user_id = ?", "readable-coordinate", user.user_id)).toEqual([]);
    } finally {
      reopened.close();
    }
  });

  test("backfills only an unambiguous old intake handle and leaves a cross-org collision unbound", () => {
    const path = `/tmp/intake-handle-binding-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const initial = new Store(path);
    const orgA = initial.createOrg({ name: "A", plan: "practice", packs: [], seat_limit: 2 });
    const orgB = initial.createOrg({ name: "B", plan: "practice", packs: [], seat_limit: 2 });
    const adminA = initial.createUser({ org_id: orgA.org_id, email: "admin-a@migration.test", password_hash: "x", role: "admin" });
    const matterA = initial.createMatter({ org_id: orgA.org_id });
    const matterB = initial.createMatter({ org_id: orgB.org_id });
    initial.activateProvisioningMatter(matterA.matter_handle);
    initial.activateProvisioningMatter(matterB.matter_handle);
    initial.upsertDevice({ device_id: "admin-a-device", user_id: adminA.user_id, org_id: orgA.org_id, machine_id: "admin-a-machine", label: "", pubkey_jwk: JSON.stringify({ kty: "EC", crv: "P-256", x: "A".repeat(43), y: "A".repeat(43) }) });
    initial.close();

    const collision = `ih2_${"C".repeat(43)}`;
    const legacy = new Database(path);
    legacy.exec("DROP TABLE intake_handle_bindings");
    const legacyRows: Array<{ matter: string; org: string; user: string; device: string }> = [
      { matter: matterA.matter_handle, org: orgA.org_id, user: adminA.user_id, device: "legacy-a-device" },
      { matter: matterB.matter_handle, org: orgB.org_id, user: "legacy-b-user", device: "legacy-b-device" },
    ];
    for (const { matter, org, user, device } of legacyRows) {
      legacy.query(`INSERT INTO wrapped_intake_keys (intake_handle, matter_handle, org_id, epoch, user_id, device_id, wrapped_key, published_by, created_at)
        VALUES (?, ?, ?, 1, ?, ?, ?, ?, ?)`)
        .run(collision, matter, org, user, device, new Uint8Array([1]), user, "2026-01-01T00:00:00.000Z");
    }
    legacy.close();

    const reopened = new Store(path);
    try {
      const inspector = reopened.inspectReadOnly();
      expect(inspector.all("SELECT intake_handle FROM intake_handle_bindings WHERE intake_handle = ?", collision)).toEqual([]);
      expect(reopened.publishWrappedIntakeKeys({
        intake_handle: collision, matter_handle: matterA.matter_handle, org_id: orgA.org_id, epoch: 1, published_by: adminA.user_id,
        wrapped: [{ user_id: adminA.user_id, device_id: "admin-a-device", wrapped_key: new Uint8Array([2]) }],
      })).toMatchObject({ stored: 1 });
    } finally {
      reopened.close();
    }
  });

  test("backfills one old intake binding across epochs and recipients", () => {
    const path = `/tmp/intake-handle-binding-normal-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const initial = new Store(path);
    const org = initial.createOrg({ name: "Normal", plan: "practice", packs: [], seat_limit: 2 });
    const matter = initial.createMatter({ org_id: org.org_id });
    initial.close();

    const handle = `ih2_${"N".repeat(43)}`;
    const legacy = new Database(path);
    legacy.exec("DROP TABLE intake_handle_bindings");
    const legacyRows: Array<{ epoch: number; user: string; device: string; createdAt: string }> = [
      { epoch: 1, user: "user-one", device: "device-one", createdAt: "2026-01-02T00:00:00.000Z" },
      { epoch: 2, user: "user-two", device: "device-two", createdAt: "2026-01-01T00:00:00.000Z" },
    ];
    for (const { epoch, user, device, createdAt } of legacyRows) {
      legacy.query(`INSERT INTO wrapped_intake_keys (intake_handle, matter_handle, org_id, epoch, user_id, device_id, wrapped_key, published_by, created_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(handle, matter.matter_handle, org.org_id, epoch, user, device, new Uint8Array([1]), user, createdAt);
    }
    legacy.close();

    const reopened = new Store(path);
    try {
      expect(reopened.inspectReadOnly().all("SELECT intake_handle, matter_handle, org_id, created_at FROM intake_handle_bindings WHERE intake_handle = ?", handle)).toEqual([
        { intake_handle: handle, matter_handle: matter.matter_handle, org_id: org.org_id, created_at: "2026-01-01T00:00:00.000Z" },
      ]);
    } finally {
      reopened.close();
    }
  });

  test("drops a manifest table left by an already-v2 bridge build", () => {
    const path = `/tmp/firm-relay-v2-bridge-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const initial = new Store(path);
    initial.close();
    const bridge = new Database(path);
    bridge.exec("CREATE TABLE firm_relay_migration_manifest (legacy_matter_id TEXT NOT NULL)");
    bridge.query("INSERT INTO firm_relay_migration_manifest VALUES (?)").run("matter-semantic-123");
    bridge.close();

    const reopened = new Store(path);
    try {
      const tables = reopened.inspectReadOnly().all("SELECT name FROM sqlite_master WHERE type='table' AND name='firm_relay_migration_manifest'");
      expect(tables).toEqual([]);
    } finally {
      reopened.close();
    }
  }, 15_000);

  // File-backed SQLite setup occasionally waits through the configured 5 s
  // busy window on this shared QA host; the migration itself is deterministic.
  test("rebuilds legacy relay schema empty and retains no legacy identifier columns or blobs", () => {
    const path = `/tmp/firm-relay-v1-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const db = new Database(path);
    db.exec(`CREATE TABLE matters (matter_id TEXT PRIMARY KEY,org_id TEXT,client_name TEXT,status TEXT,key_epoch INTEGER,created_at TEXT);
      CREATE TABLE matter_members (matter_id TEXT,user_id TEXT,org_id TEXT,role TEXT,created_at TEXT);
      CREATE TABLE ethical_walls (matter_id TEXT,user_id TEXT,org_id TEXT,reason TEXT,created_by TEXT,created_at TEXT);
      CREATE TABLE matter_updates (id INTEGER PRIMARY KEY,matter_id TEXT,org_id TEXT,doc_id TEXT,blob_id TEXT,ciphertext BLOB,author_seat TEXT,key_epoch INTEGER,created_at TEXT);
      CREATE TABLE wrapped_matter_keys (matter_id TEXT,epoch INTEGER,user_id TEXT,device_id TEXT,wrapped_key_b64 TEXT,published_by TEXT,created_at TEXT);
      CREATE TABLE audit_events (id INTEGER PRIMARY KEY,org_id TEXT,actor_user_id TEXT,action TEXT,target TEXT,detail TEXT,ts TEXT);`);
    db.query("INSERT INTO matters VALUES (?,?,?,?,?,?)").run("matter-semantic-123", "org", "CLIENT_SECRET_NIMBUS", "active", 1, "now");
    db.query("INSERT INTO matter_updates VALUES (?,?,?,?,?,?,?,?,?)").run(1, "matter-semantic-123", "org", "doc-advisory-plan.docx", "blob-1", new Uint8Array([1, 2, 3]), "seat", 1, "now");
    db.query("INSERT INTO audit_events VALUES (?,?,?,?,?,?,?)").run(1, "org", "user", "matter.create", "matter-semantic-123", '{"client_name":"CLIENT_SECRET_NIMBUS"}', "now");
    db.close();

    const store = new Store(path);
    try {
      const inspector = store.inspectReadOnly();
      for (const table of ["matters", "matter_streams", "matter_members", "ethical_walls", "matter_updates", "wrapped_matter_keys"]) {
        expect(inspector.all(`SELECT COUNT(*) AS count FROM ${table}`)).toEqual([{ count: 0 }]);
      }
      expect(inspector.all("SELECT COUNT(*) AS count FROM audit_events")).toEqual([{ count: 0 }]);

      const tables = inspector.all("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'") as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).not.toContain("firm_relay_migration_manifest");
      const columns = tables.flatMap(({ name }) =>
        (inspector.all(`PRAGMA table_info(\"${name.replaceAll('"', '""')}\")`) as Array<{ name: string }>)
          .map((column) => `${name}.${column.name}`),
      );
      expect(columns.join(" ")).not.toMatch(/legacy_matter_id|matter_id|doc_id|client_name/);

      for (const sentinel of ["CLIENT_SECRET_NIMBUS", "matter-semantic-123", "doc-advisory-plan.docx"]) {
        for (const { name } of tables) {
          const textColumns = inspector.all(`PRAGMA table_info(\"${name.replaceAll('"', '""')}\")`) as Array<{ name: string; type: string }>;
          for (const column of textColumns.filter((item) => /TEXT/i.test(item.type))) {
            expect(inspector.all(`SELECT 1 FROM \"${name.replaceAll('"', '""')}\" WHERE \"${column.name.replaceAll('"', '""')}\" = ?`, sentinel)).toEqual([]);
          }
        }
      }
    } finally {
      store.close();
    }
  }, 15_000);

  test("upgrades a pre-constraint v2 matters table without losing its active relay shell", () => {
    const path = `/tmp/firm-relay-pre-constraint-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const initial = new Store(path);
    const org = initial.createOrg({ name: "Constraint migration", plan: "practice", packs: [], seat_limit: 1 });
    const matter = initial.createMatter({ org_id: org.org_id });
    initial.activateProvisioningMatter(matter.matter_handle);
    initial.close();

    // Recreate the immediately-prior v2 shape: it has the opaque columns but
    // not the status CHECK. This uses a separate SQLite owner, never Store's
    // private connection.
    const old = new Database(path);
    old.exec(`
      PRAGMA foreign_keys = OFF;
      DROP TRIGGER IF EXISTS prevent_invalid_matter_status_transition;
      DROP TRIGGER IF EXISTS prevent_archived_matter_data_deletion;
      CREATE TABLE matters_pre_constraint (
        matter_handle TEXT PRIMARY KEY,
        org_id TEXT NOT NULL REFERENCES orgs(org_id),
        root_stream_handle TEXT NOT NULL UNIQUE,
        status TEXT NOT NULL DEFAULT 'provisioning',
        key_epoch INTEGER NOT NULL DEFAULT 1,
        created_at TEXT NOT NULL
      );
      INSERT INTO matters_pre_constraint SELECT * FROM matters;
      DROP TABLE matters;
      ALTER TABLE matters_pre_constraint RENAME TO matters;
      CREATE INDEX idx_matters_org ON matters(org_id);
      PRAGMA foreign_keys = ON;
    `);
    old.close();

    const reopened = new Store(path);
    try {
      expect(reopened.getMatter(matter.matter_handle)).toMatchObject({ status: "active", root_stream_handle: matter.root_stream_handle });
      const tableSql = reopened.inspectReadOnly().all("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'matters'") as Array<{ sql: string }>;
      expect(tableSql[0]?.sql).toContain("CHECK (status IN ('provisioning', 'active', 'archived'))");
    } finally {
      reopened.close();
    }
  });
});
