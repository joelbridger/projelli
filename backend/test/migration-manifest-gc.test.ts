import { afterEach, describe, expect, test } from "bun:test";
import { rmSync } from "node:fs";
import { Store } from "../src/lib/db.ts";
import { startLegacyManifestGc } from "../src/lib/migrationManifestGc.ts";

const paths: string[] = [];
afterEach(() => paths.splice(0).forEach((path) => {
  rmSync(path, { force: true }); rmSync(`${path}-wal`, { force: true }); rmSync(`${path}-shm`, { force: true });
}));

function seedManifest(expiresAt: string) {
  const path = `/tmp/firm-relay-manifest-gc-${crypto.randomUUID()}.sqlite`;
  paths.push(path);
  const store = new Store(path);
  const org = store.createOrg({ name: "Manifest GC", plan: "practice", packs: ["advisor"], seat_limit: 1 });
  const matter = store.createMatter({ org_id: org.org_id });
  store.db.query(`INSERT INTO firm_relay_migration_manifest
    (legacy_matter_id, matter_handle, root_stream_handle, streams_json, expires_at)
    VALUES (?, ?, ?, ?, ?)`)
    .run("legacy-matter-id", matter.matter_handle, matter.root_stream_handle, JSON.stringify({}), expiresAt);
  return { store, org, matter };
}

function manifestCount(store: Store): number {
  return (store.db.query("SELECT COUNT(*) AS count FROM firm_relay_migration_manifest").get() as { count: number }).count;
}

describe("migration manifest background cleanup", () => {
  test("startup sweep removes expired bridge rows without any migration endpoint request", () => {
    const { store, matter } = seedManifest(new Date(Date.now() - 1).toISOString());
    const timer = startLegacyManifestGc(store);
    try {
      expect(manifestCount(store)).toBe(0);
      expect(store.getMatter(matter.matter_handle)).toMatchObject({ matter_handle: matter.matter_handle });
    } finally {
      clearInterval(timer);
      store.close();
    }
  });

  test("periodic sweep removes rows that expire while the relay is running without a request", async () => {
    const { store } = seedManifest(new Date(Date.now() + 60_000).toISOString());
    const timer = startLegacyManifestGc(store, 5);
    try {
      expect(manifestCount(store)).toBe(1);
      store.db.query("UPDATE firm_relay_migration_manifest SET expires_at = ?").run(new Date(Date.now() - 1).toISOString());
      for (let attempts = 0; manifestCount(store) !== 0 && attempts < 20; attempts++) await Bun.sleep(5);
      expect(manifestCount(store)).toBe(0);
    } finally {
      clearInterval(timer);
      store.close();
    }
  });

  test("unexpired bridge rows survive both the startup and periodic sweeps", async () => {
    const { store } = seedManifest(new Date(Date.now() + 60_000).toISOString());
    const timer = startLegacyManifestGc(store, 5);
    try {
      await Bun.sleep(15);
      expect(manifestCount(store)).toBe(1);
    } finally {
      clearInterval(timer);
      store.close();
    }
  });

  test("cleanup never deletes rows outside the migration manifest tables", () => {
    const { store, org, matter } = seedManifest(new Date(Date.now() - 1).toISOString());
    const timer = startLegacyManifestGc(store);
    try {
      expect(manifestCount(store)).toBe(0);
      expect(store.getOrg(org.org_id)).toMatchObject({ org_id: org.org_id });
      expect(store.getMatter(matter.matter_handle)).toMatchObject({ matter_handle: matter.matter_handle });
      expect((store.db.query("SELECT COUNT(*) AS count FROM matter_streams WHERE matter_handle = ?").get(matter.matter_handle) as { count: number }).count).toBe(1);
    } finally {
      clearInterval(timer);
      store.close();
    }
  });
});
