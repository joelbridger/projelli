import { describe, expect, it, vi } from 'vitest';
import type { Provider } from '@/platform/providers/Provider';
import {
  requireAuditSink,
  isDurableAuditUnavailableError,
  DurableAuditUnavailableError,
} from './durableAudit';
import { sendPreparedMessageWithEgressAudit } from '@/platform/privacy/promptPreparation';

describe('requireAuditSink — durable audit is a closed door (Ask-seam defect #4)', () => {
  it('throws when NO audit sink was supplied', () => {
    expect(() => {
      requireAuditSink(undefined);
    }).toThrow(DurableAuditUnavailableError);
  });

  it('passes (does not throw) when a sink is present', () => {
    expect(() => {
      requireAuditSink(() => undefined);
    }).not.toThrow();
  });

  it('exposes the failure via isDurableAuditUnavailableError', () => {
    try {
      requireAuditSink(undefined);
      throw new Error('should have thrown');
    } catch (error) {
      expect(isDurableAuditUnavailableError(error)).toBe(true);
    }
  });
});

describe('send seam blocks egress when the durable intent cannot be written (defect #4)', () => {
  it('does NOT call the provider when beforeEgress (durable intent) fails closed', async () => {
    const sendMessage = vi.fn(() =>
      Promise.resolve({
        content: 'ok',
        usage: { inputTokens: 1, outputTokens: 1, totalTokens: 2 },
        cost: 0,
        model: 'gpt-test',
      }),
    );
    const provider = {
      getMetadata: () => ({ model: 'gpt-test' }),
      sendMessage,
    } as unknown as Provider;

    // beforeEgress is Ask's durable-intent door. With no audit sink it must
    // reject (via requireAuditSink) and the provider must never be reached.
    await expect(
      sendPreparedMessageWithEgressAudit({
        provider,
        providerId: 'openai',
        surface: 'ask',
        prompt: 'What is the client retirement target?',
        beforeEgress: () => {
          requireAuditSink(undefined);
        },
      }),
    ).rejects.toSatisfy(isDurableAuditUnavailableError);

    expect(sendMessage).not.toHaveBeenCalled();
  });
});
