/**
 * Centralised, validated configuration. Read once at boot from the environment;
 * everything downstream imports the typed `config` object rather than touching
 * `process.env` directly. Fails fast and loud on a misconfigured production
 * secret, but stays convenient (auto-generated ephemeral secret) for local dev.
 */

import { randomBytes, generateKeyPairSync, createPrivateKey, createPublicKey } from "node:crypto";
import { readFileSync } from "node:fs";
import { isIP } from "node:net";
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

/**
 * Parse a comma-separated proxy allowlist once at boot. We keep addresses as
 * IPs, rather than hostnames, because this list decides whether a request may
 * supply its own client address via X-Forwarded-For.
 */
function trustedProxyIps(name: string, fallback: string): Set<string> {
  const entries = str(name, fallback).split(",").map((value) => value.trim().toLowerCase()).filter(Boolean);
  const ips = new Set<string>();
  for (const entry of entries) {
    if (isIP(entry) === 0) throw new Error(`config: ${name} must contain only comma-separated IP addresses`);
    ips.add(entry);
  }
  if (ips.size === 0) throw new Error(`config: ${name} must contain at least one IP address`);
  return ips;
}

function normalizedIp(value: string): string | null {
  // Brackets are permitted by some proxy implementations around IPv6 values.
  const withoutBrackets = value.trim().replace(/^\[([^\]]+)\]$/, "$1").toLowerCase();
  return isIP(withoutBrackets) === 0 ? null : withoutBrackets;
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

/** Empty locks `/admin/*` closed; a configured operations credential must be strong. */
function resolveAdminProvisionSecret(): string {
  const value = process.env.ADMIN_PROVISION_SECRET?.trim() ?? "";
  if (!value) return "";
  if (value.length < 32) {
    throw new Error("config: ADMIN_PROVISION_SECRET is set but too short — use at least 32 chars (try `openssl rand -hex 48`).");
  }
  return value;
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

function enabled(name: string): boolean {
  const raw = process.env[name];
  if (raw === undefined || raw.trim() === "") return false;
  if (raw.trim().toLowerCase() === "true") return true;
  if (raw.trim().toLowerCase() === "false") return false;
  throw new Error(`config: ${name} must be either true or false`);
}

// ---- DocuSign signing broker (Wave 9) -------------------------------------
// This is deliberately separate from the seat-token keys above. The broker's
// RSA key is only for the DocuSign OAuth JWT grant and must never be reused for
// Lantern authentication or sent to a client.
type DocusignSigningEnvironment = "demo" | "production";

function optionalTrimmed(name: string): string | null {
  const value = process.env[name]?.trim();
  return value || null;
}

function assertAbsoluteUrl(name: string, value: string, { requireHttps = false }: { requireHttps?: boolean } = {}): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`config: ${name} must be an absolute URL`);
  }
  if (!["http:", "https:"].includes(parsed.protocol) || (requireHttps && parsed.protocol !== "https:")) {
    throw new Error(`config: ${name} must use ${requireHttps ? "https" : "http or https"}`);
  }
  if (parsed.username || parsed.password || parsed.hash) throw new Error(`config: ${name} must not contain credentials or a fragment`);
  return parsed.toString();
}

