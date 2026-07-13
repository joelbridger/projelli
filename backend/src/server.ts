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

import { config } from "./lib/config.ts";
import { getStore } from "./lib/db.ts";
import { json, error, preflight, rejectOpaqueV2Preflight, startRateLimitGc } from "./lib/http.ts";
import { validateV2RelayBoundary } from "./lib/v2Payload.ts";
import { V2_FIRM_ROUTE_SPECS, isDeclaredV2FirmRoute, v2FirmRouteSpec } from "./lib/v2RouteInventory.ts";
import { FIRM_PERSISTENT_ROUTE_SPECS, FIRM_SERVER_ROUTE_TABLE, assertFirmPersistentRouteInventoryComplete, isDeclaredFirmServerRoute, type FirmPersistentRouteId } from "./lib/firmPersistentRouteInventory.ts";
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
  handleReleaseMatterStream,
  handleListMatterStreams,
  handleAddMatterMember,
  handleRemoveMatterMember,
  handleListMatterMembers,
  handleSetWall,
  handleClearWall,
  handleActivateMatter,
  handlePushUpdate,
  handlePullUpdates,
  handleSyncTicket,
  authorizeSyncConnect,
} from "./routes/matters.ts";
import { fanout, FanoutHub, gateMatterAccess, verifyTicketSeatBinding, toUpdateFrame, type Subscriber } from "./lib/matters.ts";
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
import { handlePublishIntakeKeys, handleFetchIntakeKey } from "./routes/intakeKeys.ts";
import { handleOrgClaim } from "./routes/claim.ts";
import { handleSsoConfigSet, handleSsoConfigGet, handleSsoConfigDelete, handleSsoStart, handleSsoCallback, handleSsoExchange } from "./routes/sso.ts";
import { handleLemonSqueezyWebhook } from "./routes/webhooks.ts";
import { randomUUID } from "node:crypto";
import type { Store } from "./lib/db.ts";

/**
 * Non-v2 firm routes which can write caller-provided data are dispatched from
 * their executable input inventory. A new route must therefore get a table
 * entry before it can become reachable, just like the opaque v2 relay routes.
 */
const FIRM_PERSISTENT_HANDLERS: Partial<Record<FirmPersistentRouteId, (req: Request, store: Store, hub: FanoutHub) => Promise<Response>>> = {
  deviceRegister: handleDeviceRegister,
  activateSeat: handleActivate,
  transferSeat: handleTransferSeat,
  orgClaim: handleOrgClaim,
};

async function dispatchFirmPersistentRoute(path: string, method: string, req: Request, store: Store, hub: FanoutHub): Promise<Response | null> {
  const spec = FIRM_PERSISTENT_ROUTE_SPECS.find((candidate) => candidate.path === path && candidate.method === method);
  if (!spec) return null;
  const handler = FIRM_PERSISTENT_HANDLERS[spec.id];
  return handler ? handler(req, store, hub) : null;
}

/** Data attached to each sync WebSocket on upgrade (set by authorizeSyncConnect). */
export interface SyncSocketData {
  subId: string;
  matterHandle: string;
  streamHandle: string;
  orgId: string;
  userId: string;
  seatId: string;
  role: "admin" | "member";
  since: number;
}

/**
 * Extract a v2 matter route. Returns the opaque handle and trailing segment
 * (e.g. "updates", "members/add", "" for the bare matter). The handle is a
 * single path segment; we never let it contain a slash.
 */
function matchMatter(path: string): { handle: string; rest: string } | null {
  const m = path.match(/^\/v2\/firm\/matters\/([^/]+)(?:\/(.*))?$/);
  // Never decode an opaque route segment. A percent escape can throw while
  // decoding and the raw URL is often captured by infrastructure logs. The
  // handle grammar deliberately excludes `%`, so malformed encodings fail as
  // an ordinary opaque miss before any decoder sees client text.
  if (!m || !/^mh2_[A-Za-z0-9_-]{43}$/.test(m[1]!)) return null;
  return { handle: m[1]!, rest: m[2] ?? "" };
}

/** Flat stream routes keep the parent matter handle out of URLs and access logs. */
function matchStream(path: string): { handle: string; operation: "updates" | "sync-ticket" } | null {
  const m = path.match(/^\/v2\/firm\/streams\/([^/]+)\/(updates|sync-ticket)$/);
  if (!m || !/^sh2_[A-Za-z0-9_-]{43}$/.test(m[1]!)) return null;
  return { handle: m[1]!, operation: m[2]! as "updates" | "sync-ticket" };
}

