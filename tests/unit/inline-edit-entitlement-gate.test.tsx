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

function makeArgs() {
  const sendMessageStreaming = vi.fn(async () => ({ content: 'edited' }));
  const provider = {
    sendMessageStreaming,
    getMetadata: () => ({ name: 'Test', providerId: 'test', model: 'm' }),
  };
  const adapter = {
    getSelectedText: () => 'the selected text',
    getSelectionRange: () => ({ from: 0, to: 17 }),
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
});
