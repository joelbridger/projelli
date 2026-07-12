/**
 * Process-local abuse counters for the public intake mailbox.
 *
 * These counters deliberately retain no request, client, IP, user-agent, intake
 * id, token, or ciphertext data. They are for capacity/abuse tuning only and
 * disappear on restart, matching the relay's no-durable-traffic-metadata rule.
 */
export const PUBLIC_INTAKE_ENDPOINTS = ["bundle", "state", "chunk", "chunks", "submit"] as const;
export type PublicIntakeEndpoint = (typeof PUBLIC_INTAKE_ENDPOINTS)[number];

export interface IntakeAbuseTelemetry {
  requests: Record<PublicIntakeEndpoint, number>;
  rate_limited: number;
  oversize_or_quota_rejections: number;
  unauthenticated_or_invalid_token: number;
}

function emptyRequests(): Record<PublicIntakeEndpoint, number> {
  return Object.fromEntries(PUBLIC_INTAKE_ENDPOINTS.map((endpoint) => [endpoint, 0])) as Record<PublicIntakeEndpoint, number>;
}

let telemetry: IntakeAbuseTelemetry = {
  requests: emptyRequests(),
  rate_limited: 0,
  oversize_or_quota_rejections: 0,
  unauthenticated_or_invalid_token: 0,
};

export function recordPublicIntakeRequest(endpoint: PublicIntakeEndpoint): void {
  telemetry.requests[endpoint]++;
}

export function recordIntakeRateLimited(): void {
  telemetry.rate_limited++;
}

export function recordIntakePayloadRejected(): void {
  telemetry.oversize_or_quota_rejections++;
}

export function recordIntakeUnauthorized(): void {
  telemetry.unauthenticated_or_invalid_token++;
}

/** A copy prevents callers from mutating the process-local counters. */
export function getIntakeAbuseTelemetry(): IntakeAbuseTelemetry {
  return { ...telemetry, requests: { ...telemetry.requests } };
}

/** Test-only reset; production never needs to erase aggregate in-memory counts. */
export function resetIntakeAbuseTelemetryForTests(): void {
  telemetry = {
    requests: emptyRequests(),
    rate_limited: 0,
    oversize_or_quota_rejections: 0,
    unauthenticated_or_invalid_token: 0,
  };
}
