/**
 * Keepance 3.0 firm platform backend — HTTP entrypoint.
 *
 * Chunk 1 of 3: user identity/auth + per-org licensing. (Chunks 2 & 3 — the
 * E2EE CRDT sync relay and the assured zero-retention inference proxy — are
 * separate services in the same trust class; see README "Next chunks".)
 *
 * Router is a flat switch over (method, path). No framework: the API is small
 * and Bun.serve's Request/Response is all we need. Every response carries CORS
 * headers (the desktop webview calls from tauri://localhost).
 */

import { clientIpFromPeer, config } from "./lib/config.ts";
import { getStore } from "./lib/db.ts";
import { json, error, preflight, startRateLimitGc } from "./lib/http.ts";
import { hashPassword, generateLicenseKey, hmacHash } from "./lib/crypto.ts";
import { handleLogin, handleRefresh, handleLogout, handleMe } from "./routes/auth.ts";
import { handleActivate, handleSeatValidate, handleSeatHeartbeat } from "./routes/seats.ts";
import {
  handleListSeats,
  handleRevokeSeat,
  handleDeprovisionUser,
  handleTransferSeat,
  handleCreateUser,
  handleAudit,
  handleCreateOrg,
  handleListOrgUsers,
} from "./routes/admin.ts";
import {
  handleCreateMatter,
  handleListMatters,
  handleArchiveMatter,
  handleAddMatterMember,
  handleRemoveMatterMember,
  handleListMatterMembers,
  handleSetWall,
  handleClearWall,
  handlePushUpdate,
  handlePullUpdates,
  handleSyncTicket,
  authorizeSyncConnect,
} from "./routes/matters.ts";
import {
  handleAckIntake,
  handleCreateIntake,
  handleExtendIntake,
  handleGetIntakeBlob,
  handleIntakeBundle,
  handleIntakeInbox,
  handleFetchIntakeKey,
  handleListGrantedIntakes,
  handlePublishIntakeKeys,
  handleListUploadedIntakeChunks,
  handleRegenerateIntake,
  handleReplaceIntakeChecklist,
  handleRevokeIntake,
  handleSaveIntakeState,
  handleSubmitIntakeItem,
  handleUploadIntakeChunk,
} from "./routes/intake.ts";
import { fanout, FanoutHub, toUpdateFrame, resolveAccess, type Subscriber } from "./lib/matters.ts";
import { startSyncTicketGc } from "./lib/syncTickets.ts";
import { startSsoStateGc } from "./lib/ssoState.ts";
import {
  handleAssuredInfer,
  handleSetProviderKey,
  handleListProviderKeys,
  handleDeleteProviderKey,
  handleInferenceBilling,
} from "./routes/assured.ts";
import { handleDeviceRegister, handleListUsersDevices, handleListOrgAdmins } from "./routes/devices.ts";
import { handlePublishMatterKeys, handleFetchMatterKey, handleMatterMine } from "./routes/matterKeys.ts";
import { handleOrgClaim } from "./routes/claim.ts";
import { handleSsoConfigSet, handleSsoConfigGet, handleSsoConfigDelete, handleSsoStart, handleSsoCallback, handleSsoExchange } from "./routes/sso.ts";
import { handleLemonSqueezyWebhook } from "./routes/webhooks.ts";
import {
  handleAckSignatureWakeups,
  handleDeleteSignatureLaunch,
  handleDocusignConnectEvent,
  handleGetSignatureLaunch,
  handleIssueSigningCapability,
  handleListSignatureWakeups,
  handlePutSignatureLaunch,
  handleRegisterEnvelope,
} from "./routes/docusignSigning.ts";
import { handleNotifySend, handleNotifyInbox, handleNotifyAck, handleNotifySyncTicket, authorizeNotifySync, handleNotifyTerminal } from "./routes/notifications.ts";
import { notificationHub } from "./lib/notifications.ts";
import { handleCheckpointChunk, handleCheckpointManifest, handleCheckpointReceipt, handleCheckpointPrune } from "./routes/checkpoints.ts";
import { handleTestFirmProvision, handleTestFirmRetirement } from "./routes/privileged.ts";
import { randomUUID } from "node:crypto";
import type { Store } from "./lib/db.ts";
import type { UserRole } from "./lib/types.ts";

