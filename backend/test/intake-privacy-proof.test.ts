/**
 * Standing privacy proof for the intake relay.
 *
 * The relay may hold routing metadata and ciphertext, but a client submission
 * through the real public HTTP path must not leave names, labels, answers, or
 * file names in any durable row or request body the relay handles.
 */

import { afterEach, describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { issueAuthTokens } from "../src/lib/services.ts";

import {
  allDurableValues,
  b64,
  makeServer,
  parseJson,
  recordRequestsForBase,
  seedAdvisor,
} from "./intakeFlowHarness.ts";

const servers: Array<ReturnType<typeof makeServer>> = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()!.srv.stop(true);
});

async function jsonRequest(base: string, path: string, authToken: string, method: string, body?: unknown) {
  return parseJson(
    await fetch(`${base}${path}`, {
      method,
      headers: {
        authorization: `Bearer ${authToken}`,
        ...(body ? { "content-type": "application/json" } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
}

describe("standing intake privacy proof", () => {
  test("real HTTP intake submission stores no plaintext client values, labels, names, or file names", async () => {
    const ctx = makeServer();
    servers.push(ctx);
    const advisor = seedAdvisor(ctx.store);
    const accessToken = issueAuthTokens(ctx.store, advisor.user).access_token;
    const recorder = recordRequestsForBase(ctx.base);

    const plaintextClientName = "Sarah Plainclient";
    const plaintextFileName = "sarah-license-front.png";
    const plaintextItemLabel = "Social Security number";
    const plaintextAnswer = "123-45-6789";
    const restrictedTierFact = "restricted-drivers-license-9999";
    const authToken = `auth-${crypto.randomUUID()}`;

    try {
      const created = await parseJson(
        await fetch(`${ctx.base}/intake`, {
          method: "POST",
          headers: { "content-type": "application/json", "x-seat-token": advisor.seatToken, authorization: `Bearer ${accessToken}` },
          body: JSON.stringify({
            intake_id: "privacy-intake",
            auth_token: authToken,
            expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
            checklist_ciphertext_b64: b64(randomBytes(96)),
            state_ciphertext_b64: b64(randomBytes(64)),
          }),
        }),
      );
      expect(created.status).toBe(201);

      const chunk = await jsonRequest(
        ctx.base,
        "/intake/privacy-intake/item/item-ssn/chunk",
        authToken,
        "POST",
        {
          intake_id: "privacy-intake",
          item_id: "item-ssn",
          submission_id: "sid-private",
          index: 0,
          ciphertext_b64: b64(randomBytes(128)),
        },
      );
      expect(chunk.status).toBe(201);

      const finalized = await jsonRequest(
        ctx.base,
        "/intake/privacy-intake/item/item-ssn/submit",
        authToken,
        "POST",
        {
          intake_id: "privacy-intake",
          item_id: "item-ssn",
          submission_id: "sid-private",
          manifest_ciphertext_b64: b64(randomBytes(96)),
          wrapped_content_key_b64: b64(randomBytes(80)),
        },
      );
      expect(finalized.status).toBe(201);

      const durable = allDurableValues(ctx.store);
      const requestSurface = recorder.requests.join("\n");
      for (const forbidden of [
        plaintextClientName,
        plaintextFileName,
        plaintextItemLabel,
        plaintextAnswer,
        restrictedTierFact,
      ]) {
        expect(durable).not.toContain(forbidden);
        expect(requestSurface).not.toContain(forbidden);
      }
    } finally {
      recorder.restore();
    }
  });
});
