/**
 * SQLite storage layer (Bun's built-in `bun:sqlite`, zero external deps).
 *
 * Tables map 1:1 to the DECISION.md §3 data model: Org, User, Seat, LicenseKey,
 * Revocation, and an append-only AuditEvent log. Production would run this on
 * Postgres (see README) — the SQL here is intentionally vanilla so the port is
 * mechanical, and all access goes through the typed helpers below rather than
 * raw queries scattered across route handlers.
 *
 * Concurrency: WAL mode + a busy_timeout so concurrent activations/heartbeats
 * don't trip SQLITE_BUSY. Seat-limit enforcement is done inside an IMMEDIATE
 * transaction so two simultaneous activations can't both slip past the limit.
 */

import { Database, type SQLQueryBindings } from "bun:sqlite";
import { randomBytes, randomUUID } from "node:crypto";
import { config } from "./config.ts";
import { FanoutHub } from "./matters.ts";
import type {
  Org,
  User,
  Seat,
  LicenseKey,
  AuditEvent,
  AuditAction,
  Plan,
  ProfessionPack,
  OrgStatus,
  UserRole,
  UserStatus,
  SeatStatus,
  Matter,
  MatterStatus,
  MatterMember,
  MatterRole,
  EthicalWall,
  MatterUpdate,
  Device,
  WrappedMatterKey,
  WebhookEvent,
  OrgIdpConfig,
  IdpProvider,
} from "./types.ts";
import type { AssuredProvider, BillingMeta, ManagedProviderKey } from "./assured-types.ts";

/** Keep a pull response comfortably below a client- or relay-crashing size. */
export const MAX_MATTER_PULL_CIPHERTEXT_BYTES = 8 * 1024 * 1024;

/** Database rows keep the envelope as bytes; API-facing types expose base64 only at the edge. */
function toWrappedMatterKey(row: Omit<WrappedMatterKey, "wrapped_key_b64"> & { wrapped_key: Uint8Array }): WrappedMatterKey {
  const { wrapped_key, ...rest } = row;
  return { ...rest, wrapped_key_b64: Buffer.from(wrapped_key).toString("base64") };
}

const SCHEMA = `
CREATE TABLE IF NOT EXISTS orgs (
  org_id              TEXT PRIMARY KEY,
  name                TEXT NOT NULL,
  billing_customer_id TEXT,
  plan                TEXT NOT NULL,
  packs               TEXT NOT NULL DEFAULT '[]',   -- JSON array
  seat_limit          INTEGER NOT NULL,
  status              TEXT NOT NULL DEFAULT 'active',
  created_at          TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS users (
  user_id       TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs(org_id),
  email         TEXT NOT NULL,
  email_norm    TEXT NOT NULL,                 -- lowercased, for unique + lookup
  password_hash TEXT NOT NULL,
  role          TEXT NOT NULL DEFAULT 'member',
  status        TEXT NOT NULL DEFAULT 'active',
  created_at    TEXT NOT NULL
);
-- Email is unique per org (an email can belong to at most one org here).
CREATE UNIQUE INDEX IF NOT EXISTS idx_users_email_norm ON users(email_norm);
CREATE INDEX IF NOT EXISTS idx_users_org ON users(org_id);

CREATE TABLE IF NOT EXISTS seats (
  seat_id        TEXT PRIMARY KEY,
  org_id         TEXT NOT NULL REFERENCES orgs(org_id),
  user_id        TEXT NOT NULL REFERENCES users(user_id),
  machine_id     TEXT NOT NULL,
  machine_label  TEXT,
  status         TEXT NOT NULL DEFAULT 'active',
  bound_at       TEXT NOT NULL,
  last_seen      TEXT NOT NULL,
  revoked_at     TEXT,
  revoked_reason TEXT
);
CREATE INDEX IF NOT EXISTS idx_seats_org ON seats(org_id);
CREATE INDEX IF NOT EXISTS idx_seats_user ON seats(user_id);
-- A given (user, machine) pair maps to a single seat row; re-activation reuses it.
CREATE UNIQUE INDEX IF NOT EXISTS idx_seats_user_machine ON seats(user_id, machine_id);

CREATE TABLE IF NOT EXISTS license_keys (
  key_id     TEXT PRIMARY KEY,
  org_id     TEXT NOT NULL REFERENCES orgs(org_id),
  key_hash   TEXT NOT NULL UNIQUE,
  plan       TEXT NOT NULL,
  packs      TEXT NOT NULL DEFAULT '[]',
  seat_limit INTEGER NOT NULL,
  status     TEXT NOT NULL DEFAULT 'active',
  issued_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_license_keys_org ON license_keys(org_id);

-- Refresh tokens: stored as keyed hashes, rotated on use, revocable.
CREATE TABLE IF NOT EXISTS refresh_tokens (
  token_id     TEXT PRIMARY KEY,
  user_id      TEXT NOT NULL REFERENCES users(user_id),
  token_hash   TEXT NOT NULL UNIQUE,
  issued_at    TEXT NOT NULL,
  expires_at   TEXT NOT NULL,
  revoked_at   TEXT,
  rotated_to   TEXT                            -- token_id that superseded this one
);
CREATE INDEX IF NOT EXISTS idx_refresh_user ON refresh_tokens(user_id);

-- Explicit revocation tombstones for seats (the seat row also carries status,
-- but a dedicated append-only-ish list mirrors DECISION.md and keeps the reason
-- queryable even after a seat is reused/transferred).
CREATE TABLE IF NOT EXISTS revocations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  seat_id    TEXT NOT NULL,
  org_id     TEXT NOT NULL,
  reason     TEXT,
  revoked_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_revocations_seat ON revocations(seat_id);

-- Append-only license/identity audit log. Never updated or deleted in code.
CREATE TABLE IF NOT EXISTS audit_events (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  org_id         TEXT NOT NULL,
  actor_user_id  TEXT,
  action         TEXT NOT NULL,
  target         TEXT,
  detail         TEXT,
  ts             TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_audit_org ON audit_events(org_id);

-- =====================================================================
-- Chunk 2: Matters, membership, ethical walls, and the E2EE sync relay
-- (DECISION.md §4 ACL + §1 dumb-relay). All rows carry org_id so every
-- query is org-scoped — there is no cross-org read path.
-- =====================================================================

CREATE TABLE IF NOT EXISTS matters (
  matter_handle      TEXT PRIMARY KEY,
  org_id             TEXT NOT NULL REFERENCES orgs(org_id),
  root_stream_handle TEXT NOT NULL UNIQUE,
  status             TEXT NOT NULL DEFAULT 'provisioning'
                     CHECK (status IN ('provisioning', 'active', 'archived')),
  key_epoch          INTEGER NOT NULL DEFAULT 1,
  created_at         TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matters_org ON matters(org_id);

-- A provisioning retry key is a random client token, stored only as an HMAC.
-- It is binding metadata, not client metadata: it lets a lost response resume
-- the same opaque shell without ever storing a local client name or local ID.
CREATE TABLE IF NOT EXISTS matter_provisioning_idempotency (
  nonce_hash    TEXT PRIMARY KEY,
  org_id        TEXT NOT NULL REFERENCES orgs(org_id),
  user_id       TEXT NOT NULL REFERENCES users(user_id),
  matter_handle TEXT NOT NULL UNIQUE REFERENCES matters(matter_handle),
  created_at    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matter_streams (
  stream_handle     TEXT PRIMARY KEY,
  matter_handle     TEXT NOT NULL REFERENCES matters(matter_handle),
  -- Null only for the root stream, which is created with the matter before a
  -- seat exists. Every document stream is durably charged to its first writer.
  allocated_by_seat TEXT,
  created_at        TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matter_streams_matter ON matter_streams(matter_handle);

-- A released document stream is permanently dead. The handle remains only as
-- opaque binding metadata so it cannot be silently resurrected in this or a
-- different matter after its ciphertext is destroyed.
CREATE TABLE IF NOT EXISTS released_stream_tombstones (
  stream_handle TEXT PRIMARY KEY,
  released_at   TEXT NOT NULL
);

-- An archive is terminal even if a buggy/raw caller later deletes all of the
-- related relay rows. This handle-only tombstone intentionally contains no
-- client data and permanently prevents resurrection.
CREATE TABLE IF NOT EXISTS archived_matter_tombstones (
  matter_handle TEXT PRIMARY KEY,
  archived_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS matter_members (
  matter_handle TEXT NOT NULL REFERENCES matters(matter_handle),
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  org_id     TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'editor',    -- owner | editor | viewer
  created_at TEXT NOT NULL,
  PRIMARY KEY (matter_handle, user_id)
);
CREATE INDEX IF NOT EXISTS idx_matter_members_user ON matter_members(user_id);
CREATE INDEX IF NOT EXISTS idx_matter_members_matter ON matter_members(matter_handle);

-- Explicit DENY (a screen). Deny-overrides-allow: a row here blocks (matter,user)
-- regardless of membership or admin role.
CREATE TABLE IF NOT EXISTS ethical_walls (
  matter_handle TEXT NOT NULL REFERENCES matters(matter_handle),
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  org_id     TEXT NOT NULL,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (matter_handle, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ethical_walls_user ON ethical_walls(user_id);

-- The dumb relay: opaque end-to-end-encrypted CRDT update blobs. The ciphertext
-- is stored as a BLOB and is NEVER parsed, decoded, hashed, or logged. The id is
-- the monotonic fetch cursor for catch-up. (blob_id) is a per-matter client
-- idempotency key so a retried push doesn't duplicate.
-- stream_handle partitions opaque encrypted relay streams. The client keeps
-- the local document mapping inside encrypted root-stream state.
CREATE TABLE IF NOT EXISTS matter_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_handle TEXT NOT NULL REFERENCES matters(matter_handle),
  org_id      TEXT NOT NULL,
  stream_handle TEXT NOT NULL REFERENCES matter_streams(stream_handle),
  blob_id     TEXT NOT NULL,
  ciphertext  BLOB NOT NULL,
  author_seat TEXT NOT NULL,
  key_epoch   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matter_updates_matter ON matter_updates(matter_handle, stream_handle, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matter_updates_blob ON matter_updates(stream_handle, blob_id);

-- =====================================================================
-- Chunk 3: Assured zero-retention inference proxy (DECISION.md §5).
--
-- org_provider_keys: ONE managed provider key per (org, provider), stored
-- ENCRYPTED AT REST (AES-256-GCM under the server master key). The plaintext
-- key is never stored, never returned, never logged — only key_last4 (a
-- non-secret hint) is surfaced to admins. Set via the admin endpoint.
--
-- inference_billing: append-only, METADATA-ONLY usage log. CRITICAL: this
-- table has NO column capable of holding a prompt or completion. Columns are
-- ids + provider/model + token counts (from the provider's usage response) +
-- status/latency/ts. The zero-retention guard test asserts a sentinel prompt
-- string appears in NONE of these rows. Do NOT add a body/prompt/content column.
-- =====================================================================

CREATE TABLE IF NOT EXISTS org_provider_keys (
  org_id         TEXT NOT NULL REFERENCES orgs(org_id),
  provider       TEXT NOT NULL,                 -- anthropic | openai | google
  key_ciphertext TEXT NOT NULL,                 -- AES-256-GCM blob; opaque, never logged/returned
  key_last4      TEXT NOT NULL,                 -- non-secret display hint
  updated_at     TEXT NOT NULL,
  updated_by     TEXT NOT NULL,                 -- admin user_id who set it
  PRIMARY KEY (org_id, provider)
);

CREATE TABLE IF NOT EXISTS inference_billing (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  request_id    TEXT NOT NULL,
  org_id        TEXT NOT NULL,
  seat_id       TEXT NOT NULL,
  provider      TEXT NOT NULL,
  model         TEXT NOT NULL,
  input_tokens  INTEGER NOT NULL DEFAULT 0,
  output_tokens INTEGER NOT NULL DEFAULT 0,
  status        INTEGER NOT NULL DEFAULT 0,     -- upstream HTTP status
  latency_ms    INTEGER NOT NULL DEFAULT 0,
  ts            TEXT NOT NULL
  -- NO prompt / completion / body / content column. By design. See guard test.
);
CREATE INDEX IF NOT EXISTS idx_inference_billing_org ON inference_billing(org_id, id);

-- =====================================================================
-- Chunk 4: Device keys, wrapped matter keys, and webhook idempotency.
-- (Phase 1 firm desktop wiring — ECDH P-256 key distribution.)
-- =====================================================================

-- One row per (user, device). Upserted on re-register (key rotation).
CREATE TABLE IF NOT EXISTS devices (
  device_id  TEXT NOT NULL,
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  org_id     TEXT NOT NULL REFERENCES orgs(org_id),
  machine_id TEXT NOT NULL,
  label      TEXT NOT NULL DEFAULT '',
  pubkey_jwk TEXT NOT NULL,   -- JSON text of EC P-256 public JWK (no private fields)
  created_at TEXT NOT NULL,
  PRIMARY KEY (device_id, user_id)  -- device_id is caller-supplied; unique per user
);
CREATE INDEX IF NOT EXISTS idx_devices_user ON devices(user_id);
CREATE INDEX IF NOT EXISTS idx_devices_org  ON devices(org_id);

-- Per-device wrapped copy of a matter's content key at a given epoch.
-- A published set covers every (matter, epoch, user, device) tuple.
-- On member-remove / wall-set the handler deletes the affected user's rows
-- and all rows for the OLD epoch so publishers must re-wrap for the new one.
CREATE TABLE IF NOT EXISTS wrapped_matter_keys (
  matter_handle   TEXT NOT NULL REFERENCES matters(matter_handle),
  epoch           INTEGER NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  device_id       TEXT NOT NULL,
  wrapped_key     BLOB NOT NULL,
  published_by    TEXT NOT NULL,  -- user_id of the admin / owner who published
  created_at      TEXT NOT NULL,
  PRIMARY KEY (matter_handle, epoch, user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_wmk_matter_epoch ON wrapped_matter_keys(matter_handle, epoch);
CREATE INDEX IF NOT EXISTS idx_wmk_user ON wrapped_matter_keys(user_id);

-- Per-device wrapped copy of a matter key for a client-generated intake handle.
-- The intake is bound to one matter by the transaction in publishWrappedIntakeKeys;
-- this table intentionally stores no intake content or local identifier.
CREATE TABLE IF NOT EXISTS wrapped_intake_keys (
  intake_handle   TEXT NOT NULL,
  matter_handle   TEXT NOT NULL REFERENCES matters(matter_handle),
  org_id          TEXT NOT NULL REFERENCES orgs(org_id),
  epoch           INTEGER NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  device_id       TEXT NOT NULL,
  wrapped_key     BLOB NOT NULL,
  published_by    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (intake_handle, epoch, user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_wik_intake_user ON wrapped_intake_keys(intake_handle, user_id, device_id);
CREATE INDEX IF NOT EXISTS idx_wik_matter_epoch ON wrapped_intake_keys(matter_handle, epoch);

-- LemonSqueezy webhook idempotency: prevents double-processing the same event.
-- subscription_id column + index are added via guarded migration in the Store
-- constructor (see below) so a DB created from the pre-subscription_id schema
-- does not crash-loop on boot.
CREATE TABLE IF NOT EXISTS webhook_events (
  event_id        TEXT PRIMARY KEY,  -- LS event id (from meta.webhook_id or similar)
  processed_at    TEXT NOT NULL
  -- subscription_id added by migration; do not add here (breaks old schemas)
);

-- =====================================================================
-- Chunk 5: SSO / OIDC — per-org IdP configuration (DECISION.md §6).
-- One row per org (a firm has exactly one IdP configured at a time).
-- client_secret_enc is AES-256-GCM ciphertext; never returned over API.
-- =====================================================================
CREATE TABLE IF NOT EXISTS org_idp_config (
  org_id            TEXT PRIMARY KEY REFERENCES orgs(org_id),
  provider          TEXT NOT NULL,
  issuer            TEXT NOT NULL,
  client_id         TEXT NOT NULL,
  client_secret_enc TEXT NOT NULL,
  enabled           INTEGER NOT NULL DEFAULT 0,
  created_at        TEXT NOT NULL,
  updated_at        TEXT NOT NULL
);
`;