function resolveDocusignSigningConfig() {
  const releaseEnabled = enabled("DOCUSIGN_SIGNING_PRODUCTION_RELEASE");
  const requested = optionalTrimmed("DOCUSIGN_SIGNING_ENVIRONMENT") ?? "demo";
  if (requested !== "demo" && requested !== "production") {
    throw new Error("config: DOCUSIGN_SIGNING_ENVIRONMENT must be demo or production");
  }
  if (releaseEnabled && requested !== "production") {
    throw new Error("config: DOCUSIGN_SIGNING_PRODUCTION_RELEASE requires DOCUSIGN_SIGNING_ENVIRONMENT=production");
  }

  // The release flag is the sole switch to production. A stray production
  // environment/base URI can never steer a non-released service off demo.
  const environment: DocusignSigningEnvironment = releaseEnabled ? "production" : "demo";
  const integrationKey = optionalTrimmed("DOCUSIGN_SIGNING_INTEGRATION_KEY");
  const impersonatedUserId = optionalTrimmed("DOCUSIGN_SIGNING_IMPERSONATED_USER_ID");
  const accountId = optionalTrimmed("DOCUSIGN_SIGNING_ACCOUNT_ID");
  const allowedReturnUrlRaw = optionalTrimmed("DOCUSIGN_SIGNING_ALLOWED_RETURN_URL");
  const connectKey = optionalTrimmed("DOCUSIGN_SIGNING_CONNECT_KEY");
  const approvedTemplateIds = new Set(
    (optionalTrimmed("DOCUSIGN_SIGNING_APPROVED_TEMPLATE_IDS") ?? "")
      .split(",")
      .map((value) => value.trim())
      .filter(Boolean),
  );
  for (const templateId of approvedTemplateIds) {
    if (!/^[A-Za-z0-9._:-]{1,256}$/.test(templateId)) {
      throw new Error("config: DOCUSIGN_SIGNING_APPROVED_TEMPLATE_IDS contains an invalid template ID");
    }
  }
  const privatePem = loadPem("DOCUSIGN_SIGNING_PRIVATE_KEY_PEM", "DOCUSIGN_SIGNING_PRIVATE_KEY_PATH");

  if (accountId && !/^[A-Za-z0-9-]{1,128}$/.test(accountId)) {
    throw new Error("config: DOCUSIGN_SIGNING_ACCOUNT_ID has an invalid format");
  }

  let privateKey: KeyObject | null = null;
  if (privatePem) {
    try {
      privateKey = createPrivateKey(privatePem);
    } catch {
      throw new Error("config: DOCUSIGN_SIGNING private key is invalid");
    }
  }

  const apiBaseUriRaw = environment === "production"
    ? optionalTrimmed("DOCUSIGN_SIGNING_PRODUCTION_API_BASE_URI")
    : optionalTrimmed("DOCUSIGN_SIGNING_DEMO_API_BASE_URI");
  // The desktop adapter adds its one required /restapi path segment. Keeping
  // this as a bare origin prevents a duplicate /restapi/restapi request.
  const defaultApiBaseUri = "https://demo.docusign.net";
  const apiBaseUri = apiBaseUriRaw
    ? assertAbsoluteUrl("DOCUSIGN_SIGNING_API_BASE_URI", apiBaseUriRaw, { requireHttps: environment === "production" })
    : environment === "demo" ? defaultApiBaseUri : null;

  if (apiBaseUri) {
    const parsed = new URL(apiBaseUri);
    const host = parsed.hostname.toLowerCase();
    if (!host.endsWith("docusign.net") || !["", "/"].includes(parsed.pathname) || parsed.search) {
      throw new Error("config: DOCUSIGN_SIGNING API base URI must be a bare DocuSign origin");
    }
    if (environment === "demo" && host !== "demo.docusign.net") {
      throw new Error("config: a non-released signing broker must use the DocuSign demo API base URI");
    }
    if (environment === "production" && (host === "demo.docusign.net" || host.includes("demo"))) {
      throw new Error("config: a released signing broker must not use a DocuSign demo API base URI");
    }
  }

  const allowedReturnUrl = allowedReturnUrlRaw
    ? assertAbsoluteUrl("DOCUSIGN_SIGNING_ALLOWED_RETURN_URL", allowedReturnUrlRaw, { requireHttps: environment === "production" })
    : null;

  if (releaseEnabled) {
    const missing = [
      !integrationKey && "DOCUSIGN_SIGNING_INTEGRATION_KEY",
      !impersonatedUserId && "DOCUSIGN_SIGNING_IMPERSONATED_USER_ID",
      !accountId && "DOCUSIGN_SIGNING_ACCOUNT_ID",
      !apiBaseUri && "DOCUSIGN_SIGNING_PRODUCTION_API_BASE_URI",
      !privateKey && "DOCUSIGN_SIGNING_PRIVATE_KEY_PEM or DOCUSIGN_SIGNING_PRIVATE_KEY_PATH",
      !connectKey && "DOCUSIGN_SIGNING_CONNECT_KEY",
      !allowedReturnUrl && "DOCUSIGN_SIGNING_ALLOWED_RETURN_URL",
    ].filter(Boolean);
    if (missing.length > 0) throw new Error(`config: production DocuSign signing release is missing ${missing.join(", ")}`);
  }

  return {
    environment,
    productionReleaseEnabled: releaseEnabled,
    integrationKey,
    impersonatedUserId,
    accountId,
    apiBaseUri,
    privateKey,
    connectKey,
    approvedTemplateIds,
    allowedReturnUrl,
    oauthTokenEndpoint: environment === "production"
      ? "https://account.docusign.com/oauth/token"
      : "https://account-d.docusign.com/oauth/token",
    jwtAudience: environment === "production" ? "account.docusign.com" : "account-d.docusign.com",
  } as const;
}

