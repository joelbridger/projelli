import { afterEach, describe, expect, test } from "bun:test";

import { createAdvisorIntake } from "../../src/platform/intake/createIntake.ts";
import { deriveAuthToken, derivePageKey } from "../../src/platform/intake/intakeCrypto.ts";
import { IntakeRelayClient } from "../../src/platform/intake/IntakeRelayClient.ts";
import { b64ToBytes } from "../../src/platform/intake/pageSeal.ts";
import type { FormRequest, RequestItem } from "../../src/platform/intake/types.ts";
import { IntakeSyncClient, type IntakeInboxPage, type IntakeInboxSubmission } from "../../src/platform/intake/IntakeSyncClient.ts";
import { openPageJson } from "../../intake-page/src/pageCrypto.ts";
import { RelayClient } from "../../intake-page/src/relayClient.ts";
import { submitAnswer } from "../../intake-page/src/submission.ts";

import {
  allDurableValues,
  b64,
  expectOkJson,
  installMemoryLocalStorage,
  makeServer,
  recordRequestsForBase,
  seedAdvisor,
} from "./intakeFlowHarness.ts";

const servers: Array<ReturnType<typeof makeServer>> = [];

afterEach(() => {
  while (servers.length > 0) servers.pop()!.srv.stop(true);
});

function makeTrackedServer() {
  const ctx = makeServer();
  servers.push(ctx);
  return ctx;
}

async function fetchJson(url: string, init: RequestInit) {
  return expectOkJson(await fetch(url, init));
}

class HttpInboxRelay {
  constructor(
    private readonly base: string,
    private readonly seatToken: string,
  ) {}

  async fetchInbox(sinceCursor: number): Promise<IntakeInboxPage> {
    const body = await fetchJson(`${this.base}/intake/e2e-intake/inbox?cursor=${String(sinceCursor)}`, {
      method: "GET",
      headers: { "x-seat-token": this.seatToken },
    }) as {
      cursor: number;
      has_more: boolean;
      submissions: Array<{
        cursor: number;
        intake_id: string;
        item_id: string;
        submission_id: string;
        manifest_ciphertext_b64: string;
        wrapped_content_key_b64: string;
        submitted_at: string;
        session_id?: string;
        blobs: Array<{ blob_id: number; index: number; size: number }>;
      }>;
    };

    const submissions: IntakeInboxSubmission[] = [];
    for (const submission of body.submissions) {
      const chunks = [];
      for (const blob of submission.blobs) {
        const res = await fetch(`${this.base}/intake/${encodeURIComponent(submission.intake_id)}/blob/${String(blob.blob_id)}`, {
          method: "GET",
          headers: { "x-seat-token": this.seatToken },
        });
        expect(res.status).toBe(200);
        chunks.push({
          intake_id: submission.intake_id,
          item_id: submission.item_id,
          submission_id: submission.submission_id,
          index: blob.index,
          ciphertext_b64: b64(new Uint8Array(await res.arrayBuffer())),
        });
      }
      submissions.push({
        cursor: submission.cursor,
        intake_id: submission.intake_id,
        item_id: submission.item_id,
        submission_id: submission.submission_id,
        submitted_at: submission.submitted_at,
        manifest_ciphertext_b64: submission.manifest_ciphertext_b64,
        wrapped_content_key_b64: submission.wrapped_content_key_b64,
        chunks,
        ...(submission.session_id ? { session_id: submission.session_id } : {}),
      });
    }

    return { cursor: body.cursor, has_more: body.has_more, submissions };
  }

  async ackSubmission(intakeId: string, submissionId: string): Promise<void> {
    await fetchJson(`${this.base}/intake/${encodeURIComponent(intakeId)}/ack`, {
      method: "POST",
      headers: { "content-type": "application/json", "x-seat-token": this.seatToken },
      body: JSON.stringify({ submission_ids: [submissionId] }),
    });
  }
}