// ---------------------------------------------------------------------------
// Row → domain mappers
// ---------------------------------------------------------------------------
function parsePacks(json: string): ProfessionPack[] {
  try {
    const arr = JSON.parse(json);
    return Array.isArray(arr) ? (arr as ProfessionPack[]) : [];
  } catch {
    return [];
  }
}

interface OrgRow {
  org_id: string;
  name: string;
  billing_customer_id: string | null;
  plan: string;
  packs: string;
  seat_limit: number;
  status: string;
  created_at: string;
}
function toOrg(r: OrgRow): Org {
  return {
    org_id: r.org_id,
    name: r.name,
    billing_customer_id: r.billing_customer_id,
    plan: r.plan as Plan,
    packs: parsePacks(r.packs),
    seat_limit: r.seat_limit,
    status: r.status as OrgStatus,
    created_at: r.created_at,
  };
}

interface UserRow {
  user_id: string;
  org_id: string;
  email: string;
  email_norm: string;
  password_hash: string;
  role: string;
  status: string;
  created_at: string;
}
function toUser(r: UserRow): User {
  return {
    user_id: r.user_id,
    org_id: r.org_id,
    email: r.email,
    role: r.role as UserRole,
    status: r.status as UserStatus,
    created_at: r.created_at,
  };
}

interface SeatRow {
  seat_id: string;
  org_id: string;
  user_id: string;
  machine_id: string;
  machine_label: string | null;
  status: string;
  bound_at: string;
  last_seen: string;
  revoked_at: string | null;
  revoked_reason: string | null;
}
function toSeat(r: SeatRow): Seat {
  return {
    seat_id: r.seat_id,
    org_id: r.org_id,
    user_id: r.user_id,
    machine_id: r.machine_id,
    machine_label: r.machine_label,
    status: r.status as SeatStatus,
    bound_at: r.bound_at,
    last_seen: r.last_seen,
    revoked_at: r.revoked_at,
    revoked_reason: r.revoked_reason,
  };
}