/** Data attached to each sync WebSocket on upgrade (set by authorizeSyncConnect). */
interface DocumentSocketData {
  kind: "document";
  subId: string;
  matterId: string;
  /** Document stream this socket is subscribed to. '_notes' for matter notes. */
  docId: string;
  /** Last cursor the client has durably applied before this subscription. */
  since: number;
  orgId: string;
  userId: string;
  seatId: string;
  sessionId: string;
  role: UserRole;
  subscriptions: Set<string>;
}

interface NotifySocketData {
  kind: "notify";
  subId: string;
  orgId: string;
  userId: string;
  seatId: string;
  sessionId: string;
}

export type SyncSocketData = DocumentSocketData | NotifySocketData;

/**
 * Extract a `/matter/:id/...` path. Returns the matter id and the trailing
 * segment (e.g. "updates", "members/add", "" for the bare matter). The id is a
 * single path segment; we never let it contain a slash.
 */
function matchMatter(path: string): { id: string; rest: string } | null {
  const m = path.match(/^\/matter\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1]!), rest: m[2] ?? "" };
}

/** Extract `/intake/:id/...` the same way matchMatter handles matter routes. */
function matchIntake(path: string): { id: string; rest: string } | null {
  const m = path.match(/^\/intake\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1]!), rest: m[2] ?? "" };
}