/** Intake key exchange uses a separate opaque handle surface from matters. */
function matchIntake(path: string): { handle: string; operation: "keys/publish" | "keys/fetch" } | null {
  const m = path.match(/^\/v2\/firm\/intake\/([^/]+)\/(keys\/publish|keys\/fetch)$/);
  if (!m || !/^ih2_[A-Za-z0-9_-]{43}$/.test(m[1]!)) return null;
  return { handle: m[1]!, operation: m[2]! as "keys/publish" | "keys/fetch" };
}

/**
 * Build the Bun.serve options for a given Store + fan-out hub. Factored out (vs.
 * an inline object) so tests can boot an isolated server on an ephemeral port
 * with their own in-memory store + hub, exercising the SAME routes + WebSocket
 * fan-out as production — no logic duplication, no cross-file server-lifecycle
 * coupling.
 */
export interface RelayTrafficRecorder {
  onWebSocketFrame?(frame: unknown): void;
}

/**
 * Subscribe a freshly-upgraded socket only after a second access decision.
 *
 * Ticket redemption approves the upgrade, but archive can commit between that
 * approval and Bun calling `open`. This final synchronous gate sits directly
 * beside subscription and backlog delivery, closing that narrow window.
 */
export function subscribeSyncSocket(
  store: Store,
  hub: FanoutHub,
  ws: Pick<Bun.ServerWebSocket<SyncSocketData>, "data" | "send" | "close">,
  traffic?: RelayTrafficRecorder,
): void {
  const d = ws.data;
  const seat = verifyTicketSeatBinding(store, { seat_id: d.seatId, user_id: d.userId, org_id: d.orgId });
  const access = gateMatterAccess(store, { org_id: d.orgId, user_id: d.userId, role: d.role }, d.matterHandle, "connect_subscribe");
  // A ticket can be redeemed before release and the release can commit before
  // Bun calls `open`; access alone is not enough because stream release does
  // not archive the enclosing matter.
  if (!seat.ok || !access.ok || !store.streamBelongsToMatter(d.streamHandle, d.matterHandle)) {
    ws.close(1008, "access_denied");
    return;
  }
  const sendFrame = (frame: unknown) => {
    traffic?.onWebSocketFrame?.(frame);
    ws.send(JSON.stringify(frame));
  };
  const sub: Subscriber = {
    id: d.subId,
    user_id: d.userId,
    seat_id: d.seatId,
    org_id: d.orgId,
    send: (frame) => {
      try {
        sendFrame(frame);
      } catch {
        /* dead socket; close handler prunes */
      }
    },
    close: () => ws.close(1008, "matter_archived"),
  };
  // Subscribe to the (matter, docId) channel so only that doc's frames arrive.
  hub.subscribe(d.matterHandle, sub, d.streamHandle);
  // Catch-up backlog (opaque bytes, base64; never logged).
  try {
    const backlog = store.getMatterUpdatesSince(d.matterHandle, d.streamHandle, d.since, 500);
    const subscribers = hub.subscriberCount(d.matterHandle, d.streamHandle);
    sendFrame({ type: "ready", backlog: backlog.length, replay_from_cursor: d.since, latest_cursor: store.latestMatterCursor(d.matterHandle, d.streamHandle), subscribers });
    for (const u of backlog) sendFrame(toUpdateFrame(u));
  } catch {
    /* best-effort backlog */
  }
  // Broadcast updated subscriber count to all connected peers (including self).
  hub.broadcastPresence(d.matterHandle, d.streamHandle);
}

