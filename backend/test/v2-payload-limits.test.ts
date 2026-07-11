import { afterEach, describe, expect, test } from "bun:test";
import { config } from "../src/lib/config.ts";
import { hasForbiddenV2RelayKey, requestHasForbiddenV2RelayKey } from "../src/lib/v2Payload.ts";

const originalBudget = config.v2PayloadNodeBudget;
const originalTimeout = config.v2PayloadReadTimeoutMs;
afterEach(() => {
  (config as { v2PayloadNodeBudget: number }).v2PayloadNodeBudget = originalBudget;
  (config as { v2PayloadReadTimeoutMs: number }).v2PayloadReadTimeoutMs = originalTimeout;
});

describe("pre-auth v2 payload limits", () => {
  test("rejects a 2 MiB-wide JSON array at the entry budget without a wide work queue", () => {
    (config as { v2PayloadNodeBudget: number }).v2PayloadNodeBudget = 1_000;
    const body = `[${"0,".repeat((2 * 1024 * 1024 - 2) / 2)}0]`;
    expect(body.length).toBeGreaterThanOrEqual(2 * 1024 * 1024);
    const started = performance.now();
    expect(hasForbiddenV2RelayKey(JSON.parse(body))).toBe(true);
    // The budget stops after 1,001 entries; this is a generous CPU guard that
    // fails if the walker queues or visits the whole million-entry array.
    expect(performance.now() - started).toBeLessThan(1_000);
  });

  test("keeps normal small payloads valid", () => {
    expect(hasForbiddenV2RelayKey({ blob_id: "opaque", nested: { epoch: 1 } })).toBe(false);
  });

  test("aborts a trickling body at the whole-body deadline", async () => {
    (config as { v2PayloadReadTimeoutMs: number }).v2PayloadReadTimeoutMs = 15;
    let cancelled = false;
    const request = new Request("http://relay.test/v2/firm/mine", {
      method: "POST",
      body: new ReadableStream<Uint8Array>({ cancel: () => { cancelled = true; } }),
    });
    await expect(requestHasForbiddenV2RelayKey(request)).resolves.toBe(true);
    await Bun.sleep(0);
    expect(cancelled).toBe(true);
  });
});