interface MatterRow {
  matter_handle: string;
  org_id: string;
  root_stream_handle: string;
  status: string;
  key_epoch: number;
  created_at: string;
}
function toMatter(r: MatterRow): Matter {
  return {
    matter_handle: r.matter_handle,
    org_id: r.org_id,
    root_stream_handle: r.root_stream_handle,
    status: r.status as MatterStatus,
    key_epoch: r.key_epoch,
    created_at: r.created_at,
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
/**
 * Deliberately small read-only window used by privacy-proof tests. It supports
 * only SELECTs and table metadata PRAGMAs; callers never receive the mutable
 * SQLite connection.
 */
export interface ReadOnlyStoreInspector {
  all(sql: string, ...params: SQLQueryBindings[]): unknown[];
}

export class Store {
  // Keep the connection inside the storage layer. SQLite cannot defend against
  // a caller allowed to run arbitrary schema/PRAGMA SQL; the real protection is
  // never handing that caller this connection in the first place.
  readonly #db: Database;

  constructor(path: string) {
    this.#db = new Database(path, { create: true });
    // Durability + concurrency pragmas. WAL lets readers (validate/heartbeat)
    // run while a writer (activate) commits.
    this.#db.exec("PRAGMA journal_mode = WAL;");
    this.#db.exec("PRAGMA foreign_keys = ON;");
    this.#db.exec("PRAGMA busy_timeout = 5000;");
    this.#db.exec("PRAGMA synchronous = NORMAL;");
    // A legacy schema cannot even parse the v2 index declarations. Detect and
    // rebuild it before applying the current schema, all inside the rebuild's
    // transaction; fresh and already-v2 databases take the normal path.
    const existingMatterCols = this.#db.query("PRAGMA table_info(matters)").all() as Array<{ name: string }>;
    if (existingMatterCols.some((c) => c.name === "matter_id")) this.migrateFirmRelayToV2();
    this.#db.exec(SCHEMA);
    // Device names are local-only. Remove values accepted by older relay
    // builds before any endpoint can return or audit them.
    this.#db.exec("UPDATE devices SET label = ''; UPDATE seats SET machine_label = NULL;");
    // Databases created before permanent archive tombstones need one safe,
    // one-way backfill before the reinsertion trigger becomes the authority.
    this.#db.exec("INSERT OR IGNORE INTO archived_matter_tombstones (matter_handle, archived_at) SELECT matter_handle, created_at FROM matters WHERE status = 'archived'");
    // V2-only cleanup for relay databases opened by a bridge build. This must
    // happen even when their matter schema is already v2: the manifest was the
    // only relay table with a plaintext legacy identifier.
    this.#db.exec("DROP TABLE IF EXISTS firm_relay_migration_manifest_acknowledgements; DROP TABLE IF EXISTS firm_relay_migration_manifest;");

    // Streams are bound only by their first ciphertext write. Persist that
    // writer so one seat cannot consume the whole per-matter stream budget.
    const streamCols = this.#db.query("PRAGMA table_info(matter_streams)").all() as Array<{ name: string }>;
    if (!streamCols.some((c) => c.name === "allocated_by_seat")) {
      this.#db.exec("ALTER TABLE matter_streams ADD COLUMN allocated_by_seat TEXT");
      // Preserve existing live allocations on upgrade. The root stream remains
      // uncharged; a non-root legacy stream is attributed to its first writer.
      this.#db.exec(`
        UPDATE matter_streams
        SET allocated_by_seat = (
          SELECT author_seat FROM matter_updates
          WHERE matter_updates.stream_handle = matter_streams.stream_handle
          ORDER BY id ASC LIMIT 1
        )
        WHERE stream_handle != (
          SELECT root_stream_handle FROM matters WHERE matters.matter_handle = matter_streams.matter_handle
        )
      `);
    }
    this.#db.exec("CREATE INDEX IF NOT EXISTS idx_matter_streams_allocation ON matter_streams(matter_handle, allocated_by_seat)");

    // Wrapped keys are binary envelopes. Rebuild the small independent table
    // on upgrade instead of preserving legacy TEXT rows which could contain
    // readable client data. Existing clients republish after reconnecting.
    const wrappedKeyCols = this.#db.query("PRAGMA table_info(wrapped_matter_keys)").all() as Array<{ name: string; type: string }>;
    if (wrappedKeyCols.some((column) => column.name === "wrapped_key_b64")) {
      this.#db.exec(`
        DROP TABLE wrapped_matter_keys;
        CREATE TABLE wrapped_matter_keys (
          matter_handle TEXT NOT NULL REFERENCES matters(matter_handle),
          epoch INTEGER NOT NULL,
          user_id TEXT NOT NULL REFERENCES users(user_id),
          device_id TEXT NOT NULL,
          wrapped_key BLOB NOT NULL,
          published_by TEXT NOT NULL,
          created_at TEXT NOT NULL,
          PRIMARY KEY (matter_handle, epoch, user_id, device_id)
        );
        CREATE INDEX idx_wmk_matter_epoch ON wrapped_matter_keys(matter_handle, epoch);
        CREATE INDEX idx_wmk_user ON wrapped_matter_keys(user_id);
      `);
    }

    // Guarded migration: add subscription_id column + partial unique index to
    // webhook_events if they were not present in the schema when the DB was
    // created. A DB built from the pre-migration SCHEMA lacks this column and
    // would crash-loop if the index DDL ran unconditionally at schema init time.
    const cols = this.#db.query("PRAGMA table_info(webhook_events)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "subscription_id")) {
      this.#db.exec("ALTER TABLE webhook_events ADD COLUMN subscription_id TEXT");
    }
    this.#db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_subscription_id
       ON webhook_events (subscription_id) WHERE subscription_id IS NOT NULL`,
    );

    this.ensureMatterStatusConstraints();
    this.installMatterStatusGuards();

  }

  /** A narrow read-only inspection surface for sentinel/privacy sweeps. */
  inspectReadOnly(): ReadOnlyStoreInspector {
    return {
      all: (sql: string, ...params: SQLQueryBindings[]): unknown[] => {
        const statement = sql.trim();
        const isSelect = /^SELECT\b/i.test(statement);
        const isTableMetadata = /^PRAGMA\s+table_(?:info|xinfo)\s*\(/i.test(statement);
        if (!isSelect && !isTableMetadata) throw new Error("readonly_inspection_query_required");
        if (statement.includes(";")) throw new Error("readonly_inspection_single_statement_required");
        return this.#db.query(statement).all(...params);
      },
    };
  }

  /** Rebuild pre-constraint v2 databases while retaining safe, opaque relay data. */
  private ensureMatterStatusConstraints(): void {
    const schema = this.#db.query("SELECT sql FROM sqlite_master WHERE type = 'table' AND name = 'matters'").get() as { sql: string } | null;
    if (schema?.sql.includes("CHECK (status IN ('provisioning', 'active', 'archived'))")) return;

    this.#db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
    try {
      this.#db.exec(`
        CREATE TABLE matters_status_v3 (
          matter_handle      TEXT PRIMARY KEY,
          org_id             TEXT NOT NULL REFERENCES orgs(org_id),
          root_stream_handle TEXT NOT NULL UNIQUE,
          status             TEXT NOT NULL DEFAULT 'provisioning'
                             CHECK (status IN ('provisioning', 'active', 'archived')),
          key_epoch          INTEGER NOT NULL DEFAULT 1,
          created_at         TEXT NOT NULL
        );
        INSERT INTO matters_status_v3 (matter_handle, org_id, root_stream_handle, status, key_epoch, created_at)
          SELECT matter_handle, org_id, root_stream_handle,
            CASE status
              WHEN 'provisioning' THEN 'provisioning'
              WHEN 'active' THEN 'active'
              WHEN 'archived' THEN 'archived'
              ELSE 'archived'
            END,
            key_epoch, created_at
          FROM matters;
        DROP TABLE matters;
        ALTER TABLE matters_status_v3 RENAME TO matters;
        CREATE INDEX idx_matters_org ON matters(org_id);
      `);
      const fk = this.#db.query("PRAGMA foreign_key_check").all();
      if (fk.length) throw new Error("matter_status_migration_foreign_key_failure");
      this.#db.exec("COMMIT; PRAGMA foreign_keys = ON;");
    } catch (cause) {
      this.#db.exec("ROLLBACK; PRAGMA foreign_keys = ON;");
      throw cause;
    }
  }

  /** Enforce the complete finite-state machine even for accidental raw SQL. */
  private installMatterStatusGuards(): void {
    this.#db.exec(`
      DROP TRIGGER IF EXISTS prevent_invalid_matter_status_transition;
      DROP TRIGGER IF EXISTS prevent_archived_matter_resurrection;
      DROP TRIGGER IF EXISTS prevent_archived_matter_data_deletion;
      DROP TRIGGER IF EXISTS record_archived_matter_tombstone;
      DROP TRIGGER IF EXISTS prevent_archived_matter_tombstone_reinsertion;

      CREATE TRIGGER prevent_invalid_matter_status_transition
      BEFORE UPDATE OF status ON matters
      WHEN NOT (
        (OLD.status = 'provisioning' AND NEW.status IN ('provisioning', 'active', 'archived')) OR
        (OLD.status = 'active' AND NEW.status IN ('active', 'archived')) OR
        (OLD.status = 'archived' AND NEW.status = 'archived')
      )
      BEGIN
        SELECT RAISE(ABORT, 'invalid_matter_status_transition');
      END;

      -- An archive is terminal. No raw-SQL cleanup order can make this handle
      -- reusable, and INSERT OR REPLACE cannot silently delete it first.
      CREATE TRIGGER prevent_archived_matter_data_deletion
      BEFORE DELETE ON matters
      WHEN OLD.status = 'archived'
      BEGIN
        SELECT RAISE(ABORT, 'archived_matter_deletion_forbidden');
      END;

      CREATE TRIGGER record_archived_matter_tombstone
      AFTER UPDATE OF status ON matters
      WHEN NEW.status = 'archived'
      BEGIN
        INSERT OR IGNORE INTO archived_matter_tombstones (matter_handle, archived_at)
        VALUES (NEW.matter_handle, CURRENT_TIMESTAMP);
      END;

      CREATE TRIGGER prevent_archived_matter_tombstone_reinsertion
      BEFORE INSERT ON matters
      WHEN EXISTS (SELECT 1 FROM archived_matter_tombstones WHERE matter_handle = NEW.matter_handle)
      BEGIN
        SELECT RAISE(ABORT, 'archived_matter_handle_tombstoned');
      END;
    `);
  }

  private newHandle(prefix: "mh2_" | "sh2_"): string {
    return `${prefix}${randomBytes(32).toString("base64url")}`;
  }

  /** One atomic rebuild; SQLite cannot safely rename this foreign-key graph piecemeal. */
  private migrateFirmRelayToV2(): void {
    const cols = this.#db.query("PRAGMA table_info(matters)").all() as Array<{ name: string }>;
    if (cols.some((c) => c.name === "matter_handle")) return;
    this.#db.exec("PRAGMA foreign_keys = OFF; BEGIN IMMEDIATE;");
    try {
      this.#db.exec(`
        CREATE TABLE matters_v2 (matter_handle TEXT PRIMARY KEY, org_id TEXT NOT NULL, root_stream_handle TEXT NOT NULL UNIQUE, status TEXT NOT NULL CHECK (status IN ('provisioning', 'active', 'archived')), key_epoch INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE TABLE matter_streams_v2 (stream_handle TEXT PRIMARY KEY, matter_handle TEXT NOT NULL REFERENCES matters_v2(matter_handle), created_at TEXT NOT NULL);
        CREATE TABLE matter_members_v2 (matter_handle TEXT NOT NULL REFERENCES matters_v2(matter_handle), user_id TEXT NOT NULL, org_id TEXT NOT NULL, role TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(matter_handle,user_id));
        CREATE TABLE ethical_walls_v2 (matter_handle TEXT NOT NULL REFERENCES matters_v2(matter_handle), user_id TEXT NOT NULL, org_id TEXT NOT NULL, created_by TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(matter_handle,user_id));
        CREATE TABLE matter_updates_v2 (id INTEGER PRIMARY KEY AUTOINCREMENT, matter_handle TEXT NOT NULL REFERENCES matters_v2(matter_handle), org_id TEXT NOT NULL, stream_handle TEXT NOT NULL REFERENCES matter_streams_v2(stream_handle), blob_id TEXT NOT NULL, ciphertext BLOB NOT NULL, author_seat TEXT NOT NULL, key_epoch INTEGER NOT NULL, created_at TEXT NOT NULL);
        CREATE UNIQUE INDEX idx_matter_updates_blob_v2 ON matter_updates_v2(stream_handle, blob_id);
        CREATE INDEX idx_matter_updates_matter_v2 ON matter_updates_v2(matter_handle, stream_handle, id);
        CREATE TABLE wrapped_matter_keys_v2 (matter_handle TEXT NOT NULL REFERENCES matters_v2(matter_handle), epoch INTEGER NOT NULL, user_id TEXT NOT NULL, device_id TEXT NOT NULL, wrapped_key BLOB NOT NULL, published_by TEXT NOT NULL, created_at TEXT NOT NULL, PRIMARY KEY(matter_handle,epoch,user_id,device_id));
        CREATE INDEX idx_wmk_matter_epoch_v2 ON wrapped_matter_keys_v2(matter_handle, epoch);
        CREATE INDEX idx_wmk_user_v2 ON wrapped_matter_keys_v2(user_id);
      `);
      // This release is v2-only. Old relay rows can contain plaintext local
      // identifiers and v1 ciphertext that is intentionally undecodable now,
      // so this schema rebuild creates an empty relay instead of copying either.
      // Development/demo operators reset and re-seed the database before use.
      this.#db.exec("DELETE FROM audit_events");
      this.#db.exec("DROP TABLE wrapped_matter_keys; DROP TABLE matter_updates; DROP TABLE ethical_walls; DROP TABLE matter_members; DROP TABLE IF EXISTS matter_streams; DROP TABLE matters; ALTER TABLE matters_v2 RENAME TO matters; ALTER TABLE matter_streams_v2 RENAME TO matter_streams; ALTER TABLE matter_members_v2 RENAME TO matter_members; ALTER TABLE ethical_walls_v2 RENAME TO ethical_walls; ALTER TABLE matter_updates_v2 RENAME TO matter_updates; ALTER TABLE wrapped_matter_keys_v2 RENAME TO wrapped_matter_keys; DROP INDEX idx_matter_updates_blob_v2; DROP INDEX idx_matter_updates_matter_v2; DROP INDEX idx_wmk_matter_epoch_v2; DROP INDEX idx_wmk_user_v2; CREATE INDEX idx_matters_org ON matters(org_id); CREATE INDEX idx_matter_streams_matter ON matter_streams(matter_handle); CREATE INDEX idx_matter_members_user ON matter_members(user_id); CREATE INDEX idx_matter_members_matter ON matter_members(matter_handle); CREATE INDEX idx_ethical_walls_user ON ethical_walls(user_id); CREATE UNIQUE INDEX idx_matter_updates_blob ON matter_updates(stream_handle, blob_id); CREATE INDEX idx_matter_updates_matter ON matter_updates(matter_handle, stream_handle, id); CREATE INDEX idx_wmk_matter_epoch ON wrapped_matter_keys(matter_handle, epoch); CREATE INDEX idx_wmk_user ON wrapped_matter_keys(user_id);");
      const fk = this.#db.query("PRAGMA foreign_key_check").all(); if (fk.length) throw new Error("firm_relay_migration_foreign_key_failure");
      this.#db.exec("COMMIT; PRAGMA foreign_keys = ON;");
    } catch (cause) { this.#db.exec("ROLLBACK; PRAGMA foreign_keys = ON;"); throw cause; }
  }

  close(): void {
    this.#db.close();
  }

  private nowIso(): string {
    return new Date().toISOString();
  }

  // ---- Orgs ----------------------------------------------------------------
  createOrg(input: {
    name: string;
    plan: Plan;
    packs: ProfessionPack[];
    seat_limit: number;
    billing_customer_id?: string | null;
  }): Org {
    const org: Org = {
      org_id: randomUUID(),
      name: input.name,
      billing_customer_id: input.billing_customer_id ?? null,
      plan: input.plan,
      packs: input.packs,
      seat_limit: input.seat_limit,
      status: "active",
      created_at: this.nowIso(),
    };
    this.#db
      .query(
        `INSERT INTO orgs (org_id, name, billing_customer_id, plan, packs, seat_limit, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        org.org_id,
        org.name,
        org.billing_customer_id,
        org.plan,
        JSON.stringify(org.packs),
        org.seat_limit,
        org.status,
        org.created_at,
      );
    return org;
  }

  getOrg(orgId: string): Org | null {
    const r = this.#db.query(`SELECT * FROM orgs WHERE org_id = ?`).get(orgId) as OrgRow | null;
    return r ? toOrg(r) : null;
  }

  findOrgByName(name: string): Org | null {
    const r = this.#db.query(`SELECT * FROM orgs WHERE name = ?`).get(name) as OrgRow | null;
    return r ? toOrg(r) : null;
  }

  setOrgStatus(orgId: string, status: OrgStatus): void {
    this.#db.query(`UPDATE orgs SET status = ? WHERE org_id = ?`).run(status, orgId);
    if (status !== "active") FanoutHub.evictOrgEverywhere(orgId);
  }

  // ---- Users ---------------------------------------------------------------
  createUser(input: {
    org_id: string;
    email: string;
    password_hash: string;
    role: UserRole;
  }): User {
    const user: User = {
      user_id: randomUUID(),
      org_id: input.org_id,
      email: input.email,
      role: input.role,
      status: "active",
      created_at: this.nowIso(),
    };
    this.#db
      .query(
        `INSERT INTO users (user_id, org_id, email, email_norm, password_hash, role, status, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        user.user_id,
        user.org_id,
        user.email,
        user.email.trim().toLowerCase(),
        input.password_hash,
        user.role,
        user.status,
        user.created_at,
      );
    return user;
  }

  getUser(userId: string): User | null {
    const r = this.#db.query(`SELECT * FROM users WHERE user_id = ?`).get(userId) as UserRow | null;
    return r ? toUser(r) : null;
  }

  /** Returns the user plus their password hash for credential verification. */
  getUserByEmailWithHash(email: string): (User & { password_hash: string }) | null {
    const r = this.#db
      .query(`SELECT * FROM users WHERE email_norm = ?`)
      .get(email.trim().toLowerCase()) as UserRow | null;
    if (!r) return null;
    return { ...toUser(r), password_hash: r.password_hash };
  }

  setUserStatus(userId: string, status: UserStatus): void {
    this.#db.query(`UPDATE users SET status = ? WHERE user_id = ?`).run(status, userId);
    if (status !== "active") FanoutHub.evictUserEverywhere(userId);
  }

  /** Active admin users for an org. Clients use this to wrap matter keys to admin
   * devices (escrow), so any org member may read it; emails are org-internal. */
  listOrgAdmins(orgId: string): Array<{ user_id: string; email: string }> {
    const rows = this.#db
      .query(`SELECT * FROM users WHERE org_id = ? AND role = 'admin'`)
      .all(orgId) as UserRow[];
    return rows
      .map(toUser)
      .filter((u) => u.status === "active")
      .map((u) => ({ user_id: u.user_id, email: u.email }));
  }

  // ---- License keys --------------------------------------------------------
  createLicenseKey(input: {
    org_id: string;
    key_hash: string;
    plan: Plan;
    packs: ProfessionPack[];
    seat_limit: number;
  }): LicenseKey {
    const key: LicenseKey = {
      key_id: randomUUID(),
      org_id: input.org_id,
      key_hash: input.key_hash,
      plan: input.plan,
      packs: input.packs,
      seat_limit: input.seat_limit,
      issued_at: this.nowIso(),
      status: "active",
    };
    this.#db
      .query(
        `INSERT INTO license_keys (key_id, org_id, key_hash, plan, packs, seat_limit, status, issued_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        key.key_id,
        key.org_id,
        key.key_hash,
        key.plan,
        JSON.stringify(key.packs),
        key.seat_limit,
        key.status,
        key.issued_at,
      );
    return key;
  }

  /** Atomically create the unclaimed Firm org and its claimable license key. */
  createProvisionedFirmOrg(input: {
    name: string;
    seat_limit: number;
    billing_customer_id: string | null;
    key_hash: string;
    packs: ProfessionPack[];
  }): Org {
    const txn = this.#db.transaction(() => {
      const org = this.createOrg({
        name: input.name,
        plan: "practice",
        packs: input.packs,
        seat_limit: input.seat_limit,
        billing_customer_id: input.billing_customer_id,
      });
      this.setOrgStatus(org.org_id, "unclaimed");
      this.createLicenseKey({
        org_id: org.org_id,
        key_hash: input.key_hash,
        plan: "practice",
        packs: input.packs,
        seat_limit: input.seat_limit,
      });
      return org;
    });
    return txn.immediate() as Org;
  }

  getLicenseKeyByHash(keyHash: string): LicenseKey | null {
    const r = this.#db.query(`SELECT * FROM license_keys WHERE key_hash = ?`).get(keyHash) as
      | (Omit<LicenseKey, "packs"> & { packs: string })
      | null;
    if (!r) return null;
    return { ...r, packs: parsePacks(r.packs) };
  }

  // ---- Seats ---------------------------------------------------------------
  getSeat(seatId: string): Seat | null {
    const r = this.#db.query(`SELECT * FROM seats WHERE seat_id = ?`).get(seatId) as SeatRow | null;
    return r ? toSeat(r) : null;
  }

  getSeatByUserMachine(userId: string, machineId: string): Seat | null {
    const r = this.#db
      .query(`SELECT * FROM seats WHERE user_id = ? AND machine_id = ?`)
      .get(userId, machineId) as SeatRow | null;
    return r ? toSeat(r) : null;
  }

  listSeats(orgId: string): Seat[] {
    const rows = this.#db
      .query(`SELECT * FROM seats WHERE org_id = ? ORDER BY bound_at ASC`)
      .all(orgId) as SeatRow[];
    return rows.map(toSeat);
  }

  countActiveSeats(orgId: string): number {
    const r = this.#db
      .query(`SELECT COUNT(*) AS n FROM seats WHERE org_id = ? AND status = 'active'`)
      .get(orgId) as { n: number };
    return r.n;
  }

  /**
   * Bind a seat for (user, machine), enforcing seat_limit atomically.
   *
   * Behaviour:
   *   - If an ACTIVE seat already exists for (user, machine): reuse it (idempotent
   *     re-activation), refresh last_seen, return { seat, reused: true }.
   *   - If a REVOKED seat exists for (user, machine): re-activate it only if there
   *     is headroom; otherwise reject.
   *   - Otherwise: create a new seat iff active count < seat_limit, else reject.
   *
   * Runs in an IMMEDIATE transaction so two concurrent activations cannot both
   * observe headroom and both insert (the classic N+1 race).
   */
  activateSeat(input: {
    org_id: string;
    user_id: string;
    machine_id: string;
    machine_label: string | null;
    seat_limit: number;
  }): { ok: true; seat: Seat; reused: boolean } | { ok: false; reason: "seat_limit_exceeded" } {
    const now = this.nowIso();
    const txn = this.#db.transaction(() => {
      const existing = this.getSeatByUserMachine(input.user_id, input.machine_id);

      if (existing && existing.status === "active") {
        this.#db.query(`UPDATE seats SET last_seen = ? WHERE seat_id = ?`).run(now, existing.seat_id);
        return { ok: true as const, seat: { ...existing, last_seen: now }, reused: true };
      }

      // Need headroom for a brand-new or re-activated (was-revoked) seat.
      const active = this.countActiveSeats(input.org_id);
      if (active >= input.seat_limit) {
        return { ok: false as const, reason: "seat_limit_exceeded" as const };
      }

      if (existing && existing.status === "revoked") {
        this.#db
          .query(
            `UPDATE seats SET status = 'active', machine_label = ?, bound_at = ?, last_seen = ?,
                              revoked_at = NULL, revoked_reason = NULL
             WHERE seat_id = ?`,
          )
          .run(input.machine_label, now, now, existing.seat_id);
        return {
          ok: true as const,
          seat: { ...existing, status: "active", machine_label: input.machine_label, bound_at: now, last_seen: now, revoked_at: null, revoked_reason: null },
          reused: false,
        };
      }

      const seat: Seat = {
        seat_id: randomUUID(),
        org_id: input.org_id,
        user_id: input.user_id,
        machine_id: input.machine_id,
        machine_label: input.machine_label,
        status: "active",
        bound_at: now,
        last_seen: now,
        revoked_at: null,
        revoked_reason: null,
      };
      this.#db
        .query(
          `INSERT INTO seats (seat_id, org_id, user_id, machine_id, machine_label, status, bound_at, last_seen)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(seat.seat_id, seat.org_id, seat.user_id, seat.machine_id, seat.machine_label, now, now);
      return { ok: true as const, seat, reused: false };
    });
    // IMMEDIATE: take the write lock at BEGIN so the COUNT→INSERT is serialized.
    return txn.immediate() as ReturnType<typeof this.activateSeat>;
  }

  touchSeat(seatId: string): void {
    this.#db.query(`UPDATE seats SET last_seen = ? WHERE seat_id = ?`).run(this.nowIso(), seatId);
  }

  revokeSeat(seatId: string, reason: string | null): boolean {
    const now = this.nowIso();
    const seat = this.getSeat(seatId);
    if (!seat || seat.status === "revoked") return false;
    this.#db
      .query(`UPDATE seats SET status = 'revoked', revoked_at = ?, revoked_reason = ? WHERE seat_id = ?`)
      .run(now, reason, seatId);
    this.#db
      .query(`INSERT INTO revocations (seat_id, org_id, reason, revoked_at) VALUES (?, ?, ?, ?)`)
      .run(seatId, seat.org_id, reason, now);
    FanoutHub.evictSeatEverywhere(seatId);
    return true;
  }

  /** Revoke every active seat for a user (used by deprovision). Returns count. */
  revokeAllSeatsForUser(userId: string, reason: string): number {
    const seats = this.#db
      .query(`SELECT * FROM seats WHERE user_id = ? AND status = 'active'`)
      .all(userId) as SeatRow[];
    let n = 0;
    const txn = this.#db.transaction(() => {
      for (const r of seats) {
        if (this.revokeSeat(r.seat_id, reason)) n++;
      }
    });
    txn();
    return n;
  }

  /**
   * Transfer a seat to a (possibly different) user + new machine. Revokes the
   * old binding and creates a fresh active seat for the target, all atomically,
   * so the seat count is conserved. Fails if the target (user,machine) already
   * holds an active seat (would double-bind).
   */
  transferSeat(input: {
    from_seat_id: string;
    to_user_id: string;
    to_machine_id: string;
    to_machine_label: string | null;
  }):
    | { ok: true; seat: Seat }
    | { ok: false; reason: "from_seat_not_found" | "from_seat_not_active" | "target_already_bound" } {
    const now = this.nowIso();
    const txn = this.#db.transaction(() => {
      const from = this.getSeat(input.from_seat_id);
      if (!from) return { ok: false as const, reason: "from_seat_not_found" as const };
      if (from.status !== "active") return { ok: false as const, reason: "from_seat_not_active" as const };

      const targetExisting = this.getSeatByUserMachine(input.to_user_id, input.to_machine_id);
      if (targetExisting && targetExisting.status === "active") {
        return { ok: false as const, reason: "target_already_bound" as const };
      }

      // Free the old machine.
      this.#db
        .query(`UPDATE seats SET status = 'revoked', revoked_at = ?, revoked_reason = 'transferred' WHERE seat_id = ?`)
        .run(now, from.seat_id);
      this.#db
        .query(`INSERT INTO revocations (seat_id, org_id, reason, revoked_at) VALUES (?, ?, 'transferred', ?)`)
        .run(from.seat_id, from.org_id, now);

      // Bind (or re-activate) the target.
      if (targetExisting) {
        this.#db
          .query(
            `UPDATE seats SET status = 'active', machine_label = ?, bound_at = ?, last_seen = ?,
                              revoked_at = NULL, revoked_reason = NULL
             WHERE seat_id = ?`,
          )
          .run(input.to_machine_label, now, now, targetExisting.seat_id);
        return {
          ok: true as const,
          seat: { ...targetExisting, status: "active", machine_label: input.to_machine_label, bound_at: now, last_seen: now, revoked_at: null, revoked_reason: null },
        };
      }
      const seat: Seat = {
        seat_id: randomUUID(),
        org_id: from.org_id,
        user_id: input.to_user_id,
        machine_id: input.to_machine_id,
        machine_label: input.to_machine_label,
        status: "active",
        bound_at: now,
        last_seen: now,
        revoked_at: null,
        revoked_reason: null,
      };
      this.#db
        .query(
          `INSERT INTO seats (seat_id, org_id, user_id, machine_id, machine_label, status, bound_at, last_seen)
           VALUES (?, ?, ?, ?, ?, 'active', ?, ?)`,
        )
        .run(seat.seat_id, seat.org_id, seat.user_id, seat.machine_id, seat.machine_label, now, now);
      return { ok: true as const, seat };
    });
    return txn.immediate() as ReturnType<typeof this.transferSeat>;
  }

  // ---- Refresh tokens ------------------------------------------------------
  createRefreshToken(input: { user_id: string; token_hash: string; expires_at: string }): string {
    const tokenId = randomUUID();
    this.#db
      .query(
        `INSERT INTO refresh_tokens (token_id, user_id, token_hash, issued_at, expires_at)
         VALUES (?, ?, ?, ?, ?)`,
      )
      .run(tokenId, input.user_id, input.token_hash, this.nowIso(), input.expires_at);
    return tokenId;
  }

  getRefreshTokenByHash(tokenHash: string): {
    token_id: string;
    user_id: string;
    expires_at: string;
    revoked_at: string | null;
    rotated_to: string | null;
  } | null {
    return this.#db.query(`SELECT token_id, user_id, expires_at, revoked_at, rotated_to FROM refresh_tokens WHERE token_hash = ?`).get(tokenHash) as
      | { token_id: string; user_id: string; expires_at: string; revoked_at: string | null; rotated_to: string | null }
      | null;
  }

  /** Rotate: revoke the presented token, mint a new one, link them. */
  rotateRefreshToken(input: {
    old_token_id: string;
    user_id: string;
    new_token_hash: string;
    expires_at: string;
  }): string {
    const newId = randomUUID();
    const now = this.nowIso();
    const txn = this.#db.transaction(() => {
      this.#db
        .query(
          `INSERT INTO refresh_tokens (token_id, user_id, token_hash, issued_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(newId, input.user_id, input.new_token_hash, now, input.expires_at);
      this.#db
        .query(`UPDATE refresh_tokens SET revoked_at = ?, rotated_to = ? WHERE token_id = ?`)
        .run(now, newId, input.old_token_id);
    });
    txn();
    return newId;
  }

  revokeRefreshToken(tokenId: string): void {
    this.#db.query(`UPDATE refresh_tokens SET revoked_at = ? WHERE token_id = ? AND revoked_at IS NULL`).run(this.nowIso(), tokenId);
  }

  revokeAllRefreshTokensForUser(userId: string): void {
    this.#db.query(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(this.nowIso(), userId);
  }

  // ---- Audit (append-only) -------------------------------------------------
  audit(input: {
    org_id: string;
    actor_user_id: string | null;
    action: AuditAction;
    target?: string | null;
    detail?: Record<string, unknown> | null;
  }): void {
    this.#db
      .query(`INSERT INTO audit_events (org_id, actor_user_id, action, target, detail, ts) VALUES (?, ?, ?, ?, ?, ?)`)
      .run(
        input.org_id,
        input.actor_user_id,
        input.action,
        input.target ?? null,
        input.detail ? JSON.stringify(input.detail) : null,
        this.nowIso(),
      );
  }

  listAudit(orgId: string, limit = 200): AuditEvent[] {
    const rows = this.#db
      .query(`SELECT * FROM audit_events WHERE org_id = ? ORDER BY id DESC LIMIT ?`)
      .all(orgId, limit) as Array<{
      id: number;
      org_id: string;
      actor_user_id: string | null;
      action: string;
      target: string | null;
      detail: string | null;
      ts: string;
    }>;
    return rows.map((r) => ({
      id: r.id,
      org_id: r.org_id,
      actor_user_id: r.actor_user_id,
      action: r.action as AuditAction,
      target: r.target,
      detail: r.detail,
      ts: r.ts,
    }));
  }

  // ===========================================================================
  // Matters (DECISION.md §4 ACL unit)
  // ===========================================================================
  createMatter(input: { org_id: string }): Matter {
    const m: Matter = { matter_handle: this.newHandle("mh2_"), org_id: input.org_id, root_stream_handle: this.newHandle("sh2_"), status: "provisioning", key_epoch: 1, created_at: this.nowIso() };
    const txn = this.#db.transaction(() => {
      this.#db.query("INSERT INTO matters (matter_handle, org_id, root_stream_handle, status, key_epoch, created_at) VALUES (?, ?, ?, 'provisioning', 1, ?)").run(m.matter_handle, m.org_id, m.root_stream_handle, m.created_at);
      this.#db.query("INSERT INTO matter_streams (stream_handle, matter_handle, created_at) VALUES (?, ?, ?)").run(m.root_stream_handle, m.matter_handle, m.created_at);
    });
    txn.immediate(); return m;
  }

  /**
   * Create an empty shell once for one authenticated provision attempt.
   * `nonce_hash` is already domain-separated and HMACed by the route, so the
   * database never holds the client-generated token itself. The lookup and
   * insertion share one IMMEDIATE transaction: a lost HTTP response can only
   * resume this exact shell, never allocate a second one.
   */
  createMatterIdempotent(input: { org_id: string; user_id: string; nonce_hash: string }): { matter: Matter; created: boolean } {
    const txn = this.#db.transaction(() => {
      const existing = this.#db.query(`
        SELECT m.* FROM matter_provisioning_idempotency i
        JOIN matters m ON m.matter_handle = i.matter_handle
        WHERE i.nonce_hash = ? AND i.org_id = ? AND i.user_id = ?
      `).get(input.nonce_hash, input.org_id, input.user_id) as MatterRow | null;
      if (existing) return { matter: toMatter(existing), created: false };

      const matter: Matter = {
        matter_handle: this.newHandle("mh2_"), org_id: input.org_id,
        root_stream_handle: this.newHandle("sh2_"), status: "provisioning",
        key_epoch: 1, created_at: this.nowIso(),
      };
      this.#db.query("INSERT INTO matters (matter_handle, org_id, root_stream_handle, status, key_epoch, created_at) VALUES (?, ?, ?, 'provisioning', 1, ?)")
        .run(matter.matter_handle, matter.org_id, matter.root_stream_handle, matter.created_at);
      this.#db.query("INSERT INTO matter_streams (stream_handle, matter_handle, created_at) VALUES (?, ?, ?)")
        .run(matter.root_stream_handle, matter.matter_handle, matter.created_at);
      // A retry must never discover a shell that exists but has no owner. Keep
      // its owner binding and create audit row in this same transaction as the
      // idempotency mapping and handles.
      this.#db.query(`INSERT INTO matter_members (matter_handle, user_id, org_id, role, created_at)
        VALUES (?, ?, ?, 'owner', ?)`)
        .run(matter.matter_handle, input.user_id, matter.org_id, matter.created_at);
      this.#db.query(`INSERT INTO matter_provisioning_idempotency (nonce_hash, org_id, user_id, matter_handle, created_at)
        VALUES (?, ?, ?, ?, ?)`)
        .run(input.nonce_hash, input.org_id, input.user_id, matter.matter_handle, matter.created_at);
      this.#db.query(`INSERT INTO audit_events (org_id, actor_user_id, action, target, detail, ts)
        VALUES (?, ?, 'matter.create', ?, ?, ?)`)
        .run(matter.org_id, input.user_id, matter.matter_handle, JSON.stringify({ op: "create", epoch: 1 }), matter.created_at);
      return { matter, created: true };
    });
    return txn.immediate() as { matter: Matter; created: boolean };
  }

  getMatter(matterHandle: string): Matter | null {
    const r = this.#db.query(`SELECT * FROM matters WHERE matter_handle = ?`).get(matterHandle) as MatterRow | null;
    return r ? toMatter(r) : null;
  }

  listMatters(orgId: string): Matter[] {
    const rows = this.#db
      .query(`SELECT * FROM matters WHERE org_id = ? ORDER BY created_at DESC`)
      .all(orgId) as MatterRow[];
    return rows.map(toMatter);
  }

  countLiveMatterStreams(matterHandle: string): number {
    const row = this.#db.query("SELECT COUNT(*) AS count FROM matter_streams WHERE matter_handle = ?").get(matterHandle) as { count: number };
    return row.count;
  }

  /** Owner recovery view: opaque handles only, never document names or content. */
  listLiveMatterStreamHandles(matterHandle: string): string[] {
    return (this.#db.query("SELECT stream_handle FROM matter_streams WHERE matter_handle = ? ORDER BY created_at ASC").all(matterHandle) as Array<{ stream_handle: string }>)
      .map((row) => row.stream_handle);
  }

  /** Release a deleted document's stream only when the owner has explicitly approved it. */
  releaseMatterStream(matterHandle: string, streamHandle: string): boolean {
    const txn = this.#db.transaction(() => {
      const matter = this.#db.query("SELECT root_stream_handle, status FROM matters WHERE matter_handle = ?").get(matterHandle) as { root_stream_handle: string; status: MatterStatus } | null;
      if (!matter || matter.status !== "active" || matter.root_stream_handle === streamHandle) return false;
      const stream = this.#db.query("SELECT 1 FROM matter_streams WHERE matter_handle = ? AND stream_handle = ?").get(matterHandle, streamHandle);
      if (!stream) return false;
      // The relay cannot read the encrypted root index. The owner is required
      // to tombstone that mapping and publish it before this explicit release;
      // only then is opaque history for this deleted document removed.
      this.#db.query("INSERT OR IGNORE INTO released_stream_tombstones (stream_handle, released_at) VALUES (?, ?)").run(streamHandle, this.nowIso());
      this.#db.query("DELETE FROM matter_updates WHERE matter_handle = ? AND stream_handle = ?").run(matterHandle, streamHandle);
      return this.#db.query("DELETE FROM matter_streams WHERE matter_handle = ? AND stream_handle = ?").run(matterHandle, streamHandle).changes === 1;
    });
    return txn.immediate() as boolean;
  }

  streamBelongsToMatter(streamHandle: string, matterHandle: string): boolean {
    return this.#db.query("SELECT 1 FROM matter_streams WHERE stream_handle = ? AND matter_handle = ?").get(streamHandle, matterHandle) !== null;
  }

  /** Resolve a flat stream route without exposing its parent in the URL. */
  getMatterHandleForStream(streamHandle: string): string | null {
    const row = this.#db.query("SELECT matter_handle FROM matter_streams WHERE stream_handle = ?").get(streamHandle) as { matter_handle: string } | null;
    return row?.matter_handle ?? null;
  }

  /** The one legal activation transition: provisioning → active. */
  activateProvisioningMatter(matterHandle: string): boolean {
    const txn = this.#db.transaction(() =>
      this.#db.query(`UPDATE matters SET status = 'active' WHERE matter_handle = ? AND status = 'provisioning'`).run(matterHandle).changes === 1,
    );
    return txn.immediate() as boolean;
  }

  /** The only legal archive transitions: provisioning|active → archived. */
  archiveMatter(matterHandle: string): boolean {
    const txn = this.#db.transaction(() =>
      this.#db.query(`UPDATE matters SET status = 'archived' WHERE matter_handle = ? AND status IN ('provisioning', 'active')`).run(matterHandle).changes > 0,
    );
    return txn.immediate() as boolean;
  }

  /**
   * Bump the matter key epoch (returns the new epoch). Called on member-remove /
   * wall-set so the desktop key-release service rotates the per-matter key and a
   * removed/walled user's old key can't read subsequently-pushed updates (§4 L2).
   */
  bumpMatterKeyEpoch(matterHandle: string): number {
    const txn = this.#db.transaction(() => {
      this.#db.query(`UPDATE matters SET key_epoch = key_epoch + 1 WHERE matter_handle = ?`).run(matterHandle);
      const r = this.#db.query(`SELECT key_epoch FROM matters WHERE matter_handle = ?`).get(matterHandle) as
        | { key_epoch: number }
        | null;
      return r?.key_epoch ?? 1;
    });
    return txn() as number;
  }

  // ---- Matter membership ---------------------------------------------------
  addMatterMember(input: { matter_handle: string; user_id: string; org_id: string; role: MatterRole }): MatterMember {
    const m: MatterMember = {
      matter_handle: input.matter_handle,
      user_id: input.user_id,
      org_id: input.org_id,
      role: input.role,
      created_at: this.nowIso(),
    };
    // Upsert: re-adding updates the role (and refreshes created_at on first add only).
    this.#db
      .query(
        `INSERT INTO matter_members (matter_handle, user_id, org_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(matter_handle, user_id) DO UPDATE SET role = excluded.role`,
      )
      .run(m.matter_handle, m.user_id, m.org_id, m.role, m.created_at);
    return m;
  }

  removeMatterMember(matterHandle: string, userId: string): boolean {
    const res = this.#db
      .query(`DELETE FROM matter_members WHERE matter_handle = ? AND user_id = ?`)
      .run(matterHandle, userId);
    return res.changes > 0;
  }

  getMatterMember(matterHandle: string, userId: string): MatterMember | null {
    const r = this.#db
      .query(`SELECT * FROM matter_members WHERE matter_handle = ? AND user_id = ?`)
      .get(matterHandle, userId) as
      | { matter_handle: string; user_id: string; org_id: string; role: string; created_at: string }
      | null;
    return r ? { ...r, role: r.role as MatterRole } : null;
  }

  listMatterMembers(matterHandle: string): MatterMember[] {
    const rows = this.#db
      .query(`SELECT * FROM matter_members WHERE matter_handle = ? ORDER BY created_at ASC`)
      .all(matterHandle) as Array<{ matter_handle: string; user_id: string; org_id: string; role: string; created_at: string }>;
    return rows.map((r) => ({ ...r, role: r.role as MatterRole }));
  }

  /**
   * List matter members with their email addresses joined from the users table.
   * Same-org data; callers must have already verified org scoping. Returns email
   * only when a matching user row exists (it always should, but the join is LEFT
   * so a dangling member row doesn't crash the handler).
   */
  listMatterMembersWithEmail(matterHandle: string): Array<MatterMember & { email: string | null }> {
    const rows = this.#db
      .query(
        `SELECT mm.matter_handle, mm.user_id, mm.org_id, mm.role, mm.created_at, u.email
         FROM matter_members mm
         LEFT JOIN users u ON u.user_id = mm.user_id
         WHERE mm.matter_handle = ?
         ORDER BY mm.created_at ASC`,
      )
      .all(matterHandle) as Array<{ matter_handle: string; user_id: string; org_id: string; role: string; created_at: string; email: string | null }>;
    return rows.map((r) => ({ ...r, role: r.role as MatterRole, email: r.email ?? null }));
  }

  /**
   * List all active users in an org. Admin-only endpoint: returns user_id, email,
   * role, and status so the admin console can resolve user_ids to emails and the
   * wall-by-email flow can look up users without requiring a create-first pattern.
   */
  listOrgUsers(orgId: string): Array<{ user_id: string; email: string; role: UserRole; status: UserStatus }> {
    const rows = this.#db
      .query(
        `SELECT user_id, email, role, status FROM users WHERE org_id = ? ORDER BY email ASC`,
      )
      .all(orgId) as Array<{ user_id: string; email: string; role: string; status: string }>;
    return rows.map((r) => ({
      user_id: r.user_id,
      email: r.email,
      role: r.role as UserRole,
      status: r.status as UserStatus,
    }));
  }

  // ---- Ethical walls (explicit DENY, deny-overrides-allow) -----------------
  setEthicalWall(input: { matter_handle: string; user_id: string; org_id: string; created_by: string }): EthicalWall {
    const w: EthicalWall = {
      matter_handle: input.matter_handle,
      user_id: input.user_id,
      org_id: input.org_id,
      created_by: input.created_by,
      created_at: this.nowIso(),
    };
    this.#db
      .query(
        `INSERT INTO ethical_walls (matter_handle, user_id, org_id, created_by, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(matter_handle, user_id) DO UPDATE SET created_by = excluded.created_by, created_at = excluded.created_at`,
      )
      .run(w.matter_handle, w.user_id, w.org_id, w.created_by, w.created_at);
    return w;
  }

  clearEthicalWall(matterHandle: string, userId: string): boolean {
    const res = this.#db
      .query(`DELETE FROM ethical_walls WHERE matter_handle = ? AND user_id = ?`)
      .run(matterHandle, userId);
    return res.changes > 0;
  }

  getEthicalWall(matterHandle: string, userId: string): EthicalWall | null {
    const r = this.#db
      .query(`SELECT * FROM ethical_walls WHERE matter_handle = ? AND user_id = ?`)
      .get(matterHandle, userId) as
      | { matter_handle: string; user_id: string; org_id: string; created_by: string; created_at: string }
      | null;
    return r ?? null;
  }

  listEthicalWalls(matterHandle: string): EthicalWall[] {
    return this.#db
      .query(`SELECT * FROM ethical_walls WHERE matter_handle = ? ORDER BY created_at ASC`)
      .all(matterHandle) as EthicalWall[];
  }

  /** True iff there is an active ethical-wall (deny) row for (matter, user). */
  isWalled(matterHandle: string, userId: string): boolean {
    const r = this.#db
      .query(`SELECT 1 FROM ethical_walls WHERE matter_handle = ? AND user_id = ? LIMIT 1`)
      .get(matterHandle, userId);
    return r !== null;
  }

  // ===========================================================================
  // The E2EE sync relay (DECISION.md §1 — dumb relay, opaque ciphertext only)
  // ===========================================================================
  /**
   * Append an opaque encrypted CRDT update. Idempotent on (stream_handle, blob_id):
   * a retried push returns the already-stored row rather than duplicating. The
   * ciphertext is stored verbatim and NEVER inspected. Returns the stored row
   * (so callers can fan out the assigned cursor `id`).
   *
   * Each opaque `stream_handle` partitions a stream. The local document mapping
   * remains encrypted in the root stream, so the same blob_id in two streams is
   * distinct without revealing document identifiers to the relay.
   */
  appendMatterUpdate(input: {
    matter_handle: string;
    org_id: string;
    stream_handle: string;
    blob_id: string;
    ciphertext: Uint8Array;
    author_seat: string;
    key_epoch: number;
  }): { update: MatterUpdate; duplicate: boolean } | { matterArchived: true } | { streamReleased: true } | { streamLimitReached: true } | { streamSeatQuotaReached: true } | { streamMatterMismatch: true } {
    const now = this.nowIso();
    const txn = this.#db.transaction(() => {
      // This check deliberately lives inside the same IMMEDIATE transaction as
      // first-write stream binding. A push that passed its earlier access gate
      // cannot create a new stream after the matter leaves active status.
      const matter = this.#db.query(`SELECT status FROM matters WHERE matter_handle = ?`).get(input.matter_handle) as { status: MatterStatus } | null;
      if (!matter || matter.status !== "active") return { matterArchived: true as const };
      const stream = this.#db.query(`SELECT matter_handle FROM matter_streams WHERE stream_handle = ?`).get(input.stream_handle) as { matter_handle: string } | null;
      if (stream && stream.matter_handle !== input.matter_handle) return { streamMatterMismatch: true as const };
      if (!stream && this.#db.query("SELECT 1 FROM released_stream_tombstones WHERE stream_handle = ?").get(input.stream_handle)) return { streamReleased: true as const };
      const existing = this.#db
        .query(`SELECT * FROM matter_updates WHERE stream_handle = ? AND blob_id = ?`)
        .get(input.stream_handle, input.blob_id) as
        | { id: number; matter_handle: string; org_id: string; stream_handle: string; blob_id: string; ciphertext: Uint8Array; author_seat: string; key_epoch: number; created_at: string }
        | null;
      if (existing) {
        return { update: { ...existing, ciphertext: new Uint8Array(existing.ciphertext) }, duplicate: true };
      }
      if (!stream) {
        if (this.countLiveMatterStreams(input.matter_handle) >= config.firmMatterStreamCap) return { streamLimitReached: true as const };
        const allocations = this.#db.query("SELECT COUNT(*) AS count FROM matter_streams WHERE matter_handle = ? AND allocated_by_seat = ?").get(input.matter_handle, input.author_seat) as { count: number };
        if (allocations.count >= config.firmMatterStreamsPerSeat) return { streamSeatQuotaReached: true as const };
        this.#db.query("INSERT INTO matter_streams (stream_handle, matter_handle, allocated_by_seat, created_at) VALUES (?, ?, ?, ?)").run(input.stream_handle, input.matter_handle, input.author_seat, now);
      }
      this.#db
        .query(
          `INSERT INTO matter_updates (matter_handle, org_id, stream_handle, blob_id, ciphertext, author_seat, key_epoch, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.matter_handle,
          input.org_id,
          input.stream_handle,
          input.blob_id,
          input.ciphertext,
          input.author_seat,
          input.key_epoch,
          now,
        );
      const row = this.#db
        .query(`SELECT * FROM matter_updates WHERE stream_handle = ? AND blob_id = ?`)
        .get(input.stream_handle, input.blob_id) as {
        id: number;
        matter_handle: string;
        org_id: string;
        stream_handle: string;
        blob_id: string;
        ciphertext: Uint8Array;
        author_seat: string;
        key_epoch: number;
        created_at: string;
      };
      return { update: { ...row, ciphertext: new Uint8Array(row.ciphertext) }, duplicate: false };
    });
    // IMMEDIATE so concurrent pushes of the same (stream_handle, blob_id) can't both insert.
    return txn.immediate() as { update: MatterUpdate; duplicate: boolean } | { matterArchived: true } | { streamReleased: true } | { streamLimitReached: true } | { streamSeatQuotaReached: true } | { streamMatterMismatch: true };
  }

  /**
   * Fetch updates for a matter strictly AFTER `sinceCursor`, in cursor order, for
   * catch-up. `sinceCursor = 0` returns the whole history. Bounded by `limit`.
   * `streamHandle` selects one opaque encrypted stream.
   */
  getMatterUpdatesSince(
    matterHandle: string,
    streamHandle: string,
    sinceCursor: number,
    limit = 500,
    byteLimit = MAX_MATTER_PULL_CIPHERTEXT_BYTES,
  ): MatterUpdate[] {
    const rows = this.#db
      .query(
        `SELECT * FROM matter_updates WHERE matter_handle = ? AND stream_handle = ? AND id > ? ORDER BY id ASC LIMIT ?`,
      )
      .iterate(matterHandle, streamHandle, sinceCursor, limit) as Iterable<{
      id: number;
      matter_handle: string;
      org_id: string;
      stream_handle: string;
      blob_id: string;
      ciphertext: Uint8Array;
      author_seat: string;
      key_epoch: number;
      created_at: string;
    }>;
    const updates: MatterUpdate[] = [];
    let totalCiphertextBytes = 0;
    for (const row of rows) {
      const ciphertext = new Uint8Array(row.ciphertext);
      // Every stored blob is capped at 1 MiB, so a valid single update always
      // fits this 8 MiB page. Never fetch/materialize another row after this
      // point: the byte budget protects relay memory, not only JSON output.
      if (updates.length > 0 && totalCiphertextBytes + ciphertext.byteLength > byteLimit) break;
      updates.push({ ...row, ciphertext });
      totalCiphertextBytes += ciphertext.byteLength;
    }
    return updates;
  }

  /** Highest cursor currently stored for an opaque matter+stream pair (0 if none). */
  latestMatterCursor(matterHandle: string, streamHandle: string): number {
    const r = this.#db
      .query(`SELECT MAX(id) AS m FROM matter_updates WHERE matter_handle = ? AND stream_handle = ?`)
      .get(matterHandle, streamHandle) as { m: number | null };
    return r.m ?? 0;
  }

  // ===========================================================================
  // Assured zero-retention inference proxy (DECISION.md §5)
  // ===========================================================================

  /**
   * Upsert the org's managed key for a provider. The CIPHERTEXT is supplied by
   * the caller (already AES-GCM-encrypted via crypto.encryptSecret); this layer
   * never sees or stores plaintext. One key per (org, provider).
   */
  setOrgProviderKey(input: {
    org_id: string;
    provider: AssuredProvider;
    key_ciphertext: string;
    key_last4: string;
    updated_by: string;
  }): void {
    this.#db
      .query(
        `INSERT INTO org_provider_keys (org_id, provider, key_ciphertext, key_last4, updated_at, updated_by)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(org_id, provider) DO UPDATE SET
           key_ciphertext = excluded.key_ciphertext,
           key_last4      = excluded.key_last4,
           updated_at     = excluded.updated_at,
           updated_by     = excluded.updated_by`,
      )
      .run(input.org_id, input.provider, input.key_ciphertext, input.key_last4, this.nowIso(), input.updated_by);
  }

  /** Fetch a stored managed key row (ciphertext + metadata) for (org, provider). */
  getOrgProviderKey(orgId: string, provider: AssuredProvider): ManagedProviderKey | null {
    const r = this.#db
      .query(`SELECT * FROM org_provider_keys WHERE org_id = ? AND provider = ?`)
      .get(orgId, provider) as
      | { org_id: string; provider: string; key_ciphertext: string; key_last4: string; updated_at: string; updated_by: string }
      | null;
    if (!r) return null;
    return { ...r, provider: r.provider as AssuredProvider };
  }

  /** List which providers an org has a managed key for (metadata only, no secrets). */
  listOrgProviderKeys(orgId: string): Array<{ provider: AssuredProvider; key_last4: string; updated_at: string; updated_by: string }> {
    const rows = this.#db
      .query(`SELECT provider, key_last4, updated_at, updated_by FROM org_provider_keys WHERE org_id = ? ORDER BY provider ASC`)
      .all(orgId) as Array<{ provider: string; key_last4: string; updated_at: string; updated_by: string }>;
    return rows.map((r) => ({ ...r, provider: r.provider as AssuredProvider }));
  }

  /** Remove an org's managed key for a provider. Returns true if a row was deleted. */
  deleteOrgProviderKey(orgId: string, provider: AssuredProvider): boolean {
    const res = this.#db.query(`DELETE FROM org_provider_keys WHERE org_id = ? AND provider = ?`).run(orgId, provider);
    return res.changes > 0;
  }

  /**
   * Append a METADATA-ONLY billing row. This is the only per-request write on
   * the assured path. The `BillingMeta` type has no body field, and this INSERT
   * lists only metadata columns — there is structurally no way for prompt or
   * completion text to land here.
   */
  recordInference(meta: BillingMeta): void {
    this.#db
      .query(
        `INSERT INTO inference_billing (request_id, org_id, seat_id, provider, model, input_tokens, output_tokens, status, latency_ms, ts)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .run(
        meta.request_id,
        meta.org_id,
        meta.seat_id,
        meta.provider,
        meta.model,
        meta.input_tokens,
        meta.output_tokens,
        meta.status,
        meta.latency_ms,
        meta.ts,
      );
  }

  /** List the org's inference billing rows (newest first). Metadata only. */
  listInferenceBilling(orgId: string, limit = 200): BillingMeta[] {
    const rows = this.#db
      .query(`SELECT * FROM inference_billing WHERE org_id = ? ORDER BY id DESC LIMIT ?`)
      .all(orgId, limit) as Array<{
      request_id: string;
      org_id: string;
      seat_id: string;
      provider: string;
      model: string;
      input_tokens: number;
      output_tokens: number;
      status: number;
      latency_ms: number;
      ts: string;
    }>;
    // Map to the BillingMeta shape explicitly (drop the internal autoincrement
    // `id` column) so the API surface is exactly the documented metadata fields.
    return rows.map(
      (r): BillingMeta => ({
        request_id: r.request_id,
        org_id: r.org_id,
        seat_id: r.seat_id,
        provider: r.provider as AssuredProvider,
        model: r.model,
        input_tokens: r.input_tokens,
        output_tokens: r.output_tokens,
        status: r.status,
        latency_ms: r.latency_ms,
        ts: r.ts,
      }),
    );
  }

  // ===========================================================================
  // Chunk 4 — Device keys
  // ===========================================================================

  /**
   * Upsert a device record for (device_id, user_id). If the device already
   * exists for this user, update label + pubkey (key rotation). If device_id is
   * claimed by a DIFFERENT user in this org, that is fine — devices are scoped
   * to a user. Cross-user collisions (a client bug) overwrite only the calling
   * user's row, so they cannot steal another user's device slot.
   */
  upsertDevice(input: {
    device_id: string;
    user_id: string;
    org_id: string;
    machine_id: string;
    /** Accepted only by trusted in-process fixtures; never persisted. */
    label?: string;
    pubkey_jwk: string;
  }): Device {
    const now = this.nowIso();
    this.#db
      .query(
        `INSERT INTO devices (device_id, user_id, org_id, machine_id, label, pubkey_jwk, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id, user_id) DO UPDATE SET
           machine_id = excluded.machine_id,
           label      = excluded.label,
           pubkey_jwk = excluded.pubkey_jwk`,
      )
      .run(input.device_id, input.user_id, input.org_id, input.machine_id, "", input.pubkey_jwk, now);
    return {
      device_id: input.device_id,
      user_id: input.user_id,
      org_id: input.org_id,
      machine_id: input.machine_id,
      label: "",
      pubkey_jwk: input.pubkey_jwk,
      created_at: now,
    };
  }

  /** List all devices registered by the given users (org-scoped: only same-org users). */
  listDevicesForUsers(userIds: string[]): Device[] {
    if (userIds.length === 0) return [];
    // SQLite has no array binding; build a parameterised IN clause.
    const placeholders = userIds.map(() => "?").join(",");
    const rows = this.#db
      .query(`SELECT * FROM devices WHERE user_id IN (${placeholders}) ORDER BY user_id, created_at ASC`)
      .all(...userIds) as Array<{
      device_id: string;
      user_id: string;
      org_id: string;
      machine_id: string;
      label: string;
      pubkey_jwk: string;
      created_at: string;
    }>;
    return rows;
  }

  getDevice(deviceId: string, userId: string): Device | null {
    const r = this.#db.query(`SELECT * FROM devices WHERE device_id = ? AND user_id = ?`).get(deviceId, userId) as
      | Device
      | null;
    return r ?? null;
  }

  // ===========================================================================
  // Chunk 4 — Wrapped matter keys
  // ===========================================================================

  /**
   * Atomically publish a batch of wrapped keys for the current active epoch.
   *
   * The active-status and epoch checks intentionally share this IMMEDIATE
   * transaction with every insert. That closes the time-of-check/time-of-use
   * window where a matter could leave active status after a route checked it but
   * before it wrote new encrypted key material.
   */
  publishWrappedMatterKeys(input: {
    matter_handle: string;
    org_id: string;
    epoch: number;
    published_by: string;
    wrapped: Array<{ user_id: string; device_id: string; wrapped_key: Uint8Array }>;
  }): { stored: number; skipped: number } | { matterArchived: true } | { staleEpoch: true } | { matterNotFound: true } | { invalidRecipient: true } | { publisherUnauthorized: true } | { publisherWalled: true } {
    const txn = this.#db.transaction(() => {
      const matter = this.#db
        .query(`SELECT org_id, status, key_epoch FROM matters WHERE matter_handle = ?`)
        .get(input.matter_handle) as { org_id: string; status: MatterStatus; key_epoch: number } | null;
      if (!matter || matter.org_id !== input.org_id) return { matterNotFound: true as const };
      if (matter.status !== "active") return { matterArchived: true as const };
      if (matter.key_epoch !== input.epoch) return { staleEpoch: true as const };

      // The route performs this check first for fast rejection, but permission
      // can change while it parses the request. Recheck inside this same
      // IMMEDIATE transaction as the inserts so a demoted or walled publisher
      // cannot replace current-epoch wrapped keys after losing access.
      if (this.isWalled(input.matter_handle, input.published_by)) return { publisherWalled: true as const };
      const publisher = this.#db
        .query(`SELECT role FROM users WHERE user_id = ? AND org_id = ?`)
        .get(input.published_by, input.org_id) as { role: UserRole } | null;
      const publisherMembership = this.#db
        .query(`SELECT role FROM matter_members WHERE matter_handle = ? AND user_id = ? AND org_id = ?`)
        .get(input.matter_handle, input.published_by, input.org_id) as { role: MatterRole } | null;
      if (publisher?.role !== "admin" && publisherMembership?.role !== "owner") return { publisherUnauthorized: true as const };

      let stored = 0;
      let skipped = 0;
      for (const key of input.wrapped) {
        const user = this.getUser(key.user_id);
        if (!user || user.org_id !== input.org_id || !this.getDevice(key.device_id, key.user_id)) return { invalidRecipient: true as const };
        if (this.isWalled(input.matter_handle, key.user_id)) {
          skipped++;
          continue;
        }
        this.upsertWrappedMatterKey({ ...key, matter_handle: input.matter_handle, epoch: input.epoch, published_by: input.published_by });
        stored++;
      }
      return { stored, skipped };
    });
    return txn.immediate() as { stored: number; skipped: number } | { matterArchived: true } | { staleEpoch: true } | { matterNotFound: true } | { invalidRecipient: true } | { publisherUnauthorized: true } | { publisherWalled: true };
  }

  /**
   * Store a wrapped matter key for one device. Idempotent on the PK tuple:
   * a re-publish of the same (matter, epoch, user, device) replaces the blob.
   */
  upsertWrappedMatterKey(input: {
    matter_handle: string;
    epoch: number;
    user_id: string;
    device_id: string;
    wrapped_key: Uint8Array;
    published_by: string;
  }): void {
    this.#db
      .query(
        `INSERT INTO wrapped_matter_keys (matter_handle, epoch, user_id, device_id, wrapped_key, published_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(matter_handle, epoch, user_id, device_id) DO UPDATE SET
           wrapped_key = excluded.wrapped_key,
           published_by    = excluded.published_by`,
      )
      .run(input.matter_handle, input.epoch, input.user_id, input.device_id, input.wrapped_key, input.published_by, this.nowIso());
  }

  /** Fetch the wrapped key for a specific (matter, epoch, user, device). */
  getWrappedMatterKey(matterHandle: string, epoch: number, userId: string, deviceId: string): WrappedMatterKey | null {
    const r = this.#db
      .query(`SELECT * FROM wrapped_matter_keys WHERE matter_handle = ? AND epoch = ? AND user_id = ? AND device_id = ?`)
      .get(matterHandle, epoch, userId, deviceId) as (Omit<WrappedMatterKey, "wrapped_key_b64"> & { wrapped_key: Uint8Array }) | null;
    return r ? toWrappedMatterKey(r) : null;
  }

  /**
   * Resolve access, active status, current epoch, and one wrapped key under one
   * IMMEDIATE lock. A completed status change therefore serializes either wholly
   * before this read (no key returned) or wholly after it (the read happened
   * while the matter was active); there is no check-then-read gap.
   */
  fetchWrappedMatterKeyForAccess(input: {
    matter_handle: string;
    org_id: string;
    user_id: string;
    role: UserRole;
    device_id: string;
  }):
    | { ok: true; epoch: number; access: "member" | "admin"; key: WrappedMatterKey | null }
    | { ok: false; reason: "matter_not_found" | "cross_org" | "inactive" | "walled" | "not_member" } {
    const txn = this.#db.transaction(() => {
      const matter = this.#db
        .query(`SELECT org_id, status, key_epoch FROM matters WHERE matter_handle = ?`)
        .get(input.matter_handle) as { org_id: string; status: MatterStatus; key_epoch: number } | null;
      if (!matter) return { ok: false as const, reason: "matter_not_found" as const };
      if (matter.org_id !== input.org_id) return { ok: false as const, reason: "cross_org" as const };
      if (matter.status !== "active") return { ok: false as const, reason: "inactive" as const };

      const walled = this.#db
        .query(`SELECT 1 FROM ethical_walls WHERE matter_handle = ? AND user_id = ?`)
        .get(input.matter_handle, input.user_id);
      if (walled) return { ok: false as const, reason: "walled" as const };

      const member = this.#db
        .query(`SELECT 1 FROM matter_members WHERE matter_handle = ? AND user_id = ?`)
        .get(input.matter_handle, input.user_id);
      if (!member && input.role !== "admin") return { ok: false as const, reason: "not_member" as const };

      const row = this.#db
        .query(`SELECT * FROM wrapped_matter_keys WHERE matter_handle = ? AND epoch = ? AND user_id = ? AND device_id = ?`)
        .get(input.matter_handle, matter.key_epoch, input.user_id, input.device_id) as (Omit<WrappedMatterKey, "wrapped_key_b64"> & { wrapped_key: Uint8Array }) | null;
      return { ok: true as const, epoch: matter.key_epoch, access: member ? "member" as const : "admin" as const, key: row ? toWrappedMatterKey(row) : null };
    });
    return txn.immediate() as ReturnType<Store["fetchWrappedMatterKeyForAccess"]>;
  }

  /**
   * Atomically publish a batch of wrapped keys for one opaque intake handle.
   * The handle can bind to only one matter, which makes the fetch route
   * unambiguous without putting a matter handle in its URL or body.
   */
  publishWrappedIntakeKeys(input: {
    intake_handle: string;
    matter_handle: string;
    org_id: string;
    epoch: number;
    published_by: string;
    wrapped: Array<{ user_id: string; device_id: string; wrapped_key: Uint8Array }>;
  }): { stored: number; skipped: number } | { matterArchived: true } | { staleEpoch: true } | { matterNotFound: true } | { invalidRecipient: true } | { publisherUnauthorized: true } | { publisherWalled: true } | { intakeMatterMismatch: true } {
    const txn = this.#db.transaction(() => {
      const matter = this.#db
        .query(`SELECT org_id, status, key_epoch FROM matters WHERE matter_handle = ?`)
        .get(input.matter_handle) as { org_id: string; status: MatterStatus; key_epoch: number } | null;
      if (!matter || matter.org_id !== input.org_id) return { matterNotFound: true as const };
      if (matter.status !== "active") return { matterArchived: true as const };
      if (matter.key_epoch !== input.epoch) return { staleEpoch: true as const };

      if (this.isWalled(input.matter_handle, input.published_by)) return { publisherWalled: true as const };
      const publisher = this.#db
        .query(`SELECT role FROM users WHERE user_id = ? AND org_id = ?`)
        .get(input.published_by, input.org_id) as { role: UserRole } | null;
      const publisherMembership = this.#db
        .query(`SELECT role FROM matter_members WHERE matter_handle = ? AND user_id = ? AND org_id = ?`)
        .get(input.matter_handle, input.published_by, input.org_id) as { role: MatterRole } | null;
      if (publisher?.role !== "admin" && publisherMembership?.role !== "owner") return { publisherUnauthorized: true as const };

      const existing = this.#db
        .query(`SELECT matter_handle FROM wrapped_intake_keys WHERE intake_handle = ? AND org_id = ? LIMIT 1`)
        .get(input.intake_handle, input.org_id) as { matter_handle: string } | null;
      if (existing && existing.matter_handle !== input.matter_handle) return { intakeMatterMismatch: true as const };

      let stored = 0;
      let skipped = 0;
      for (const key of input.wrapped) {
        const user = this.getUser(key.user_id);
        if (!user || user.org_id !== input.org_id || !this.getDevice(key.device_id, key.user_id)) return { invalidRecipient: true as const };
        if (this.isWalled(input.matter_handle, key.user_id)) {
          skipped++;
          continue;
        }
        this.#db
          .query(
            `INSERT INTO wrapped_intake_keys (intake_handle, matter_handle, org_id, epoch, user_id, device_id, wrapped_key, published_by, created_at)
             VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
             ON CONFLICT(intake_handle, epoch, user_id, device_id) DO UPDATE SET
               wrapped_key = excluded.wrapped_key,
               published_by = excluded.published_by`,
          )
          .run(input.intake_handle, input.matter_handle, input.org_id, input.epoch, key.user_id, key.device_id, key.wrapped_key, input.published_by, this.nowIso());
        stored++;
      }
      return { stored, skipped };
    });
    return txn.immediate() as ReturnType<Store["publishWrappedIntakeKeys"]>;
  }

  /** Resolve an intake's bound matter, apply normal matter access checks, and fetch one device key atomically. */
  fetchWrappedIntakeKeyForAccess(input: {
    intake_handle: string;
    org_id: string;
    user_id: string;
    role: UserRole;
    device_id: string;
  }):
    | { ok: true; epoch: number; access: "member" | "admin"; key: { wrapped_key: Uint8Array } | null }
    | { ok: false; reason: "intake_not_found" | "matter_not_found" | "cross_org" | "inactive" | "walled" | "not_member" } {
    const txn = this.#db.transaction(() => {
      const binding = this.#db
        .query(`SELECT matter_handle FROM wrapped_intake_keys WHERE intake_handle = ? AND org_id = ? LIMIT 1`)
        .get(input.intake_handle, input.org_id) as { matter_handle: string } | null;
      if (!binding) return { ok: false as const, reason: "intake_not_found" as const };

      const matter = this.#db
        .query(`SELECT org_id, status, key_epoch FROM matters WHERE matter_handle = ?`)
        .get(binding.matter_handle) as { org_id: string; status: MatterStatus; key_epoch: number } | null;
      if (!matter) return { ok: false as const, reason: "matter_not_found" as const };
      if (matter.org_id !== input.org_id) return { ok: false as const, reason: "cross_org" as const };
      if (matter.status !== "active") return { ok: false as const, reason: "inactive" as const };

      const walled = this.#db
        .query(`SELECT 1 FROM ethical_walls WHERE matter_handle = ? AND user_id = ?`)
        .get(binding.matter_handle, input.user_id);
      if (walled) return { ok: false as const, reason: "walled" as const };
      const member = this.#db
        .query(`SELECT 1 FROM matter_members WHERE matter_handle = ? AND user_id = ?`)
        .get(binding.matter_handle, input.user_id);
      if (!member && input.role !== "admin") return { ok: false as const, reason: "not_member" as const };

      const key = this.#db
        .query(`SELECT wrapped_key FROM wrapped_intake_keys WHERE intake_handle = ? AND matter_handle = ? AND epoch = ? AND user_id = ? AND device_id = ?`)
        .get(input.intake_handle, binding.matter_handle, matter.key_epoch, input.user_id, input.device_id) as { wrapped_key: Uint8Array } | null;
      return {
        ok: true as const,
        epoch: matter.key_epoch,
        access: member ? "member" as const : "admin" as const,
        key: key ? { wrapped_key: key.wrapped_key } : null,
      };
    });
    return txn.immediate() as ReturnType<Store["fetchWrappedIntakeKeyForAccess"]>;
  }

  /**
   * Delete ALL wrapped keys for a user on a given matter (all epochs).
   * Called when a member is removed or walled — they lose access to all key
   * epochs, including ones they already had.
   */
  deleteWrappedKeysForUser(matterHandle: string, userId: string): void {
    this.#db
      .query(`DELETE FROM wrapped_matter_keys WHERE matter_handle = ? AND user_id = ?`)
      .run(matterHandle, userId);
  }

  /**
   * Delete all wrapped keys for a matter at a SPECIFIC epoch (the old epoch
   * before a key rotation). After remove/wall the epoch bumps; the old epoch's
   * published set is stale because the removed user had keys for it. Deleting
   * it forces a full re-publish at the new epoch.
   */
  deleteWrappedKeysForEpoch(matterHandle: string, epoch: number): void {
    this.#db
      .query(`DELETE FROM wrapped_matter_keys WHERE matter_handle = ? AND epoch = ?`)
      .run(matterHandle, epoch);
  }

  // ===========================================================================
  // Chunk 4 — Webhook idempotency
  // ===========================================================================

  /**
   * Record a processed webhook event. Returns false if the event_id already
   * exists (already processed — caller should return 200 + ignore).
   */
  recordWebhookEvent(eventId: string): boolean {
    const existing = this.#db.query(`SELECT 1 FROM webhook_events WHERE event_id = ?`).get(eventId);
    if (existing) return false;
    this.#db.query(`INSERT INTO webhook_events (event_id, processed_at) VALUES (?, ?)`).run(eventId, this.nowIso());
    return true;
  }

  /**
   * Record a processed webhook event with an optional subscription identifier
   * for second-level deduplication. Returns false if:
   *   - the event_id already exists (retry of the same delivery), OR
   *   - the subscriptionId already appears in another row (same subscription
   *     delivered twice under different webhook_ids, e.g. subscription_created
   *     and order_created for the same purchase).
   * When the subscription_id constraint fires, returns false so the caller
   * skips provisioning without treating it as an error.
   */
  recordWebhookEventWithSubscription(eventId: string, subscriptionId: string | null): boolean {
    // First-level: duplicate event_id.
    const byEventId = this.#db.query(`SELECT 1 FROM webhook_events WHERE event_id = ?`).get(eventId);
    if (byEventId) return false;
    // Second-level: same subscription delivered under a different webhook_id.
    if (subscriptionId) {
      const bySubId = this.#db.query(
        `SELECT 1 FROM webhook_events WHERE subscription_id = ?`,
      ).get(subscriptionId);
      if (bySubId) return false;
    }
    this.#db
      .query(
        `INSERT INTO webhook_events (event_id, processed_at, subscription_id) VALUES (?, ?, ?)`,
      )
      .run(eventId, this.nowIso(), subscriptionId ?? null);
    return true;
  }

  // ===========================================================================
  // Chunk 5 — SSO / OIDC IdP configuration
  // ===========================================================================

  /** Look up a user by normalised email (trim + lowercase). Returns User or null. */
  getUserByEmailNorm(email: string): User | null {
    const r = this.#db
      .query(`SELECT * FROM users WHERE email_norm = ?`)
      .get(email.trim().toLowerCase()) as UserRow | null;
    return r ? toUser(r) : null;
  }

  /** Get the org's IdP configuration, or null if not set. */
  getOrgIdpConfig(orgId: string): OrgIdpConfig | null {
    const r = this.#db
      .query(`SELECT * FROM org_idp_config WHERE org_id = ?`)
      .get(orgId) as {
      org_id: string;
      provider: string;
      issuer: string;
      client_id: string;
      client_secret_enc: string;
      enabled: number;
      created_at: string;
      updated_at: string;
    } | null;
    if (!r) return null;
    return {
      org_id: r.org_id,
      provider: r.provider as OrgIdpConfig["provider"],
      issuer: r.issuer,
      client_id: r.client_id,
      client_secret_enc: r.client_secret_enc,
      enabled: r.enabled === 1,
      created_at: r.created_at,
      updated_at: r.updated_at,
    };
  }

  /** Upsert (insert or replace) the org's IdP configuration. Keyed on org_id. */
  upsertOrgIdpConfig(input: {
    org_id: string;
    provider: IdpProvider;
    issuer: string;
    client_id: string;
    client_secret_enc: string;
    enabled: boolean;
  }): void {
    const now = this.nowIso();
    this.#db
      .query(
        `INSERT INTO org_idp_config
           (org_id, provider, issuer, client_id, client_secret_enc, enabled, created_at, updated_at)
         VALUES ($org_id, $provider, $issuer, $client_id, $secret, $enabled, $now, $now)
         ON CONFLICT(org_id) DO UPDATE SET
           provider = $provider,
           issuer = $issuer,
           client_id = $client_id,
           client_secret_enc = $secret,
           enabled = $enabled,
           updated_at = $now`,
      )
      .run({
        $org_id: input.org_id,
        $provider: input.provider,
        $issuer: input.issuer,
        $client_id: input.client_id,
        $secret: input.client_secret_enc,
        $enabled: input.enabled ? 1 : 0,
        $now: now,
      });
  }

  /** Delete the org's IdP configuration. No-op if not set. */
  deleteOrgIdpConfig(orgId: string): void {
    this.#db.query(`DELETE FROM org_idp_config WHERE org_id = ?`).run(orgId);
  }

  // ===========================================================================
  // Chunk 4 — Org claim (for unclaimed orgs provisioned by webhook)
  // ===========================================================================

  /** Find an org by its license key hash (used in /org/claim). */
  findOrgByLicenseKeyHash(keyHash: string): { org: Org; licenseKey: LicenseKey } | null {
    const keyRow = this.#db.query(`SELECT * FROM license_keys WHERE key_hash = ?`).get(keyHash) as
      | (Omit<LicenseKey, "packs"> & { packs: string })
      | null;
    if (!keyRow) return null;
    const orgRow = this.#db.query(`SELECT * FROM orgs WHERE org_id = ?`).get(keyRow.org_id) as OrgRow | null;
    if (!orgRow) return null;
    return {
      org: toOrg(orgRow),
      licenseKey: { ...keyRow, packs: parsePacks(keyRow.packs) },
    };
  }

  /**
   * Mark an org as active (claim it). Sets status = 'active' and optionally
   * renames it. Called by /org/claim after identity verification.
   */
  claimOrg(orgId: string, opts?: { name?: string }): void {
    if (opts?.name) {
      this.#db.query(`UPDATE orgs SET status = 'active', name = ? WHERE org_id = ?`).run(opts.name, orgId);
    } else {
      this.#db.query(`UPDATE orgs SET status = 'active' WHERE org_id = ?`).run(orgId);
    }
  }

  /** Atomically claim an org and create its first administrator. */
  claimOrgAndCreateAdmin(input: {
    org_id: string;
    org_name?: string;
    email: string;
    password_hash: string;
  }): User {
    const txn = this.#db.transaction(() => {
      this.claimOrg(input.org_id, input.org_name ? { name: input.org_name } : undefined);
      return this.createUser({
        org_id: input.org_id,
        email: input.email,
        password_hash: input.password_hash,
        role: "admin",
      });
    });
    return txn.immediate() as User;
  }

  /**
   * List matters where the user is a member AND NOT walled, in the given org.
   * Returns the matter info plus the user's role in that matter.
   * Used by POST /matter/mine.
   */
  listMatterMembershipsForUser(
    userId: string,
    orgId: string,
  ): Array<{ matter_handle: string; root_stream_handle: string; status: MatterStatus; key_epoch: number; role: MatterRole }> {
    const rows = this.#db
      .query(
        `SELECT m.matter_handle, m.root_stream_handle, m.status, m.key_epoch, mm.role
         FROM matter_members mm
         JOIN matters m ON m.matter_handle = mm.matter_handle
         WHERE mm.user_id = ? AND m.org_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM ethical_walls ew
             WHERE ew.matter_handle = mm.matter_handle AND ew.user_id = mm.user_id
           )
         ORDER BY m.created_at DESC`,
      )
      .all(userId, orgId) as Array<{
      matter_handle: string;
      root_stream_handle: string;
      status: string;
      key_epoch: number;
      role: string;
    }>;
    return rows.map((r) => ({
      matter_handle: r.matter_handle,
      root_stream_handle: r.root_stream_handle,
      status: r.status as MatterStatus,
      key_epoch: r.key_epoch,
      role: r.role as MatterRole,
    }));
  }
}

/** Process-wide store, opened from config. Tests construct their own Store(":memory:"). */
let _store: Store | null = null;
export function getStore(): Store {
  if (!_store) _store = new Store(config.dbPath);
  return _store;
}
