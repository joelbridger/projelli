import { describe, expect, it, vi, afterEach } from 'vitest';
vi.mock('@/platform/privacy/cloudSendGuard', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/platform/privacy/cloudSendGuard')>();
  return { ...actual, assertCloudSendAllowed: vi.fn(), isLocalOnlyModeFailClosed: () => false };
});
import { SECRET_SCRUB_FIXTURES } from './promptPreparation.fixtures';
import {
  assertCloudPreparation,
  getPendingPromptReview,
  getPreparationEnforcementMode,
  prepareCloudRequest,
  prepareToolResultContinuation,
  resetPromptPreparationStateForTests,
  scanPromptPart,
  sendPreparedMessageWithEgressAudit,
  setPromptDecisionBroker,
  setPreparationEnforcementMode,
} from './promptPreparation';
import type { Provider } from '@/platform/providers/Provider';
import type { AttachmentBytes } from '@/platform/providers/Provider';
import { extractPdfText } from '@/lib/pdf-extract';

function pdfAttachment(overrides: Partial<AttachmentBytes['att']> = {}, bytes = new TextEncoder().encode('ordinary attachment')): AttachmentBytes {
  return {
    att: {
      id: 'attachment-1', type: 'pdf', mimeType: 'application/pdf', fileName: 'clean.pdf',
      pathInWorkspace: 'media/clean.pdf', byteSize: bytes.byteLength, metadata: {}, ...overrides,
    },
    bytes,
  };
}

