/**
 * Test preload (configured via bunfig.toml `preload`). Runs BEFORE any source
 * module, so it can set the env that `config.ts` reads once at import time:
 *   - a fixed AUTH_SECRET so HS256 access tokens + HMAC hashes are stable
 *   - a fixed Ed25519 seat keypair so seat-token signatures verify within a run
 *   - an in-memory DB so tests never touch disk
 *
 * Generating the seat keypair here (rather than hardcoding a PEM) keeps a
 * private key out of the repo while still being stable for the process.
 */

import { generateKeyPairSync } from "node:crypto";

process.env.BUN_TEST = "1";
process.env.NODE_ENV = "test";
process.env.AUTH_SECRET = "test-secret-deterministic-please-do-not-use-in-prod-0123456789";
process.env.ADMIN_PROVISION_SECRET = "test-provision-secret-deterministic-0123456789";
process.env.DB_PATH = ":memory:";
process.env.PORT = "0"; // ephemeral port — avoids collisions when the server boots in tests
process.env.ACCESS_TOKEN_TTL_SECONDS = "3600";
process.env.REFRESH_TOKEN_TTL_SECONDS = "86400";
process.env.SEAT_TOKEN_TTL_SECONDS = "2592000";
process.env.AUTH_RATE_LIMIT_MAX = "1000"; // don't rate-limit the test runner
process.env.RELAY_RATE_LIMIT_MAX = "100000"; // relay is chatty in tests; don't throttle
process.env.ASSURED_RATE_LIMIT_MAX = "100000"; // assured proxy: don't throttle the runner
// Short upstream timeout so the assured-proxy "hung provider" test is fast.
// (config reads this at import; it MUST be set in this preload, not in the test
// file body, which runs after imports.)
process.env.ASSURED_UPSTREAM_TIMEOUT_MS = "800";

const kp = generateKeyPairSync("ed25519");
process.env.SEAT_PRIVATE_KEY_PEM = kp.privateKey.export({ type: "pkcs8", format: "pem" }) as string;
process.env.SEAT_PUBLIC_KEY_PEM = kp.publicKey.export({ type: "spki", format: "pem" }) as string;
