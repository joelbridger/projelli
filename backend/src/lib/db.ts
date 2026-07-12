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

import { Database } from "bun:sqlite";
import { randomUUID } from "node:crypto";
import { config } from "./config.ts";
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

/** Ciphertext is retained for an advisor's offline catch-up window, then removed. */
export const INTAKE_EXPIRY_CIPHERTEXT_GRACE_DAYS = 30;
export const INTAKE_EXPIRY_CIPHERTEXT_GRACE_MS = INTAKE_EXPIRY_CIPHERTEXT_GRACE_DAYS * 24 * 60 * 60 * 1000;

/** Store intake expiries in sortable UTC ISO form so retention range queries are reliable. */
function normalizeIntakeExpiry(value: string): string {
  const timestamp = Date.parse(value);
  if (!Number.isFinite(timestamp)) throw new Error("invalid_intake_expires_at");
  return new Date(timestamp).toISOString();
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
  matter_id   TEXT PRIMARY KEY,
  org_id      TEXT NOT NULL REFERENCES orgs(org_id),
  client_name TEXT NOT NULL,
  status      TEXT NOT NULL DEFAULT 'active',   -- active | archived
  key_epoch   INTEGER NOT NULL DEFAULT 1,       -- bumps on member-remove / wall-set
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matters_org ON matters(org_id);

CREATE TABLE IF NOT EXISTS matter_members (
  matter_id  TEXT NOT NULL REFERENCES matters(matter_id),
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  org_id     TEXT NOT NULL,
  role       TEXT NOT NULL DEFAULT 'editor',    -- owner | editor | viewer
  created_at TEXT NOT NULL,
  PRIMARY KEY (matter_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_matter_members_user ON matter_members(user_id);
CREATE INDEX IF NOT EXISTS idx_matter_members_matter ON matter_members(matter_id);

-- Explicit DENY (a screen). Deny-overrides-allow: a row here blocks (matter,user)
-- regardless of membership or admin role.
CREATE TABLE IF NOT EXISTS ethical_walls (
  matter_id  TEXT NOT NULL REFERENCES matters(matter_id),
  user_id    TEXT NOT NULL REFERENCES users(user_id),
  org_id     TEXT NOT NULL,
  reason     TEXT,
  created_by TEXT NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY (matter_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_ethical_walls_user ON ethical_walls(user_id);

-- The dumb relay: opaque end-to-end-encrypted CRDT update blobs. The ciphertext
-- is stored as a BLOB and is NEVER parsed, decoded, hashed, or logged. The id is
-- the monotonic fetch cursor for catch-up. (blob_id) is a per-matter client
-- idempotency key so a retried push doesn't duplicate.
-- doc_id partitions the relay into per-document streams; notes use '_notes'.
CREATE TABLE IF NOT EXISTS matter_updates (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  matter_id   TEXT NOT NULL REFERENCES matters(matter_id),
  org_id      TEXT NOT NULL,
  doc_id      TEXT NOT NULL DEFAULT '_notes',
  blob_id     TEXT NOT NULL,
  ciphertext  BLOB NOT NULL,
  author_seat TEXT NOT NULL,
  key_epoch   INTEGER NOT NULL DEFAULT 1,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_matter_updates_matter ON matter_updates(matter_id, doc_id, id);
CREATE UNIQUE INDEX IF NOT EXISTS idx_matter_updates_blob ON matter_updates(matter_id, doc_id, blob_id);

-- =====================================================================
-- CRM relay envelopes (03 §2). The primary tables intentionally match the
-- frozen contract exactly. Sender identity, sender seat, matter scope, type,
-- and operation links are deliberately absent.
-- =====================================================================
CREATE TABLE IF NOT EXISTS notify_envelopes (
  org_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  recipient_user_id TEXT NOT NULL,
  envelope_id TEXT NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at TEXT NOT NULL,
  expires_at TEXT,
  retention_until_terminal BOOLEAN NOT NULL DEFAULT FALSE,
  terminal_at TEXT,
  PRIMARY KEY(org_id, seq),
  UNIQUE(org_id, recipient_user_id, envelope_id)
);
CREATE TABLE IF NOT EXISTS notify_device_acks (
  org_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  device_id TEXT NOT NULL,
  acked_through INTEGER NOT NULL,
  PRIMARY KEY(org_id, recipient_user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_notify_inbox ON notify_envelopes(org_id, recipient_user_id, seq);

-- The key hint and retry token are routing metadata required by the wire API,
-- not envelope content. Neither table contains a sender, scope, type, or
-- operation reference.
CREATE TABLE IF NOT EXISTS notify_envelope_delivery (
  org_id TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  envelope_id TEXT NOT NULL,
  key_hint TEXT NOT NULL,
  PRIMARY KEY(org_id, recipient_user_id, envelope_id)
);
CREATE TABLE IF NOT EXISTS notify_idempotency (
  org_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  recipient_user_id TEXT NOT NULL,
  envelope_id TEXT NOT NULL,
  seq INTEGER NOT NULL,
  PRIMARY KEY(org_id, idempotency_key)
);

-- =====================================================================
-- Checkpoint relay control plane (03 §6.1). The relay stores encrypted
-- manifest/chunk/receipt blobs plus only the allowed plaintext control fields.
-- =====================================================================
CREATE TABLE IF NOT EXISTS checkpoint_manifests (
  matter_id TEXT NOT NULL REFERENCES matters(matter_id),
  org_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  frontier INTEGER NOT NULL,
  retention_eligible BOOLEAN NOT NULL DEFAULT FALSE,
  manifest_ciphertext BLOB NOT NULL,
  published_at TEXT NOT NULL,
  PRIMARY KEY(matter_id, doc_id, generation)
);
CREATE TABLE IF NOT EXISTS checkpoint_chunks (
  matter_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  ciphertext BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(matter_id, doc_id, generation, chunk_index)
);
CREATE TABLE IF NOT EXISTS checkpoint_validation_receipts (
  matter_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  validator_user_id TEXT NOT NULL,
  validator_device_id TEXT NOT NULL,
  signed_receipt BLOB NOT NULL,
  created_at TEXT NOT NULL,
  PRIMARY KEY(matter_id, doc_id, generation, validator_user_id)
);
CREATE TABLE IF NOT EXISTS checkpoint_archives (
  matter_id TEXT NOT NULL,
  org_id TEXT NOT NULL,
  doc_id TEXT NOT NULL,
  generation INTEGER NOT NULL,
  frontier INTEGER NOT NULL,
  manifest_ciphertext BLOB NOT NULL,
  archived_at TEXT NOT NULL,
  PRIMARY KEY(matter_id, doc_id, generation)
);

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
  matter_id       TEXT NOT NULL REFERENCES matters(matter_id),
  epoch           INTEGER NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  device_id       TEXT NOT NULL,
  wrapped_key_b64 TEXT NOT NULL,
  published_by    TEXT NOT NULL,  -- user_id of the admin / owner who published
  created_at      TEXT NOT NULL,
  PRIMARY KEY (matter_id, epoch, user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_wmk_matter_epoch ON wrapped_matter_keys(matter_id, epoch);
CREATE INDEX IF NOT EXISTS idx_wmk_user ON wrapped_matter_keys(user_id);

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

-- =====================================================================
-- Lantern Intake Wave 1: write-only public intake relay.
--
-- The relay is a mailbox for opaque ciphertext. It stores the link-token HMAC
-- (never the token), advisor routing identity, sealed page state/checklist, and
-- submitted ciphertext chunks/manifests. It deliberately has no client_name,
-- item label, answer, file-name, IP, or user-agent columns.
-- =====================================================================

CREATE TABLE IF NOT EXISTS intakes (
  intake_id            TEXT PRIMARY KEY,
  org_id               TEXT NOT NULL,
  user_id              TEXT NOT NULL,
  seat_id              TEXT NOT NULL,
  token_hash           TEXT NOT NULL,
  expires_at           TEXT NOT NULL,
  status               TEXT NOT NULL DEFAULT 'active',
  checklist_ciphertext BLOB NOT NULL,
  state_ciphertext     BLOB NOT NULL,
  checklist_version    INTEGER NOT NULL DEFAULT 1,
  generation           INTEGER NOT NULL DEFAULT 1,
  created_at           TEXT NOT NULL,
  revoked_at           TEXT
);
CREATE INDEX IF NOT EXISTS idx_intakes_org ON intakes(org_id, created_at);
CREATE INDEX IF NOT EXISTS idx_intakes_status ON intakes(status, expires_at);

CREATE TABLE IF NOT EXISTS intake_chunks (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  intake_id     TEXT NOT NULL REFERENCES intakes(intake_id) ON DELETE CASCADE,
  item_id       TEXT NOT NULL,
  submission_id TEXT NOT NULL,
  idx           INTEGER NOT NULL,
  ciphertext    BLOB NOT NULL,
  size          INTEGER NOT NULL,
  created_at    TEXT NOT NULL,
  bound_at      TEXT,
  UNIQUE(intake_id, item_id, submission_id, idx)
);
CREATE INDEX IF NOT EXISTS idx_intake_chunks_intake ON intake_chunks(intake_id, id);
CREATE INDEX IF NOT EXISTS idx_intake_chunks_submission ON intake_chunks(intake_id, item_id, submission_id, idx);

CREATE TABLE IF NOT EXISTS intake_submissions (
  id                   INTEGER PRIMARY KEY AUTOINCREMENT,
  intake_id            TEXT NOT NULL REFERENCES intakes(intake_id) ON DELETE CASCADE,
  item_id              TEXT NOT NULL,
  submission_id        TEXT NOT NULL,
  manifest_ciphertext  BLOB,
  wrapped_content_key  BLOB,
  chunk_count          INTEGER NOT NULL DEFAULT 0,
  created_at           TEXT NOT NULL,
  acked_at             TEXT,
  UNIQUE(intake_id, submission_id)
);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_inbox ON intake_submissions(intake_id, id);
CREATE INDEX IF NOT EXISTS idx_intake_submissions_item ON intake_submissions(intake_id, item_id);

-- Firm-only per-device copies of an intake's private key. The relay stores
-- routing ids and opaque ciphertext only. matter_id is authorization routing
-- metadata, not client content; it is needed to apply the existing roster and
-- ethical-wall rules on every fetch.
CREATE TABLE IF NOT EXISTS intake_wrapped_keys (
  intake_id       TEXT NOT NULL REFERENCES intakes(intake_id) ON DELETE CASCADE,
  matter_id       TEXT NOT NULL REFERENCES matters(matter_id),
  epoch           INTEGER NOT NULL,
  user_id         TEXT NOT NULL REFERENCES users(user_id),
  device_id       TEXT NOT NULL,
  wrapped_key_b64 TEXT NOT NULL,
  published_by    TEXT NOT NULL,
  created_at      TEXT NOT NULL,
  PRIMARY KEY (intake_id, epoch, user_id, device_id)
);
CREATE INDEX IF NOT EXISTS idx_intake_wrapped_keys_fetch ON intake_wrapped_keys(intake_id, user_id, device_id, epoch DESC);
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
  matter_id: string;
  org_id: string;
  client_name: string;
  status: string;
  key_epoch: number;
  created_at: string;
}
function toMatter(r: MatterRow): Matter {
  return {
    matter_id: r.matter_id,
    org_id: r.org_id,
    client_name: r.client_name,
    status: r.status as MatterStatus,
    key_epoch: r.key_epoch,
    created_at: r.created_at,
  };
}

export type IntakeStatus = "active" | "revoked";

export interface IntakeRecord {
  intake_id: string;
  org_id: string;
  user_id: string;
  seat_id: string;
  token_hash: string;
  expires_at: string;
  status: IntakeStatus;
  checklist_ciphertext: Uint8Array;
  state_ciphertext: Uint8Array;
  checklist_version: number;
  generation: number;
  created_at: string;
  revoked_at: string | null;
}

export interface IntakeChunkRecord {
  id: number;
  intake_id: string;
  item_id: string;
  submission_id: string;
  index: number;
  ciphertext: Uint8Array;
  size: number;
  created_at: string;
  bound_at: string | null;
}

export interface IntakeSubmissionRecord {
  id: number;
  intake_id: string;
  item_id: string;
  submission_id: string;
  manifest_ciphertext: Uint8Array | null;
  wrapped_content_key: Uint8Array | null;
  chunk_count: number;
  created_at: string;
  acked_at: string | null;
}

interface IntakeRow {
  intake_id: string;
  org_id: string;
  user_id: string;
  seat_id: string;
  token_hash: string;
  expires_at: string;
  status: string;
  checklist_ciphertext: Uint8Array;
  state_ciphertext: Uint8Array;
  checklist_version: number;
  generation: number;
  created_at: string;
  revoked_at: string | null;
}

interface IntakeChunkRow {
  id: number;
  intake_id: string;
  item_id: string;
  submission_id: string;
  idx: number;
  ciphertext: Uint8Array;
  size: number;
  created_at: string;
  bound_at: string | null;
}

interface IntakeSubmissionRow {
  id: number;
  intake_id: string;
  item_id: string;
  submission_id: string;
  manifest_ciphertext: Uint8Array | null;
  wrapped_content_key: Uint8Array | null;
  chunk_count: number;
  created_at: string;
  acked_at: string | null;
}

function toBytes(v: Uint8Array): Uint8Array {
  return new Uint8Array(v);
}

function toIntake(r: IntakeRow): IntakeRecord {
  return {
    ...r,
    status: r.status as IntakeStatus,
    checklist_ciphertext: toBytes(r.checklist_ciphertext),
    state_ciphertext: toBytes(r.state_ciphertext),
  };
}

function toIntakeChunk(r: IntakeChunkRow): IntakeChunkRecord {
  return {
    id: r.id,
    intake_id: r.intake_id,
    item_id: r.item_id,
    submission_id: r.submission_id,
    index: r.idx,
    ciphertext: toBytes(r.ciphertext),
    size: r.size,
    created_at: r.created_at,
    bound_at: r.bound_at,
  };
}

function nullableBytes(v: Uint8Array | null): Uint8Array | null {
  return v === null ? null : toBytes(v);
}

function toIntakeSubmission(r: IntakeSubmissionRow): IntakeSubmissionRecord {
  return {
    ...r,
    manifest_ciphertext: nullableBytes(r.manifest_ciphertext),
    wrapped_content_key: nullableBytes(r.wrapped_content_key),
  };
}

// ---------------------------------------------------------------------------
// The store
// ---------------------------------------------------------------------------
export class Store {
  readonly db: Database;

  constructor(path: string) {
    this.db = new Database(path, { create: true });
    // Durability + concurrency pragmas. WAL lets readers (validate/heartbeat)
    // run while a writer (activate) commits.
    this.db.exec("PRAGMA journal_mode = WAL;");
    this.db.exec("PRAGMA foreign_keys = ON;");
    this.db.exec("PRAGMA busy_timeout = 5000;");
    this.db.exec("PRAGMA synchronous = NORMAL;");
    this.db.exec(SCHEMA);

    // Guarded migration: add subscription_id column + partial unique index to
    // webhook_events if they were not present in the schema when the DB was
    // created. A DB built from the pre-migration SCHEMA lacks this column and
    // would crash-loop if the index DDL ran unconditionally at schema init time.
    const cols = this.db.query("PRAGMA table_info(webhook_events)").all() as Array<{ name: string }>;
    if (!cols.some((c) => c.name === "subscription_id")) {
      this.db.exec("ALTER TABLE webhook_events ADD COLUMN subscription_id TEXT");
    }
    this.db.exec(
      `CREATE UNIQUE INDEX IF NOT EXISTS idx_webhook_events_subscription_id
       ON webhook_events (subscription_id) WHERE subscription_id IS NOT NULL`,
    );

    // Guarded migration: add doc_id column to matter_updates for doc-level stream
    // partitioning (Wave 4 co-editing). Existing rows backfill to '_notes' so live
    // matters keep working unchanged. The old per-(matter,blob_id) unique index is
    // dropped and recreated as per-(matter,doc_id,blob_id). Because SQLite cannot
    // drop an index by DDL inside IF-EXISTS guards cleanly, we check column presence
    // first and only run the migration once.
    const muCols = this.db.query("PRAGMA table_info(matter_updates)").all() as Array<{ name: string }>;
    if (!muCols.some((c) => c.name === "doc_id")) {
      this.db.exec("ALTER TABLE matter_updates ADD COLUMN doc_id TEXT NOT NULL DEFAULT '_notes'");
      // Backfill any rows that were inserted before this migration (shouldn't exist
      // in production yet, but defence-in-depth; NULL would violate NOT NULL).
      this.db.exec("UPDATE matter_updates SET doc_id = '_notes' WHERE doc_id IS NULL");
      // Drop the old blob uniqueness index (keyed only on matter+blob) and recreate
      // it keyed on (matter, doc_id, blob) so blobs are unique per stream.
      this.db.exec("DROP INDEX IF EXISTS idx_matter_updates_blob");
      this.db.exec("CREATE UNIQUE INDEX IF NOT EXISTS idx_matter_updates_blob ON matter_updates(matter_id, doc_id, blob_id)");
      // Drop the old ordering index and recreate it partitioned by doc_id.
      this.db.exec("DROP INDEX IF EXISTS idx_matter_updates_matter");
      this.db.exec("CREATE INDEX IF NOT EXISTS idx_matter_updates_matter ON matter_updates(matter_id, doc_id, id)");
    }

    // A public state save is authorized before its body is read. This epoch
    // lets the later write prove that a link regeneration did not happen in
    // between those two steps.
    const intakeCols = this.db.query("PRAGMA table_info(intakes)").all() as Array<{ name: string }>;
    if (!intakeCols.some((c) => c.name === "generation")) {
      this.db.exec("ALTER TABLE intakes ADD COLUMN generation INTEGER NOT NULL DEFAULT 1");
    }
  }

  close(): void {
    this.db.close();
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
    this.db
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
    const r = this.db.query(`SELECT * FROM orgs WHERE org_id = ?`).get(orgId) as OrgRow | null;
    return r ? toOrg(r) : null;
  }

  findOrgByName(name: string): Org | null {
    const r = this.db.query(`SELECT * FROM orgs WHERE name = ?`).get(name) as OrgRow | null;
    return r ? toOrg(r) : null;
  }

  setOrgStatus(orgId: string, status: OrgStatus): void {
    this.db.query(`UPDATE orgs SET status = ? WHERE org_id = ?`).run(status, orgId);
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
    this.db
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
    const r = this.db.query(`SELECT * FROM users WHERE user_id = ?`).get(userId) as UserRow | null;
    return r ? toUser(r) : null;
  }

  /** Returns the user plus their password hash for credential verification. */
  getUserByEmailWithHash(email: string): (User & { password_hash: string }) | null {
    const r = this.db
      .query(`SELECT * FROM users WHERE email_norm = ?`)
      .get(email.trim().toLowerCase()) as UserRow | null;
    if (!r) return null;
    return { ...toUser(r), password_hash: r.password_hash };
  }

  setUserStatus(userId: string, status: UserStatus): void {
    this.db.query(`UPDATE users SET status = ? WHERE user_id = ?`).run(status, userId);
  }

  /** Active admin users for an org. Clients use this to wrap matter keys to admin
   * devices (escrow), so any org member may read it; emails are org-internal. */
  listOrgAdmins(orgId: string): Array<{ user_id: string; email: string }> {
    const rows = this.db
      .query(`SELECT * FROM users WHERE org_id = ? AND role = 'admin' AND status = 'active'`)
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
    this.db
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

  getLicenseKeyByHash(keyHash: string): LicenseKey | null {
    const r = this.db.query(`SELECT * FROM license_keys WHERE key_hash = ?`).get(keyHash) as
      | (Omit<LicenseKey, "packs"> & { packs: string })
      | null;
    if (!r) return null;
    return { ...r, packs: parsePacks(r.packs) };
  }

  // ---- Seats ---------------------------------------------------------------
  getSeat(seatId: string): Seat | null {
    const r = this.db.query(`SELECT * FROM seats WHERE seat_id = ?`).get(seatId) as SeatRow | null;
    return r ? toSeat(r) : null;
  }

  getSeatByUserMachine(userId: string, machineId: string): Seat | null {
    const r = this.db
      .query(`SELECT * FROM seats WHERE user_id = ? AND machine_id = ?`)
      .get(userId, machineId) as SeatRow | null;
    return r ? toSeat(r) : null;
  }

  listSeats(orgId: string): Seat[] {
    const rows = this.db
      .query(`SELECT * FROM seats WHERE org_id = ? ORDER BY bound_at ASC`)
      .all(orgId) as SeatRow[];
    return rows.map(toSeat);
  }

  countActiveSeats(orgId: string): number {
    const r = this.db
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
    const txn = this.db.transaction(() => {
      const existing = this.getSeatByUserMachine(input.user_id, input.machine_id);

      if (existing && existing.status === "active") {
        this.db.query(`UPDATE seats SET last_seen = ? WHERE seat_id = ?`).run(now, existing.seat_id);
        return { ok: true as const, seat: { ...existing, last_seen: now }, reused: true };
      }

      // Need headroom for a brand-new or re-activated (was-revoked) seat.
      const active = this.countActiveSeats(input.org_id);
      if (active >= input.seat_limit) {
        return { ok: false as const, reason: "seat_limit_exceeded" as const };
      }

      if (existing && existing.status === "revoked") {
        this.db
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
      this.db
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
    this.db.query(`UPDATE seats SET last_seen = ? WHERE seat_id = ?`).run(this.nowIso(), seatId);
  }

  revokeSeat(seatId: string, reason: string | null): boolean {
    const now = this.nowIso();
    const seat = this.getSeat(seatId);
    if (!seat || seat.status === "revoked") return false;
    this.db
      .query(`UPDATE seats SET status = 'revoked', revoked_at = ?, revoked_reason = ? WHERE seat_id = ?`)
      .run(now, reason, seatId);
    this.db
      .query(`INSERT INTO revocations (seat_id, org_id, reason, revoked_at) VALUES (?, ?, ?, ?)`)
      .run(seatId, seat.org_id, reason, now);
    return true;
  }

  /** Revoke every active seat for a user (used by deprovision). Returns count. */
  revokeAllSeatsForUser(userId: string, reason: string): number {
    const seats = this.db
      .query(`SELECT * FROM seats WHERE user_id = ? AND status = 'active'`)
      .all(userId) as SeatRow[];
    let n = 0;
    const txn = this.db.transaction(() => {
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
    const txn = this.db.transaction(() => {
      const from = this.getSeat(input.from_seat_id);
      if (!from) return { ok: false as const, reason: "from_seat_not_found" as const };
      if (from.status !== "active") return { ok: false as const, reason: "from_seat_not_active" as const };

      const targetExisting = this.getSeatByUserMachine(input.to_user_id, input.to_machine_id);
      if (targetExisting && targetExisting.status === "active") {
        return { ok: false as const, reason: "target_already_bound" as const };
      }

      // Free the old machine.
      this.db
        .query(`UPDATE seats SET status = 'revoked', revoked_at = ?, revoked_reason = 'transferred' WHERE seat_id = ?`)
        .run(now, from.seat_id);
      this.db
        .query(`INSERT INTO revocations (seat_id, org_id, reason, revoked_at) VALUES (?, ?, 'transferred', ?)`)
        .run(from.seat_id, from.org_id, now);

      // Bind (or re-activate) the target.
      if (targetExisting) {
        this.db
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
      this.db
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
    this.db
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
    return this.db.query(`SELECT token_id, user_id, expires_at, revoked_at, rotated_to FROM refresh_tokens WHERE token_hash = ?`).get(tokenHash) as
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
    const txn = this.db.transaction(() => {
      this.db
        .query(
          `INSERT INTO refresh_tokens (token_id, user_id, token_hash, issued_at, expires_at)
           VALUES (?, ?, ?, ?, ?)`,
        )
        .run(newId, input.user_id, input.new_token_hash, now, input.expires_at);
      this.db
        .query(`UPDATE refresh_tokens SET revoked_at = ?, rotated_to = ? WHERE token_id = ?`)
        .run(now, newId, input.old_token_id);
    });
    txn();
    return newId;
  }

  revokeRefreshToken(tokenId: string): void {
    this.db.query(`UPDATE refresh_tokens SET revoked_at = ? WHERE token_id = ? AND revoked_at IS NULL`).run(this.nowIso(), tokenId);
  }

  revokeAllRefreshTokensForUser(userId: string): void {
    this.db.query(`UPDATE refresh_tokens SET revoked_at = ? WHERE user_id = ? AND revoked_at IS NULL`).run(this.nowIso(), userId);
  }

  // ---- Audit (append-only) -------------------------------------------------
  audit(input: {
    org_id: string;
    actor_user_id: string | null;
    action: AuditAction;
    target?: string | null;
    detail?: Record<string, unknown> | null;
  }): void {
    this.db
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
    const rows = this.db
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
  // Lantern Intake relay (write-only mailbox for opaque ciphertext)
  // ===========================================================================

  createIntake(input: {
    intake_id: string;
    org_id: string;
    user_id: string;
    seat_id: string;
    token_hash: string;
    expires_at: string;
    checklist_ciphertext: Uint8Array;
    state_ciphertext: Uint8Array;
  }): IntakeRecord {
    const now = this.nowIso();
    const expiresAt = normalizeIntakeExpiry(input.expires_at);
    this.db
      .query(
        `INSERT INTO intakes
           (intake_id, org_id, user_id, seat_id, token_hash, expires_at, status,
            checklist_ciphertext, state_ciphertext, checklist_version, created_at)
         VALUES (?, ?, ?, ?, ?, ?, 'active', ?, ?, 1, ?)`,
      )
      .run(
        input.intake_id,
        input.org_id,
        input.user_id,
        input.seat_id,
        input.token_hash,
        expiresAt,
        input.checklist_ciphertext,
        input.state_ciphertext,
        now,
      );
    const intake = this.getIntake(input.intake_id);
    if (!intake) throw new Error("intake_insert_failed");
    return intake;
  }

  getIntake(intakeId: string): IntakeRecord | null {
    const r = this.db.query(`SELECT * FROM intakes WHERE intake_id = ?`).get(intakeId) as IntakeRow | null;
    return r ? toIntake(r) : null;
  }

  replaceIntakeChecklist(intakeId: string, checklistCiphertext: Uint8Array): IntakeRecord | null {
    this.db
      .query(
        `UPDATE intakes
         SET checklist_ciphertext = ?, checklist_version = checklist_version + 1
         WHERE intake_id = ?`,
      )
      .run(checklistCiphertext, intakeId);
    return this.getIntake(intakeId);
  }

  setIntakeState(intakeId: string, stateCiphertext: Uint8Array, authorizedGeneration: number): boolean {
    // BENCH-FIX-REGEN-GENERATION-GUARD
    const res = this.db
      .query(`UPDATE intakes SET state_ciphertext = ? WHERE intake_id = ? AND generation = ?`)
      .run(stateCiphertext, intakeId, authorizedGeneration);
    return res.changes > 0;
  }

  regenerateIntake(input: {
    intake_id: string;
    token_hash: string;
    checklist_ciphertext: Uint8Array;
    state_ciphertext: Uint8Array;
  }): IntakeRecord | null {
    this.db
      .query(
        `UPDATE intakes
         SET token_hash = ?, checklist_ciphertext = ?, state_ciphertext = ?,
             status = 'active', revoked_at = NULL, checklist_version = checklist_version + 1,
             generation = generation + 1
         WHERE intake_id = ?`,
      )
      .run(
        input.token_hash,
        input.checklist_ciphertext,
        input.state_ciphertext,
        input.intake_id,
      );
    return this.getIntake(input.intake_id);
  }

  revokeIntake(intakeId: string): boolean {
    const now = this.nowIso();
    const res = this.db
      .query(`UPDATE intakes SET status = 'revoked', revoked_at = ? WHERE intake_id = ? AND status <> 'revoked'`)
      .run(now, intakeId);
    return res.changes > 0;
  }

  extendIntake(intakeId: string, expiresAt: string): boolean {
    const normalizedExpiry = normalizeIntakeExpiry(expiresAt);
    const res = this.db
      .query(`UPDATE intakes SET expires_at = ? WHERE intake_id = ?`)
      .run(normalizedExpiry, intakeId);
    return res.changes > 0;
  }

  appendIntakeChunk(input: {
    intake_id: string;
    item_id: string;
    submission_id: string;
    index: number;
    ciphertext: Uint8Array;
  }): { ok: true; chunk: IntakeChunkRecord } | { ok: false; reason: "duplicate_chunk" | "submission_finalized" } {
    const now = this.nowIso();
    const txn = this.db.transaction(() => {
      // Once a submission is finalized (manifest + chunk_count recorded), its
      // chunk set is frozen. Accepting more chunks afterward would let a retry
      // or a malicious link holder change the blob list behind a recorded
      // chunk_count, producing stale inbox envelopes that fail the advisor-side
      // integrity check.
      const finalized = this.db
        .query(`SELECT 1 FROM intake_submissions WHERE intake_id = ? AND submission_id = ? LIMIT 1`)
        .get(input.intake_id, input.submission_id);
      if (finalized) return { ok: false as const, reason: "submission_finalized" as const };

      const existing = this.db
        .query(
          `SELECT * FROM intake_chunks
           WHERE intake_id = ? AND item_id = ? AND submission_id = ? AND idx = ?`,
        )
        .get(input.intake_id, input.item_id, input.submission_id, input.index) as IntakeChunkRow | null;
      if (existing) return { ok: false as const, reason: "duplicate_chunk" as const };

      this.db
        .query(
          `INSERT INTO intake_chunks
             (intake_id, item_id, submission_id, idx, ciphertext, size, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.intake_id,
          input.item_id,
          input.submission_id,
          input.index,
          input.ciphertext,
          input.ciphertext.byteLength,
          now,
        );
      const row = this.db
        .query(
          `SELECT * FROM intake_chunks
           WHERE intake_id = ? AND item_id = ? AND submission_id = ? AND idx = ?`,
        )
        .get(input.intake_id, input.item_id, input.submission_id, input.index) as IntakeChunkRow;
      return { ok: true as const, chunk: toIntakeChunk(row) };
    });
    return txn.immediate() as ReturnType<typeof this.appendIntakeChunk>;
  }

  getIntakeChunkById(intakeId: string, chunkId: number): IntakeChunkRecord | null {
    const r = this.db
      .query(`SELECT * FROM intake_chunks WHERE intake_id = ? AND id = ?`)
      .get(intakeId, chunkId) as IntakeChunkRow | null;
    return r ? toIntakeChunk(r) : null;
  }

  listIntakeChunksForSubmission(intakeId: string, itemId: string, submissionId: string): IntakeChunkRecord[] {
    const rows = this.db
      .query(
        `SELECT * FROM intake_chunks
         WHERE intake_id = ? AND item_id = ? AND submission_id = ?
         ORDER BY idx ASC`,
      )
      .all(intakeId, itemId, submissionId) as IntakeChunkRow[];
    return rows.map(toIntakeChunk);
  }

  listIntakeChunkIndexesForSubmission(intakeId: string, itemId: string, submissionId: string): number[] {
    const rows = this.db
      .query(
        `SELECT idx FROM intake_chunks
         WHERE intake_id = ? AND item_id = ? AND submission_id = ?
         ORDER BY idx ASC`,
      )
      .all(intakeId, itemId, submissionId) as Array<{ idx: number }>;
    return rows.map((row) => row.idx);
  }

  countIntakeChunks(intakeId: string): number {
    const r = this.db
      .query(`SELECT COUNT(*) AS n FROM intake_chunks WHERE intake_id = ?`)
      .get(intakeId) as { n: number };
    return r.n;
  }

  sumIntakeBytes(intakeId: string): number {
    const r = this.db
      .query(`SELECT COALESCE(SUM(size), 0) AS n FROM intake_chunks WHERE intake_id = ?`)
      .get(intakeId) as { n: number };
    return r.n;
  }

  /**
   * Bytes stored in finalization rows (manifest + wrapped content key) for an
   * intake. These persist independently of chunks (a submit with a fresh
   * submission_id and no chunks still stores a manifest + wrapped key), so they
   * must be counted toward the per-intake quota or a link holder could grow the
   * relay database without bound by posting endless finalizations.
   */
  sumIntakeSubmissionStoredBytes(intakeId: string): number {
    const r = this.db
      .query(
        `SELECT COALESCE(SUM(LENGTH(manifest_ciphertext) + LENGTH(wrapped_content_key)), 0) AS n
         FROM intake_submissions WHERE intake_id = ?`,
      )
      .get(intakeId) as { n: number };
    return r.n;
  }

  countIntakeSubmissions(intakeId: string): number {
    const r = this.db
      .query(`SELECT COUNT(*) AS n FROM intake_submissions WHERE intake_id = ?`)
      .get(intakeId) as { n: number };
    return r.n;
  }

  sumIntakeSubmissionBytes(intakeId: string, itemId: string, submissionId: string): number {
    const r = this.db
      .query(
        `SELECT COALESCE(SUM(size), 0) AS n FROM intake_chunks
         WHERE intake_id = ? AND item_id = ? AND submission_id = ?`,
      )
      .get(intakeId, itemId, submissionId) as { n: number };
    return r.n;
  }

  finalizeIntakeSubmission(input: {
    intake_id: string;
    item_id: string;
    submission_id: string;
    manifest_ciphertext: Uint8Array;
    wrapped_content_key: Uint8Array;
  }): { ok: true; submission: IntakeSubmissionRecord } | { ok: false; reason: "duplicate_submission_id" } {
    const now = this.nowIso();
    const txn = this.db.transaction(() => {
      const existing = this.db
        .query(`SELECT 1 FROM intake_submissions WHERE intake_id = ? AND submission_id = ? LIMIT 1`)
        .get(input.intake_id, input.submission_id);
      if (existing) return { ok: false as const, reason: "duplicate_submission_id" as const };

      const chunkCount = this.listIntakeChunksForSubmission(input.intake_id, input.item_id, input.submission_id).length;
      this.db
        .query(
          `INSERT INTO intake_submissions
             (intake_id, item_id, submission_id, manifest_ciphertext, wrapped_content_key, chunk_count, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.intake_id,
          input.item_id,
          input.submission_id,
          input.manifest_ciphertext,
          input.wrapped_content_key,
          chunkCount,
          now,
        );
      this.db
        .query(
          `UPDATE intake_chunks
           SET bound_at = ?
           WHERE intake_id = ? AND item_id = ? AND submission_id = ? AND bound_at IS NULL`,
        )
        .run(now, input.intake_id, input.item_id, input.submission_id);
      const row = this.db
        .query(`SELECT * FROM intake_submissions WHERE intake_id = ? AND submission_id = ?`)
        .get(input.intake_id, input.submission_id) as IntakeSubmissionRow;
      return { ok: true as const, submission: toIntakeSubmission(row) };
    });
    return txn.immediate() as ReturnType<typeof this.finalizeIntakeSubmission>;
  }

  listIntakeSubmissionsSince(intakeId: string, sinceCursor: number, limit = 500): IntakeSubmissionRecord[] {
    const rows = this.db
      .query(
        `SELECT * FROM intake_submissions
         WHERE intake_id = ? AND id > ? AND acked_at IS NULL
         ORDER BY id ASC
         LIMIT ?`,
      )
      .all(intakeId, sinceCursor, limit) as IntakeSubmissionRow[];
    return rows.map(toIntakeSubmission);
  }

  latestIntakeSubmissionCursor(intakeId: string): number {
    const r = this.db
      .query(`SELECT MAX(id) AS m FROM intake_submissions WHERE intake_id = ?`)
      .get(intakeId) as { m: number | null };
    return r.m ?? 0;
  }

  listFinalizedItemIds(intakeId: string): string[] {
    const rows = this.db
      .query(
        `SELECT DISTINCT item_id FROM intake_submissions
         WHERE intake_id = ?
         ORDER BY id ASC`,
      )
      .all(intakeId) as Array<{ item_id: string }>;
    return rows.map((r) => r.item_id);
  }

  // ===========================================================================
  // Firm intake key grants. These rows contain opaque device-wrapped JWK bytes
  // only. A re-publish replaces the entire current grant set, deleting stale
  // rows for removed devices as defence in depth. It cannot retract a key that
  // an old device already downloaded.
  // ===========================================================================

  replaceIntakeWrappedKeys(input: {
    intake_id: string;
    matter_id: string;
    epoch: number;
    published_by: string;
    wrapped: Array<{ user_id: string; device_id: string; wrapped_key_b64: string }>;
  }): void {
    const now = this.nowIso();
    this.db.transaction(() => {
      this.db.query(`DELETE FROM intake_wrapped_keys WHERE intake_id = ?`).run(input.intake_id);
      const insert = this.db.query(
        `INSERT INTO intake_wrapped_keys
          (intake_id, matter_id, epoch, user_id, device_id, wrapped_key_b64, published_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      );
      for (const row of input.wrapped) {
        insert.run(input.intake_id, input.matter_id, input.epoch, row.user_id, row.device_id, row.wrapped_key_b64, input.published_by, now);
      }
    })();
  }

  getIntakeWrappedKeyForDevice(
    intakeId: string,
    userId: string,
    deviceId: string,
  ): { intake_id: string; matter_id: string; epoch: number; user_id: string; device_id: string; wrapped_key_b64: string } | null {
    return this.db.query(
      `SELECT intake_id, matter_id, epoch, user_id, device_id, wrapped_key_b64
       FROM intake_wrapped_keys
       WHERE intake_id = ? AND user_id = ? AND device_id = ?
       ORDER BY epoch DESC LIMIT 1`,
    ).get(intakeId, userId, deviceId) as {
      intake_id: string; matter_id: string; epoch: number; user_id: string; device_id: string; wrapped_key_b64: string;
    } | null;
  }

  /** Opaque intake-key grant routing rows for one authenticated device. */
  listIntakeWrappedKeysForDevice(
    userId: string,
    deviceId: string,
  ): Array<{ intake_id: string; matter_id: string; epoch: number }> {
    return this.db.query(
      `SELECT intake_id, matter_id, epoch
       FROM intake_wrapped_keys
       WHERE user_id = ? AND device_id = ?
       ORDER BY intake_id ASC, epoch DESC`,
    ).all(userId, deviceId) as Array<{ intake_id: string; matter_id: string; epoch: number }>;
  }

  getIntakeKeyMatterId(intakeId: string): string | null {
    const row = this.db.query(
      `SELECT matter_id FROM intake_wrapped_keys WHERE intake_id = ? ORDER BY epoch DESC LIMIT 1`,
    ).get(intakeId) as { matter_id: string } | null;
    return row?.matter_id ?? null;
  }

  listIntakeWrappedKeys(intakeId: string): Array<{ intake_id: string; matter_id: string; epoch: number; user_id: string; device_id: string; wrapped_key_b64: string }> {
    return this.db.query(
      `SELECT intake_id, matter_id, epoch, user_id, device_id, wrapped_key_b64
       FROM intake_wrapped_keys WHERE intake_id = ? ORDER BY user_id, device_id`,
    ).all(intakeId) as Array<{ intake_id: string; matter_id: string; epoch: number; user_id: string; device_id: string; wrapped_key_b64: string }>;
  }

  getIntakeBundle(intakeId: string): {
    checklist_ciphertext: Uint8Array;
    state_ciphertext: Uint8Array;
    checklist_version: number;
    finalized_item_ids: string[];
  } | null {
    const intake = this.getIntake(intakeId);
    if (!intake) return null;
    return {
      checklist_ciphertext: intake.checklist_ciphertext,
      state_ciphertext: intake.state_ciphertext,
      checklist_version: intake.checklist_version,
      finalized_item_ids: this.listFinalizedItemIds(intakeId),
    };
  }

  ackIntakeCiphertext(input: {
    intake_id: string;
    submission_ids?: string[];
    blob_ids?: number[];
  }): { deleted_chunks: number; wiped_submissions: number } {
    const submissionIds = Array.from(new Set(input.submission_ids ?? [])).filter((s) => s.length > 0);
    const blobIds = Array.from(new Set(input.blob_ids ?? [])).filter((id) => Number.isInteger(id) && id > 0);
    let deletedChunks = 0;
    let wipedSubmissions = 0;
    const now = this.nowIso();

    const txn = this.db.transaction(() => {
      if (blobIds.length > 0) {
        const placeholders = blobIds.map(() => "?").join(",");
        const res = this.db
          .query(`DELETE FROM intake_chunks WHERE intake_id = ? AND id IN (${placeholders})`)
          .run(input.intake_id, ...blobIds);
        deletedChunks += res.changes;
      }

      if (submissionIds.length > 0) {
        const placeholders = submissionIds.map(() => "?").join(",");
        const chunkRes = this.db
          .query(`DELETE FROM intake_chunks WHERE intake_id = ? AND submission_id IN (${placeholders})`)
          .run(input.intake_id, ...submissionIds);
        deletedChunks += chunkRes.changes;

        const subRes = this.db
          .query(
            `UPDATE intake_submissions
             SET manifest_ciphertext = NULL,
                 wrapped_content_key = NULL,
                 acked_at = COALESCE(acked_at, ?)
             WHERE intake_id = ? AND submission_id IN (${placeholders})`,
          )
          .run(now, input.intake_id, ...submissionIds);
        wipedSubmissions += subRes.changes;
      }
    });
    txn.immediate();
    return { deleted_chunks: deletedChunks, wiped_submissions: wipedSubmissions };
  }

  /**
   * Remove an expired mailbox after its 30-day offline-sync grace window.
   * Deleting the intake row deliberately cascades to chunks, manifests, wrapped
   * keys, and the page's sealed checklist/state. No content or client traffic
   * data is inspected or retained by this maintenance pass.
   */
  purgeExpiredIntakeCiphertext(nowMs = Date.now()): { deleted_intakes: number } {
    const cutoff = new Date(nowMs - INTAKE_EXPIRY_CIPHERTEXT_GRACE_MS).toISOString();
    const result = this.db.query(`DELETE FROM intakes WHERE expires_at <= ?`).run(cutoff);
    return { deleted_intakes: result.changes };
  }

  // ===========================================================================
  // Matters (DECISION.md §4 ACL unit)
  // ===========================================================================
  createMatter(input: { org_id: string; client_name: string }): Matter {
    const m: Matter = {
      matter_id: randomUUID(),
      org_id: input.org_id,
      client_name: input.client_name,
      status: "active",
      key_epoch: 1,
      created_at: this.nowIso(),
    };
    this.db
      .query(
        `INSERT INTO matters (matter_id, org_id, client_name, status, key_epoch, created_at)
         VALUES (?, ?, ?, 'active', 1, ?)`,
      )
      .run(m.matter_id, m.org_id, m.client_name, m.created_at);
    return m;
  }

  getMatter(matterId: string): Matter | null {
    const r = this.db.query(`SELECT * FROM matters WHERE matter_id = ?`).get(matterId) as MatterRow | null;
    return r ? toMatter(r) : null;
  }

  listMatters(orgId: string): Matter[] {
    const rows = this.db
      .query(`SELECT * FROM matters WHERE org_id = ? ORDER BY created_at DESC`)
      .all(orgId) as MatterRow[];
    return rows.map(toMatter);
  }

  setMatterStatus(matterId: string, status: MatterStatus): void {
    this.db.query(`UPDATE matters SET status = ? WHERE matter_id = ?`).run(status, matterId);
  }

  /**
   * Bump the matter key epoch (returns the new epoch). Called on member-remove /
   * wall-set so the desktop key-release service rotates the per-matter key and a
   * removed/walled user's old key can't read subsequently-pushed updates (§4 L2).
   */
  bumpMatterKeyEpoch(matterId: string): number {
    const txn = this.db.transaction(() => {
      this.db.query(`UPDATE matters SET key_epoch = key_epoch + 1 WHERE matter_id = ?`).run(matterId);
      const r = this.db.query(`SELECT key_epoch FROM matters WHERE matter_id = ?`).get(matterId) as
        | { key_epoch: number }
        | null;
      return r?.key_epoch ?? 1;
    });
    return txn() as number;
  }

  // ---- Matter membership ---------------------------------------------------
  addMatterMember(input: { matter_id: string; user_id: string; org_id: string; role: MatterRole }): MatterMember {
    const m: MatterMember = {
      matter_id: input.matter_id,
      user_id: input.user_id,
      org_id: input.org_id,
      role: input.role,
      created_at: this.nowIso(),
    };
    // Upsert: re-adding updates the role (and refreshes created_at on first add only).
    this.db
      .query(
        `INSERT INTO matter_members (matter_id, user_id, org_id, role, created_at)
         VALUES (?, ?, ?, ?, ?)
         ON CONFLICT(matter_id, user_id) DO UPDATE SET role = excluded.role`,
      )
      .run(m.matter_id, m.user_id, m.org_id, m.role, m.created_at);
    return m;
  }

  removeMatterMember(matterId: string, userId: string): boolean {
    const res = this.db
      .query(`DELETE FROM matter_members WHERE matter_id = ? AND user_id = ?`)
      .run(matterId, userId);
    return res.changes > 0;
  }

  getMatterMember(matterId: string, userId: string): MatterMember | null {
    const r = this.db
      .query(`SELECT * FROM matter_members WHERE matter_id = ? AND user_id = ?`)
      .get(matterId, userId) as
      | { matter_id: string; user_id: string; org_id: string; role: string; created_at: string }
      | null;
    return r ? { ...r, role: r.role as MatterRole } : null;
  }

  listMatterMembers(matterId: string): MatterMember[] {
    const rows = this.db
      .query(`SELECT * FROM matter_members WHERE matter_id = ? ORDER BY created_at ASC`)
      .all(matterId) as Array<{ matter_id: string; user_id: string; org_id: string; role: string; created_at: string }>;
    return rows.map((r) => ({ ...r, role: r.role as MatterRole }));
  }

  /**
   * List matter members with their email addresses joined from the users table.
   * Same-org data; callers must have already verified org scoping. Returns email
   * only when a matching user row exists (it always should, but the join is LEFT
   * so a dangling member row doesn't crash the handler).
   */
  listMatterMembersWithEmail(matterId: string): Array<MatterMember & { email: string | null }> {
    const rows = this.db
      .query(
        `SELECT mm.matter_id, mm.user_id, mm.org_id, mm.role, mm.created_at, u.email
         FROM matter_members mm
         LEFT JOIN users u ON u.user_id = mm.user_id
         WHERE mm.matter_id = ?
         ORDER BY mm.created_at ASC`,
      )
      .all(matterId) as Array<{ matter_id: string; user_id: string; org_id: string; role: string; created_at: string; email: string | null }>;
    return rows.map((r) => ({ ...r, role: r.role as MatterRole, email: r.email ?? null }));
  }

  /**
   * List all active users in an org. Admin-only endpoint: returns user_id, email,
   * role, and status so the admin console can resolve user_ids to emails and the
   * wall-by-email flow can look up users without requiring a create-first pattern.
   */
  listOrgUsers(orgId: string): Array<{ user_id: string; email: string; role: UserRole; status: UserStatus }> {
    const rows = this.db
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
  setEthicalWall(input: { matter_id: string; user_id: string; org_id: string; reason: string | null; created_by: string }): EthicalWall {
    const w: EthicalWall = {
      matter_id: input.matter_id,
      user_id: input.user_id,
      org_id: input.org_id,
      reason: input.reason,
      created_by: input.created_by,
      created_at: this.nowIso(),
    };
    this.db
      .query(
        `INSERT INTO ethical_walls (matter_id, user_id, org_id, reason, created_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(matter_id, user_id) DO UPDATE SET reason = excluded.reason, created_by = excluded.created_by, created_at = excluded.created_at`,
      )
      .run(w.matter_id, w.user_id, w.org_id, w.reason, w.created_by, w.created_at);
    return w;
  }

  clearEthicalWall(matterId: string, userId: string): boolean {
    const res = this.db
      .query(`DELETE FROM ethical_walls WHERE matter_id = ? AND user_id = ?`)
      .run(matterId, userId);
    return res.changes > 0;
  }

  getEthicalWall(matterId: string, userId: string): EthicalWall | null {
    const r = this.db
      .query(`SELECT * FROM ethical_walls WHERE matter_id = ? AND user_id = ?`)
      .get(matterId, userId) as
      | { matter_id: string; user_id: string; org_id: string; reason: string | null; created_by: string; created_at: string }
      | null;
    return r ?? null;
  }

  listEthicalWalls(matterId: string): EthicalWall[] {
    return this.db
      .query(`SELECT * FROM ethical_walls WHERE matter_id = ? ORDER BY created_at ASC`)
      .all(matterId) as EthicalWall[];
  }

  /** True iff there is an active ethical-wall (deny) row for (matter, user). */
  isWalled(matterId: string, userId: string): boolean {
    const r = this.db
      .query(`SELECT 1 FROM ethical_walls WHERE matter_id = ? AND user_id = ? LIMIT 1`)
      .get(matterId, userId);
    return r !== null;
  }

  // ===========================================================================
  // The E2EE sync relay (DECISION.md §1 — dumb relay, opaque ciphertext only)
  // ===========================================================================
  /**
   * Append an opaque encrypted CRDT update. Idempotent on (matter_id, doc_id, blob_id):
   * a retried push returns the already-stored row rather than duplicating. The
   * ciphertext is stored verbatim and NEVER inspected. Returns the stored row
   * (so callers can fan out the assigned cursor `id`).
   *
   * `doc_id` partitions the relay into per-document streams. Notes use '_notes'
   * (the default). The idempotency key is scoped to (matter, doc_id) so the same
   * blob_id under different doc_ids are distinct rows.
   */
  appendMatterUpdate(input: {
    matter_id: string;
    org_id: string;
    doc_id?: string;
    blob_id: string;
    ciphertext: Uint8Array;
    author_seat: string;
    key_epoch: number;
  }): { update: MatterUpdate; duplicate: boolean } {
    const now = this.nowIso();
    const docId = input.doc_id ?? "_notes";
    const txn = this.db.transaction(() => {
      const existing = this.db
        .query(`SELECT * FROM matter_updates WHERE matter_id = ? AND doc_id = ? AND blob_id = ?`)
        .get(input.matter_id, docId, input.blob_id) as
        | { id: number; matter_id: string; org_id: string; doc_id: string; blob_id: string; ciphertext: Uint8Array; author_seat: string; key_epoch: number; created_at: string }
        | null;
      if (existing) {
        return { update: { ...existing, ciphertext: new Uint8Array(existing.ciphertext) }, duplicate: true };
      }
      this.db
        .query(
          `INSERT INTO matter_updates (matter_id, org_id, doc_id, blob_id, ciphertext, author_seat, key_epoch, created_at)
           VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
        )
        .run(
          input.matter_id,
          input.org_id,
          docId,
          input.blob_id,
          input.ciphertext,
          input.author_seat,
          input.key_epoch,
          now,
        );
      const row = this.db
        .query(`SELECT * FROM matter_updates WHERE matter_id = ? AND doc_id = ? AND blob_id = ?`)
        .get(input.matter_id, docId, input.blob_id) as {
        id: number;
        matter_id: string;
        org_id: string;
        doc_id: string;
        blob_id: string;
        ciphertext: Uint8Array;
        author_seat: string;
        key_epoch: number;
        created_at: string;
      };
      return { update: { ...row, ciphertext: new Uint8Array(row.ciphertext) }, duplicate: false };
    });
    // IMMEDIATE so concurrent pushes of the same (doc_id, blob_id) can't both insert.
    return txn.immediate() as { update: MatterUpdate; duplicate: boolean };
  }

  /**
   * Fetch updates for a matter strictly AFTER `sinceCursor`, in cursor order, for
   * catch-up. `sinceCursor = 0` returns the whole history. Bounded by `limit`.
   * `docId` filters to a specific document stream; defaults to '_notes'.
   */
  getMatterUpdatesSince(matterId: string, sinceCursor: number, limit = 500, docId = "_notes"): MatterUpdate[] {
    const rows = this.db
      .query(
        `SELECT * FROM matter_updates WHERE matter_id = ? AND doc_id = ? AND id > ? ORDER BY id ASC LIMIT ?`,
      )
      .all(matterId, docId, sinceCursor, limit) as Array<{
      id: number;
      matter_id: string;
      org_id: string;
      doc_id: string;
      blob_id: string;
      ciphertext: Uint8Array;
      author_seat: string;
      key_epoch: number;
      created_at: string;
    }>;
    return rows.map((r) => ({ ...r, ciphertext: new Uint8Array(r.ciphertext) }));
  }

  /**
   * Fetch one bounded catch-up page strictly after `sinceCursor` and no later
   * than an already-captured subscription watermark. The upper bound is what
   * lets a live socket finish historical replay without racing a concurrent
   * writer: rows after `throughCursor` arrive through the subscriber instead.
   */
  getMatterUpdatesThrough(
    matterId: string,
    sinceCursor: number,
    throughCursor: number,
    limit = 500,
    docId = "_notes",
  ): MatterUpdate[] {
    const rows = this.db
      .query(
        `SELECT * FROM matter_updates
         WHERE matter_id = ? AND doc_id = ? AND id > ? AND id <= ?
         ORDER BY id ASC LIMIT ?`,
      )
      .all(matterId, docId, sinceCursor, throughCursor, limit) as Array<{
      id: number;
      matter_id: string;
      org_id: string;
      doc_id: string;
      blob_id: string;
      ciphertext: Uint8Array;
      author_seat: string;
      key_epoch: number;
      created_at: string;
    }>;
    return rows.map((r) => ({ ...r, ciphertext: new Uint8Array(r.ciphertext) }));
  }

  /** Count a bounded historical range without loading its opaque blobs. */
  countMatterUpdatesThrough(matterId: string, sinceCursor: number, throughCursor: number, docId = "_notes"): number {
    const row = this.db
      .query(
        `SELECT COUNT(*) AS count FROM matter_updates
         WHERE matter_id = ? AND doc_id = ? AND id > ? AND id <= ?`,
      )
      .get(matterId, docId, sinceCursor, throughCursor) as { count: number };
    return row.count;
  }

  /** Highest cursor currently stored for a matter+doc stream (0 if none). */
  latestMatterCursor(matterId: string, docId = "_notes"): number {
    const r = this.db
      .query(`SELECT MAX(id) AS m FROM matter_updates WHERE matter_id = ? AND doc_id = ?`)
      .get(matterId, docId) as { m: number | null };
    return r.m ?? 0;
  }

  // ---- Sealed notification envelopes (03 §2) -----------------------------
  appendNotifyEnvelope(input: { org_id: string; recipient_user_id: string; envelope_id: string; ciphertext: Uint8Array; key_hint: string; idempotency_key: string; retention_until_terminal: boolean }): { envelope: { seq: number; envelope_id: string; created_at: string; expires_at: string | null }; duplicate: boolean; conflict: boolean } {
    const now = this.nowIso();
    const expiresAt = input.retention_until_terminal ? null : new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
    const find = (seq: number) => this.db.query(`SELECT seq, envelope_id, created_at, expires_at FROM notify_envelopes WHERE org_id = ? AND seq = ?`).get(input.org_id, seq) as { seq: number; envelope_id: string; created_at: string; expires_at: string | null };
    const txn = this.db.transaction(() => {
      const idem = this.db.query(`SELECT recipient_user_id, envelope_id, seq FROM notify_idempotency WHERE org_id = ? AND idempotency_key = ?`).get(input.org_id, input.idempotency_key) as { recipient_user_id: string; envelope_id: string; seq: number } | null;
      if (idem) return idem.recipient_user_id !== input.recipient_user_id || idem.envelope_id !== input.envelope_id ? { envelope: find(idem.seq), duplicate: false, conflict: true } : { envelope: find(idem.seq), duplicate: true, conflict: false };
      const existing = this.db.query(`SELECT seq FROM notify_envelopes WHERE org_id = ? AND recipient_user_id = ? AND envelope_id = ?`).get(input.org_id, input.recipient_user_id, input.envelope_id) as { seq: number } | null;
      if (existing) {
        this.db.query(`INSERT INTO notify_idempotency (org_id, idempotency_key, recipient_user_id, envelope_id, seq) VALUES (?, ?, ?, ?, ?)`)
          .run(input.org_id, input.idempotency_key, input.recipient_user_id, input.envelope_id, existing.seq);
        return { envelope: find(existing.seq), duplicate: true, conflict: false };
      }
      const max = this.db.query(`SELECT COALESCE(MAX(seq), 0) AS seq FROM notify_envelopes WHERE org_id = ?`).get(input.org_id) as { seq: number };
      const seq = max.seq + 1;
      this.db.query(`INSERT INTO notify_envelopes (org_id, seq, recipient_user_id, envelope_id, ciphertext, created_at, expires_at, retention_until_terminal, terminal_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`)
        .run(input.org_id, seq, input.recipient_user_id, input.envelope_id, input.ciphertext, now, expiresAt, input.retention_until_terminal ? 1 : 0);
      this.db.query(`INSERT INTO notify_envelope_delivery (org_id, recipient_user_id, envelope_id, key_hint) VALUES (?, ?, ?, ?)`)
        .run(input.org_id, input.recipient_user_id, input.envelope_id, input.key_hint);
      this.db.query(`INSERT INTO notify_idempotency (org_id, idempotency_key, recipient_user_id, envelope_id, seq) VALUES (?, ?, ?, ?, ?)`)
        .run(input.org_id, input.idempotency_key, input.recipient_user_id, input.envelope_id, seq);
      return { envelope: find(seq), duplicate: false, conflict: false };
    });
    return txn.immediate() as { envelope: { seq: number; envelope_id: string; created_at: string; expires_at: string | null }; duplicate: boolean; conflict: boolean };
  }

  getNotifyInbox(orgId: string, recipientUserId: string, since: number, limit = 500): Array<{ seq: number; envelope_id: string; created_at: string; expires_at: string | null; key_hint: string; ciphertext: Uint8Array }> {
    const rows = this.db.query(`SELECT e.seq, e.envelope_id, e.created_at, e.expires_at, d.key_hint, e.ciphertext FROM notify_envelopes e JOIN notify_envelope_delivery d ON d.org_id = e.org_id AND d.recipient_user_id = e.recipient_user_id AND d.envelope_id = e.envelope_id WHERE e.org_id = ? AND e.recipient_user_id = ? AND e.seq > ? AND (e.expires_at IS NULL OR e.expires_at > ?) ORDER BY e.seq ASC LIMIT ?`)
      .all(orgId, recipientUserId, since, this.nowIso(), limit) as Array<{ seq: number; envelope_id: string; created_at: string; expires_at: string | null; key_hint: string; ciphertext: Uint8Array }>;
    return rows.map((r) => ({ ...r, ciphertext: new Uint8Array(r.ciphertext) }));
  }

  latestNotifyCursor(orgId: string, recipientUserId: string): number {
    const r = this.db.query(`SELECT COALESCE(MAX(seq), 0) AS seq FROM notify_envelopes WHERE org_id = ? AND recipient_user_id = ?`).get(orgId, recipientUserId) as { seq: number };
    return r.seq;
  }

  acknowledgeNotify(orgId: string, recipientUserId: string, deviceId: string, upToCursor: number): number {
    const existing = this.db.query(`SELECT acked_through FROM notify_device_acks WHERE org_id = ? AND recipient_user_id = ? AND device_id = ?`).get(orgId, recipientUserId, deviceId) as { acked_through: number } | null;
    const acked = Math.max(existing?.acked_through ?? 0, upToCursor);
    this.db.query(`INSERT INTO notify_device_acks (org_id, recipient_user_id, device_id, acked_through) VALUES (?, ?, ?, ?) ON CONFLICT(org_id, recipient_user_id, device_id) DO UPDATE SET acked_through = MAX(acked_through, excluded.acked_through)`).run(orgId, recipientUserId, deviceId, acked);
    this.releaseTerminalNotifyRetention(orgId, recipientUserId);
    return acked;
  }

  markNotifyTerminal(orgId: string, recipientUserId: string, envelopeId: string): boolean {
    const res = this.db.query(`UPDATE notify_envelopes SET terminal_at = COALESCE(terminal_at, ?) WHERE org_id = ? AND recipient_user_id = ? AND envelope_id = ? AND retention_until_terminal = TRUE`).run(this.nowIso(), orgId, recipientUserId, envelopeId);
    if (res.changes) this.releaseTerminalNotifyRetention(orgId, recipientUserId);
    return res.changes > 0;
  }

  private releaseTerminalNotifyRetention(orgId: string, recipientUserId: string): void {
    const devices = this.db.query(`SELECT d.device_id FROM devices d JOIN users u ON u.user_id = d.user_id WHERE d.org_id = ? AND d.user_id = ? AND u.status = 'active'`).all(orgId, recipientUserId) as Array<{ device_id: string }>;
    if (!devices.length) return;
    const terminal = this.db.query(`SELECT seq FROM notify_envelopes WHERE org_id = ? AND recipient_user_id = ? AND retention_until_terminal = TRUE AND terminal_at IS NOT NULL`).all(orgId, recipientUserId) as Array<{ seq: number }>;
    for (const row of terminal) {
      const allAcked = devices.every((device) => ((this.db.query(`SELECT acked_through FROM notify_device_acks WHERE org_id = ? AND recipient_user_id = ? AND device_id = ?`).get(orgId, recipientUserId, device.device_id) as { acked_through: number } | null)?.acked_through ?? 0) >= row.seq);
      if (allAcked) this.db.query(`UPDATE notify_envelopes SET retention_until_terminal = FALSE WHERE org_id = ? AND seq = ?`).run(orgId, row.seq);
    }
  }

  hasCurrentMatterKeyGrant(matterId: string, userId: string): boolean {
    return this.db.query(`SELECT 1 FROM wrapped_matter_keys k JOIN matters m ON m.matter_id = k.matter_id WHERE k.matter_id = ? AND k.user_id = ? AND k.epoch = m.key_epoch LIMIT 1`).get(matterId, userId) !== null;
  }

  // ---- Checkpoint control plane (03 §6.1) --------------------------------
  putCheckpointChunk(input: { matter_id: string; doc_id: string; generation: number; chunk_index: number; ciphertext: Uint8Array }): void {
    this.db.query(`INSERT INTO checkpoint_chunks (matter_id, doc_id, generation, chunk_index, ciphertext, created_at) VALUES (?, ?, ?, ?, ?, ?) ON CONFLICT(matter_id, doc_id, generation, chunk_index) DO NOTHING`).run(input.matter_id, input.doc_id, input.generation, input.chunk_index, input.ciphertext, this.nowIso());
  }

  publishCheckpointManifest(input: { matter_id: string; org_id: string; doc_id: string; generation: number; frontier: number; retention_eligible: boolean; manifest_ciphertext: Uint8Array }): boolean {
    const result = this.db.query(`INSERT INTO checkpoint_manifests (matter_id, org_id, doc_id, generation, frontier, retention_eligible, manifest_ciphertext, published_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(matter_id, doc_id, generation) DO NOTHING`).run(input.matter_id, input.org_id, input.doc_id, input.generation, input.frontier, input.retention_eligible ? 1 : 0, input.manifest_ciphertext, this.nowIso());
    return result.changes > 0;
  }

  addCheckpointReceipt(input: { matter_id: string; org_id: string; doc_id: string; generation: number; validator_user_id: string; validator_device_id: string; signed_receipt: Uint8Array }): boolean {
    const result = this.db.query(`INSERT INTO checkpoint_validation_receipts (matter_id, org_id, doc_id, generation, validator_user_id, validator_device_id, signed_receipt, created_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?) ON CONFLICT(matter_id, doc_id, generation, validator_user_id) DO NOTHING`).run(input.matter_id, input.org_id, input.doc_id, input.generation, input.validator_user_id, input.validator_device_id, input.signed_receipt, this.nowIso());
    return result.changes > 0;
  }

  pruneCheckpointTail(input: { matter_id: string; org_id: string; doc_id: string; generation: number }): { ok: boolean; reason?: string; pruned?: number } {
    const manifest = this.db.query(`SELECT frontier, retention_eligible, manifest_ciphertext FROM checkpoint_manifests WHERE matter_id = ? AND org_id = ? AND doc_id = ? AND generation = ?`).get(input.matter_id, input.org_id, input.doc_id, input.generation) as { frontier: number; retention_eligible: number; manifest_ciphertext: Uint8Array } | null;
    if (!manifest) return { ok: false, reason: "manifest_not_found" };
    if (!manifest.retention_eligible) return { ok: false, reason: "retention_not_eligible" };
    const receipts = this.db.query(`SELECT COUNT(*) AS count FROM checkpoint_validation_receipts WHERE matter_id = ? AND org_id = ? AND doc_id = ? AND generation = ?`).get(input.matter_id, input.org_id, input.doc_id, input.generation) as { count: number };
    if (receipts.count < 2) return { ok: false, reason: "two_receipts_required" };
    const txn = this.db.transaction(() => {
      // Archive executes before prune in the same durable transaction.
      this.db.query(`INSERT INTO checkpoint_archives (matter_id, org_id, doc_id, generation, frontier, manifest_ciphertext, archived_at) VALUES (?, ?, ?, ?, ?, ?, ?) ON CONFLICT(matter_id, doc_id, generation) DO NOTHING`).run(input.matter_id, input.org_id, input.doc_id, input.generation, manifest.frontier, manifest.manifest_ciphertext, this.nowIso());
      return this.db.query(`DELETE FROM matter_updates WHERE matter_id = ? AND org_id = ? AND doc_id = ? AND id <= ?`).run(input.matter_id, input.org_id, input.doc_id, manifest.frontier).changes;
    });
    return { ok: true, pruned: txn.immediate() as number };
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
    this.db
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
    const r = this.db
      .query(`SELECT * FROM org_provider_keys WHERE org_id = ? AND provider = ?`)
      .get(orgId, provider) as
      | { org_id: string; provider: string; key_ciphertext: string; key_last4: string; updated_at: string; updated_by: string }
      | null;
    if (!r) return null;
    return { ...r, provider: r.provider as AssuredProvider };
  }

  /** List which providers an org has a managed key for (metadata only, no secrets). */
  listOrgProviderKeys(orgId: string): Array<{ provider: AssuredProvider; key_last4: string; updated_at: string; updated_by: string }> {
    const rows = this.db
      .query(`SELECT provider, key_last4, updated_at, updated_by FROM org_provider_keys WHERE org_id = ? ORDER BY provider ASC`)
      .all(orgId) as Array<{ provider: string; key_last4: string; updated_at: string; updated_by: string }>;
    return rows.map((r) => ({ ...r, provider: r.provider as AssuredProvider }));
  }

  /** Remove an org's managed key for a provider. Returns true if a row was deleted. */
  deleteOrgProviderKey(orgId: string, provider: AssuredProvider): boolean {
    const res = this.db.query(`DELETE FROM org_provider_keys WHERE org_id = ? AND provider = ?`).run(orgId, provider);
    return res.changes > 0;
  }

  /**
   * Append a METADATA-ONLY billing row. This is the only per-request write on
   * the assured path. The `BillingMeta` type has no body field, and this INSERT
   * lists only metadata columns — there is structurally no way for prompt or
   * completion text to land here.
   */
  recordInference(meta: BillingMeta): void {
    this.db
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
    const rows = this.db
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
    label: string;
    pubkey_jwk: string;
  }): Device {
    const now = this.nowIso();
    this.db
      .query(
        `INSERT INTO devices (device_id, user_id, org_id, machine_id, label, pubkey_jwk, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(device_id, user_id) DO UPDATE SET
           machine_id = excluded.machine_id,
           label      = excluded.label,
           pubkey_jwk = excluded.pubkey_jwk`,
      )
      .run(input.device_id, input.user_id, input.org_id, input.machine_id, input.label, input.pubkey_jwk, now);
    return {
      device_id: input.device_id,
      user_id: input.user_id,
      org_id: input.org_id,
      machine_id: input.machine_id,
      label: input.label,
      pubkey_jwk: input.pubkey_jwk,
      created_at: now,
    };
  }

  /** List all devices registered by the given users (org-scoped: only same-org users). */
  listDevicesForUsers(userIds: string[]): Device[] {
    if (userIds.length === 0) return [];
    // SQLite has no array binding; build a parameterised IN clause.
    const placeholders = userIds.map(() => "?").join(",");
    const rows = this.db
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
    const r = this.db.query(`SELECT * FROM devices WHERE device_id = ? AND user_id = ?`).get(deviceId, userId) as
      | Device
      | null;
    return r ?? null;
  }

  // ===========================================================================
  // Chunk 4 — Wrapped matter keys
  // ===========================================================================

  /**
   * Store a wrapped matter key for one device. Idempotent on the PK tuple:
   * a re-publish of the same (matter, epoch, user, device) replaces the blob.
   */
  upsertWrappedMatterKey(input: {
    matter_id: string;
    epoch: number;
    user_id: string;
    device_id: string;
    wrapped_key_b64: string;
    published_by: string;
  }): void {
    this.db
      .query(
        `INSERT INTO wrapped_matter_keys (matter_id, epoch, user_id, device_id, wrapped_key_b64, published_by, created_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT(matter_id, epoch, user_id, device_id) DO UPDATE SET
           wrapped_key_b64 = excluded.wrapped_key_b64,
           published_by    = excluded.published_by`,
      )
      .run(input.matter_id, input.epoch, input.user_id, input.device_id, input.wrapped_key_b64, input.published_by, this.nowIso());
  }

  /** Fetch the wrapped key for a specific (matter, epoch, user, device). */
  getWrappedMatterKey(matterId: string, epoch: number, userId: string, deviceId: string): WrappedMatterKey | null {
    const r = this.db
      .query(`SELECT * FROM wrapped_matter_keys WHERE matter_id = ? AND epoch = ? AND user_id = ? AND device_id = ?`)
      .get(matterId, epoch, userId, deviceId) as WrappedMatterKey | null;
    return r ?? null;
  }

  /**
   * Delete ALL wrapped keys for a user on a given matter (all epochs).
   * Called when a member is removed or walled — they lose access to all key
   * epochs, including ones they already had.
   */
  deleteWrappedKeysForUser(matterId: string, userId: string): void {
    this.db
      .query(`DELETE FROM wrapped_matter_keys WHERE matter_id = ? AND user_id = ?`)
      .run(matterId, userId);
  }

  /**
   * Delete all wrapped keys for a matter at a SPECIFIC epoch (the old epoch
   * before a key rotation). After remove/wall the epoch bumps; the old epoch's
   * published set is stale because the removed user had keys for it. Deleting
   * it forces a full re-publish at the new epoch.
   */
  deleteWrappedKeysForEpoch(matterId: string, epoch: number): void {
    this.db
      .query(`DELETE FROM wrapped_matter_keys WHERE matter_id = ? AND epoch = ?`)
      .run(matterId, epoch);
  }

  // ===========================================================================
  // Chunk 4 — Webhook idempotency
  // ===========================================================================

  /**
   * Record a processed webhook event. Returns false if the event_id already
   * exists (already processed — caller should return 200 + ignore).
   */
  recordWebhookEvent(eventId: string): boolean {
    const existing = this.db.query(`SELECT 1 FROM webhook_events WHERE event_id = ?`).get(eventId);
    if (existing) return false;
    this.db.query(`INSERT INTO webhook_events (event_id, processed_at) VALUES (?, ?)`).run(eventId, this.nowIso());
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
    const byEventId = this.db.query(`SELECT 1 FROM webhook_events WHERE event_id = ?`).get(eventId);
    if (byEventId) return false;
    // Second-level: same subscription delivered under a different webhook_id.
    if (subscriptionId) {
      const bySubId = this.db.query(
        `SELECT 1 FROM webhook_events WHERE subscription_id = ?`,
      ).get(subscriptionId);
      if (bySubId) return false;
    }
    this.db
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
    const r = this.db
      .query(`SELECT * FROM users WHERE email_norm = ?`)
      .get(email.trim().toLowerCase()) as UserRow | null;
    return r ? toUser(r) : null;
  }

  /** Get the org's IdP configuration, or null if not set. */
  getOrgIdpConfig(orgId: string): OrgIdpConfig | null {
    const r = this.db
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
    this.db
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
    this.db.query(`DELETE FROM org_idp_config WHERE org_id = ?`).run(orgId);
  }

  // ===========================================================================
  // Chunk 4 — Org claim (for unclaimed orgs provisioned by webhook)
  // ===========================================================================

  /** Find an org by its license key hash (used in /org/claim). */
  findOrgByLicenseKeyHash(keyHash: string): { org: Org; licenseKey: LicenseKey } | null {
    const keyRow = this.db.query(`SELECT * FROM license_keys WHERE key_hash = ?`).get(keyHash) as
      | (Omit<LicenseKey, "packs"> & { packs: string })
      | null;
    if (!keyRow) return null;
    const orgRow = this.db.query(`SELECT * FROM orgs WHERE org_id = ?`).get(keyRow.org_id) as OrgRow | null;
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
      this.db.query(`UPDATE orgs SET status = 'active', name = ? WHERE org_id = ?`).run(opts.name, orgId);
    } else {
      this.db.query(`UPDATE orgs SET status = 'active' WHERE org_id = ?`).run(orgId);
    }
  }

  /**
   * List matters where the user is a member AND NOT walled, in the given org.
   * Returns the matter info plus the user's role in that matter.
   * Used by POST /matter/mine.
   */
  listMatterMembershipsForUser(
    userId: string,
    orgId: string,
  ): Array<{ matter_id: string; client_name: string; status: MatterStatus; key_epoch: number; role: MatterRole }> {
    const rows = this.db
      .query(
        `SELECT m.matter_id, m.client_name, m.status, m.key_epoch, mm.role
         FROM matter_members mm
         JOIN matters m ON m.matter_id = mm.matter_id
         WHERE mm.user_id = ? AND m.org_id = ?
           AND NOT EXISTS (
             SELECT 1 FROM ethical_walls ew
             WHERE ew.matter_id = mm.matter_id AND ew.user_id = mm.user_id
           )
         ORDER BY m.created_at DESC`,
      )
      .all(userId, orgId) as Array<{
      matter_id: string;
      client_name: string;
      status: string;
      key_epoch: number;
      role: string;
    }>;
    return rows.map((r) => ({
      matter_id: r.matter_id,
      client_name: r.client_name,
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
