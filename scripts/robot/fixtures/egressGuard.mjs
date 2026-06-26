//
// Egress guard for the deterministic test robot.
//
// When the Windows smoke runs `deterministic:true`, the AI replay fixture is
// supposed to serve EVERY model call. This guard is the tripwire that proves it:
// it routes every live-AI host/path to a handler that RECORDS a violation and
// ABORTS the request. Because Playwright matches routes in reverse-registration
// order, the guard is installed FIRST and the replay routes are installed AFTER —
// so for any URL the fixture covers, the replay wins and the guard never fires.
// The guard only fires for an AI request the fixture did NOT serve (a path/host
// we didn't anticipate, or the replay not being installed) — i.e. real egress.
//
// A deterministic Ask therefore fails loudly (no live spend, no flaky answer) if
// anything slips past the fixture.
//
// The generic chat-completions / messages / v1beta API-shape patterns below are
// the important part: they catch egress to a provider host we never listed.
//
// (Line comments, not a block comment: the glob patterns contain the "*/"
// sequence, which would prematurely close a block comment.)

// Generation (answer-producing) endpoints — distinct from peripheral calls like
// `/v1/models`. The deterministic proof "the fixture was used" must count a real
// GENERATION call, not a model-list refresh, so a future stray request can't make
// a leaked answer look served. Used by aiReplay.mjs's `served` counter.
export const GENERATION_PATTERNS = [
  /\/chat\/completions(?:[/?#]|$)/, // OpenAI
  /\/v1\/messages(?:[/?#]|$)/, // Anthropic
  /:streamGenerateContent/, // Gemini (streaming)
  /:generateContent/, // Gemini (non-streaming)
];

/** True if `url` is an AI *generation* endpoint (not /models etc.). Pure. */
export function isGenerationUrl(url) {
  const u = String(url || '');
  return GENERATION_PATTERNS.some((re) => re.test(u));
}

export const LIVE_AI_PATTERNS = [
  // Absolute provider hosts
  '**/api.openai.com/**',
  '**/api.anthropic.com/**',
  '**/generativelanguage.googleapis.com/**',
  // Dev-proxy paths (Vite)
  '**/api/openai/**',
  '**/api/anthropic/**',
  '**/api/google/**',
  // Provider API shapes — catch any UNANTICIPATED host
  '**/v1/chat/completions',
  '**/v1/messages',
  '**/v1beta/**',
];

/**
 * Install the tripwire on `page`. Call this BEFORE installAIReplay so the replay
 * routes (registered later) take precedence for the URLs they cover.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ violations: string[], count: number, ok: () => boolean, report: () => object }>}
 */
export async function installEgressGuard(page) {
  const violations = [];
  for (const pattern of LIVE_AI_PATTERNS) {
    await page.route(pattern, async (route) => {
      let url = '';
      try { url = route.request().url(); } catch { /* ignore */ }
      violations.push(url);
      await route.abort('blockedbyclient').catch(() => {});
    });
  }
  return {
    violations,
    get count() { return violations.length; },
    ok() { return violations.length === 0; },
    report() { return { egressViolations: violations.length, urls: violations.slice(0, 10) }; },
  };
}

/**
 * Pure verdict for a deterministic run: the fixture must have served the model
 * call (served >= 1) AND nothing may have egressed to a live provider. Returns
 * `ok:false` for both "leaked to live AI" and "fixture was never used".
 *
 * @param {{ served?: number, violations?: string[] }} input
 */
export function egressVerdict({ served = 0, violations = [] } = {}) {
  const list = Array.isArray(violations) ? violations : [];
  return {
    served,
    violationCount: list.length,
    violations: list.slice(0, 10),
    ok: list.length === 0 && served >= 1,
  };
}
