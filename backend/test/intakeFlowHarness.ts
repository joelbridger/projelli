import { expect } from "bun:test";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { mintSeatToken } from "../src/lib/services.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";

export function b64(value: string | Uint8Array): string {
  return Buffer.from(typeof value === "string" ? value : value).toString("base64");
}

export function bytesFromB64(value: string): Uint8Array {
  return new Uint8Array(Buffer.from(value, "base64"));
}

export async function parseJson(res: Response) {
  return { status: res.status, body: (await res.json().catch(() => ({}))) as Record<string, any> };
}

export function makeServer() {
  const store = new Store(":memory:");
  const srv = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
  return { store, srv, base: `http://${srv.hostname}:${srv.port}` };
}

export function seedAdvisor(store: Store) {
  const org = store.createOrg({
    name: `Acme Advice ${crypto.randomUUID()}`,
    plan: "practice",
    packs: ["advisor"],
    seat_limit: 5,
  });
  const user = store.createUser({
    org_id: org.org_id,
    email: `advisor-${crypto.randomUUID()}@acme.test`,
    password_hash: "x",
    role: "admin",
  });
  const seat = store.activateSeat({
    org_id: org.org_id,
    user_id: user.user_id,
    machine_id: `machine-${crypto.randomUUID()}`,
    machine_label: "Test machine",
    seat_limit: org.seat_limit,
  });
  if (!seat.ok) throw new Error("fixture seat activation failed");
  return { org, user, seat: seat.seat, seatToken: mintSeatToken(org, user, seat.seat).token };
}

export async function expectOkJson(res: Response) {
  const parsed = await parseJson(res);
  expect(parsed.status).toBeGreaterThanOrEqual(200);
  expect(parsed.status).toBeLessThan(300);
  return parsed.body;
}

export function allDurableValues(store: Store): string {
  const tables = store.db
    .query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%' ORDER BY name")
    .all() as Array<{ name: string }>;

  const parts: string[] = [];
  for (const { name } of tables) {
    const rows = store.db.query(`SELECT * FROM ${name}`).all() as Array<Record<string, unknown>>;
    for (const row of rows) {
      for (const value of Object.values(row)) {
        if (value === null || value === undefined) continue;
        if (value instanceof Uint8Array) {
          parts.push(Buffer.from(value).toString("utf8"));
          parts.push(Buffer.from(value).toString("base64"));
        } else {
          parts.push(String(value));
        }
      }
    }
  }
  return parts.join("\n");
}

export function installMemoryLocalStorage(): () => void {
  const previous = Object.getOwnPropertyDescriptor(globalThis, "localStorage");
  const data = new Map<string, string>();
  Object.defineProperty(globalThis, "localStorage", {
    configurable: true,
    value: {
      getItem: (key: string) => data.get(key) ?? null,
      setItem: (key: string, value: string) => {
        data.set(key, value);
      },
      removeItem: (key: string) => {
        data.delete(key);
      },
      clear: () => {
        data.clear();
      },
    },
  });

  return () => {
    if (previous) Object.defineProperty(globalThis, "localStorage", previous);
    else Reflect.deleteProperty(globalThis, "localStorage");
  };
}

export function recordRequestsForBase(base: string): { requests: string[]; restore: () => void } {
  const previousFetch = globalThis.fetch;
  const requests: string[] = [];
  globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url =
      typeof input === "string"
        ? input
        : input instanceof URL
          ? input.toString()
          : input.url;
    const absolute = url.startsWith("/") ? `${base}${url}` : url;
    const fetchInput = url.startsWith("/") ? absolute : input;
    if (absolute.startsWith(base)) {
      const body = typeof init?.body === "string" ? init.body : "";
      const parsed = new URL(absolute);
      requests.push(`${init?.method ?? "GET"} ${parsed.pathname}${parsed.search}\n${body}`);
    }
    return previousFetch(fetchInput, init);
  }) as typeof globalThis.fetch;

  return {
    requests,
    restore: () => {
      globalThis.fetch = previousFetch;
    },
  };
}
