import { describe, expect, test } from "bun:test";
import * as Y from "yjs";
import { Store } from "../src/lib/db.ts";
import { FanoutHub } from "../src/lib/matters.ts";
import { issueAuthTokens, mintSeatToken } from "../src/lib/services.ts";
import { buildServeOptions, type SyncSocketData } from "../src/server.ts";
import { hasForbiddenV2RelayKey } from "../src/lib/v2Payload.ts";

const sentinels = ["CLIENT_SECRET_NIMBUS", "matter-semantic-123", "doc-advisory-plan.docx"] as const;
const [clientSecret, semanticMatter, documentName] = sentinels;
const firmApiClientModule: string = "../../src/platform/firm/FirmApiClient.ts";
const matterSyncClientModule: string = "../../src/platform/firm/MatterSyncClient.ts";
const matterCryptoModule: string = "../../src/platform/firm/matterCrypto.ts";
const hostileBody = {
  cLiEnT_NaMe: clientSecret,
  nested: { MATTER_ID: semanticMatter, Filename: documentName },
};

function textColumns(store: Store): Array<{ table: string; column: string }> {
  const tables = store.db.query("SELECT name FROM sqlite_master WHERE type = 'table' AND name NOT LIKE 'sqlite_%'").all() as Array<{ name: string }>;
  return tables.flatMap(({ name }) =>
    (store.db.query(`PRAGMA table_info("${name.replaceAll('"', '""')}")`).all() as Array<{ name: string; type: string }>)
      .filter((column) => /TEXT/i.test(column.type))
      .map((column) => ({ table: name, column: column.name })),
  );
}

function expectSentinelsAbsentFromStore(store: Store): void {
  for (const { table, column } of textColumns(store)) {
    const quotedTable = `"${table.replaceAll('"', '""')}"`;
    const quotedColumn = `"${column.replaceAll('"', '""')}"`;
    for (const sentinel of sentinels) {
      const rows = store.db.query(`SELECT 1 FROM ${quotedTable} WHERE instr(CAST(${quotedColumn} AS TEXT), ?) > 0`).all(sentinel);
      expect(rows, `${table}.${column} contains ${sentinel}`).toHaveLength(0);
    }
  }
  expect(JSON.stringify(store.listAudit("org"))).not.toContain(sentinels[0]);
  expect(JSON.stringify(store.listAudit("org"))).not.toContain(sentinels[1]);
  expect(JSON.stringify(store.listAudit("org"))).not.toContain(sentinels[2]);
}

function fixture() {
  const store = new Store(":memory:");
  const org = store.createOrg({ name: "Relay privacy", plan: "practice", packs: ["advisor"], seat_limit: 4 });
  store.db.query("UPDATE orgs SET org_id='org' WHERE org_id=?").run(org.org_id);
  const admin = store.createUser({ org_id: "org", email: "admin@privacy.test", password_hash: "x", role: "admin" });
  const member = store.createUser({ org_id: "org", email: "member@privacy.test", password_hash: "x", role: "member" });
  const adminSeat = store.activateSeat({ org_id: "org", user_id: admin.user_id, machine_id: "admin-device", machine_label: null, seat_limit: 4 });
  const memberSeat = store.activateSeat({ org_id: "org", user_id: member.user_id, machine_id: "member-device", machine_label: null, seat_limit: 4 });
  if (!adminSeat.ok || !memberSeat.ok) throw new Error("test seat activation failed");
  const seededOrg = store.getOrg("org")!;
  return {
    store,
    admin,
    member,
    adminToken: issueAuthTokens(store, admin).access_token,
    memberToken: issueAuthTokens(store, member).access_token,
    adminSeatToken: mintSeatToken(seededOrg, admin, adminSeat.seat).token,
    memberSeatToken: mintSeatToken(seededOrg, member, memberSeat.seat).token,
  };
}

async function responseJson(response: Response): Promise<Record<string, unknown>> {
  return await response.json() as Record<string, unknown>;
}

