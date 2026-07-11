import { afterEach, describe, expect, it, vi } from 'vitest';

vi.mock('@/platform/privacy/cloudSendGuard', () => ({
  assertCloudSendAllowed: vi.fn(),
  isLocalOnlyModeFailClosed: () => false,
}));

import { OpenAIProvider } from '@/platform/providers/OpenAIProvider';
import {
  sendPreparedMessageWithEgressAudit,
  setPreparationEnforcementMode,
} from './promptPreparation';

function successfulOpenAIResponse(): Response {
  return new Response(JSON.stringify({
    model: 'gpt-4o',
    choices: [{ message: { content: 'prepared answer' }, finish_reason: 'stop' }],
    usage: { prompt_tokens: 1, completion_tokens: 1, total_tokens: 2 },
  }), { status: 200, headers: { 'Content-Type': 'application/json' } });
}

afterEach(() => {
  setPreparationEnforcementMode('enforce');
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('prepared cloud stamp', () => {
  it('lets a prepared OpenAI send reach mocked fetch silently in enforce mode', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulOpenAIResponse());
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    vi.stubGlobal('fetch', fetchMock);
    setPreparationEnforcementMode('enforce');
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

    await expect(sendPreparedMessageWithEgressAudit({
      provider,
      providerId: 'openai',
      surface: 'test',
      prompt: 'ordinary question',
    })).resolves.toMatchObject({ content: 'prepared answer' });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    expect(warning).not.toHaveBeenCalled();
  });

  it('blocks unstamped or foreign stamps by default before fetch', async () => {
    const fetchMock = vi.fn().mockResolvedValue(successfulOpenAIResponse());
    vi.stubGlobal('fetch', fetchMock);
    const provider = new OpenAIProvider({ apiKey: 'test-key', model: 'gpt-4o' });

    await expect(provider.sendMessage('unstamped')).rejects.toThrow('not prepared');
    await expect(provider.sendMessage('foreign stamp', { preparationStamp: {} as never })).rejects.toThrow('not prepared');
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