export function buildServeOptions(store: Store, hub: FanoutHub, traffic?: RelayTrafficRecorder) {
  // Keep the executable input inventory live in production as well as tests.
  // A typo or missing entry fails server construction instead of silently
  // leaving a new route outside the hostile-client proof.
  for (const route of V2_FIRM_ROUTE_SPECS) v2FirmRouteSpec(route.id);
  // This is a construction-time control, not a one-off audit. The route table
  // below is the gate for every non-v2 firm endpoint, and every row marked as
  // writing data or an audit record must have a classified inventory entry.
  assertFirmPersistentRouteInventoryComplete(FIRM_SERVER_ROUTE_TABLE);
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
      const ip = srv.requestIP(req)?.address ?? "unknown";

      const isV2FirmPath = path.startsWith("/v2/firm/");
      // Preflight routing is part of the inventory gate, not a separate early
      // return. Keep this before *all* CORS headers so an undeclared URL never
      // becomes an accepted browser route (or a tempting access-log exception).
      if (isV2FirmPath && method === "OPTIONS") {
        const requestedMethod = req.headers.get("access-control-request-method");
        if (!requestedMethod || !isDeclaredV2FirmRoute(path, requestedMethod.toUpperCase())) return rejectOpaqueV2Preflight();
      }

      // The v2 boundary runs even for a CORS preflight: an OPTIONS cannot reach a
      // handler, but its URL still reaches proxy/access logs, which is exactly the
      // disclosure this relay exists to prevent. Fail closed first, preflight after.
      const v2Boundary = isV2FirmPath ? await validateV2RelayBoundary(req) : null;
      if (v2Boundary) return error(v2Boundary, 400);

      if (method === "OPTIONS") return preflight();

      // The inventory is an allow-list, not merely documentation. A new v2
      // handler is unreachable until its route and every client field are in
      // the shared table that drives the hostile-client privacy proof.
      if (isV2FirmPath && !isDeclaredV2FirmRoute(path, method)) return error("not_found", 404);
      // Do not leave a second, direct-dispatch route outside the inventory.
      // All non-v2 firm endpoints must be named in the server's route table;
      // therefore a future write route is unreachable until its declaration is
      // added and construction verifies its classified input inventory.
      if (!isV2FirmPath && !isDeclaredFirmServerRoute(path, method)) {
        if (path.startsWith("/matter/") || (path.startsWith("/org/") && ["matters", "matters/list"].includes(path.slice("/org/".length)))) return error("firm_relay_upgrade_required", 426);
        return error("not_found", 404);
      }

      try {
        // --- E2EE sync relay + matter ACL (chunk 2) ---
        // The WebSocket upgrade is handled before normal routing so the relay
        // live fan-out shares the same access gate as the HTTP endpoints.
        if (path === "/v2/firm/matters/mine" && method === "POST") return await handleMatterMine(req, store);
        if (path === "/v2/firm/matters/list" && method === "POST") return await handleListMatters(req, store);
        if (path === "/v2/firm/sync" && method === "GET" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          v2FirmRouteSpec("syncSocket");
          const authz = authorizeSyncConnect(req, store);
          if (!authz.ok) return authz.resp;
          const data: SyncSocketData = { subId: randomUUID(), ...authz.data };
          if (srv.upgrade(req, { data })) return undefined;
          return error("upgrade_failed", 400);
        }
        const sm = matchStream(path);
        if (sm) {
          const stream = sm.handle;
          const matterHandle = store.getMatterHandleForStream(stream);
          // A flat handle has to be mapped internally before an ACL can be
          // evaluated, but that lookup is never exposed: unknown, released,
          // removed, and walled all receive this exact opaque denial.
          if (!matterHandle) return error("stream_access_denied", 404);
          if (sm.operation === "sync-ticket" && method === "POST") return await handleSyncTicket(req, store, matterHandle, stream, ip);
          if (sm.operation === "updates" && method === "POST") return error("stream_not_found", 404);
          if (sm.operation === "updates" && method === "GET") return await handlePullUpdates(req, store, matterHandle, stream, ip);
        }
        const intake = matchIntake(path);
        if (intake) {
          if (intake.operation === "keys/publish" && method === "POST") return await handlePublishIntakeKeys(req, store, intake.handle);
          if (intake.operation === "keys/fetch" && method === "POST") return await handleFetchIntakeKey(req, store, intake.handle);
        }
        const mm = matchMatter(path);
        if (mm) {
          // HTTP matter administration remains handle-scoped. Live sync uses
          // the fixed /v2/firm/sync ticket route handled above.
          if (mm.rest === "" && method === "POST") return error("invalid_v2_payload", 400);
          if (mm.rest === "activate" && method === "POST") return await handleActivateMatter(req, store, mm.handle);
          const streamPush = mm.rest.match(/^streams\/([^/]+)\/updates$/);
          if (streamPush && method === "POST") return await handlePushUpdate(req, store, mm.handle, streamPush[1]!, ip, hub);
          // Relay: append / catch-up. Push broadcasts via this server's hub.
          // Admin: membership + walls (scoped to :id).
          if (mm.rest === "members/add" && method === "POST") return await handleAddMatterMember(req, store, mm.handle);
          if (mm.rest === "members/remove" && method === "POST") return await handleRemoveMatterMember(req, store, mm.handle);
          if (mm.rest === "members/list" && method === "POST") return await handleListMatterMembers(req, store, mm.handle);
          if (mm.rest === "wall/set" && method === "POST") return await handleSetWall(req, store, mm.handle);
          if (mm.rest === "wall/clear" && method === "POST") return await handleClearWall(req, store, mm.handle);
          if (mm.rest === "archive" && method === "POST") return await handleArchiveMatter(req, store, mm.handle, hub);
          if (mm.rest === "streams/release" && method === "POST") return await handleReleaseMatterStream(req, store, mm.handle, hub);
          if (mm.rest === "streams/list" && method === "POST") return await handleListMatterStreams(req, store, mm.handle);
          // Phase 1: wrapped matter-key distribution.
          if (mm.rest === "keys/publish" && method === "POST") return await handlePublishMatterKeys(req, store, mm.handle);
          if (mm.rest === "keys/fetch" && method === "POST") return await handleFetchMatterKey(req, store, mm.handle);
        }
        // Admin: matter collection.
        if (path === "/v2/firm/matters" && method === "POST") return await handleCreateMatter(req, store);
        if (path.startsWith("/matter/") || (path.startsWith("/org/") && ["matters", "matters/list"].includes(path.slice("/org/".length)))) return error("firm_relay_upgrade_required", 426);

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

        const persistentRouteResponse = await dispatchFirmPersistentRoute(path, method, req, store, hub);
        if (persistentRouteResponse) return persistentRouteResponse;

        // --- Licensing / seats (client-facing core) ---
        if (path === "/seat/validate" && method === "POST") return await handleSeatValidate(req, store);
        if (path === "/seat/heartbeat" && method === "POST") return await handleSeatHeartbeat(req, store);

        // --- Admin (role=admin) ---
        if (path === "/org/seats" && method === "POST") return await handleListSeats(req, store);
        if (path === "/org/seat/revoke" && method === "POST") return await handleRevokeSeat(req, store, hub);
        if (path === "/org/user/deprovision" && method === "POST") return await handleDeprovisionUser(req, store, hub);
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
        if (path === "/org/users/devices" && method === "POST") return await handleListUsersDevices(req, store);
        if (path === "/org/admins" && method === "POST") return await handleListOrgAdmins(req, store);

        // --- Phase 1: LemonSqueezy webhook ---
        if (path === "/webhooks/lemonsqueezy" && method === "POST") return await handleLemonSqueezyWebhook(req, store);

        // --- Provisioning (billing-driven; protect at network layer) ---
        if (path === "/admin/org" && method === "POST") return await handleCreateOrg(req, store);

        return error("not_found", 404);
      } catch {
        // Do not log a URL, path, query, header, body, or thrown parser text:
        // all can contain attacker-controlled readable data. Route handlers
        // emit structured audit metadata only after validation.
        console.error("[error] relay_request_failed");
        return error("internal_error", 500);
      }
    },

    // Live fan-out for the sync relay. The upgrade is access-gated in `fetch`,
    // then `open` gates once more immediately before subscribing and delivering
    // backlog so a terminal archive cannot slip ciphertext through that window.
    websocket: {
      open(ws: Bun.ServerWebSocket<SyncSocketData>) {
        subscribeSyncSocket(store, hub, ws, traffic);
      },
      message(ws: Bun.ServerWebSocket<SyncSocketData>) {
        // This protocol is receive-only after the ticketed upgrade. Closing on
        // any inbound frame proves hostile frame text cannot become a log, audit,
        // database value, or echoed frame. Document writes use the HTTP relay.
        ws.close(1008, "inbound_frames_not_supported");
      },
      close(ws: Bun.ServerWebSocket<SyncSocketData>) {
        const d = ws.data;
        hub.unsubscribe(d.matterHandle, d.subId, d.streamHandle);
        // Broadcast updated presence count to remaining subscribers (no-op if all left).
        hub.broadcastPresence(d.matterHandle, d.streamHandle);
      },
    },
  };
}

const store = getStore();
maybeBootstrap(store);
startRateLimitGc();
startSyncTicketGc();
startSsoStateGc();

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
