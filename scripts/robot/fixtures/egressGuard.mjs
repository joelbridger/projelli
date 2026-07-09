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
  '**/v1/responses',
  '**/v1/messages',
  '**/v1/embeddings',
  '**/v1/audio/transcriptions',
  '**/v1/audio/speech',
  '**/v1/images/**',
  '**/v1/models',
  '**/v1beta/**',
];

export const WHOLE_APP_CLOUD_AI_PATTERNS = [
  ...LIVE_AI_PATTERNS,
  // Common cloud model gateway host shapes. Localhost is allowed by the route
  // handler below so local llama/Ollama traffic is not treated as cloud egress.
  '**/openrouter.ai/**',
  '**/api.mistral.ai/**',
  '**/api.cohere.ai/**',
  '**/api.perplexity.ai/**',
];

export function isLocalUrl(url) {
  try {
    const u = new URL(String(url || ''));
    return ['localhost', '127.0.0.1', '::1', '[::1]'].includes(u.hostname);
  } catch {
    return false;
  }
}

/**
 * Install the tripwire on `page`. Call this BEFORE installAIReplay so the replay
 * routes (registered later) take precedence for the URLs they cover.
 *
 * @param {import('playwright').Page} page
 * @returns {Promise<{ violations: string[], count: number, ok: () => boolean, report: () => object }>}
 */
export async function installEgressGuard(page, { patterns = LIVE_AI_PATTERNS, allowLocal = true } = {}) {
  const violations = [];
  for (const pattern of patterns) {
    await page.route(pattern, async (route) => {
      let url = '';
      try { url = route.request().url(); } catch { /* ignore */ }
      if (allowLocal && isLocalUrl(url)) {
        await route.continue().catch(() => {});
        return;
      }
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
 * Whole-app local-only tripwire. Use after switching the app into
 * "On this computer only" mode, before exercising every AI-capable feature.
 * Verdict is stricter than deterministic replay: no fixture needs to be served;
 * the proof is simply zero cloud AI egress anywhere in the app.
 */
export async function installLocalOnlyEgressTripwire(page) {
  return installEgressGuard(page, {
    patterns: WHOLE_APP_CLOUD_AI_PATTERNS,
    allowLocal: true,
  });
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

export function localOnlyEgressVerdict({ violations = [] } = {}) {
  const list = Array.isArray(violations) ? violations : [];
  return {
    violationCount: list.length,
    violations: list.slice(0, 10),
    ok: list.length === 0,
  };
}
