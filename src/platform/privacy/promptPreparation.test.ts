import { describe, expect, it, vi, afterEach } from 'vitest';
vi.mock('@/platform/privacy/cloudSendGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/privacy/cloudSendGuard')>();
  return { ...actual, assertCloudSendAllowed: vi.fn(), isLocalOnlyModeFailClosed: () => false };
});
const fetchSpy = vi.fn();
import { SECRET_SCRUB_FIXTURES } from './promptPreparation.fixtures';
import {
  assertCloudPreparation,
  getPreparationEnforcementMode,
  prepareCloudRequest,
  prepareToolResultContinuation,
  scanPromptPart,
  sendPreparedMessageWithEgressAudit,
  setPromptDecisionBroker,
  setPreparationEnforcementMode,
} from './promptPreparation';
import type { Provider } from '@/platform/providers/Provider';
import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import { GeminiProvider } from '@/platform/providers/GeminiProvider';

afterEach(() => { setPreparationEnforcementMode('warn'); setPromptDecisionBroker(); vi.unstubAllGlobals(); });

describe('prompt preparation red-team catalog', () => {
  it('finds every required secret family without retaining a value in the receipt data', () => {
    const cases = [
      [SECRET_SCRUB_FIXTURES.bearer, 'bearer_token'], [SECRET_SCRUB_FIXTURES.jwt, 'bearer_token'],
      [SECRET_SCRUB_FIXTURES.apiKeys, 'api_key'], [SECRET_SCRUB_FIXTURES.oauth, 'oauth_token'],
      [SECRET_SCRUB_FIXTURES.oauth, 'oauth_code'], [SECRET_SCRUB_FIXTURES.passwordForms, 'password'],
      [SECRET_SCRUB_FIXTURES.passwordForms, 'cookie'], [SECRET_SCRUB_FIXTURES.passwordForms, 'connection_string'], [SECRET_SCRUB_FIXTURES.privateKey, 'private_key'],
      [SECRET_SCRUB_FIXTURES.urls, 'signed_url'], [SECRET_SCRUB_FIXTURES.encoded, 'api_key'],
      [SECRET_SCRUB_FIXTURES.zeroWidth, 'api_key'], [SECRET_SCRUB_FIXTURES.folded, 'bearer_token'],
      [SECRET_SCRUB_FIXTURES.markdown, 'intake_link_secret'], ['https://example.test/path#private', 'url_fragment'],
    ] as const;
    for (const [text, expected] of cases) {
      const scan = scanPromptPart({ id: expected, origin: 'retrieval', label: 'Retrieved text', text });
      expect(scan.findings.some((finding) => finding.kind === expected)).toBe(true);
      expect(JSON.stringify(scan.findings)).not.toContain('intake-secret');
      expect(JSON.stringify(scan.findings)).not.toContain('aws-secret');
      expect(scan.redactedText).not.toContain('private-key-material');
    }
  });

  it('does not flag ordinary URLs, ordinary language, benign code, or normal client data', () => {
    for (const text of SECRET_SCRUB_FIXTURES.safe) {
      expect(scanPromptPart({ id: 'safe', origin: 'typed_question', label: 'Question', text }).findings).toEqual([]);
    }
  });

  it('keeps the safe link path while hiding fragments and signed query values', () => {
    const scan = scanPromptPart({ id: 'urls', origin: 'email', label: 'Email', text: SECRET_SCRUB_FIXTURES.urls });
    expect(scan.redactedText).toContain('https://example.test/i/abc#[private-link-hidden]');
    expect(scan.redactedText).toContain('https://s3.example.test/file?X-Amz-Signature=[private-value-hidden]');
    expect(scan.redactedText).not.toContain('intake-secret');
  });

  it('blocks an unscannable cloud attachment', () => {
    expect(prepareCloudRequest({ prompt: 'summarize', parts: [{ id: 'photo', origin: 'attachment_binary', label: 'Photo', attachment: {} }] }))
      .toMatchObject({ status: 'blocked', reason: 'unscannable_attachment' });
  });

  it('blocks a secret-bearing tool continuation before the follow-up request', () => {
    expect(() => prepareToolResultContinuation(SECRET_SCRUB_FIXTURES.urls)).toThrow('prompt_review_required');
    expect(prepareToolResultContinuation('ordinary tool response')).toBe('ordinary tool response');
  });

  it('warn mode never throws while enforce mode stops before a fetch can start', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getPreparationEnforcementMode()).toBe('warn');
    expect(() => { assertCloudPreparation(undefined, 'openai'); }).not.toThrow();
    expect(warning).toHaveBeenCalled();
    setPreparationEnforcementMode('enforce');
    expect(() => { assertCloudPreparation(undefined, 'openai'); }).toThrow('not prepared');
    warning.mockRestore();
  });

  it('records category and count before egress, without putting the source value in the receipt', async () => {
    const entries: unknown[] = [];
    let sent = '';
    const provider = {
      getMetadata: () => ({ model: 'local-test' }),
      sendMessage: (prompt: string) => {
        sent = prompt;
        return Promise.resolve({ content: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, cost: 0, model: 'local-test' });
      },
    } as unknown as Provider;
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));
    await sendPreparedMessageWithEgressAudit({
      provider, providerId: 'ollama', surface: 'test', prompt: SECRET_SCRUB_FIXTURES.urls,
      onAuditLog: (entry) => { entries.push(entry); },
    });
    expect(sent).not.toContain('intake-secret');
    expect(JSON.stringify(entries)).not.toContain('intake-secret');
    expect((entries[0] as { action: string }).action).toBe('prompt_preparation');
    expect((entries[1] as { action: string }).action).toBe('egress');
    expect(JSON.stringify(entries[0])).toContain('intake_link_secret');
  });

  it('scans tool results in Claude, OpenAI, and Gemini before a continuation fetch', async () => {
    const cases: Array<{ provider: { setTools: (tools: never[], executor: () => Promise<unknown>) => void; sendMessage: (prompt: string) => Promise<unknown> }; body: unknown }> = [
      {
        provider: new ClaudeProvider({ apiKey: 'test' }),
        body: { model: 'claude', stop_reason: 'tool_use', usage: { input_tokens: 1, output_tokens: 1 }, content: [{ type: 'tool_use', id: 'tool-1', name: 'read', input: {} }] },
      },
      {
        provider: new OpenAIProvider({ apiKey: 'test' }),
        body: { model: 'openai', usage: { prompt_tokens: 1, completion_tokens: 1 }, choices: [{ finish_reason: 'tool_calls', message: { content: null, tool_calls: [{ id: 'tool-1', function: { name: 'read', arguments: '{}' } }] } }] },
      },
      {
        provider: new GeminiProvider({ apiKey: 'test' }),
        body: { usageMetadata: { promptTokenCount: 1, candidatesTokenCount: 1 }, candidates: [{ content: { parts: [{ functionCall: { name: 'read', args: {} } }] } }] },
      },
    ];
    for (const { provider, body } of cases) {
      fetchSpy.mockReset();
      fetchSpy.mockResolvedValue(new Response(JSON.stringify(body), { status: 200 }));
      vi.stubGlobal('fetch', fetchSpy);
      provider.setTools([] as never[], () => Promise.resolve({ link: 'https://example.test/i/abc#tool-secret' }));
      // eslint-disable-next-line lantern-egress/no-direct-provider-send -- this proves the provider backstop rejects an unprepared tool continuation.
      await expect(provider.sendMessage('read this')).rejects.toThrow('prompt_review_required');
      expect(fetchSpy).toHaveBeenCalledTimes(1);
    }
  });
});
