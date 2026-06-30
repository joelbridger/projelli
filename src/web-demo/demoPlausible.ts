/**
 * Stream D-web Group VII · Task 7.1
 *
 * Thin Plausible wrapper for the demo bundle. All five demo-funnel events
 * land here:
 *
 *   - `demo_loaded`            — fired once on initial mount
 *   - `demo_ai_first_message`  — fired the first time the user sends a
 *                                proxy-backed AI message in this session
 *   - `demo_limit_hit`         — fired when the DemoExitModal opens (any
 *                                trigger: count, time, or proxy 429/503)
 *   - `demo_download_clicked`  — fired on click of any download CTA
 *                                (banner, exit modal, or homepage hero)
 *   - `demo_byok_used`         — fired when a user successfully stores a
 *                                BYOK key (the next AI call will bypass the
 *                                proxy entirely)
 *
 * If the Plausible script never loads (blocked by an extension, served
 * from the wrong domain, no network), every call no-ops silently. The demo
 * itself must never crash because analytics failed.
 *
 * The Plausible snippet is added to `index.demo.html`; it sets a global
 * `plausible(eventName, { props })` function. We type that function loosely
 * here so the demo bundle does not depend on `@types/plausible` (which would
 * pull in extra dev deps for one analytics call).
 */

import { SK_DEMO_FIRST_MESSAGE_FLAG, SK_DEMO_BYOK_REPORTED_FLAG } from '@/config/identity';

type PlausibleProps = Record<string, string | number | boolean | undefined>;

interface PlausibleFn {
  (eventName: string, options?: { props?: PlausibleProps }): void;
}

declare global {
  interface Window {
    plausible?: PlausibleFn;
  }
}

const FIRST_MESSAGE_FLAG = SK_DEMO_FIRST_MESSAGE_FLAG;
const BYOK_REPORTED_FLAG = SK_DEMO_BYOK_REPORTED_FLAG;


function safeCall(eventName: string, props?: PlausibleProps): void {
  if (typeof window === 'undefined') return;
  try {
    const fn = window.plausible;
    if (typeof fn !== 'function') return;
    if (props) {
      fn(eventName, { props });
    } else {
      fn(eventName);
    }
  } catch {
    // tolerate
  }
}

export function trackDemoLoaded(): void {
  safeCall('demo_loaded');
}

/**
 * Reports `demo_ai_first_message` exactly once per browser session. Uses
 * sessionStorage so a refresh in the same tab does not double-count, but a
 * brand-new tab (or a returning user the next day) re-counts as a fresh
 * funnel entry.
 */
export function trackDemoAiFirstMessage(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.sessionStorage.getItem(FIRST_MESSAGE_FLAG) === '1') return;
    window.sessionStorage.setItem(FIRST_MESSAGE_FLAG, '1');
  } catch {
    // tolerate; we'd rather over-count once than swallow the event
  }
  safeCall('demo_ai_first_message');
}

export function trackDemoLimitHit(reason: string): void {
  safeCall('demo_limit_hit', { reason });
}

export function trackDemoDownloadClicked(surface: string, os?: string): void {
  const props: PlausibleProps = { surface };
  if (os) props['os'] = os;
  safeCall('demo_download_clicked', props);
}

/**
 * Reports `demo_byok_used` exactly once per browser session, the same way
 * the first-message event behaves.
 */
export function trackDemoByokUsed(): void {
  if (typeof window === 'undefined') return;
  try {
    if (window.sessionStorage.getItem(BYOK_REPORTED_FLAG) === '1') return;
    window.sessionStorage.setItem(BYOK_REPORTED_FLAG, '1');
  } catch {
    // tolerate
  }
  safeCall('demo_byok_used');
}

/** Test-only escape hatch so unit tests can re-arm session-once events. */
export function _resetDemoPlausibleFlagsForTests(): void {
  if (typeof window === 'undefined') return;
  try {
    window.sessionStorage.removeItem(FIRST_MESSAGE_FLAG);
    window.sessionStorage.removeItem(BYOK_REPORTED_FLAG);
  } catch {
    // tolerate
  }
}
