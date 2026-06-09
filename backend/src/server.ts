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
} from "./routes/admin.ts";
import type { Store } from "./lib/db.ts";

const store = getStore();
maybeBootstrap(store);
startRateLimitGc();

const server = Bun.serve({
  hostname: config.host,
  port: config.port,
  // Long-ish idle timeout so a slow bcrypt verify under load never severs the
  // connection (mirrors the Keepance Bun idleTimeout gotcha).
  idleTimeout: 60,
  async fetch(req, srv) {
    const url = new URL(req.url);
    const path = url.pathname;
    const method = req.method;
    const ip = srv.requestIP(req)?.address ?? "unknown";

    if (method === "OPTIONS") return preflight();

    try {
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
      if (path === "/org/audit" && (method === "POST" || method === "GET")) return handleAudit(req, store);

      // --- Provisioning (billing-driven; protect at network layer) ---
      if (path === "/admin/org" && method === "POST") return await handleCreateOrg(req, store);

      return error("not_found", 404);
    } catch (err) {
      console.error(`[error] ${method} ${path}:`, err);
      return error("internal_error", 500);
    }
  },
});

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
  const org = store.createOrg({ name: b.orgName, plan, packs: plan === "practice" ? ["legal", "tax", "consulting"] : [], seat_limit: b.seatLimit });
  const hash = await hashPassword(b.adminPassword);
  const admin = store.createUser({ org_id: org.org_id, email: b.adminEmail, password_hash: hash, role: "admin" });
  const key = generateLicenseKey();
  store.createLicenseKey({ org_id: org.org_id, key_hash: hmacHash(key), plan, packs: org.packs, seat_limit: b.seatLimit });
  store.audit({ org_id: org.org_id, actor_user_id: admin.user_id, action: "org.create", target: org.org_id, detail: { via: "bootstrap" } });
  console.log(`[bootstrap] created org "${org.org_id}" admin=${b.adminEmail} seat_limit=${b.seatLimit}`);
  console.log(`[bootstrap] LICENSE KEY (shown once): ${key}`);
}

export { server };
