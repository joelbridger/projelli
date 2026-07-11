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
  handleActivateMatter,
  handleAllocateStream,
  handlePushUpdate,
  handlePullUpdates,
  handleSyncTicket,
  authorizeSyncConnect,
} from "./routes/matters.ts";
import { fanout, FanoutHub, toUpdateFrame, type Subscriber } from "./lib/matters.ts";
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
import { handlePublishMatterKeys, handleFetchMatterKey, handleMatterMine, handleMigrationManifest, handleMigrationComplete } from "./routes/matterKeys.ts";
import { handleOrgClaim } from "./routes/claim.ts";
import { handleSsoConfigSet, handleSsoConfigGet, handleSsoConfigDelete, handleSsoStart, handleSsoCallback, handleSsoExchange } from "./routes/sso.ts";
import { handleLemonSqueezyWebhook } from "./routes/webhooks.ts";
import { randomUUID } from "node:crypto";
import type { Store } from "./lib/db.ts";

/** Data attached to each sync WebSocket on upgrade (set by authorizeSyncConnect). */
export interface SyncSocketData {
  subId: string;
  matterHandle: string;
  streamHandle: string;
  orgId: string;
  userId: string;
  seatId: string;
}

/**
 * Extract a `/matter/:id/...` path. Returns the matter id and the trailing
 * segment (e.g. "updates", "members/add", "" for the bare matter). The id is a
 * single path segment; we never let it contain a slash.
 */
function matchMatter(path: string): { handle: string; rest: string } | null {
  const m = path.match(/^\/v2\/firm\/matters\/([^/]+)(?:\/(.*))?$/);
  if (!m) return null;
  return { handle: decodeURIComponent(m[1]!), rest: m[2] ?? "" };
}

/** Flat stream routes keep the parent matter handle out of URLs and access logs. */
function matchStream(path: string): { handle: string; operation: "updates" | "sync-ticket" } | null {
  const m = path.match(/^\/v2\/firm\/streams\/([^/]+)\/(updates|sync-ticket)$/);
  if (!m) return null;
  return { handle: decodeURIComponent(m[1]!), operation: m[2]! as "updates" | "sync-ticket" };
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
      const ip = srv.requestIP(req)?.address ?? "unknown";

      if (method === "OPTIONS") return preflight();

      try {
        // --- E2EE sync relay + matter ACL (chunk 2) ---
        // The WebSocket upgrade is handled before normal routing so the relay
        // live fan-out shares the same access gate as the HTTP endpoints.
        if (path === "/v2/firm/matters/mine" && method === "POST") return await handleMatterMine(req, store);
        if (path === "/v2/firm/migration-manifest" && method === "POST") return await handleMigrationManifest(req, store);
        if (path === "/v2/firm/migration-complete" && method === "POST") return await handleMigrationComplete(req, store);
        if (path === "/v2/firm/matters/list" && method === "POST") return handleListMatters(req, store);
        if (path === "/v2/firm/sync" && method === "GET" && req.headers.get("upgrade")?.toLowerCase() === "websocket") {
          if ([...url.searchParams.keys()].some((key) => key !== "ticket")) return error("invalid_v2_query", 400);
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
          if (!matterHandle) return error("stream_not_found", 404);
          if (sm.operation === "sync-ticket" && method === "POST") return handleSyncTicket(req, store, matterHandle, stream, ip);
          if (sm.operation === "updates" && method === "POST") return await handlePushUpdate(req, store, matterHandle, stream, ip, hub);
          if (sm.operation === "updates" && method === "GET") return handlePullUpdates(req, store, matterHandle, stream, ip);
        }
        const mm = matchMatter(path);
        if (mm) {
          // HTTP matter administration remains handle-scoped. Live sync uses
          // the fixed /v2/firm/sync ticket route handled above.
          if (mm.rest === "" && method === "POST") return error("invalid_v2_payload", 400);
          if (mm.rest === "activate" && method === "POST") return handleActivateMatter(req, store, mm.handle);
          if (mm.rest === "streams" && method === "POST") return handleAllocateStream(req, store, mm.handle);
          // Relay: append / catch-up. Push broadcasts via this server's hub.
          // Admin: membership + walls (scoped to :id).
          if (mm.rest === "members/add" && method === "POST") return await handleAddMatterMember(req, store, mm.handle);
          if (mm.rest === "members/remove" && method === "POST") return await handleRemoveMatterMember(req, store, mm.handle);
          if (mm.rest === "members/list" && method === "POST") return handleListMatterMembers(req, store, mm.handle);
          if (mm.rest === "wall/set" && method === "POST") return await handleSetWall(req, store, mm.handle);
          if (mm.rest === "wall/clear" && method === "POST") return await handleClearWall(req, store, mm.handle);
          if (mm.rest === "archive" && method === "POST") return handleArchiveMatter(req, store, mm.handle);
          // Phase 1: wrapped matter-key distribution.
          if (mm.rest === "keys/publish" && method === "POST") return await handlePublishMatterKeys(req, store, mm.handle);
          if (mm.rest === "keys/fetch" && method === "POST") return await handleFetchMatterKey(req, store, mm.handle);
        }
        // Admin: matter collection.
        if (path === "/v2/firm/matters" && method === "POST") return await handleCreateMatter(req, store);
        if (path.startsWith("/matter/") || path === "/org/matters" || path === "/org/matters/list") return error("firm_relay_upgrade_required", 426);

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

        // --- Provisioning (billing-driven; protect at network layer) ---
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
    // ship a `since=0` backlog so a late joiner catches up, then receives new
    // updates live. We never read inbound socket frames as document data: pushes
    // go through the audited HTTP POST so every write is gated + recorded.
    websocket: {
      open(ws: Bun.ServerWebSocket<SyncSocketData>) {
        const d = ws.data;
        const sub: Subscriber = {
          id: d.subId,
          user_id: d.userId,
          seat_id: d.seatId,
          send: (frame) => {
            try {
              ws.send(JSON.stringify(frame));
            } catch {
              /* dead socket; close handler prunes */
            }
          },
        };
        // Subscribe to the (matter, docId) channel so only that doc's frames arrive.
        hub.subscribe(d.matterHandle, sub, d.streamHandle);
        // Catch-up backlog (opaque bytes, base64; never logged).
        try {
          const backlog = store.getMatterUpdatesSince(d.matterHandle, d.streamHandle, 0, 500);
          const subscribers = hub.subscriberCount(d.matterHandle, d.streamHandle);
          ws.send(JSON.stringify({ type: "ready", backlog: backlog.length, latest_cursor: store.latestMatterCursor(d.matterHandle, d.streamHandle), subscribers }));
          for (const u of backlog) ws.send(JSON.stringify(toUpdateFrame(u)));
        } catch {
          /* best-effort backlog */
        }
        // Broadcast updated subscriber count to all connected peers (including self).
        hub.broadcastPresence(d.matterHandle, d.streamHandle);
      },
      message() {
        // Inbound socket frames are ignored on purpose. Awareness/presence would
        // ride a separate ephemeral channel; document writes use the HTTP relay so
        // they pass the access gate + audit. (DECISION.md §1.)
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