const docusignSigning = resolveDocusignSigningConfig();

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

  // Public intake links are unauthenticated until their capability token is
  // checked. The largest allowed 500 MiB intake is 125 four-MiB chunks. 300
  // requests/minute leaves more than a full extra upload's worth of room for
  // retries, bundle/resume checks, and finalizations, while still bounding a
  // single-IP probe flood. The higher per-link cap stops a distributed flood
  // without punishing a household using several devices on one link.
  intakePublicIpRateLimitMax: num("INTAKE_PUBLIC_IP_RATE_LIMIT_MAX", 300),
  intakePublicIpRateLimitWindowSeconds: num("INTAKE_PUBLIC_IP_RATE_LIMIT_WINDOW_SECONDS", 60),
  intakePublicIntakeRateLimitMax: num("INTAKE_PUBLIC_LINK_RATE_LIMIT_MAX", 600),
  intakePublicIntakeRateLimitWindowSeconds: num("INTAKE_PUBLIC_LINK_RATE_LIMIT_WINDOW_SECONDS", 60),

  // Caddy is normally the loopback peer. Only these known proxy addresses may
  // provide X-Forwarded-For; direct clients never get to choose their bucket.
  // Override with TRUSTED_PROXY_IPS for a non-loopback proxy (comma-separated).
  trustedProxyIps: trustedProxyIps("TRUSTED_PROXY_IPS", "127.0.0.1,::1,::ffff:127.0.0.1"),

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

  /**
   * Operations credential for the global `/admin/*` provisioning surface.
   * It travels in the backend's existing `Authorization: Bearer` mechanism but
   * is deliberately separate from end-user JWTs: an organization admin is not
   * a platform-wide provisioner. Empty means the route is locked closed.
   */
  adminProvisionSecret: resolveAdminProvisionSecret(),

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

  /** Blind DocuSign JWT broker. Its key material is distinct from seat keys. */
  docusignSigning,

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

/**
 * Return the address used for rate limits. A forwarded chain is accepted only
 * when the direct socket peer is on the configured proxy allowlist. In that
 * case, walk from the proxy-facing end and choose the first untrusted hop: a
 * client cannot spoof this position because a correctly configured proxy
 * appends its direct client address to X-Forwarded-For.
 */
export function clientIpFromPeer(
  peerIp: string | null | undefined,
  xForwardedFor: string | null,
  trustedProxies: ReadonlySet<string> = config.trustedProxyIps,
): string {
  const peer = normalizedIp(peerIp ?? "");
  if (!peer) return peerIp?.trim() || "unknown";
  if (!trustedProxies.has(peer) || !xForwardedFor) return peer;

  const hops = xForwardedFor.split(",");
  for (let index = hops.length - 1; index >= 0; index--) {
    const hop = normalizedIp(hops[index]!);
    if (hop && !trustedProxies.has(hop)) return hop;
  }
  return peer;
}
