import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Provider, ProviderResponse, SendOptions } from '@/platform/providers/Provider';
import {
  resetPromptPreparationStateForTests,
  setPromptDecisionBroker,
} from '@/platform/privacy/promptPreparation';
import { SECRET_SCRUB_FIXTURES } from '@/platform/privacy/promptPreparation.fixtures';
import type { AuditEntry } from '@/platform/types/audit';
import { createPreparedMeetingTemplateFillProvider } from './meetingTemplateAi';

function providerWithSend(sendMessage: Provider['sendMessage']): Provider {
  return {
    sendMessage,
  } as unknown as Provider;
}

describe('meeting template prepared AI sender', () => {
  afterEach(() => {
    resetPromptPreparationStateForTests();
    vi.clearAllMocks();
  });

  it('redacts a transcript capability, records the decision, and sends only the prepared copy', async () => {
    let sentPrompt: string | undefined;
    let sentOptions: SendOptions | undefined;
    const sendMessage = (prompt: string, options?: SendOptions): Promise<ProviderResponse> => {
      sentPrompt = prompt;
      sentOptions = options;
      return Promise.resolve({
        content: '{"sections":[]}',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        cost: 0,
        model: 'local-test-model',
      });
    };
    const onAuditLog = vi.fn<(entry: Omit<AuditEntry, 'id' | 'timestamp'>) => void>();
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));
    const sender = createPreparedMeetingTemplateFillProvider({
      matterId: 'client-1',
      resolved: {
        provider: providerWithSend(sendMessage),
        providerId: 'ollama',
        model: 'local-test-model',
      },
      onAuditLog,
    });

    await sender.send(
      `Transcript: ${SECRET_SCRUB_FIXTURES.urls}`,
      { systemPrompt: 'Fill the selected template.' },
    );

    expect(sentPrompt).toContain('#[link-fragment-hidden]');
    expect(sentOptions?.preparationStamp).toBeDefined();

    const auditEntries = onAuditLog.mock.calls.map(([entry]) => entry);
    const preparation = auditEntries.find((entry) => entry.action === 'prompt_preparation');
    expect(preparation).toBeDefined();
    expect(preparation?.metadata['surface']).toBe('meeting_template_fill');
    expect(preparation?.metadata['decision']).toBe('redacted_by_user');

    const egress = auditEntries.find((entry) => entry.action === 'egress');
    expect(egress).toBeDefined();
    expect(egress?.metadata['scope']).toEqual({ kind: 'matter', matterId: 'client-1' });
  });
});
