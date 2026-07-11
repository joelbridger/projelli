/**
 * Licensing audit — inline AI editing is a PAID AI feature and must be gated by
 * the same entitlement (useTrialGate) as chat / workflows / Word redline.
 * Regression: when AI is locked (lapsed/expired license), submitInstruction must
 * NOT call the AI provider. Data access is never gated — only the AI call.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { renderHook, act } from '@testing-library/react';

const gate = vi.hoisted(() => ({ isLocked: false }));
vi.mock('@/platform/hooks/useTrial', () => ({
  useTrialGate: () => ({
    isLocked: gate.isLocked,
    daysRemaining: 0,
    isTrialExpired: gate.isLocked,
    isActivated: !gate.isLocked,
    trialDays: 14,
  }),
}));

import { useInlineAiEdit } from '@/features/documents/editor/useInlineAiEdit';
import { setPromptDecisionBroker } from '@/platform/privacy/promptPreparation';

function makeArgs(selectedText = 'the selected text') {
  const sendMessageStreaming = vi.fn(async () => ({ content: 'edited' }));
  const provider = {
    sendMessageStreaming,
    getMetadata: () => ({ name: 'Test', providerId: 'test', model: 'm' }),
  };
  const adapter = {
    getSelectedText: () => selectedText,
    getSelectionRange: () => ({ from: 0, to: selectedText.length }),
    replaceRange: vi.fn(),
    coordsAtPos: () => ({ x: 0, y: 0 }),
    getDocText: () => 'the selected text and more',
    getDomNode: () => null,
    filePath: '/ws/note.md',
  };
  return {
    sendMessageStreaming,
    args: {
      adapter,
      getProvider: () => provider as never,
      formatHint: 'markdown' as const,
      docVersion: 0,
    },
  };
}

describe('inline AI edit — entitlement gate', () => {
  beforeEach(() => {
    gate.isLocked = false;
  });

  it('does NOT call the AI provider when AI is locked (lapsed license)', async () => {
    gate.isLocked = true;
    const { sendMessageStreaming, args } = makeArgs();
    const { result } = renderHook(() => useInlineAiEdit(args));

    await act(async () => {
      await result.current.handlers.submitInstruction('make it formal');
    });

    expect(sendMessageStreaming).not.toHaveBeenCalled();
  });

  it('calls the AI provider when AI is NOT locked (active license)', async () => {
    gate.isLocked = false;
    const { sendMessageStreaming, args } = makeArgs();
    const { result } = renderHook(() => useInlineAiEdit(args));

    await act(async () => {
      await result.current.handlers.submitInstruction('make it formal');
    });

    expect(sendMessageStreaming).toHaveBeenCalledTimes(1);
  });

  it('sends a redacted copy when the selected text contains a private link', async () => {
    const secret = 'Open https://example.test/i/abc#intake-secret';
    const { sendMessageStreaming, args } = makeArgs(secret);
    setPromptDecisionBroker(() => Promise.resolve('send_redacted_copy'));
    try {
      const { result } = renderHook(() => useInlineAiEdit(args));
      await act(async () => {
        await result.current.handlers.submitInstruction('make it formal');
      });

      expect(sendMessageStreaming).toHaveBeenCalledTimes(1);
      const [, options] = sendMessageStreaming.mock.calls[0] as unknown as [string, { systemPrompt?: string }];
      expect(options.systemPrompt).not.toContain('intake-secret');
    } finally {
      setPromptDecisionBroker();
    }
  });
});
