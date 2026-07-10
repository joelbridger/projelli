/**
 * Standing privacy proof for the intake relay.
 *
 * The relay may hold routing metadata and ciphertext, but an honest client flow
 * must not leave names, labels, answers, or file names in any durable row.
 */

import { describe, expect, test } from "bun:test";
import { randomBytes } from "node:crypto";
import { Store } from "../src/lib/db.ts";
import { hmacHash } from "../src/lib/crypto.ts";

function allDurableValues(store: Store): string {
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

function b64(bytes: Uint8Array): string {
  return Buffer.from(bytes).toString("base64");
}

describe("standing intake privacy proof", () => {
  test("honest-client intake submission stores no plaintext client values, labels, names, or file names", () => {
    const store = new Store(":memory:");

    const plaintextClientName = "Sarah Plainclient";
    const plaintextFileName = "sarah-license-front.png";
    const plaintextItemLabel = "Social Security number";
    const plaintextAnswer = "123-45-6789";
    const restrictedTierFact = "restricted-drivers-license-9999";

    const org = store.createOrg({
      name: "Acme Advice",
      plan: "practice",
      packs: ["advisor"],
      seat_limit: 2,
    });
    const user = store.createUser({
      org_id: org.org_id,
      email: "advisor@acme.test",
      password_hash: "x",
      role: "admin",
    });
    const seat = store.activateSeat({
      org_id: org.org_id,
      user_id: user.user_id,
      machine_id: "privacy-machine",
      machine_label: "Privacy machine",
      seat_limit: org.seat_limit,
    });
    if (!seat.ok) throw new Error("fixture seat activation failed");

    // Honest clients send ciphertext. Use high-entropy bytes that do not contain
    // any of the sentinel plaintext strings.
    const checklistCiphertext = randomBytes(96);
    const stateCiphertext = randomBytes(64);
    const chunkCiphertext = randomBytes(128);
    const manifestCiphertext = randomBytes(96);
    const wrappedKeyCiphertext = randomBytes(80);

    store.createIntake({
      intake_id: "privacy-intake",
      org_id: org.org_id,
      user_id: user.user_id,
      seat_id: seat.seat.seat_id,
      token_hash: hmacHash("privacy-auth-token"),
      expires_at: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      checklist_ciphertext: checklistCiphertext,
      state_ciphertext: stateCiphertext,
    });
    store.appendIntakeChunk({
      intake_id: "privacy-intake",
      item_id: "item-ssn",
      submission_id: "sid-private",
      index: 0,
      ciphertext: chunkCiphertext,
    });
    const finalized = store.finalizeIntakeSubmission({
      intake_id: "privacy-intake",
      item_id: "item-ssn",
      submission_id: "sid-private",
      manifest_ciphertext: manifestCiphertext,
      wrapped_content_key: wrappedKeyCiphertext,
    });
    expect(finalized.ok).toBe(true);

    const durable = allDurableValues(store);
    for (const forbidden of [
      plaintextClientName,
      plaintextFileName,
      plaintextItemLabel,
      plaintextAnswer,
      restrictedTierFact,
    ]) {
      expect(durable).not.toContain(forbidden);
    }

    const bundle = store.getIntakeBundle("privacy-intake");
    expect(bundle).not.toBeNull();
    const outbound = JSON.stringify({
      checklist_ciphertext_b64: b64(bundle!.checklist_ciphertext),
      state_ciphertext_b64: b64(bundle!.state_ciphertext),
      checklist_version: bundle!.checklist_version,
      finalized_item_ids: bundle!.finalized_item_ids,
    });
    expect(outbound).not.toContain(restrictedTierFact);
    expect(outbound).not.toContain(plaintextAnswer);
  });
});
