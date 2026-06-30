/**
 * diagnostics.ts — fire-and-forget structural event sender for design-partner mode.
 *
 * STRICTLY OPT-IN: sends nothing unless getDesignPartnerConsent() === 'enabled'.
 * STRUCTURE-ONLY: the typed event union makes it impossible to pass content,
 * file names, matter names, prompt text, or email bodies. Only counts and enums.
 *
 * Events POST to a dedicated endpoint (separate from the /app-event telemetry
 * endpoint) with source: 'design-partner' so the server can route them cleanly.
 *
 * Failures are swallowed — diagnostics never block UI or surface errors.
 *
 * THE EVENT TYPES ARE THE PRIVACY GUARANTEE.
 * No field named body/text/query/content/message/subject/prompt is permitted.
 * The discriminated union below enforces this at compile time.
 */

import { getInstallId } from './installId';
import { getDesignPartnerConsent } from '@/platform/hooks/useDesignPartnerConsent';
import { isLocalOnlyModeFailClosed } from '@/platform/privacy/localOnlyGuard';
import { BRAND } from '@/config/brand';

const ENDPOINT = BRAND.urls.formsDiagnostics;

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
  return (import.meta as { env?: { VITE_APP_VERSION?: string } }).env?.VITE_APP_VERSION ?? 'unknown';
}

// ---------------------------------------------------------------------------
// Structural event union — STRUCTURE-ONLY, no free-text content fields.
// Every field is an enum, count, id, or code. No body/text/query/content/
// message/subject/prompt field appears anywhere in this union.
// ---------------------------------------------------------------------------

export type DiagnosticEvent =
  | {
      event: 'feature_used';
      feature: 'ask' | 'workflow' | 'search' | 'dictation' | 'email_import';
    }
  | {
      event: 'workflow_run';
      /** The workflow template id — a stable slug, not user-typed text. */
      templateId: string;
    }
  | {
      event: 'search_count';
      /** Integer count of searches executed. No query text. */
      count: number;
    }
  | {
      event: 'error_caught';
      /** The React component name or module label. No stack trace. */
      component: string;
      /** A short error code or category (e.g. 'network', 'rag_failed'). */
      code: string;
    }
  | {
      event: 'onboarding_step';
      /** The step identifier (e.g. 'ai_setup', 'workspace_created'). */
      step: string;
    }
  | {
      event: 'matter_count';
      /** Integer count of matters in this workspace. */
      count: number;
    }
  | {
      event: 'provider_connected';
      /** The provider name (e.g. 'anthropic', 'openai', 'ollama'). */
      provider: string;
    };

/**
 * Send a structural diagnostic event. No-op unless design-partner consent
 * is 'enabled'. Always fire-and-forget (use `void sendDiagnosticEvent(...)`
 * at call sites to make the floating promise explicit and intentional).
 *
 * The payload contains only structural fields from the event union above plus
 * anonymous install metadata. It never contains content, file names, matter
 * names, prompt text, email bodies, or search queries.
 */
export async function sendDiagnosticEvent(event: DiagnosticEvent): Promise<void> {
  if (getDesignPartnerConsent() !== 'enabled') return;
  // Private-mode kill-switch (fail-closed): never make an outbound diagnostics
  // call in private mode, or before the mode is confirmed non-local. Silent skip.
  if (isLocalOnlyModeFailClosed()) return;

  const base: Record<string, string | number> = {
    install_id: getInstallId(),
    app_version: getAppVersion(),
    platform: getPlatform(),
    source: 'design-partner',
  };

  // Spread event fields into payload. TypeScript ensures only structural fields
  // from DiagnosticEvent are present — no content leaks possible.
  const payload: Record<string, string | number> = { ...base };
  for (const [k, v] of Object.entries(event)) {
    payload[k] = typeof v === 'number' ? v : String(v);
  }

  try {
    await fetch(ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
      keepalive: true,
    });
  } catch {
    // Swallow — diagnostics never block UI.
  }
}
