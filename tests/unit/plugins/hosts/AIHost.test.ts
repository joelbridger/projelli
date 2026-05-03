// Tests for AIHost.
//
// Coverage:
//  - happy path: ai.invoke calls provider.sendMessage and returns content
//  - system prompt is forwarded as systemPrompt
//  - throws not-found when no provider is configured
//  - throws invalid-args on missing / non-string prompt or non-string system
//  - provider.sendMessage rejection is wrapped as internal error
//  - audit event fires with prompt + response length and model id
//  - handlesMethod is true only for ai.invoke

import { describe, it, expect, vi, beforeEach } from 'vitest';

import { AuditService } from '@/modules/audit/AuditService';
import { AIHost, AIHostError } from '@/modules/plugins/hosts/AIHost';
import type {
  Provider,
  ProviderResponse,
  SendOptions,
  ProviderMetadata,
  ProviderContentBlock,
} from '@/modules/models/Provider';
import type { ChatAttachment } from '@/types/ai';

class FakeProvider implements Provider {
  lastPrompt: string | null = null;
  lastOptions: SendOptions | undefined = undefined;
  response: ProviderResponse = {
    content: 'fake response',
    usage: { inputTokens: 10, outputTokens: 5, totalTokens: 15 },
    cost: 0,
    model: 'claude-fake',
  };
  shouldThrow: Error | null = null;

  getMetadata(): ProviderMetadata {
    return { model: 'claude-fake' };
  }

  async sendMessage(prompt: string, options?: SendOptions): Promise<ProviderResponse> {
    if (this.shouldThrow) throw this.shouldThrow;
    this.lastPrompt = prompt;
    this.lastOptions = options;
    return this.response;
  }

  async structuredOutput<T>(): Promise<T> {
    throw new Error('not used');
  }

  formatAttachmentForRequest(_att: ChatAttachment, _bytes: Uint8Array): ProviderContentBlock {
    throw new Error('not used');
  }

  supportsAttachment(): boolean | string {
    return false;
  }
}

let provider: FakeProvider;
let audit: AuditService;
let host: AIHost;

beforeEach(() => {
  globalThis.localStorage.clear();
  provider = new FakeProvider();
  audit = new AuditService('test-plugins');
  host = new AIHost({
    getProvider: async () => provider,
    auditService: audit,
  });
});

describe('AIHost.handle', () => {
  it('calls provider.sendMessage and returns the text response', async () => {
    const result = await host.handle({
      pluginId: 'p',
      method: 'ai.invoke',
      args: [{ prompt: 'Hello' }],
    });
    expect(provider.lastPrompt).toBe('Hello');
    expect(result).toBe('fake response');
  });

  it('forwards system as systemPrompt', async () => {
    await host.handle({
      pluginId: 'p',
      method: 'ai.invoke',
      args: [{ prompt: 'Hi', system: 'You are helpful.' }],
    });
    expect(provider.lastOptions).toEqual({ systemPrompt: 'You are helpful.' });
  });

  it('throws not-found when no provider is configured', async () => {
    const noopHost = new AIHost({
      getProvider: async () => null,
      auditService: audit,
    });
    await expect(
      noopHost.handle({ pluginId: 'p', method: 'ai.invoke', args: [{ prompt: 'x' }] }),
    ).rejects.toMatchObject({ code: 'not-found' });
  });

  it('throws invalid-args on missing / empty / non-string prompt', async () => {
    await expect(
      host.handle({ pluginId: 'p', method: 'ai.invoke', args: [{}] }),
    ).rejects.toThrow(AIHostError);
    await expect(
      host.handle({ pluginId: 'p', method: 'ai.invoke', args: [{ prompt: '' }] }),
    ).rejects.toThrow(AIHostError);
    await expect(
      host.handle({ pluginId: 'p', method: 'ai.invoke', args: [{ prompt: 42 }] }),
    ).rejects.toThrow(AIHostError);
  });

  it('throws invalid-args when system is provided but not a string', async () => {
    await expect(
      host.handle({
        pluginId: 'p',
        method: 'ai.invoke',
        args: [{ prompt: 'x', system: 42 }],
      }),
    ).rejects.toThrow(AIHostError);
  });

  it('throws invalid-args when args[0] is not an object', async () => {
    await expect(
      host.handle({ pluginId: 'p', method: 'ai.invoke', args: ['not-an-object'] }),
    ).rejects.toThrow(AIHostError);
  });

  it('wraps provider errors as internal errors', async () => {
    provider.shouldThrow = new Error('rate limited');
    await expect(
      host.handle({ pluginId: 'p', method: 'ai.invoke', args: [{ prompt: 'x' }] }),
    ).rejects.toMatchObject({ code: 'internal', message: 'rate limited' });
  });

  it('audits the call with prompt + response length and model id', async () => {
    const appendSpy = vi.spyOn(audit, 'append');
    await host.handle({
      pluginId: 'translator',
      method: 'ai.invoke',
      args: [{ prompt: 'translate me' }],
    });
    expect(appendSpy).toHaveBeenCalledTimes(1);
    const event = appendSpy.mock.calls[0]?.[0];
    expect(event?.type).toBe('plugin_executed');
    if (event?.type === 'plugin_executed') {
      expect(event.payload.id).toBe('translator');
      expect(event.payload.command).toContain('claude-fake');
      expect(event.payload.command).toContain('prompt=12');
      expect(event.payload.command).toContain('response=13');
    }
  });

  it('throws on unknown methods', async () => {
    await expect(
      host.handle({ pluginId: 'p', method: 'ai.complete', args: [] }),
    ).rejects.toThrow(AIHostError);
  });
});

describe('AIHost.handlesMethod', () => {
  it('returns true only for ai.invoke', () => {
    expect(host.handlesMethod('ai.invoke')).toBe(true);
    expect(host.handlesMethod('ai.complete')).toBe(false);
    expect(host.handlesMethod('network.fetch')).toBe(false);
  });
});

describe('AIHost.setProviderAccessor', () => {
  it('swaps the provider accessor at runtime', async () => {
    const other = new FakeProvider();
    other.response = { ...provider.response, content: 'other' };
    host.setProviderAccessor(async () => other);
    const result = await host.handle({
      pluginId: 'p',
      method: 'ai.invoke',
      args: [{ prompt: 'x' }],
    });
    expect(result).toBe('other');
  });
});
