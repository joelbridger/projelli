import { afterEach, describe, expect, test } from "bun:test";
import { Database } from "bun:sqlite";
import { rmSync } from "node:fs";
import { Store } from "../src/lib/db.ts";

const paths: string[] = [];
afterEach(() => paths.splice(0).forEach((path) => rmSync(path, { force: true })));

describe("file-backed v1 firm relay reset", () => {
  test("drops a manifest table left by an already-v2 bridge build", () => {
    const path = `/tmp/firm-relay-v2-bridge-${crypto.randomUUID()}.sqlite`;
    paths.push(path);
    const initial = new Store(path);
    initial.db.exec("CREATE TABLE firm_relay_migration_manifest (legacy_matter_id TEXT NOT NULL)");
    initial.db.query("INSERT INTO firm_relay_migration_manifest VALUES (?)").run("matter-semantic-123");
    initial.close();

    const reopened = new Store(path);
    try {
      const tables = reopened.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name='firm_relay_migration_manifest'").all();
      expect(tables).toEqual([]);
    } finally {
      reopened.close();
    }
  });

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
      for (const table of ["matters", "matter_streams", "matter_members", "ethical_walls", "matter_updates", "wrapped_matter_keys"]) {
        expect(store.db.query(`SELECT COUNT(*) AS count FROM ${table}`).get()).toEqual({ count: 0 });
      }
      expect(store.db.query("SELECT COUNT(*) AS count FROM audit_events").get()).toEqual({ count: 0 });

      const tables = store.db.query("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
      expect(tables.map((table) => table.name)).not.toContain("firm_relay_migration_manifest");
      const columns = tables.flatMap(({ name }) =>
        (store.db.query(`PRAGMA table_info(\"${name.replaceAll('"', '""')}\")`).all() as Array<{ name: string }>)
          .map((column) => `${name}.${column.name}`),
      );
      expect(columns.join(" ")).not.toMatch(/legacy_matter_id|matter_id|doc_id|client_name/);

      for (const sentinel of ["CLIENT_SECRET_NIMBUS", "matter-semantic-123", "doc-advisory-plan.docx"]) {
        for (const { name } of tables) {
          const textColumns = store.db.query(`PRAGMA table_info(\"${name.replaceAll('"', '""')}\")`).all() as Array<{ name: string; type: string }>;
          for (const column of textColumns.filter((item) => /TEXT/i.test(item.type))) {
            expect(store.db.query(`SELECT 1 FROM \"${name.replaceAll('"', '""')}\" WHERE \"${column.name.replaceAll('"', '""')}\" = ?`).all(sentinel)).toEqual([]);
          }
        }
      }
    } finally {
      store.close();
    }
  });
});