/** Extract `/docusign-signing/:intakeId/...` without coupling it to intake routes. */
function matchDocusignSigning(path: string): { id: string; rest: string } | null {
  const m = path.match(/^\/docusign-signing\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  return { id: decodeURIComponent(m[1]!), rest: m[2] ?? "" };
}

function documentChannel(matterId: string, docId: string): string {
  return `${matterId}\u0000${docId}`;
}

/** Check the live database immediately before every socket frame. */
function liveSocketAllowed(store: Store, data: SyncSocketData, matterId?: string): boolean {
  try {
    const session = store.getRefreshTokenById(data.sessionId);
    const user = store.getUser(data.userId);
    const org = store.getOrg(data.orgId);
    const seat = store.getSeat(data.seatId);
    if (!session || session.user_id !== data.userId || session.revoked_at || session.rotated_to || Date.parse(session.expires_at) <= Date.now() || !user || user.status !== "active" || !org || org.status !== "active" || !seat || seat.status !== "active" || seat.user_id !== data.userId || seat.org_id !== data.orgId) return false;
    return data.kind !== "document" || !matterId || resolveAccess(store, { orgId: data.orgId, userId: data.userId, role: user.role }, matterId).allowed;
  } catch { return false; }
}

/** Add one logical document to a multiplexed authenticated socket. Subscribe before
 * taking the watermark, so rows written during HTTP/socket handoff are buffered
 * by the hub and delivered at least once rather than lost. */
function subscribeDocument(
  ws: Bun.ServerWebSocket<SyncSocketData>,
  store: Store,
  hub: FanoutHub,
  matterId: string,
  docId: string,
  since: number,
): void {
  const d = ws.data;
  if (d.kind !== "document") return;
  if (!liveSocketAllowed(store, d, matterId)) { ws.close(1008, "authorization_revoked"); return; }
  const access = resolveAccess(store, { orgId: d.orgId, userId: d.userId, role: d.role }, matterId);
  if (!access.allowed) {
    ws.send(JSON.stringify({ type: "subscription_error", matter_id: matterId, doc_id: docId, error: "forbidden" }));
    return;
  }
  const channel = documentChannel(matterId, docId);
  const subId = `${d.subId}:${channel}`;
  const sub: Subscriber = {
    id: subId,
    user_id: d.userId,
    seat_id: d.seatId,
    send: (frame) => { if (!liveSocketAllowed(store, d, matterId)) { ws.close(1008, "authorization_revoked"); return; } try { ws.send(JSON.stringify(frame)); } catch { /* close cleans up */ } },
  };
  hub.subscribe(matterId, sub, docId);
  d.subscriptions.add(channel);
  try {
    const watermark = store.latestMatterCursor(matterId, docId);
    const backlog = store.countMatterUpdatesThrough(matterId, since, watermark, docId);
    if (!liveSocketAllowed(store, d, matterId)) { ws.close(1008, "authorization_revoked"); return; }
    ws.send(JSON.stringify({ type: "ready", matter_id: matterId, doc_id: docId, watermark, latest_cursor: watermark, backlog, subscribers: hub.subscriberCount(matterId, docId) }));
    let cursor = since;
    for (;;) {
      const page = store.getMatterUpdatesThrough(matterId, cursor, watermark, 500, docId);
      if (!page.length) break;
      for (const update of page) { if (!liveSocketAllowed(store, d, matterId)) { ws.close(1008, "authorization_revoked"); return; } ws.send(JSON.stringify(toUpdateFrame(update))); }
      cursor = page[page.length - 1]!.id;
    }
  } catch {
    hub.unsubscribe(matterId, subId, docId);
    d.subscriptions.delete(channel);
    ws.close(1011, "sync_backfill_failed");
    return;
  }
  hub.broadcastPresence(matterId, docId);
}

/**
 * Build the Bun.serve options for a given Store + fan-out hub. Factored out (vs.
 * an inline object) so tests can boot an isolated server on an ephemeral port
 * with their own in-memory store + hub, exercising the SAME routes + WebSocket
 * fan-out as production — no logic duplication, no cross-file server-lifecycle
 * coupling.
 */
export function buildServeOptions(store: Store, hub: FanoutHub) {
  return {
    hostname: config.host,
    port: config.port,
    // Long-ish idle timeout so a slow bcrypt verify under load never severs the
    // connection (mirrors the Keepance Bun idleTimeout gotcha).
    idleTimeout: 60,
    async fetch(req: Request, srv: Bun.Server<SyncSocketData>): Promise<Response | undefined> {
      const url = new URL(req.url);
      const path = url.pathname;
      const method = req.method;
      const ip = clientIpFromPeer(srv.requestIP(req)?.address, req.headers.get("x-forwarded-for"));

        if (method === "OPTIONS") return preflight();

      try {
        // --- Sender-blind sealed notification relay (03 §2) ---
        if (path === "/notify/send" && method === "POST") return await handleNotifySend(req, store, ip, notificationHub);
        if (path === "/notify/inbox" && method === "GET") return handleNotifyInbox(req, store);
        if (path === "/notify/ack" && method === "POST") return await handleNotifyAck(req, store);
        if (path === "/notify/sync-ticket" && method === "POST") return await handleNotifySyncTicket(req, store);
        if (path === "/notify/terminal" && method === "POST") return await handleNotifyTerminal(req, store);
        if (path === "/notify/sync" && method === "GET" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          const authz = authorizeNotifySync(req, store);
          if (!authz.ok) return authz.resp;
          if (srv.upgrade(req, { data: { kind: "notify", subId: randomUUID(), orgId: authz.orgId, userId: authz.userId, seatId: authz.seatId, sessionId: authz.sessionId } })) return undefined;
          return error("upgrade_failed", 400);
        }
        // --- E2EE sync relay + matter ACL (chunk 2) ---
        // The WebSocket upgrade is handled before normal routing so the relay
        // live fan-out shares the same access gate as the HTTP endpoints.
        const mm = matchMatter(path);
        if (mm) {
          // Mint a single-use WS connect ticket (authed; runs the relay gate).
          if (mm.rest === "sync-ticket" && method === "POST") return handleSyncTicket(req, store, mm.id, ip);
          // Live sync socket: GET /matter/:id/sync?ticket=<t> (Upgrade: websocket).
          // The upgrade carries ONLY a single-use ticket — never the access/seat
          // token — so no credential can land in an access log or browser history.
          if (mm.rest === "sync" && method === "GET" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
            const authz = authorizeSyncConnect(req, store, mm.id);
            if (!authz.ok) return authz.resp;
            // Read the doc_id from the query string (absent → '_notes').
            const syncDocId = url.searchParams.get("doc_id") ?? "_notes";
            const sinceRaw = url.searchParams.get("since") ?? "0";
            const syncSince = Number(sinceRaw);
            if (!Number.isInteger(syncSince) || syncSince < 0) return error("invalid_cursor", 400);
            const data: DocumentSocketData = { kind: "document", subId: randomUUID(), docId: syncDocId, since: syncSince, subscriptions: new Set(), ...authz.data };
            if (srv.upgrade(req, { data })) return undefined; // upgraded; Bun owns the socket now
            return error("upgrade_failed", 400);
          }
          // Relay: append / catch-up. Push broadcasts via this server's hub.
          if (mm.rest === "updates" && method === "POST") return await handlePushUpdate(req, store, mm.id, ip, hub);
          if (mm.rest === "updates" && method === "GET") return handlePullUpdates(req, store, mm.id, ip);
          // Checkpoint chunks are opaque; only control metadata reaches the relay.
          if (mm.rest === "checkpoints/chunks" && method === "POST") return await handleCheckpointChunk(req, store, mm.id);
          if (mm.rest === "checkpoints/manifest" && method === "POST") return await handleCheckpointManifest(req, store, mm.id);
          if (mm.rest === "checkpoints/receipt" && method === "POST") return await handleCheckpointReceipt(req, store, mm.id);
          if (mm.rest === "checkpoints/prune" && method === "POST") return await handleCheckpointPrune(req, store, mm.id);
          // Admin: membership + walls (scoped to :id).
          if (mm.rest === "members/add" && method === "POST") return await handleAddMatterMember(req, store, mm.id);
          if (mm.rest === "members/remove" && method === "POST") return await handleRemoveMatterMember(req, store, mm.id);
          if (mm.rest === "members/list" && method === "POST") return handleListMatterMembers(req, store, mm.id);
          if (mm.rest === "wall/set" && method === "POST") return await handleSetWall(req, store, mm.id);
          if (mm.rest === "wall/clear" && method === "POST") return await handleClearWall(req, store, mm.id);
          if (mm.rest === "archive" && method === "POST") return handleArchiveMatter(req, store, mm.id);
          // Phase 1: wrapped matter-key distribution.
          if (mm.rest === "keys/publish" && method === "POST") return await handlePublishMatterKeys(req, store, mm.id);
          if (mm.rest === "keys/fetch" && method === "POST") return await handleFetchMatterKey(req, store, mm.id);
        }
        // Phase 1: /matter/mine (before the :id match so it doesn't accidentally match).
        if (path === "/matter/mine" && method === "POST") return await handleMatterMine(req, store);
        // Admin: matter collection.
        if (path === "/org/matters" && method === "POST") return await handleCreateMatter(req, store);
        if (path === "/org/matters/list" && method === "POST") return handleListMatters(req, store);

        // --- Lantern Intake relay (write-only public mailbox) ---
        if (path === "/intake" && method === "POST") return await handleCreateIntake(req, store);
        if (path === "/intake/granted" && method === "GET") return handleListGrantedIntakes(req, store);
        const ii = matchIntake(path);
        if (ii) {
          if (ii.rest === "keys" && method === "POST") return await handlePublishIntakeKeys(req, store, ii.id);
          if (ii.rest === "keys" && method === "GET") return handleFetchIntakeKey(req, store, ii.id);
          if (ii.rest === "checklist" && method === "PUT") return await handleReplaceIntakeChecklist(req, store, ii.id);
          if (ii.rest === "inbox" && method === "GET") return handleIntakeInbox(req, store, ii.id);
          const blob = ii.rest.match(/^blob\/([^/]+)$/);
          if (blob && method === "GET") return handleGetIntakeBlob(req, store, ii.id, decodeURIComponent(blob[1]!));
          if (ii.rest === "ack" && method === "POST") return await handleAckIntake(req, store, ii.id);
          if (ii.rest === "revoke" && method === "POST") return handleRevokeIntake(req, store, ii.id);
          if (ii.rest === "extend" && method === "POST") return await handleExtendIntake(req, store, ii.id);
          if (ii.rest === "regenerate" && method === "POST") return await handleRegenerateIntake(req, store, ii.id);
          if (ii.rest === "bundle" && method === "GET") return handleIntakeBundle(req, store, ii.id, ip);
          if (ii.rest === "state" && method === "PUT") return await handleSaveIntakeState(req, store, ii.id, ip);
          const item = ii.rest.match(/^item\/([^/]+)\/(chunk|chunks|submit)$/);
          if (item && item[2] === "chunks" && method === "GET") {
            return handleListUploadedIntakeChunks(req, store, ii.id, decodeURIComponent(item[1]!), ip);
          }
          if (item && item[2] === "chunk" && method === "POST") {
            return await handleUploadIntakeChunk(req, store, ii.id, decodeURIComponent(item[1]!), ip);
          }
          if (item && item[2] === "submit" && method === "POST") {
            return await handleSubmitIntakeItem(req, store, ii.id, decodeURIComponent(item[1]!), ip);
          }
        }

        // --- Blind DocuSign signing broker (Wave 9) ---
        const ds = matchDocusignSigning(path);
        if (ds) {
          if (ds.rest === "capability" && method === "POST") return await handleIssueSigningCapability(req, store, ds.id);
          if (ds.rest === "launch" && method === "PUT") return await handlePutSignatureLaunch(req, store, ds.id);
          if (ds.rest === "launch" && method === "GET") return await handleGetSignatureLaunch(req, store, ds.id, ip);
          if (ds.rest === "launch" && method === "DELETE") return await handleDeleteSignatureLaunch(req, store, ds.id);
          if (ds.rest === "envelope" && method === "POST") return await handleRegisterEnvelope(req, store, ds.id);
          if (ds.rest === "wakeups" && method === "GET") return await handleListSignatureWakeups(req, store, ds.id);
          if (ds.rest === "wakeups/ack" && method === "POST") return await handleAckSignatureWakeups(req, store, ds.id);
        }

        // --- Health (open) ---
        if (path === "/healthz" && method === "GET") {
          return json({ ok: true, service: "keepance-firm-backend", version: "0.1.0" });
        }
        // Public key the desktop client embeds to verify seat tokens offline.
        if (path === "/.well-known/seat-pubkey" && method === "GET") {
          return new Response(config.seatPublicKeyPem, { status: 200, headers: { "content-type": "application/x-pem-file", "Access-Control-Allow-Origin": "*" } });
        }

        // --- Auth ---
        if (path === "/auth/login" && method === "POST") return await handleLogin(req, store, ip);
        if (path === "/auth/refresh" && method === "POST") return await handleRefresh(req, store, ip);
        if (path === "/auth/logout" && method === "POST") return await handleLogout(req, store);
        if (path === "/auth/me" && method === "GET") return handleMe(req, store);
        if (path === "/auth/sso/start" && method === "POST") return await handleSsoStart(req, store, ip);
        if (path === "/auth/sso/callback" && method === "GET") return await handleSsoCallback(req, store, ip);
        if (path === "/auth/sso/exchange" && method === "POST") return await handleSsoExchange(req, store, ip);

        // --- Licensing / seats (client-facing core) ---
        if (path === "/org/activate" && method === "POST") return await handleActivate(req, store);
        if (path === "/seat/validate" && method === "POST") return await handleSeatValidate(req, store);
        if (path === "/seat/heartbeat" && method === "POST") return await handleSeatHeartbeat(req, store);

        // --- Admin (role=admin) ---
        if (path === "/org/seats" && method === "POST") return await handleListSeats(req, store);
        if (path === "/org/seat/revoke" && method === "POST") return await handleRevokeSeat(req, store);
        if (path === "/org/user/deprovision" && method === "POST") return await handleDeprovisionUser(req, store);
        if (path === "/org/seats/transfer" && method === "POST") return await handleTransferSeat(req, store);
        if (path === "/org/users" && method === "POST") return await handleCreateUser(req, store);
        if (path === "/org/users/list" && method === "POST") return handleListOrgUsers(req, store);
        if (path === "/org/audit" && (method === "POST" || method === "GET")) return handleAudit(req, store);
        if (path === "/org/sso/config/set" && method === "POST") return await handleSsoConfigSet(req, store);
        if (path === "/org/sso/config/get" && method === "POST") return handleSsoConfigGet(req, store);
        if (path === "/org/sso/config/delete" && method === "POST") return handleSsoConfigDelete(req, store);

        // --- Assured zero-retention inference proxy (chunk 3, DECISION.md §5) ---
        // The proxy endpoint takes the request BODY as an opaque stream and pipes
        // it upstream untouched — it is handled directly with `req` and never
        // routed through any body-reading/logging middleware.
        if (path === "/assured/infer" && method === "POST") return await handleAssuredInfer(req, store, ip);
        // Admin: managed provider keys + metadata-only billing.
        if (path === "/assured/keys/set" && method === "POST") return await handleSetProviderKey(req, store);
        if (path === "/assured/keys/list" && method === "POST") return handleListProviderKeys(req, store);
        if (path === "/assured/keys/delete" && method === "POST") return await handleDeleteProviderKey(req, store);
        if (path === "/assured/billing" && method === "POST") return handleInferenceBilling(req, store);

        // --- Phase 1: device key registration ---
        if (path === "/device/register" && method === "POST") return await handleDeviceRegister(req, store);
        if (path === "/org/users/devices" && method === "POST") return await handleListUsersDevices(req, store);
        if (path === "/org/admins" && method === "POST") return await handleListOrgAdmins(req, store);

        // --- Phase 1: org claim (self-serve activation) ---
        if (path === "/org/claim" && method === "POST") return await handleOrgClaim(req, store);

        // --- Phase 1: LemonSqueezy webhook ---
        if (path === "/webhooks/lemonsqueezy" && method === "POST") return await handleLemonSqueezyWebhook(req, store);
        if (path === "/webhooks/docusign-signing" && method === "POST") return await handleDocusignConnectEvent(req);

        // --- Provisioning (billing-driven; protect at network layer) ---
        // The fixed TEST firm is loopback-only and authenticates before any body read.
        if (path === "/admin/test-firm" && method === "POST") return await handleTestFirmProvision(req, store);
        if (path === "/admin/test-firm/retire" && method === "POST") return handleTestFirmRetirement(req, store);
        if (path === "/admin/org" && method === "POST") return await handleCreateOrg(req, store);

        return error("not_found", 404);
      } catch (err) {
        // Log the method + PATH only — never `req.url` / the query string. Even
        // though credentials no longer ride in any relay URL, scrubbing the query
        // is defense in depth so a stray token (or a future param) can't reach a
        // log file. `path` is `url.pathname` (no query) by construction.
        console.error(`[error] ${method} ${path}:`, err);
        return error("internal_error", 500);
      }
    },

    // Live fan-out for the sync relay. The connection is already access-gated in
    // `fetch` (authorizeSyncConnect) before upgrade, so a walled / non-member /
    // cross-org socket never gets here. We register the socket as a Subscriber and
    // subscribe BEFORE capturing a historical watermark, then page every update
    // from the client's `since` cursor through that watermark. Updates written
    // after the watermark are delivered by the live subscription. This closes
    // the pull-then-subscribe gap without asking the relay to inspect ciphertext.
    // We never read inbound socket frames as document data: pushes go through the
    // audited HTTP POST so every write is gated + recorded.
    websocket: {
      open(ws: Bun.ServerWebSocket<SyncSocketData>) {
        const d = ws.data;
        if (d.kind === "notify") {
          notificationHub.subscribe(d.orgId, d.userId, d.subId, (frame) => {
            if (!liveSocketAllowed(store, d)) { notificationHub.unsubscribe(d.orgId, d.userId, d.subId); ws.close(1008, "authorization_revoked"); return; }
            try { ws.send(JSON.stringify(frame)); } catch { /* close handler prunes */ }
          });
          return;
        }
        subscribeDocument(ws, store, hub, d.matterId, d.docId, d.since);
      },
      message(ws: Bun.ServerWebSocket<SyncSocketData>, message: string | Buffer) {
        const d = ws.data;
        if (d.kind !== "document") return;
        let frame: { type?: unknown; matter_id?: unknown; doc_id?: unknown; since?: unknown };
        try { frame = JSON.parse(typeof message === "string" ? message : message.toString("utf8")); } catch { return; }
        if (frame.type === "subscribe" && typeof frame.matter_id === "string" && frame.matter_id.length && typeof frame.doc_id === "string" && frame.doc_id.length && Number.isInteger(frame.since) && (frame.since as number) >= 0) {
          subscribeDocument(ws, store, hub, frame.matter_id, frame.doc_id, frame.since as number);
        }
        if (frame.type === "unsubscribe" && typeof frame.matter_id === "string" && typeof frame.doc_id === "string") {
          const channel = documentChannel(frame.matter_id, frame.doc_id);
          if (d.subscriptions.delete(channel)) {
            hub.unsubscribe(frame.matter_id, `${d.subId}:${channel}`, frame.doc_id);
            hub.broadcastPresence(frame.matter_id, frame.doc_id);
          }
        }
      },
      close(ws: Bun.ServerWebSocket<SyncSocketData>) {
        const d = ws.data;
        if (d.kind === "notify") {
          notificationHub.unsubscribe(d.orgId, d.userId, d.subId);
          return;
        }
        for (const channel of d.subscriptions) {
          const [matterId, docId] = channel.split("\u0000", 2);
          if (!matterId || !docId) continue;
          hub.unsubscribe(matterId, `${d.subId}:${channel}`, docId);
          hub.broadcastPresence(matterId, docId);
        }
      },
    },
  };
}

const store = getStore();
maybeBootstrap(store);
startRateLimitGc();
startSyncTicketGc();
startSsoStateGc();
startIntakeRetentionSweep(store);

const server = Bun.serve<SyncSocketData>(buildServeOptions(store, fanout));

console.log(`[startup] keepance-firm-backend listening on http://${server.hostname}:${server.port}`);
console.log(`[startup] DB: ${config.dbPath}`);
console.log(`[startup] seat-token public key fingerprint: ${hmacHash(config.seatPublicKeyPem).slice(0, 16)}`);

/**
 * Optional dev bootstrap: create an org + admin + license key on first boot so
 * the API is immediately exercisable. No-op if the org already exists or env is
 * unset. The license key is printed once to the server log (dev convenience).
 */
async function maybeBootstrap(store: Store): Promise<void> {
  const b = config.bootstrap;
  if (!b.orgName || !b.adminEmail || !b.adminPassword) return;
  if (store.findOrgByName(b.orgName)) {
    console.log(`[bootstrap] org "${b.orgName}" already exists — skipping.`);
    return;
  }
  if (!config.isTest && b.adminPassword.length < 12) {
    console.warn("[bootstrap] BOOTSTRAP_ADMIN_PASSWORD too short (<12) — skipping bootstrap.");
    return;
  }
  const plan = (["personal", "professional", "practice"].includes(b.plan) ? b.plan : "practice") as
    | "personal"
    | "professional"
    | "practice";
  const org = store.createOrg({ name: b.orgName, plan, packs: plan === "practice" ? ["advisor", "legal", "tax", "consulting"] : [], seat_limit: b.seatLimit });
  const hash = await hashPassword(b.adminPassword);
  const admin = store.createUser({ org_id: org.org_id, email: b.adminEmail, password_hash: hash, role: "admin" });
  const key = generateLicenseKey();
  store.createLicenseKey({ org_id: org.org_id, key_hash: hmacHash(key), plan, packs: org.packs, seat_limit: b.seatLimit });
  store.audit({ org_id: org.org_id, actor_user_id: admin.user_id, action: "org.create", target: org.org_id, detail: { via: "bootstrap" } });
  console.log(`[bootstrap] created org "${org.org_id}" admin=${b.adminEmail} seat_limit=${b.seatLimit}`);
  console.log(`[bootstrap] LICENSE KEY (shown once): ${key}`);
}

export { server };

/**
 * A single-instance relay can sweep locally. Run once at boot and daily after
 * that; the database operation only deletes expired mailbox rows and cascades
 * their opaque ciphertext. The log intentionally contains a count, not ids.
 */
function startIntakeRetentionSweep(store: Store): ReturnType<typeof setInterval> {
  const sweep = () => {
    const result = store.purgeExpiredIntakeCiphertext();
    if (result.deleted_intakes > 0) console.info(`[intake-retention] deleted ${result.deleted_intakes} expired mailbox(es)`);
  };
  sweep();
  const timer = setInterval(sweep, 24 * 60 * 60 * 1000);
  if (typeof timer.unref === "function") timer.unref();
  return timer;
}
