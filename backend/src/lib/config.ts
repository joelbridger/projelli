/**
 * Centralised, validated configuration. Read once at boot from the environment;
 * everything downstream imports the typed `config` object rather than touching
 * `process.env` directly. Fails fast and loud on a misconfigured production
 * secret, but stays convenient (auto-generated ephemeral secret) for local dev.
 */

import { randomBytes, generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import type { KeyObject } from "node:crypto";

function num(name: string, fallback: number, { min = 1 }: { min?: number } = {}): number {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return fallback;
  const n = Number(raw);
  if (!Number.isFinite(n) || n < min) {
    throw new Error(`config: ${name} must be a number >= ${min}, got ${JSON.stringify(raw)}`);
  }
  return n;
}

function str(name: string, fallback: string): string {
  const raw = process.env[name];
  return raw === undefined || raw.trim() === "" ? fallback : raw;
}

/** Detect a test run so we never warn about ephemeral secrets in `bun test`. */
const IS_TEST = process.env.NODE_ENV === "test" || !!process.env.BUN_TEST;

// ---- Auth secret (HS256 access JWTs + refresh-token HMAC) ------------------
function resolveAuthSecret(): string {
  const fromEnv = process.env.AUTH_SECRET;
  if (fromEnv && fromEnv.trim().length >= 32) return fromEnv.trim();
  if (fromEnv && fromEnv.trim().length > 0) {
    throw new Error("config: AUTH_SECRET is set but too short — use at least 32 chars (try `openssl rand -hex 48`).");
  }
  // No secret provided: generate an ephemeral one. Fine for dev/tests (tokens
  // simply don't survive a restart); a hard error would make `bun test` and
  // `bun run dev` annoying. We warn loudly outside tests so prod never ships
  // without a stable secret.
  if (!IS_TEST) {
    console.warn(
      "[config] WARNING: AUTH_SECRET not set — using a random per-boot secret. " +
        "Tokens will be invalidated on restart. Set AUTH_SECRET in production.",
    );
  }
  return randomBytes(48).toString("hex");
}

// ---- Seat-token Ed25519 keypair (asymmetric) -------------------------------
function loadPem(inlineEnv: string, pathEnv: string): string | null {
  const p = process.env[pathEnv];
  if (p && p.trim()) return readFileSync(p.trim(), "utf8");
  const inline = process.env[inlineEnv];
  if (inline && inline.trim()) {
    // Allow `\n`-escaped single-line PEM (common in env/secret managers).
    return inline.includes("\\n") ? inline.replace(/\\n/g, "\n") : inline;
  }
  return null;
}

function resolveSeatKeys(): { privateKey: KeyObject; publicKey: KeyObject; publicKeyPem: string } {
  const privPem = loadPem("SEAT_PRIVATE_KEY_PEM", "SEAT_PRIVATE_KEY_PATH");
  const pubPem = loadPem("SEAT_PUBLIC_KEY_PEM", "SEAT_PUBLIC_KEY_PATH");
  if (privPem && pubPem) {
    return {
      privateKey: createPrivateKey(privPem),
      publicKey: createPublicKey(pubPem),
      publicKeyPem: pubPem,
    };
  }
  if (privPem || pubPem) {
    throw new Error("config: provide BOTH seat private and public keys, or neither (run `bun run keygen`).");
  }
  // Neither provided: generate an ephemeral pair (dev/tests). Seat tokens won't
  // verify across restarts, which is fine locally.
  if (!IS_TEST) {
    console.warn(
      "[config] WARNING: SEAT_*_KEY not set — generating an ephemeral Ed25519 keypair. " +
        "Seat tokens won't survive a restart and the embedded client public key would change. " +
        "Run `bun run keygen` and set the keys in production.",
    );
  }
  const kp = generateKeyPairSync("ed25519");
  const generatedPubPem = kp.publicKey.export({ type: "spki", format: "pem" }) as string;
  return { privateKey: kp.privateKey, publicKey: kp.publicKey, publicKeyPem: generatedPubPem };
}

const seat = resolveSeatKeys();
// Resolve the auth secret exactly once so the managed-key fallback derives from
// the SAME value the rest of the app uses (resolveAuthSecret generates a random
// per-boot secret when unset — calling it twice would diverge).
const authSecretResolved = resolveAuthSecret();

// ---- Managed-key master secret (assured proxy org provider keys, chunk 3) --
// Master key under which org-level managed provider API keys are encrypted at
// rest (HKDF-derived AES-256-GCM; see crypto.encryptSecret). A dedicated secret
// is preferred in production so rotating it is independent of AUTH_SECRET; if
// unset we derive from AUTH_SECRET (fine for dev/tests). It is only ever used to
// wrap/unwrap provider keys — never logged, never returned.
function resolveManagedKeySecret(): string {
  const fromEnv = process.env.MANAGED_KEY_SECRET;
  if (fromEnv && fromEnv.trim().length >= 32) return fromEnv.trim();
  if (fromEnv && fromEnv.trim().length > 0) {
    throw new Error("config: MANAGED_KEY_SECRET is set but too short — use at least 32 chars (try `openssl rand -hex 48`).");
  }
  if (!IS_TEST) {
    console.warn(
      "[config] WARNING: MANAGED_KEY_SECRET not set — deriving the managed-key master from AUTH_SECRET. " +
        "Set a dedicated MANAGED_KEY_SECRET in production so it can be rotated independently.",
    );
  }
  return `managed-key::${authSecretResolved}`;
}

export const config = {
  host: str("HOST", "127.0.0.1"),
  // 0 is valid: Bun.serve binds an ephemeral port (used by the HTTP test).
  port: num("PORT", 5190, { min: 0 }),

  authSecret: authSecretResolved,

  /** Master secret for wrapping org managed provider keys at rest (chunk 3). */
  managedKeySecret: resolveManagedKeySecret(),

  seatPrivateKey: seat.privateKey,
  seatPublicKey: seat.publicKey,
  /** SPKI PEM of the seat-signing public key — what the desktop client embeds. */
  seatPublicKeyPem: seat.publicKeyPem,

  dbPath: str("DB_PATH", "./data/keepance-firm.sqlite"),

  accessTokenTtlSeconds: num("ACCESS_TOKEN_TTL_SECONDS", 3600),
  refreshTokenTtlSeconds: num("REFRESH_TOKEN_TTL_SECONDS", 2_592_000),
  seatTokenTtlSeconds: num("SEAT_TOKEN_TTL_SECONDS", 2_592_000),

  seatInactiveAfterSeconds: num("SEAT_INACTIVE_AFTER_SECONDS", 1_209_600),

  authRateLimitMax: num("AUTH_RATE_LIMIT_MAX", 10),
  authRateLimitWindowSeconds: num("AUTH_RATE_LIMIT_WINDOW_SECONDS", 60),

  // Sync relay is chattier than auth (a busy redline pushes many small updates),
  // so it gets its own, more generous per-IP+bucket window. Still bounds abuse.
  relayRateLimitMax: num("RELAY_RATE_LIMIT_MAX", 600),
  relayRateLimitWindowSeconds: num("RELAY_RATE_LIMIT_WINDOW_SECONDS", 60),

  /** Pre-auth JSON reads must not let a trickling peer occupy a worker forever. */
  v2PayloadReadTimeoutMs: num("V2_PAYLOAD_READ_TIMEOUT_MS", 10_000, { min: 100 }),
  /** Limits the amount of parsed JSON we inspect before authentication. */
  v2PayloadNodeBudget: num("V2_PAYLOAD_NODE_BUDGET", 100_000, { min: 1 }),

  /** Includes the root notes stream. A stream counts only after its first write. */
  firmMatterStreamCap: num("FIRM_MATTER_STREAM_CAP", 1024, { min: 1 }),
  /** Maximum non-root streams one active seat may allocate in a matter. */
  firmMatterStreamsPerSeat: num("FIRM_MATTER_STREAMS_PER_SEAT", 256, { min: 1 }),
  /** Every push is seat-rate-limited; unused client handles never reach the relay. */
  firmMatterStreamWriteRateLimitMax: num("FIRM_MATTER_STREAM_WRITE_RATE_LIMIT_MAX", 30, { min: 1 }),
  firmMatterStreamWriteRateLimitWindowSeconds: num("FIRM_MATTER_STREAM_WRITE_RATE_LIMIT_WINDOW_SECONDS", 60, { min: 1 }),

  /** Distinct client-generated intake handles that may be durably bound to one matter. */
  firmMatterIntakeHandleCap: num("FIRM_MATTER_INTAKE_HANDLE_CAP", 1024, { min: 1 }),
  /** Per-firm intake-key publish budget; it uses the shared firm write-rate window above. */
  firmMatterIntakePublishRateLimitMax: num("FIRM_MATTER_INTAKE_PUBLISH_RATE_LIMIT_MAX", 30, { min: 1 }),
  /** Per-firm intake-key fetch budget; it uses the shared firm write-rate window above. */
  firmMatterIntakeFetchRateLimitMax: num("FIRM_MATTER_INTAKE_FETCH_RATE_LIMIT_MAX", 30, { min: 1 }),

  // Assured inference proxy (chunk 3). Per-IP request cap + an upstream timeout.
  // The cap bounds abuse; the timeout severs a hung provider connection so a
  // stuck request can't pin server memory indefinitely (nothing is buffered, but
  // an open socket still costs a connection).
  assuredRateLimitMax: num("ASSURED_RATE_LIMIT_MAX", 120),
  assuredRateLimitWindowSeconds: num("ASSURED_RATE_LIMIT_WINDOW_SECONDS", 60),
  assuredUpstreamTimeoutMs: num("ASSURED_UPSTREAM_TIMEOUT_MS", 120_000),
  /** Hard cap on a forwarded inference request body (the prompt). Streams through;
   *  never buffered. Generous for long privileged documents, still bounded. */
  assuredMaxRequestBytes: num("ASSURED_MAX_REQUEST_BYTES", 8 * 1024 * 1024),

  /** JWT issuer claim. Kept identical to the legacy validator's audience so the
   *  client treats tokens uniformly; the seat-token issuer is the firm host. */
  issuer: str("TOKEN_ISSUER", "licenses.lanternplatform.app"),

  // ---- SSO (OIDC) — Wave 3a -------------------------------------------------
  /** Public base URL the IdP redirects back to: `${ssoCallbackBase}/auth/sso/callback`.
   *  Must match the redirect URI the firm registers with their IdP. */
  ssoCallbackBase: str("SSO_CALLBACK_BASE", "https://api.lanternplatform.app"),
  ssoStateTtlSeconds: num("SSO_STATE_TTL_SECONDS", 600),
  ssoCodeTtlSeconds: num("SSO_CODE_TTL_SECONDS", 120),

  // ---- LemonSqueezy webhook (chunk 4) --------------------------------------
  /** HMAC-SHA256 signing secret for verifying X-Signature on LS webhooks.
   *  Set in production; empty string in dev/tests (tests set it directly). */
  lemonSqueezyWebhookSecret: str("LEMONSQUEEZY_WEBHOOK_SECRET", ""),
  /** Comma-separated LS variant IDs that map to the Firm plan. */
  firmVariantIds: str("FIRM_VARIANT_IDS", ""),

  bootstrap: {
    orgName: process.env.BOOTSTRAP_ORG_NAME?.trim() || null,
    adminEmail: process.env.BOOTSTRAP_ADMIN_EMAIL?.trim() || null,
    adminPassword: process.env.BOOTSTRAP_ADMIN_PASSWORD ?? null,
    seatLimit: num("BOOTSTRAP_SEAT_LIMIT", 5),
    plan: str("BOOTSTRAP_PLAN", "practice"),
  },

  isTest: IS_TEST,
} as const;

export type Config = typeof config;
