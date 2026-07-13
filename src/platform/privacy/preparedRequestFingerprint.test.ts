import { describe, expect, it, vi, afterEach } from 'vitest';
import type { Provider } from '@/platform/providers/Provider';
import {
  sendPreparedMessageWithEgressAudit,
  setPromptDecisionBroker,
  resetPromptPreparationStateForTests,
  type PreparedCloudRequest,
} from './promptPreparation';
import {
  fingerprintPreparedRequest,
  canonicalizePreparedPayload,
} from './preparedRequestFingerprint';

afterEach(() => {
  resetPromptPreparationStateForTests();
  vi.restoreAllMocks();
});

interface Seen {
  prompt?: string;
  systemPrompt?: string | undefined;
}

function fakeProvider(seen: Seen): Provider {
  return {
    getMetadata: () => ({ model: 'gpt-test' }),
    sendMessage: (prompt: string, options?: { systemPrompt?: string }) => {
      seen.prompt = prompt;
      seen.systemPrompt = options?.systemPrompt;
      return Promise.resolve({
        content: 'ok',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        cost: 0,
        model: 'gpt-test',
      });
    },
  } as unknown as Provider;
}

async function sha256Hex(value: string): Promise<string> {
  const bytes = new TextEncoder().encode(value);
  const digest = new Uint8Array(await crypto.subtle.digest('SHA-256', bytes));
  return Array.from(digest, (b) => b.toString(16).padStart(2, '0')).join('');
}

/**
 * Audit-send mismatch (Ask-seam defect #3): the durable intent must fingerprint
 * the EXACT prepared payload the provider receives, not the typed question.
 */
describe('prepared-request fingerprint at the egress seam', () => {
  it('hands beforeEgress the exact prepared request the provider is then called with', async () => {
    const seen: Seen = {};
    let beforeEgressRequest: Readonly<PreparedCloudRequest> | undefined;
    await sendPreparedMessageWithEgressAudit({
      provider: fakeProvider(seen),
      providerId: 'openai',
      surface: 'ask',
      prompt: 'What is the client retirement target?',
      options: {
        systemPrompt:
          'Client CRM: retire at 62. Retrieved files: 401k statement. Prior answer: on track.',
      },
      beforeEgress: (request) => {
        beforeEgressRequest = request;
      },
    });

    // Pre-fix, beforeEgress received NO argument at all — this is the crux.
    const req = beforeEgressRequest;
    expect(req).toBeDefined();
    expect(seen.prompt).toBeDefined();
    if (!req || seen.prompt === undefined) throw new Error('no prepared request');
    // The audited (beforeEgress) request IS the exact payload the provider got.
    expect(req.prompt).toBe(seen.prompt);
    expect(req.systemPrompt).toBe(seen.systemPrompt);

    // And its fingerprint records the prepared system prompt's real length —
    // not `q.length` of the short typed question.
    const fp = await fingerprintPreparedRequest(req);
    expect(fp.preparedSystemPromptLength).toBe(seen.systemPrompt?.length);
    expect(fp.preparedPromptLength).toBe(seen.prompt.length);
    // The typed question is far shorter than the transmitted system prompt.
    expect(fp.preparedSystemPromptLength).toBeGreaterThan(fp.preparedPromptLength);

    const recomputed = await sha256Hex(
      canonicalizePreparedPayload({
        prompt: seen.prompt,
        systemPrompt: seen.systemPrompt,
        attachments: [],
        attachmentDisposition: req.attachmentDisposition,
      }),
    );
    expect(fp.preparedPayloadSha256).toBe(recomputed);
  });

  it('fingerprints the REDACTED payload actually sent, never the raw material', async () => {
    const seen: Seen = {};
    // A redactable secret in the system prompt forces preparation to rewrite it.
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));

    let beforeEgressRequest: Readonly<PreparedCloudRequest> | undefined;
    await sendPreparedMessageWithEgressAudit({
      provider: fakeProvider(seen),
      providerId: 'openai',
      surface: 'ask',
      prompt: 'Summarize',
      options: {
        systemPrompt: 'Authorization: Bearer sk-secret-value-1234567890abcdef',
      },
      parts: [
        { id: 'prompt', origin: 'typed_question', label: 'Q', text: 'Summarize' },
      ],
      beforeEgress: (request) => {
        beforeEgressRequest = request;
      },
    });

    const req = beforeEgressRequest;
    expect(req).toBeDefined();
    if (!req) throw new Error('no prepared request');
    // The fingerprinted system prompt is the redacted one the provider received.
    expect(req.systemPrompt).toBe(seen.systemPrompt);
    expect(req.systemPrompt).not.toContain('sk-secret-value');
    const fp = await fingerprintPreparedRequest(req);
    expect(fp.preparedSystemPromptLength).toBe(seen.systemPrompt?.length);
  });
});
