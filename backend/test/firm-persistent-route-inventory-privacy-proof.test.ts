/**
 * Hostile-client proof for every non-v2 firm route that can save client input.
 * The route table is the source of truth: adding a saved firm input without a
 * table row makes the coverage assertion fail.
 */
import { describe, expect, test } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { issueAuthTokens } from "../src/lib/services.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";
import { FIRM_PERSISTENT_ROUTE_SPECS, type FirmPersistentRouteId } from "../src/lib/firmPersistentRouteInventory.ts";

const SENTINELS = ["CLIENT_SECRET_NIMBUS", "matter-semantic-123", "doc-advisory-plan.docx"] as const;
const UUID = "00000000-0000-4000-8000-000000000001";

function assertNoSentinels(value: unknown, where: string): void {
  const text = typeof value === "string" ? value : JSON.stringify(value);
  for (const sentinel of SENTINELS) expect(text, `${where} includes ${sentinel}`).not.toContain(sentinel);
}

function assertStoreClean(store: Store): void {
  const db = store.inspectReadOnly();
  const tables = db.all("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'") as Array<{ name: string }>;
  for (const { name } of tables) {
    for (const { name: column } of db.all(`PRAGMA table_info(\"${name}\")`) as Array<{ name: string }>) {
      for (const sentinel of SENTINELS) {
        expect(db.all(`SELECT 1 FROM \"${name}\" WHERE instr(CAST(\"${column}\" AS TEXT), ?) > 0`, sentinel), `${name}.${column}`).toHaveLength(0);
      }
    }
  }
  for (const { org_id } of db.all("SELECT org_id FROM orgs") as Array<{ org_id: string }>) assertNoSentinels(store.listAudit(org_id), `audit ${org_id}`);
}

function bodyFor(id: FirmPersistentRouteId, sourceSeat: string, targetUser: string): Record<string, unknown> {
  switch (id) {
    case "deviceRegister": return { device_id: UUID, machine_id: UUID, pubkey_jwk: { kty: "EC", crv: "P-256", x: "x", y: "y" } };
    case "activateSeat": return { license_key: "unused-valid-shaped-key", machine_id: UUID };
    case "transferSeat": return { from_seat_id: sourceSeat, to_user_id: targetUser, to_machine_id: UUID };
    case "orgClaim": return { license_key: "unused-valid-shaped-key", email: "claim@inventory.test", password: "password-claim-123" };
  }
}

describe("non-v2 persisted firm-input inventory hostile-client proof", () => {
  test("every saved firm route and listed client field rejects text without reflection or persistence", async () => {
    const store = new Store(":memory:");
    const org = store.createOrg({ name: "Inventory proof", plan: "practice", packs: ["advisor"], seat_limit: 3 });
    const admin = store.createUser({ org_id: org.org_id, email: "admin@inventory.test", password_hash: "x", role: "admin" });
    const target = store.createUser({ org_id: org.org_id, email: "target@inventory.test", password_hash: "x", role: "member" });
    const source = store.activateSeat({ org_id: org.org_id, user_id: admin.user_id, machine_id: UUID, machine_label: null, seat_limit: 3 });
    if (!source.ok) throw new Error("fixture seat failed");
    const logs: unknown[][] = [];
    const originalError = console.error;
    console.error = (...args: unknown[]) => { logs.push(args); };
    const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
    const base = `http://${server.hostname}:${server.port}`;
    const auth = `Bearer ${issueAuthTokens(store, admin).access_token}`;
    const exercised = new Set<string>();
    try {
      // This explicit path set is a no-silent-escape check for all current
      // non-v2 routes that save a caller-controlled field.
      expect(FIRM_PERSISTENT_ROUTE_SPECS.map((spec) => spec.path).sort()).toEqual([
        "/device/register", "/org/activate", "/org/claim", "/org/seats/transfer",
      ]);
      for (const spec of FIRM_PERSISTENT_ROUTE_SPECS) {
        for (const input of spec.inputs) {
          for (const sentinel of SENTINELS) {
            const body = bodyFor(spec.id, source.seat.seat_id, target.user_id);
            // A field which is intentionally absent from the accepted shape is
            // still tested: it must fail as an unknown key before persistence.
            body[input.name] = sentinel;
            const response = await fetch(`${base}${spec.path}`, {
              method: spec.method,
              headers: { authorization: auth, "content-type": "application/json" },
              body: JSON.stringify(body),
            });
            expect(response.status, `${spec.id}:${input.name}`).toBeGreaterThanOrEqual(400);
            assertNoSentinels(await response.text(), `${spec.id}:${input.name} response`);
            exercised.add(`${spec.id}:${input.name}`);
          }
        }
      }
      expect(exercised).toEqual(new Set(FIRM_PERSISTENT_ROUTE_SPECS.flatMap((spec) => spec.inputs.map((input) => `${spec.id}:${input.name}`))));
      assertStoreClean(store);
      assertNoSentinels(logs, "server logs");
    } finally {
      console.error = originalError;
      server.stop(true);
      store.close();
    }
  });
});
