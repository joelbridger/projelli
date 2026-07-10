import { config } from "./config.ts";
import { hmacEquals, hmacHash, verifySeatToken } from "./crypto.ts";
import { authenticate, error, getBearer, json, rateLimit } from "./http.ts";
import type { Store, IntakeRecord } from "./db.ts";
import type { AccessTokenClaims, SeatTokenClaims } from "./types.ts";

export const MAX_INTAKE_STATE_BYTES = 64 * 1024;
export const MAX_INTAKE_CHECKLIST_BYTES = 512 * 1024;
export const MAX_INTAKE_CHUNK_BYTES = 4 * 1024 * 1024;
export const MAX_INTAKE_FILE_BYTES = 100 * 1024 * 1024;
export const MAX_INTAKE_TOTAL_BYTES = 500 * 1024 * 1024;

const DECOY_INTAKE_TOKEN_HASH = hmacHash("lantern-intake-decoy-token-v1");
const NEUTRAL_INTAKE_GONE = { error: "intake_unavailable" };

export function neutralIntakeGone(): Response {
  return json(NEUTRAL_INTAKE_GONE, 410);
}

export interface AdvisorIntakeIdentity {
  org_id: string;
  user_id: string;
  seat_id: string;
  claims: SeatTokenClaims;
  access?: AccessTokenClaims;
}

export function verifyAdvisorSeat(
  req: Request,
  store: Store,
): { ok: true; identity: AdvisorIntakeIdentity } | { ok: false; resp: Response } {
  const seatToken = req.headers.get("x-seat-token");
  if (!seatToken) return { ok: false, resp: error("seat_required", 401, "missing_seat_token") };

  const verified = verifySeatToken<SeatTokenClaims>(seatToken, config.seatPublicKey);
  if (!verified.valid) return { ok: false, resp: error("seat_invalid", 401, verified.reason) };
  const claims = verified.payload;

  const seat = store.getSeat(claims.seat_id);
  if (!seat || seat.status !== "active") return { ok: false, resp: error("seat_invalid", 401, "seat_not_active") };
  if (seat.user_id !== claims.user_id || seat.org_id !== claims.org_id) {
    return { ok: false, resp: error("seat_invalid", 401, "seat_mismatch") };
  }

  const org = store.getOrg(claims.org_id);
  if (!org || org.status !== "active") return { ok: false, resp: error("seat_invalid", 401, "org_inactive") };
  const user = store.getUser(claims.user_id);
  if (!user || user.status !== "active") return { ok: false, resp: error("seat_invalid", 401, "user_inactive") };

  let access: AccessTokenClaims | undefined;
  if (req.headers.get("authorization")) {
    const auth = authenticate(req);
    if (!auth.ok) return { ok: false, resp: error("unauthorized", 401, auth.reason) };
    if (auth.claims.sub !== claims.user_id || auth.claims.org_id !== claims.org_id) {
      return { ok: false, resp: error("forbidden", 403, "identity_mismatch") };
    }
    access = auth.claims;
  }

  return {
    ok: true,
    identity: {
      org_id: claims.org_id,
      user_id: claims.user_id,
      seat_id: claims.seat_id,
      claims,
      access,
    },
  };
}

export function authorizeAdvisorIntake(
  req: Request,
  store: Store,
  intakeId: string,
): { ok: true; identity: AdvisorIntakeIdentity; intake: IntakeRecord } | { ok: false; resp: Response } {
  const advisor = verifyAdvisorSeat(req, store);
  if (!advisor.ok) return advisor;

  const intake = store.getIntake(intakeId);
  if (!intake || intake.org_id !== advisor.identity.org_id) {
    return { ok: false, resp: error("intake_not_found", 404) };
  }
  return { ok: true, identity: advisor.identity, intake };
}

export function authorizePublicIntake(
  req: Request,
  store: Store,
  intakeId: string,
): { ok: true; intake: IntakeRecord; token: string } | { ok: false; resp: Response } {
  const token = getBearer(req) ?? "";
  const intake = store.getIntake(intakeId);
  const storedHash = intake?.token_hash ?? DECOY_INTAKE_TOKEN_HASH;
  const tokenMatches = hmacEquals(token, storedHash);
  const active =
    intake !== null &&
    intake.status === "active" &&
    Number.isFinite(Date.parse(intake.expires_at)) &&
    Date.parse(intake.expires_at) > Date.now();

  if (!tokenMatches || !active || !intake) return { ok: false, resp: neutralIntakeGone() };
  return { ok: true, intake, token };
}

export function publicIntakeRateLimit(ip: string, intakeId: string): Response | null {
  const byIp = rateLimit(ip, "intake_public_ip", {
    max: config.relayRateLimitMax,
    windowSeconds: config.relayRateLimitWindowSeconds,
  });
  if (!byIp.ok) return error("rate_limited", 429, `Try again in ${byIp.retryAfter}s`);

  const byIntake = rateLimit(intakeId, "intake_public_intake", {
    max: config.relayRateLimitMax,
    windowSeconds: config.relayRateLimitWindowSeconds,
  });
  if (!byIntake.ok) return error("rate_limited", 429, `Try again in ${byIntake.retryAfter}s`);
  return null;
}

export function isSafeIntakePathId(v: string): boolean {
  return v.length > 0 && v.length <= 128 && !v.includes("/");
}
