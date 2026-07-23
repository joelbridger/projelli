/**
 * Single-use, short-lived WebSocket connect tickets for the E2EE sync relay.
 *
 * WHY THIS EXISTS (security): the browser `WebSocket` API cannot set request
 * headers, so the only way to authenticate a WS upgrade is via the URL. Putting
 * the access JWT + seat token in that URL leaks long-lived secrets into proxy
 * access logs, browser history, and referrer headers — exactly what a
 * confidentiality product must not do. Instead the client first proves identity
 * over an ORDINARY authed HTTPS request (`POST /matter/:id/sync-ticket`, which
 * runs the SAME access gate as the relay) and receives an opaque, high-entropy
 * ticket. Only that ticket rides on the WS URL (`?ticket=<t>`). A ticket is:
 *   - short-lived (default 30s) — a stray log entry is useless almost immediately
 *   - single-use — redeemed exactly once, then deleted (replay-proof)
 *   - bound to {matter, user, seat, org} — it can't be used for another matter
 *     or by another identity, and the redeemed identity is what the socket runs
 *     as (we never trust the URL's matter id alone)
 *
 * Storage is in-memory, mirroring the rate-limiter (`http.ts`). The relay is a
 * single-instance service (documented in README + matters.ts); a multi-instance
 * deployment would back this with the same Redis the fan-out hub would use. No
 * ticket value is ever logged.
 */

import { randomBytes } from "node:crypto";
import type { UserRole } from "./types.ts";

/** What a redeemed ticket authorizes — the identity the socket runs as. */
export interface SyncTicketBinding {
  matterId: string;
  orgId: string;
  userId: string;
  seatId: string;
  /** Session binding makes pre-retirement tickets inert at redemption time. */
  sid: string;
  /** The caller's role at mint time, so a connect-time re-check uses the right
   *  access path (an org admin's access doesn't depend on matter membership). */
  role: UserRole;
}

interface StoredTicket extends SyncTicketBinding {
  expiresAt: number; // epoch ms
}

/** Default ticket lifetime. Long enough to open a socket, short enough to be inert. */
export const SYNC_TICKET_TTL_MS = 30_000;

export class SyncTicketStore {
  private readonly tickets = new Map<string, StoredTicket>();
  private readonly ttlMs: number;

  constructor(ttlMs: number = SYNC_TICKET_TTL_MS) {
    this.ttlMs = ttlMs;
  }

  /**
   * Mint a fresh single-use ticket for a binding. Returns the opaque ticket
   * string (256 bits of entropy, URL-safe). The caller has ALREADY run the
   * access gate; this only records the grant.
   */
  mint(binding: SyncTicketBinding): { ticket: string; expiresInMs: number } {
    // 32 random bytes (256 bits), hex — URL-safe, no encoding needed in a query.
    const ticket = randomBytes(32).toString("hex");
    this.tickets.set(ticket, { ...binding, expiresAt: Date.now() + this.ttlMs });
    return { ticket, expiresInMs: this.ttlMs };
  }

  /**
   * Redeem a ticket EXACTLY once. On success the ticket is deleted (so a replay
   * fails) and the binding is returned. Returns null if the ticket is unknown,
   * already redeemed, or expired. An expired ticket is also dropped.
   */
  redeem(ticket: string): SyncTicketBinding | null {
    if (!ticket) return null;
    const entry = this.tickets.get(ticket);
    if (!entry) return null;
    // Single-use: remove on first lookup regardless of expiry outcome.
    this.tickets.delete(ticket);
    if (entry.expiresAt <= Date.now()) return null;
    const { expiresAt: _expiresAt, ...binding } = entry;
    return binding;
  }

  /** Drop expired tickets so the map can't grow without bound. */
  gc(): void {
    const now = Date.now();
    for (const [k, v] of this.tickets) {
      if (v.expiresAt <= now) this.tickets.delete(k);
    }
  }

  /** Test/diagnostic helper: current live ticket count. */
  size(): number {
    return this.tickets.size;
  }
}

/** Process-wide ticket store (the server shares one; tests construct their own). */
export const syncTickets = new SyncTicketStore();

/** Periodically GC the process-wide store (like startRateLimitGc). */
export function startSyncTicketGc(store: SyncTicketStore = syncTickets): ReturnType<typeof setInterval> {
  const t = setInterval(() => store.gc(), 30_000);
  if (typeof t.unref === "function") t.unref();
  return t;
}
