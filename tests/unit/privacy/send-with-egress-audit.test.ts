import { describe, expect, it, vi, beforeEach } from 'vitest';

const localOnlyMocks = vi.hoisted(() => {
  const order: string[] = [];
  return {
    order,
    assertLocalOnlyAllowsSend: vi.fn(() => {
      order.push('privacy-check');
    }),
  };
});

vi.mock('@/platform/privacy/localOnlyGuard', () => ({
  assertLocalOnlyAllowsSend: localOnlyMocks.assertLocalOnlyAllowsSend,
}));

import { sendWithEgressAudit } from '@/platform/privacy/sendWithEgressAudit';
import type { Provider } from '@/platform/providers/Provider';

describe('sendWithEgressAudit', () => {
  beforeEach(() => {
    localOnlyMocks.order.length = 0;
    localOnlyMocks.assertLocalOnlyAllowsSend.mockClear();
  });

  it('checks the privacy mode, audits egress, sends, then audits the model call', async () => {
    const provider = {
      getMetadata: () => ({
        id: 'fake',
        providerId: 'anthropic',
        name: 'Fake Claude',
        model: 'claude-test',
      }),
      sendMessage: vi.fn(async () => {
        localOnlyMocks.order.push('send');
        return {
          content: 'Safe answer',
          usage: { inputTokens: 10, outputTokens: 4, totalTokens: 14 },
          cost: 0.01,
          model: 'claude-test',
        };
      }),
    } as unknown as Provider;
    const auditLog: string[] = [];

    const response = await sendWithEgressAudit({
      provider,
      providerId: 'anthropic',
      model: 'claude-test',
      mode: 'direct',
      prompt: 'Summarize the client notes.',
      onAuditLog: (entry) => {
        auditLog.push(entry.action);
        localOnlyMocks.order.push(entry.action);
      },
      scope: { kind: 'matter', matterId: 'm-1' },
      modelCall: {
        description: 'Test model call',
        metadata: { feature: 'unit_test' },
      },
    });

    expect(response.content).toBe('Safe answer');
    expect(localOnlyMocks.assertLocalOnlyAllowsSend).toHaveBeenCalledWith('anthropic');
    expect(auditLog).toEqual(['egress', 'model_call']);
    expect(localOnlyMocks.order).toEqual(['privacy-check', 'egress', 'send', 'model_call']);
  });

  it('throws before audit or provider send when Local-only blocks the provider', async () => {
    const provider = {
      getMetadata: () => ({
        id: 'fake',
        providerId: 'anthropic',
        name: 'Fake Claude',
        model: 'claude-test',
      }),
      sendMessage: vi.fn(async () => {
        localOnlyMocks.order.push('send');
        return {
          content: 'should not send',
          usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
          cost: 0.01,
          model: 'claude-test',
        };
      }),
    } as unknown as Provider;
    const auditLog = vi.fn((entry: { action: string }) => {
      localOnlyMocks.order.push(entry.action);
    });
    localOnlyMocks.assertLocalOnlyAllowsSend.mockImplementationOnce(() => {
      localOnlyMocks.order.push('privacy-check');
      throw new Error('Local-only blocked anthropic');
    });

    await expect(sendWithEgressAudit({
      provider,
      providerId: 'anthropic',
      model: 'claude-test',
      mode: 'local-only',
      prompt: 'Summarize the client notes.',
      onAuditLog: auditLog,
      scope: { kind: 'matter', matterId: 'm-1' },
      modelCall: {
        description: 'Blocked model call',
      },
    })).rejects.toThrow('Local-only blocked anthropic');

    expect(auditLog).not.toHaveBeenCalled();
    expect(provider.sendMessage).not.toHaveBeenCalled();
    expect(localOnlyMocks.order).toEqual(['privacy-check']);
  });
});
