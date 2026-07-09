// scripts/robot/__tests__/egressGuard.test.mjs
// The deterministic smoke must NEVER silently fall through to a live model. The
// egress guard registers tripwire routes on every live-AI host/path and FAILS
// the run (records a violation + aborts the request) if anything that the replay
// fixture didn't serve tries to reach a real provider.
//
// We drive it with a fake Playwright page: it captures the (pattern -> handler)
// registrations so we can fire a fake request at the handler and assert the guard
// records + aborts it.
import { describe, it, expect } from 'vitest';
import {
  installEgressGuard,
  installLocalOnlyEgressTripwire,
  egressVerdict,
  localOnlyEgressVerdict,
  isGenerationUrl,
  isLocalUrl,
  LIVE_AI_PATTERNS,
  WHOLE_APP_CLOUD_AI_PATTERNS,
} from '../fixtures/egressGuard.mjs';

// minimal glob -> regex for ** and * (test-only), char by char (no placeholders)
function globToRe(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*') {
      if (glob[i + 1] === '*') { re += '.*'; i++; } else { re += '[^/]*'; }
    } else if ('.+^${}()|[]\\/'.includes(c)) {
      re += '\\' + c;
    } else {
      re += c;
    }
  }
  return new RegExp('^' + re + '$');
}

function makeFakePage() {
  const routes = [];
  return {
    routes,
    async route(pattern, handler) { routes.push({ pattern, handler }); },
    // simulate a request to `url`: run the LAST-registered matching handler
    // (mirrors Playwright's reverse-registration-order matching).
    async fire(url) {
      const aborted = [];
      const fakeRoute = {
        request: () => ({ url: () => url }),
        abort: async (reason) => { aborted.push(reason); },
        fulfill: async () => {},
        fetch: async () => ({}),
        continue: async () => {},
      };
      const match = [...routes].reverse().find((r) => globToRe(r.pattern).test(url));
      if (match) await match.handler(fakeRoute);
      return { matched: !!match, aborted };
    },
  };
}

describe('installEgressGuard', () => {
  it('registers a tripwire on every live-AI pattern', async () => {
    const page = makeFakePage();
    await installEgressGuard(page);
    expect(page.routes.length).toBe(LIVE_AI_PATTERNS.length);
  });

  it('records a violation and aborts when a live OpenAI request egresses', async () => {
    const page = makeFakePage();
    const guard = await installEgressGuard(page);
    const r = await page.fire('https://api.openai.com/v1/chat/completions');
    expect(r.matched).toBe(true);
    expect(r.aborted.length).toBe(1); // request was blocked, not allowed out
    expect(guard.violations).toContain('https://api.openai.com/v1/chat/completions');
    expect(guard.ok()).toBe(false);
  });

  it('catches an UNANTICIPATED provider host via the generic API-shape tripwire', async () => {
    const page = makeFakePage();
    const guard = await installEgressGuard(page);
    await page.fire('https://sneaky-proxy.example/v1/chat/completions');
    await page.fire('https://other.example/v1/messages');
    expect(guard.violations.length).toBe(2);
    expect(guard.ok()).toBe(false);
  });

  it('does not count localhost model traffic as cloud egress', async () => {
    const page = makeFakePage();
    const guard = await installEgressGuard(page);
    const r = await page.fire('http://127.0.0.1:11434/v1/chat/completions');
    expect(r.matched).toBe(true);
    expect(r.aborted.length).toBe(0);
    expect(guard.ok()).toBe(true);
  });

  it('reports clean when nothing egressed', async () => {
    const page = makeFakePage();
    const guard = await installEgressGuard(page);
    expect(guard.ok()).toBe(true);
    expect(guard.report().egressViolations).toBe(0);
  });
});

describe('installLocalOnlyEgressTripwire', () => {
  it('covers the wider whole-app cloud AI pattern list', async () => {
    const page = makeFakePage();
    await installLocalOnlyEgressTripwire(page);
    expect(page.routes.length).toBe(WHOLE_APP_CLOUD_AI_PATTERNS.length);
  });

  it('fails local-only when any cloud AI endpoint is touched', async () => {
    const page = makeFakePage();
    const guard = await installLocalOnlyEgressTripwire(page);
    await page.fire('https://api.openai.com/v1/embeddings');
    await page.fire('https://api.anthropic.com/v1/messages');
    const verdict = localOnlyEgressVerdict({ violations: guard.violations });
    expect(verdict.ok).toBe(false);
    expect(verdict.violationCount).toBe(2);
  });

  it('passes local-only when only local model endpoints are touched', async () => {
    const page = makeFakePage();
    const guard = await installLocalOnlyEgressTripwire(page);
    await page.fire('http://localhost:11434/v1/chat/completions');
    const verdict = localOnlyEgressVerdict({ violations: guard.violations });
    expect(verdict.ok).toBe(true);
  });
});

describe('egressVerdict (deterministic pass/fail)', () => {
  it('passes only when the fixture served the call AND nothing leaked', () => {
    expect(egressVerdict({ served: 1, violations: [] }).ok).toBe(true);
    expect(egressVerdict({ served: 3, violations: [] }).ok).toBe(true);
  });

  it('FAILS when something egressed to live AI', () => {
    const v = egressVerdict({ served: 1, violations: ['https://api.openai.com/v1/chat/completions'] });
    expect(v.ok).toBe(false);
    expect(v.violationCount).toBe(1);
  });

  it('FAILS when the fixture was never used (served 0) — no silent live fallthrough', () => {
    expect(egressVerdict({ served: 0, violations: [] }).ok).toBe(false);
    expect(egressVerdict({}).ok).toBe(false);
  });
});

describe('isGenerationUrl (served must count a real answer call, not /models)', () => {
  it('matches generation endpoints', () => {
    expect(isGenerationUrl('http://localhost:5173/api/openai/v1/chat/completions')).toBe(true);
    expect(isGenerationUrl('https://api.openai.com/v1/chat/completions')).toBe(true);
    expect(isGenerationUrl('http://localhost:5173/api/anthropic/v1/messages')).toBe(true);
    expect(isGenerationUrl('https://generativelanguage.googleapis.com/v1beta/models/gemini:streamGenerateContent')).toBe(true);
  });

  it('does NOT match the model-list endpoint', () => {
    expect(isGenerationUrl('http://localhost:5173/api/openai/v1/models')).toBe(false);
    expect(isGenerationUrl('https://api.openai.com/v1/models')).toBe(false);
  });
});

describe('isLocalUrl', () => {
  it('recognizes localhost AI servers as local, not cloud', () => {
    expect(isLocalUrl('http://localhost:11434/v1/chat/completions')).toBe(true);
    expect(isLocalUrl('http://127.0.0.1:11434/v1/chat/completions')).toBe(true);
    expect(isLocalUrl('https://api.openai.com/v1/chat/completions')).toBe(false);
  });
});