describe("firm relay privacy proof", () => {
  test("the shared recursive guard recognizes forbidden relay descriptors", () => {
    expect(hasForbiddenV2RelayKey(hostileBody)).toBe(true);
    expect(hasForbiddenV2RelayKey({ wrapped: [{ user_id: "safe", TITLE: sentinels[0] }] })).toBe(true);
    expect(hasForbiddenV2RelayKey({ blob_id: "opaque", ciphertext_b64: "AQID" })).toBe(false);
  });

  test("every v2 firm route rejects a hostile descriptor body without storing or echoing it", async () => {
    const { store, admin, adminToken, adminSeatToken, memberToken, memberSeatToken } = fixture();
    const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
    const base = `http://${server.hostname}:${server.port}`;
    const auth = { authorization: `Bearer ${adminToken}`, "x-seat-token": adminSeatToken };
    const send = async (path: string, body: unknown, headers = auth) => {
      const response = await fetch(`${base}${path}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...headers },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await responseJson(response) };
    };
    try {
      const created = await send("/v2/firm/matters", {});
      const matterHandle = created.body.matter_handle as string;
      const rootStream = created.body.root_stream_handle as string;
      await send(`/v2/firm/matters/${matterHandle}/activate`, {});
      await send(`/v2/firm/matters/${matterHandle}/members/add`, { user_id: admin.user_id, role: "owner" });

      const routes = [
        ["/v2/firm/matters", auth],
        ["/v2/firm/matters/list", auth],
        ["/v2/firm/matters/mine", auth],
        ["/v2/firm/migration-manifest", auth],
        ["/v2/firm/migration-complete", auth],
        [`/v2/firm/matters/${matterHandle}/activate`, auth],
        [`/v2/firm/matters/${matterHandle}/archive`, auth],
        [`/v2/firm/matters/${matterHandle}/members/add`, auth],
        [`/v2/firm/matters/${matterHandle}/members/remove`, auth],
        [`/v2/firm/matters/${matterHandle}/members/list`, auth],
        [`/v2/firm/matters/${matterHandle}/wall/set`, auth],
        [`/v2/firm/matters/${matterHandle}/wall/clear`, auth],
        [`/v2/firm/matters/${matterHandle}/keys/publish`, auth],
        [`/v2/firm/matters/${matterHandle}/keys/fetch`, auth],
        [`/v2/firm/matters/${matterHandle}/streams`, auth],
        [`/v2/firm/streams/${rootStream}/updates`, auth],
        [`/v2/firm/streams/${rootStream}/sync-ticket`, auth],
      ] as const;

      for (const [path, headers] of routes) {
        const result = await send(path, hostileBody, headers);
        expect(result.status, path).toBe(400);
        expect(result.body.error, path).toBe("invalid_v2_payload");
        expect(JSON.stringify(result.body), path).not.toContain(sentinels[0]);
        expect(JSON.stringify(result.body), path).not.toContain(sentinels[1]);
        expect(JSON.stringify(result.body), path).not.toContain(sentinels[2]);
      }

      // Fetch does not permit a GET body, so the pull route gets the same
      // fail-closed treatment through its strict query schema.
      const pull = await fetch(`${base}/v2/firm/streams/${rootStream}/updates?since=0&doc_id=${encodeURIComponent(documentName)}`, { headers: auth });
      expect(pull.status).toBe(400);
      expect(await pull.text()).not.toContain(documentName);
      expectSentinelsAbsentFromStore(store);
      // Keep this here: this assertion is the direct proof that a temporary
      // reversion of the shared recursive guard makes this proof file fail.
      expect(hasForbiddenV2RelayKey(hostileBody)).toBe(true);
      expect(memberToken).toBeTruthy();
      expect(memberSeatToken).toBeTruthy();
    } finally {
      server.stop(true);
      store.close();
    }
  });

  test("every non-pull v2 route rejects query strings before they can reach a handler", async () => {
    const { store, admin, adminToken, adminSeatToken } = fixture();
    const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
    const base = `http://${server.hostname}:${server.port}`;
    const auth = { authorization: `Bearer ${adminToken}`, "x-seat-token": adminSeatToken };
    const sentinelQuery = `client_name=${encodeURIComponent(clientSecret)}`;
    const request = async (path: string, body: unknown = {}) => {
      const response = await fetch(`${base}${path}?${sentinelQuery}`, {
        method: "POST",
        headers: { "content-type": "application/json", ...auth },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await responseJson(response) };
    };
    try {
      const created = await fetch(`${base}/v2/firm/matters`, {
        method: "POST", headers: { "content-type": "application/json", ...auth }, body: "{}",
      });
      const { matter_handle: matterHandle, root_stream_handle: rootStream } = await responseJson(created) as { matter_handle: string; root_stream_handle: string };
      const routes = [
        `/v2/firm/matters/${matterHandle}/activate`,
        `/v2/firm/matters/${matterHandle}/archive`,
        `/v2/firm/matters/${matterHandle}/members/add`,
        `/v2/firm/matters/${matterHandle}/members/remove`,
        `/v2/firm/matters/${matterHandle}/members/list`,
        `/v2/firm/matters/${matterHandle}/wall/set`,
        `/v2/firm/matters/${matterHandle}/wall/clear`,
        `/v2/firm/matters/${matterHandle}/keys/publish`,
        `/v2/firm/matters/${matterHandle}/keys/fetch`,
        `/v2/firm/matters/${matterHandle}/streams`,
        `/v2/firm/streams/${rootStream}/updates`,
        `/v2/firm/streams/${rootStream}/sync-ticket`,
        "/v2/firm/migration-manifest",
        "/v2/firm/migration-complete",
      ];
      for (const path of routes) {
        const result = await request(path);
        expect(result.status, path).toBe(400);
        expect(result.body.error, path).toBe("invalid_v2_query");
        expect(JSON.stringify(result.body), path).not.toContain(clientSecret);
      }
      expectSentinelsAbsentFromStore(store);
    } finally {
      server.stop(true);
      store.close();
    }
  });

  test("only one validated cursor query is accepted for pulls, and only one ticket query is accepted for sync", async () => {
    const { store, adminToken, adminSeatToken } = fixture();
    const server = Bun.serve<SyncSocketData>(buildServeOptions(store, new FanoutHub()));
    const base = `http://${server.hostname}:${server.port}`;
    const auth = { authorization: `Bearer ${adminToken}`, "x-seat-token": adminSeatToken };
    try {
      const create = await fetch(`${base}/v2/firm/matters`, {
        method: "POST", headers: { "content-type": "application/json", ...auth }, body: "{}",
      });
      const { matter_handle: matterHandle, root_stream_handle: rootStream } = await responseJson(create) as { matter_handle: string; root_stream_handle: string };
      await fetch(`${base}/v2/firm/matters/${matterHandle}/activate`, {
        method: "POST", headers: { "content-type": "application/json", ...auth }, body: "{}",
      });
      const validPull = await fetch(`${base}/v2/firm/streams/${rootStream}/updates?since=0`, { headers: auth });
      expect(validPull.status).toBe(200);
      for (const query of [
        "",
        "since=0&since=1",
        "since=-1",
        "since=not-a-number",
        `since=0&client_name=${encodeURIComponent(clientSecret)}`,
      ]) {
        const response = await fetch(`${base}/v2/firm/streams/${rootStream}/updates${query ? `?${query}` : ""}`, { headers: auth });
        expect(response.status, query || "missing since").toBe(400);
        expect(await response.text(), query || "missing since").not.toContain(clientSecret);
      }

      const ticketResponse = await fetch(`${base}/v2/firm/streams/${rootStream}/sync-ticket`, {
        method: "POST", headers: { "content-type": "application/json", ...auth }, body: "{}",
      });
      const { ticket } = await responseJson(ticketResponse) as { ticket: string };
      const socket = await new Promise<WebSocket>((resolve, reject) => {
        const ws = new WebSocket(`${base.replace("http", "ws")}/v2/firm/sync?ticket=${ticket}`);
        const timeout = setTimeout(() => reject(new Error("socket did not open")), 2_000);
        ws.onopen = () => { clearTimeout(timeout); resolve(ws); };
        ws.onerror = () => { clearTimeout(timeout); reject(new Error("socket failed to open")); };
      });
      socket.close();
      for (const query of ["", `ticket=${ticket}&ticket=${ticket}`, `ticket=${ticket}&client_name=${encodeURIComponent(clientSecret)}`, "ticket=not-a-ticket"]) {
        const response = await fetch(`${base}/v2/firm/sync${query ? `?${query}` : ""}`);
        expect(response.status, query || "missing ticket").toBe(400);
        expect(await response.text(), query || "missing ticket").not.toContain(clientSecret);
      }
      expectSentinelsAbsentFromStore(store);
    } finally {
      server.stop(true);
      store.close();
    }
  });

  test("real FirmApiClient and MatterSyncClient traffic stays opaque, while the hostile probe remains captured and rejected", async () => {
    const { store, admin, member, adminToken, memberToken, adminSeatToken, memberSeatToken } = fixture();
    const httpCapture: Array<Record<string, unknown>> = [];
    const frameCapture: unknown[] = [];
    const options = buildServeOptions(store, new FanoutHub(), { onWebSocketFrame: (frame) => frameCapture.push(frame) });
    const routeFetch = options.fetch;
    options.fetch = async (request: Request, srv: Bun.Server<SyncSocketData>) => {
      const body = await request.clone().text();
      const requestCapture = { direction: "request", method: request.method, url: request.url, headers: [...request.headers.entries()], body };
      httpCapture.push(requestCapture);
      const response = await routeFetch(request, srv);
      if (response) httpCapture.push({ direction: "response", status: response.status, headers: [...response.headers.entries()], body: await response.clone().text() });
      return response;
    };
    const server = Bun.serve<SyncSocketData>(options);
    const base = `http://${server.hostname}:${server.port}`;
    process.env.VITE_FIRM_API_BASE = base;

    try {
      const [{ FirmApiClient }, { MatterSyncClient }, { generateMatterKey }] = await Promise.all([
        import(firmApiClientModule),
        import(matterSyncClientModule),
        import(matterCryptoModule),
      ]);
      const adminClient = new FirmApiClient({ getAccessToken: () => adminToken, refreshAccessToken: async () => null });
      const memberClient = new FirmApiClient({ getAccessToken: () => memberToken, refreshAccessToken: async () => null });

      // Device-local state deliberately contains all three sentinels. It only
      // enters a local Yjs update; MatterSyncClient encrypts that update before
      // its real FirmApiClient sends it to the Bun relay.
      const localMatter = {
        id: semanticMatter,
        clientName: clientSecret,
        documentId: documentName,
        path: "/Clients/CLIENT_SECRET_NIMBUS/doc-advisory-plan.docx",
      };
      const created = await adminClient.createMatter();
      await adminClient.activateMatter(created.matter_handle);
      await adminClient.addMatterMember(created.matter_handle, member.user_id, "editor");
      const wall = await adminClient.setWall(created.matter_handle, member.user_id);
      await adminClient.clearWall(created.matter_handle, member.user_id);
      await adminClient.publishMatterKeys(created.matter_handle, {
        epoch: wall.key_epoch,
        wrapped: [
          { user_id: admin.user_id, device_id: "admin-device", wrapped_key_b64: "admin-wrapped-key" },
          { user_id: member.user_id, device_id: "member-device", wrapped_key_b64: "member-wrapped-key" },
        ],
      });
      await memberClient.fetchMatterKeys(created.matter_handle, "member-device", memberSeatToken);
      await adminClient.allocateStream(created.matter_handle, adminSeatToken);

      const doc = new Y.Doc();
      const sync = new MatterSyncClient({
        matterHandle: created.matter_handle,
        streamHandle: created.root_stream_handle,
        keyB64: await generateMatterKey(),
        keyEpoch: wall.key_epoch,
        seatToken: adminSeatToken,
        client: adminClient,
        doc,
      });
      await sync.start(); // real pull + ticket + WebSocket against Bun.serve
      doc.getMap("FirmMatterPrivateIndex").set("private", localMatter);
      await sync.flush(); // real encrypted push
      await adminClient.pullUpdates(created.root_stream_handle, 0, adminSeatToken);
      await new Promise<void>((resolve, reject) => {
        const deadline = Date.now() + 2_000;
        const check = () => {
          if (frameCapture.some((frame) => (frame as { type?: string }).type === "update")) return resolve();
          if (Date.now() >= deadline) return reject(new Error("expected live update frame"));
          setTimeout(check, 10);
        };
        check();
      });
      sync.stop();

      const cleanCapture = JSON.stringify({ httpCapture, frameCapture });
      for (const sentinel of sentinels) expect(cleanCapture).not.toContain(sentinel);
      const capturedUrls = httpCapture
        .filter((entry) => entry.direction === "request")
        .map((entry) => entry.url)
        .join("\n");
      for (const sentinel of sentinels) expect(capturedUrls).not.toContain(sentinel);
      const frameText = JSON.stringify(frameCapture);
      expect(frameText).not.toContain("matter_handle");
      expect(frameText).not.toContain("stream_handle");
      expect(frameCapture.some((frame) => (frame as { type?: string }).type === "ready")).toBe(true);
      expect(frameCapture.some((frame) => (frame as { type?: string }).type === "update")).toBe(true);
      expectSentinelsAbsentFromStore(store);

      // This deliberately hostile legacy-shaped request is never removed from
      // capture. Its raw request necessarily includes the sentinels; its 400
      // response, audit rows, and database do not.
      const hostile = await fetch(`${base}/v2/firm/matters/${created.matter_handle}/archive`, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${adminToken}` },
        body: JSON.stringify(hostileBody),
      });
      const hostileText = await hostile.text();
      expect(hostile.status).toBe(400);
      expect(hostileText).toContain("invalid_v2_payload");
      expect(hostileText).not.toContain(clientSecret);
      expect(JSON.stringify(httpCapture)).toContain(clientSecret);
      expectSentinelsAbsentFromStore(store);
    } finally {
      server.stop(true);
      store.close();
      delete process.env.VITE_FIRM_API_BASE;
    }
  });
});
