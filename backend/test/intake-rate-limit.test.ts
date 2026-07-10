import { afterEach, describe, expect, test } from "bun:test";

import { hmacHash } from "../src/lib/crypto.ts";
import { config } from "../src/lib/config.ts";
import { Store } from "../src/lib/db.ts";
import { handleIntakeBundle } from "../src/routes/intake.ts";
import { seedAdvisor } from "./intakeFlowHarness.ts";

const originalLimit = {
  max: config.relayRateLimitMax,
  windowSeconds: config.relayRateLimitWindowSeconds,
};

afterEach(() => {
  config.relayRateLimitMax = originalLimit.max;
  config.relayRateLimitWindowSeconds = originalLimit.windowSeconds;
});

function bearer(token: string): Request {
  return new Request("http://relay.test/intake/x/bundle", {
    method: "GET",
    headers: { authorization: `Bearer ${token}` },
  });
}

describe("public intake probe throttling", () => {
  test("repeated unknown-id probes are rate-limited before auth returns the neutral 410", () => {
    config.relayRateLimitMax = 2;
    config.relayRateLimitWindowSeconds = 60;
    const store = new Store(":memory:");
    const ip = `unknown-probe-${crypto.randomUUID()}`;

    expect(handleIntakeBundle(bearer("probe"), store, "missing-intake", ip).status).toBe(410);
    expect(handleIntakeBundle(bearer("probe"), store, "missing-intake", ip).status).toBe(410);
    expect(handleIntakeBundle(bearer("probe"), store, "missing-intake", ip).status).toBe(429);
  });

  test("repeated wrong-token probes are rate-limited before auth returns the neutral 410", () => {
    config.relayRateLimitMax = 2;
    config.relayRateLimitWindowSeconds = 60;
    const store = new Store(":memory:");
    const advisor = seedAdvisor(store);
    store.createIntake({
      intake_id: "real-intake",
      org_id: advisor.org.org_id,
      user_id: advisor.user.user_id,
      seat_id: advisor.seat.seat_id,
      token_hash: hmacHash("right-token"),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      checklist_ciphertext: new Uint8Array([1]),
      state_ciphertext: new Uint8Array([2]),
    });
    const ip = `wrong-token-probe-${crypto.randomUUID()}`;

    expect(handleIntakeBundle(bearer("wrong-token"), store, "real-intake", ip).status).toBe(410);
    expect(handleIntakeBundle(bearer("wrong-token"), store, "real-intake", ip).status).toBe(410);
    expect(handleIntakeBundle(bearer("wrong-token"), store, "real-intake", ip).status).toBe(429);
  });
});
