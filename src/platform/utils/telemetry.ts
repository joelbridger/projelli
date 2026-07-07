/**
 * telemetry — fire-and-forget event sender for anonymous lifecycle events.
 *
 * Honors the user's consent (see useTelemetryConsent). Without consent,
 * sendEvent is a no-op and no network request is made.
 *
 * Events POST to the form-handler service at:
 *   https://forms.lanternplatform.app/api/forms/lantern/app-event
 *
 * Payload (whitelisted by the server; extra fields are dropped):
 *   { install_id, app_version, platform, event, license_tier?, days_since_install? }
 *
 * Event names follow lower_snake_case: 'app_launch', 'trial_start',
 * 'trial_end', 'license_activated', 'license_deactivated', 'onboarding_skipped',
 * 'onboarding_email_submitted'.
 *
 * Failures are swallowed (network down, 4xx, etc.) — telemetry never blocks
 * UI or surfaces errors to the user. Once-per-event-name dedup is the
 * caller's responsibility (see `sendEventOnce`).
 */

import { getInstallId } from './installId';
import { getTelemetryConsent } from '@/platform/hooks/useTelemetryConsent';
import { isLocalOnlyModeFailClosed } from '@/platform/privacy/localOnlyGuard';
import { BRAND } from '@/config/brand';
import { SK_TELEMETRY_SENT_EVENTS } from '@/config/identity';

const ENDPOINT = BRAND.urls.formsTelemetry;

interface EventFields {
  /** e.g. 'personal' | 'professional' | 'practice' | 'trial' | 'expired'. */
  license_tier?: string;
  /** Integer days since first launch. Sent as string by the server schema. */
  days_since_install?: number;
}

/** Detect platform for the `platform` field. */
function getPlatform(): string {
  if (typeof navigator === 'undefined') return 'unknown';
  const ua = navigator.userAgent.toLowerCase();
  if (ua.includes('mac')) return 'darwin';
  if (ua.includes('win')) return 'win32';
  if (ua.includes('linux')) return 'linux';
  return 'unknown';
}

function getAppVersion(): string {
  // Vite injects this from package.json via define in vite.config (or as
  // an env var); fall back to a constant so we always send something.
  return (import.meta as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION ?? 'unknown';
}

export async function sendEvent(event: string, fields: EventFields = {}): Promise<void> {
  if (getTelemetryConsent() !== 'enabled') return;
  // Private-mode kill-switch (fail-closed): never make an outbound telemetry call
  // in private mode, or before the mode is confirmed non-local. Silent skip.
  if (isLocalOnlyModeFailClosed()) return;
  const body: Record<string, string> = {
    install_id: getInstallId(),
    app_version: getAppVersion(),
    platform: getPlatform(),
    event,
  };
  if (fields.license_tier) body['license_tier'] = fields.license_tier;
  if (typeof fields.days_since_install === 'number') {
    body['days_since_install'] = String(fields.days_since_install);
  }
  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
      // Best-effort; don't block on slow networks.
      keepalive: true,
    });
  } catch {
    // Swallow.
  }
}

/**
 * Send an event at most once per install. Used for "this happened for
 * the first time" milestones like trial_start or trial_end so a
 * relaunch doesn't double-count.
 */
export async function sendEventOnce(event: string, fields: EventFields = {}): Promise<void> {
  const sent = readSent();
  if (sent.has(event)) return;
  sent.add(event);
  writeSent(sent);
  await sendEvent(event, fields);
}

function readSent(): Set<string> {
  try {
    const raw = localStorage.getItem(SK_TELEMETRY_SENT_EVENTS);
    if (!raw) return new Set();
    const arr = JSON.parse(raw);
    return new Set(Array.isArray(arr) ? arr : []);
  } catch {
    return new Set();
  }
}

function writeSent(set: Set<string>): void {
  try {
    localStorage.setItem(SK_TELEMETRY_SENT_EVENTS, JSON.stringify([...set]));
  } catch {
    // Out of quota or otherwise broken; ignore.
  }
}
