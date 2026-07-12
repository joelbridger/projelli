import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/lib/config.ts";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";
import { validateV2RelayBoundary } from "../src/lib/v2Payload.ts";

const encoder = new TextEncoder();
const MAX_BODY_BYTES = 2 * 1024 * 1024;
const ticket = "a".repeat(64);
const originalTimeout = config.v2PayloadReadTimeoutMs;

afterEach(() => {
  (config as { v2PayloadReadTimeoutMs: number }).v2PayloadReadTimeoutMs = originalTimeout;
});

function preflight(body?: Bun.BodyInit | null, headers: Bun.HeadersInit = {}): Request {
  return new Request("https://relay.test/v2/firm/matters", {
    method: "OPTIONS",
    headers: { "access-control-request-method": "POST", ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
  });
}

/**
 * The Fetch API correctly forbids GET bodies, while a raw WebSocket handshake
 * can contain one. Keep the underlying request stream real and override only
 * its exposed method so the boundary is tested with the upgrade route shape.
 */
function websocketUpgrade(body?: Bun.BodyInit | null, headers: Bun.HeadersInit = {}): Request {
  const request = new Request(`https://relay.test/v2/firm/sync?ticket=${ticket}`, {
    method: "POST",
    headers: { upgrade: "websocket", ...headers },
    body,
    ...(body instanceof ReadableStream ? { duplex: "half" as const } : {}),
  });
  return new Proxy(request, {
    get(target, property) {
      if (property === "method") return "GET";
      if (property === "clone") return target.clone.bind(target);
      return Reflect.get(target, property, target);
    },
  }) as Request;
}

describe("bodyless v2 relay boundaries", () => {
  test("malformed descriptor JSON is rejected on normal POSTs, preflights, and before WebSocket upgrade", async () => {
    const malformed = '{"client_name":"CLIENT_SECRET_NIMBUS"';
    const normal = new Request("https://relay.test/v2/firm/matters", { method: "POST", body: malformed });
    expect(await validateV2RelayBoundary(normal)).toBe("invalid_v2_payload");
    expect(await validateV2RelayBoundary(preflight(malformed))).toBe("invalid_v2_payload");
    expect(await validateV2RelayBoundary(websocketUpgrade(malformed))).toBe("invalid_v2_payload");

    const store = new Store(":memory:");
    const options = buildServeOptions(store, new FanoutHub());
    let upgrades = 0;
    try {
      const response = await options.fetch(websocketUpgrade(malformed), {
        requestIP: () => ({ address: "127.0.0.1" }),
        upgrade: () => { upgrades++; return true; },
      } as unknown as Bun.Server<SyncSocketData>);
      expect(response?.status).toBe(400);
      expect(await response?.json()).toEqual({ error: "invalid_v2_payload" });
      expect(upgrades).toBe(0);
    } finally {
      store.close();
    }
  });

  test("preflights and WebSocket handshakes reject every body and transfer encoding", async () => {
    for (const request of [preflight("{}"), websocketUpgrade("{}")]) {
      expect(await validateV2RelayBoundary(request)).toBe("invalid_v2_payload");
    }
    for (const request of [
      preflight(null, { "transfer-encoding": "chunked" }),
      websocketUpgrade(null, { "transfer-encoding": "chunked" }),
    ]) {
      expect(await validateV2RelayBoundary(request)).toBe("invalid_v2_payload");
    }
  });

  test("size, depth, and slow-stream limits still run on bodyless routes", async () => {
    const oversized = () => new ReadableStream<Uint8Array>({
      start(controller) {
        controller.enqueue(encoder.encode("{}"));
        controller.close();
      },
    });
    for (const request of [
      preflight(oversized(), { "content-length": String(MAX_BODY_BYTES + 1) }),
      websocketUpgrade(oversized(), { "content-length": String(MAX_BODY_BYTES + 1) }),
    ]) {
      expect(await validateV2RelayBoundary(request)).toBe("invalid_v2_payload");
    }

    const deep = `${'{"nested":'.repeat(300)}0${"}".repeat(300)}`;
    for (const request of [preflight(deep), websocketUpgrade(deep)]) {
      expect(await validateV2RelayBoundary(request)).toBe("invalid_v2_payload");
    }

    (config as { v2PayloadReadTimeoutMs: number }).v2PayloadReadTimeoutMs = 15;
    for (const request of [
      preflight(new ReadableStream<Uint8Array>({})),
      websocketUpgrade(new ReadableStream<Uint8Array>({})),
    ]) {
      expect(await validateV2RelayBoundary(request)).toBe("invalid_v2_payload");
    }
  });

  test("ordinary v2 traffic keeps its deliberately narrow valid shapes", async () => {
    expect(await validateV2RelayBoundary(new Request("https://relay.test/v2/firm/matters", { method: "POST", body: "{}" }))).toBeNull();
    expect(await validateV2RelayBoundary(new Request("https://relay.test/v2/firm/matters", { method: "POST" }))).toBeNull();
    expect(await validateV2RelayBoundary(new Request("https://relay.test/v2/firm/streams/sh2_abc/updates?since=0"))).toBeNull();
    expect(await validateV2RelayBoundary(preflight())).toBeNull();
    expect(await validateV2RelayBoundary(websocketUpgrade())).toBeNull();
  });
});
