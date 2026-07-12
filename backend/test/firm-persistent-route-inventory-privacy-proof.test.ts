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
import { FIRM_PERSISTENT_ROUTE_SPECS, FIRM_SERVER_ROUTE_TABLE, assertFirmPersistentRouteInventoryComplete, type FirmPersistentRouteId } from "../src/lib/firmPersistentRouteInventory.ts";

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

type ExercisableRoute = Extract<FirmPersistentRouteId, "deviceRegister" | "activateSeat" | "transferSeat" | "orgClaim" | "revokeSeat">;
function bodyFor(id: ExercisableRoute, sourceSeat: string, targetUser: string): Record<string, unknown> {
  switch (id) {
    case "deviceRegister": return { device_id: UUID, machine_id: UUID, pubkey_jwk: { kty: "EC", crv: "P-256", x: "x", y: "y" } };
    case "activateSeat": return { license_key: "unused-valid-shaped-key", machine_id: UUID };
    case "transferSeat": return { from_seat_id: sourceSeat, to_user_id: targetUser, to_machine_id: UUID };
    case "orgClaim": return { license_key: "unused-valid-shaped-key", email: "claim@inventory.test", password: "password-claim-123" };
    case "revokeSeat": return { seat_id: sourceSeat, reason_code: "seat_transfer" };
  }
}

describe("non-v2 persisted firm-input inventory hostile-client proof", () => {
  test("the server route table cannot contain an undeclared persisting handler", () => {
    expect(() => assertFirmPersistentRouteInventoryComplete([
      ...FIRM_SERVER_ROUTE_TABLE,
      { id: "futureWriter", method: "POST", path: "/org/future-write", persists: true },
    ])).toThrow("undeclared_persisting_firm_route:futureWriter");
  });

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
      // COMPLETENESS GATE. A hardcoded "routes we happen to probe" list is the
      // very antipattern that let a free-text `reason` reach the seat record and
      // the audit log: /org/seat/revoke was declared, but nothing ever drove a
      // sentinel through it. So every declared route carrying client-supplied
      // inputs must either have a DRIVER here or be explicitly EXEMPT with a
      // stated reason. A new route with inputs and no driver FAILS this test.
      const DRIVEN: ExercisableRoute[] = ["deviceRegister", "activateSeat", "transferSeat", "orgClaim", "revokeSeat"];
      const EXEMPT: Partial<Record<FirmPersistentRouteId, string>> = {
        webhook: "signed billing payload from the payment provider; not a client-supplied field",
        authLogin: "credentials only; verified then discarded, never persisted as text",
        authRefresh: "opaque token only",
        authLogout: "opaque token only",
        ssoStart: "IdP redirect; no persisted client field",
        ssoCallback: "IdP-issued code; exchanged, never persisted as text",
        ssoExchange: "IdP-issued code; exchanged, never persisted as text",
        setSsoConfig: "admin IdP setup (issuer/client id); secret stored encrypted",
        deleteSsoConfig: "no client-supplied body",
        setProviderKey: "provider API key stored encrypted; never rendered",
        deleteProviderKey: "no client-supplied body",
        seatHeartbeat: "opaque seat token only",
        assuredInfer: "prompt body is transient: proxied, never stored or logged",
        createUser: "account email/password; account data, not client work product",
        createOrg: "account bootstrap; firm name is account data, not client work product",
        deprovisionUser: "server-minted user id only",
      };
      const undriven = FIRM_PERSISTENT_ROUTE_SPECS
        .filter((spec) => spec.inputs.length > 0)
        .filter((spec) => !DRIVEN.includes(spec.id as ExercisableRoute) && EXEMPT[spec.id] === undefined)
        .map((spec) => `${spec.id} (${spec.path})`);
      expect(undriven, "declared persisting route with client inputs has no hostile-client driver and no stated exemption").toEqual([]);

      for (const spec of FIRM_PERSISTENT_ROUTE_SPECS.filter((candidate): candidate is typeof candidate & { id: ExercisableRoute } => DRIVEN.includes(candidate.id as ExercisableRoute))) {
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
      expect(exercised).toEqual(new Set(FIRM_PERSISTENT_ROUTE_SPECS.filter((spec) => DRIVEN.includes(spec.id as ExercisableRoute)).flatMap((spec) => spec.inputs.map((input) => `${spec.id}:${input.name}`))));
      assertStoreClean(store);
      assertNoSentinels(logs, "server logs");
    } finally {
      console.error = originalError;
      server.stop(true);
      store.close();
    }
  });
});