describe("intake real page to relay to advisor flow", () => {
  test("creates a real advisor link, resumes chunk upload, syncs real submissions, and stores no plaintext", async () => {
    const ctx = makeTrackedServer();
    const advisor = seedAdvisor(ctx.store);
    const restoreLocalStorage = installMemoryLocalStorage();
    const recorder = recordRequestsForBase(ctx.base);

    const typedItem: RequestItem = {
      t: "typed_field",
      item_id: "item-ssn",
      label: "Social Security number",
      help_text: "Enter the number from your card.",
      required: true,
      subject: "primary",
      fact_kind: "ssn",
      input: "ssn",
    };
    const fileItem: RequestItem = {
      t: "doc_upload",
      item_id: "item-license",
      label: "Driver license photo",
      help_text: "Upload the front of the card.",
      required: true,
      subject: "primary",
      accepted_mime_types: ["image/png"],
      max_files: 1,
      max_bytes: 10_000,
    };
    const checklist: FormRequest = {
      request_id: "request-private",
      schema_version: 1,
      matter_id: "matter-e2e",
      kind: "onboarding",
      items: [typedItem, fileItem],
    };

    try {
      const bundle = await createAdvisorIntake({
        intakeId: "e2e-intake",
        matterId: "matter-e2e",
        intakeHost: "https://forms.example.test",
        expiresAt: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
        checklist,
        relay: new IntakeRelayClient({ baseUrl: ctx.base, seatToken: advisor.seatToken }),
      });
      expect(ctx.store.getIntake("e2e-intake")).not.toBeNull();

      const linkSecret = b64ToBytes(bundle.linkSecretB64);
      const pageKey = await derivePageKey(linkSecret);
      const authToken = await deriveAuthToken(linkSecret);
      expect(authToken.tokenB64).toBe(bundle.tokenB64);

      const clientRelay = new RelayClient("e2e-intake", authToken.tokenB64);
      const bundleResponse = await clientRelay.fetchBundle();
      const openedChecklist = await openPageJson<FormRequest>(pageKey, bundleResponse.checklist_ciphertext_b64);
      expect(openedChecklist.items.map((item) => item.item_id)).toEqual(["item-ssn", "item-license"]);

      const ssnValue = "123-45-6789";
      const privateFileName = "sarah-license-front-private.png";
      const documentBytes = new Uint8Array([0x89, 0x50, 0x4e, 0x47, 1, 2, 3, 4, 5, 6]);
      await submitAnswer({
        intakeId: "e2e-intake",
        intakePubRaw: bundle.publicKeyRaw,
        item: typedItem,
        payload: { kind: "typed", value: ssnValue, display_value: "ends in 6789" },
        relay: clientRelay,
      });
      await submitAnswer({
        intakeId: "e2e-intake",
        intakePubRaw: bundle.publicKeyRaw,
        item: fileItem,
        payload: {
          kind: "files",
          files: [new File([documentBytes], privateFileName, { type: "image/png" })],
        },
        relay: clientRelay,
      });

      expect(recorder.requests.some((req) => req.includes("/item/item-ssn/chunks?submission_id="))).toBe(true);
      expect(recorder.requests.some((req) => req.includes("/item/item-license/chunks?submission_id="))).toBe(true);

      const forbidden = [ssnValue, privateFileName, typedItem.label, fileItem.label];
      const durableBeforeSync = allDurableValues(ctx.store);
      const requestSurface = recorder.requests.join("\n");
      for (const plaintext of forbidden) {
        expect(durableBeforeSync).not.toContain(plaintext);
        expect(requestSurface).not.toContain(plaintext);
      }

      const routed: Array<{
        itemId: string;
        manifestFileNames: string[];
        plaintextBytes: Uint8Array[];
      }> = [];
      const sync = new IntakeSyncClient({
        relay: new HttpInboxRelay(ctx.base, advisor.seatToken),
        loadPrivateKey: async () => bundle.privateKey,
        hasSubmission: async () => false,
        rememberSubmission: async () => {},
        isKnownSession: async () => true,
        rememberSession: async () => {},
        flagSubmission: async (flag) => {
          throw new Error(`unexpected intake flag: ${flag.kind} ${flag.reason}`);
        },
        routeSubmission: async (submission) => {
          routed.push({
            itemId: submission.itemId,
            manifestFileNames: submission.manifest.file_names,
            plaintextBytes: submission.plaintextBytes,
          });
          return { factId: `fact-${submission.itemId}` };
        },
      });

      const result = await sync.syncOnce();
      expect(result.routed).toBe(2);
      expect(result.acked).toBe(2);

      const typed = routed.find((entry) => entry.itemId === "item-ssn");
      expect(typed).toBeDefined();
      const typedPayload = JSON.parse(new TextDecoder().decode(typed!.plaintextBytes[0])) as { value: string };
      expect(typedPayload.value).toBe(ssnValue);

      const file = routed.find((entry) => entry.itemId === "item-license");
      expect(file).toBeDefined();
      expect(file!.manifestFileNames).toEqual([privateFileName]);
      const fileChunk = file!.plaintextBytes[0];
      expect(fileChunk).toBeDefined();
      expect(Array.from(fileChunk!)).toEqual(Array.from(documentBytes));

      expect(ctx.store.countIntakeChunks("e2e-intake")).toBe(0);
      const emptyInbox = await fetchJson(`${ctx.base}/intake/e2e-intake/inbox?cursor=0`, {
        method: "GET",
        headers: { "x-seat-token": advisor.seatToken },
      }) as { submissions: unknown[] };
      expect(emptyInbox.submissions).toEqual([]);
    } finally {
      recorder.restore();
      restoreLocalStorage();
    }
  });
});