afterEach(() => {
  vi.unstubAllEnvs();
  setPreparationEnforcementMode('enforce');
  resetPromptPreparationStateForTests();
  vi.unstubAllGlobals();
});

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
      const prepared = prepareCloudRequest({ prompt: text, systemPrompt: text });
      expect(prepared.status).toBe('needs_user_decision');
      if (prepared.status !== 'needs_user_decision') continue;
      for (const value of SECRET_SCRUB_FIXTURES.secretValues) {
        if (!text.includes(value)) continue;
        expect(prepared.redactedRequest.prompt).not.toContain(value);
        expect(prepared.redactedRequest.systemPrompt).not.toContain(value);
      }
    }
  });

  it('does not flag ordinary URLs, ordinary language, benign code, or normal client data', () => {
    for (const text of SECRET_SCRUB_FIXTURES.safe) {
      expect(scanPromptPart({ id: 'safe', origin: 'typed_question', label: 'Question', text }).findings).toEqual([]);
    }
  });

  it('keeps the safe link path while hiding fragments and signed query values', () => {
    const scan = scanPromptPart({ id: 'urls', origin: 'email', label: 'Email', text: SECRET_SCRUB_FIXTURES.urls });
    expect(scan.redactedText).toContain('https://example.test/i/abc#[link-fragment-hidden]');
    expect(scan.redactedText).toContain('https://s3.example.test/file?X-Amz-Signature=[private-value-hidden]');
    expect(scan.redactedText).not.toContain('intake-secret');
  });

  it('hides a normalized secret even when a visible secret was already redacted', () => {
    const original = 'password=hide access%5Ftoken%3Dencoded-secret';
    const prepared = prepareCloudRequest({ prompt: original, systemPrompt: original });
    expect(prepared.status).toBe('needs_user_decision');
    if (prepared.status !== 'needs_user_decision') return;
    expect(prepared.redactedRequest.prompt).not.toContain('hide');
    expect(prepared.redactedRequest.prompt).not.toContain('encoded-secret');
    expect(prepared.redactedRequest.systemPrompt).not.toContain('hide');
    expect(prepared.redactedRequest.systemPrompt).not.toContain('encoded-secret');
  });

  it('blocks an unscannable cloud attachment', () => {
    expect(prepareCloudRequest({ prompt: 'summarize', parts: [{ id: 'photo', origin: 'attachment_binary', label: 'Photo', attachment: {} }] }))
      .toMatchObject({ status: 'blocked', reason: 'unscannable_attachment' });
  });

  it('never forwards original attachment bytes after redacting attachment-derived text', async () => {
    const original = pdfAttachment({}, new TextEncoder().encode(`original bytes ${SECRET_SCRUB_FIXTURES.attachmentText}`));
    const prepared = prepareCloudRequest({
      prompt: 'summarize', attachmentBytes: [original],
      parts: [{
        id: 'attachment-text', origin: 'attachment_text', label: 'Attachment',
        attachment: { attachmentId: original.att.id, extractedText: SECRET_SCRUB_FIXTURES.attachmentText, canRedact: true },
      }],
    });
    expect(prepared.status).toBe('needs_user_decision');
    if (prepared.status !== 'needs_user_decision') return;
    const forwarded = prepared.redactedRequest.attachmentBytes?.[0];
    expect(forwarded?.bytes).not.toBe(original.bytes);
    expect(Array.from(forwarded?.bytes ?? [])).not.toEqual(Array.from(original.bytes));
    expect(new TextDecoder().decode(forwarded?.bytes)).not.toContain('attachment-secret-value');
    expect(forwarded?.att.fileName).toBe('redacted-attachment.pdf');
    if (!forwarded) throw new Error('Expected a redacted attachment derivative');
    const extractedDerivative = await extractPdfText(forwarded.bytes.slice());
    expect(extractedDerivative.pages.join('')).not.toHaveLength(0);
    expect(extractedDerivative.pages.join('\n')).not.toContain('attachment-secret-value');

    let sent: AttachmentBytes[] | undefined;
    const provider = {
      getMetadata: () => ({ model: 'local-test' }),
      sendMessage: (_prompt: string, options?: { attachmentBytes?: AttachmentBytes[] }) => {
        sent = options?.attachmentBytes;
        return Promise.resolve({ content: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, cost: 0, model: 'local-test' });
      },
    } as unknown as Provider;
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));
    await sendPreparedMessageWithEgressAudit({
      provider, providerId: 'ollama', surface: 'test', prompt: 'summarize',
      options: { attachmentBytes: [original] },
      parts: [{ id: 'attachment-text', origin: 'attachment_text', label: 'Attachment', attachment: { attachmentId: original.att.id, extractedText: SECRET_SCRUB_FIXTURES.attachmentText, canRedact: true } }],
    });
    expect(sent?.[0]?.bytes).not.toBe(original.bytes);
    expect(new TextDecoder().decode(sent?.[0]?.bytes)).not.toContain('attachment-secret-value');
  });

  it('redacts a secret-bearing filename and records only the attachment filename category', async () => {
    const original = pdfAttachment({ fileName: SECRET_SCRUB_FIXTURES.attachmentFilename });
    const prepared = prepareCloudRequest({ prompt: 'summarize', attachmentBytes: [original] });
    expect(prepared.status).toBe('needs_user_decision');
    if (prepared.status !== 'needs_user_decision') return;
    expect(prepared.redactedRequest.attachmentBytes?.[0]?.att.fileName).toBe('attachment.pdf');
    expect(JSON.stringify(prepared.findings)).not.toContain('filename-secret-value');

    const receipts: unknown[] = [];
    const provider = {
      getMetadata: () => ({ model: 'local-test' }),
      sendMessage: () => Promise.resolve({ content: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, cost: 0, model: 'local-test' }),
    } as unknown as Provider;
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));
    await sendPreparedMessageWithEgressAudit({
      provider, providerId: 'ollama', surface: 'test', prompt: 'summarize', options: { attachmentBytes: [original] },
      onAuditLog: (entry) => { receipts.push(entry); },
    });
    expect(JSON.stringify(receipts[0])).toContain('attachment/filename');
    expect(JSON.stringify(receipts[0])).not.toContain('filename-secret-value');
  });

  it('blocks an attachment finding when it cannot rebuild a safe derivative', () => {
    const original = pdfAttachment();
    expect(prepareCloudRequest({
      prompt: 'summarize', attachmentBytes: [original],
      parts: [{ id: 'attachment-text', origin: 'attachment_text', label: 'Attachment', attachment: { attachmentId: original.att.id, extractedText: SECRET_SCRUB_FIXTURES.attachmentText, canRedact: false } }],
    })).toMatchObject({ status: 'blocked', reason: 'unscannable_attachment' });
  });

  it('passes a clean attachment through byte-identically', () => {
    const original = pdfAttachment();
    const prepared = prepareCloudRequest({
      prompt: 'summarize', attachmentBytes: [original],
      parts: [{ id: 'attachment-text', origin: 'attachment_text', label: 'Attachment', attachment: { attachmentId: original.att.id, extractedText: 'A clean client statement.', canRedact: true } }],
    });
    expect(prepared.status).toBe('ready');
    if (prepared.status !== 'ready') return;
    expect(prepared.request.attachmentBytes?.[0]?.bytes).toBe(original.bytes);
    expect(Array.from(prepared.request.attachmentBytes?.[0]?.bytes ?? [])).toEqual(Array.from(original.bytes));
  });

  it('blocks a secret-bearing tool continuation before the follow-up request', () => {
    expect(() => prepareToolResultContinuation(SECRET_SCRUB_FIXTURES.urls)).toThrow('prompt_review_required');
    expect(() => prepareToolResultContinuation('{"access_token":"tool-secret"}')).toThrow('prompt_review_required');
    expect(prepareToolResultContinuation('ordinary tool response')).toBe('ordinary tool response');
  });

  it('starts clean after a test leaves a pending review', () => {
    expect(getPendingPromptReview()).toBeUndefined();
  });

  it('enforces by default, while explicit warn mode remains available for diagnostics', () => {
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    expect(getPreparationEnforcementMode()).toBe('enforce');
    expect(() => { assertCloudPreparation(undefined, 'openai'); }).toThrow('not prepared');
    setPreparationEnforcementMode('warn');
    expect(() => { assertCloudPreparation(undefined, 'openai'); }).not.toThrow();
    expect(warning).toHaveBeenCalled();
    warning.mockRestore();
  });

  it('cannot weaken cloud preparation in a production build', () => {
    vi.stubEnv('DEV', false);
    vi.stubEnv('NODE_ENV', 'production');

    expect(() => { setPreparationEnforcementMode('off'); })
      .toThrow('enforcement mode can only change in development or tests');
    expect(getPreparationEnforcementMode()).toBe('enforce');
  });

  it('records detected categories and counts for every preparation decision', async () => {
    type ReceiptMetadata = {
      decision: 'clean' | 'redacted_by_user' | 'cancelled' | 'blocked';
      categories: Array<{ kind: string; count: number }>;
    };
    const receipts: ReceiptMetadata[] = [];
    const provider = {
      getMetadata: () => ({ model: 'local-test' }),
      sendMessage: () => Promise.resolve({ content: 'ok', usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 }, cost: 0, model: 'local-test' }),
    } as unknown as Provider;
    const send = (prompt: string, background = false) => sendPreparedMessageWithEgressAudit({
      provider, providerId: 'ollama', surface: 'test', prompt, background,
      onAuditLog: (entry) => {
        if (entry.action === 'prompt_preparation') receipts.push(entry.metadata as ReceiptMetadata);
      },
    });

    await send('ordinary question');
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));
    await send('password: private-value');
    setPromptDecisionBroker(() => Promise.resolve('cancel'));
    await expect(send('password: private-value')).rejects.toThrow('prompt_send_cancelled');
    await expect(send('password: private-value', true)).rejects.toThrow('prompt_review_required');

    expect(receipts.map(({ decision, categories }) => ({ decision, categories }))).toEqual([
      { decision: 'clean', categories: [] },
      { decision: 'redacted_by_user', categories: [{ kind: 'password', count: 1 }] },
      { decision: 'cancelled', categories: [{ kind: 'password', count: 1 }] },
      { decision: 'blocked', categories: [{ kind: 'password', count: 1 }] },
    ]);
  });

  it('keeps the model-call audit detail while adding a preparation receipt before egress', async () => {
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
      modelCall: (response) => ({
        action: 'model_call',
        description: 'Legacy audit detail',
        model: response.model,
        inputs: { promptLength: 42 },
        outputs: { contentLength: response.content.length },
        userDecision: 'auto',
        metadata: { source: 'legacy-path' },
      }),
    });
    expect(sent).not.toContain('intake-secret');
    expect(JSON.stringify(entries)).not.toContain('intake-secret');
    expect((entries[0] as { action: string }).action).toBe('prompt_preparation');
    expect((entries[1] as { action: string }).action).toBe('egress');
    expect(JSON.stringify(entries[0])).toContain('intake_link_secret');
    expect(entries[2]).toMatchObject({
      action: 'model_call',
      description: 'Legacy audit detail',
      model: 'local-test',
      inputs: { promptLength: 42 },
      outputs: { contentLength: 2 },
      metadata: { source: 'legacy-path' },
    });
  });

});
