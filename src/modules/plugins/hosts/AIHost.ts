// Plugin runner — AI host adapter (Wave 3).
//
// Plugins call `api.ai.invoke({ prompt, system? })`. The bridge enforces
// `ai:invoke` permission. This host:
//
//   1. Resolves the user's currently-configured Provider via a delegate.
//      The delegate is supplied by the PluginManager (Group VII), which
//      reads `defaultProvider` + `defaultModel` from `useSettingsStore`,
//      pulls the matching API key from `KeychainService`, and instantiates
//      the right `ClaudeProvider` / `OpenAIProvider` / `GeminiProvider` /
//      `OllamaProvider`. Plugins NEVER see the API key.
//   2. Calls `provider.sendMessage(prompt, { systemPrompt: system })` and
//      returns the text response (the `content` field of `ProviderResponse`).
//   3. Audits a `plugin_executed` event with prompt length, response length,
//      and the model id.
//
// We expose only `sendMessage` (no streaming) because the plugin API surface
// is non-streaming per spec §6.4. If the user's default provider doesn't have
// a key configured, the delegate returns null and we surface `not-found` so
// the plugin gets a clear failure.
//
// Spec: docs/superpowers/specs/2026-04-28-v2.0-mega-release-design.md §6.4
// Plan: docs/superpowers/plans/2026-05-03-stream-c3-plugin-runner.md (task 6.3)

import { AuditService } from '@/modules/audit/AuditService';
import type { Provider } from '@/modules/models/Provider';
import type { PluginAIInvokeOptions } from '@/types/plugin';

import type { PluginApiDispatchCall } from '../PluginAPIBridge';

/**
 * Returns a configured Provider, or null when no provider is currently
 * available (no default set, no API key in keychain, etc.). Async because
 * KeychainService.getKey is async.
 */
export type AIProviderAccessor = () => Promise<Provider | null>;

export class AIHostError extends Error {
  readonly code: 'invalid-args' | 'not-found' | 'internal';
  constructor(code: 'invalid-args' | 'not-found' | 'internal', message: string) {
    super(message);
    this.code = code;
    this.name = 'AIHostError';
  }
}

export interface AIHostOptions {
  /**
   * Returns the user's currently-configured Provider (with API key already
   * injected). Defaults to a stub that returns null so the host is safe to
   * construct before the manager wires the real accessor.
   */
  getProvider?: AIProviderAccessor;
  auditService?: AuditService;
}

export class AIHost {
  private getProvider: AIProviderAccessor;
  private readonly auditService: AuditService;

  constructor(options: AIHostOptions = {}) {
    this.getProvider = options.getProvider ?? (async () => null);
    this.auditService = options.auditService ?? new AuditService('plugins');
  }

  setProviderAccessor(accessor: AIProviderAccessor): void {
    this.getProvider = accessor;
  }

  handlesMethod(method: string): boolean {
    return method === 'ai.invoke';
  }

  async handle(call: PluginApiDispatchCall): Promise<unknown> {
    if (call.method !== 'ai.invoke') {
      throw new AIHostError('invalid-args', `AIHost cannot handle method ${call.method}`);
    }
    const opts = parseInvokeOptions(call.args[0]);
    const provider = await this.getProvider();
    if (!provider) {
      throw new AIHostError(
        'not-found',
        'no AI provider configured (set a default provider in Settings and add an API key)',
      );
    }
    const sendOpts: { systemPrompt?: string } = {};
    if (opts.system !== undefined) {
      sendOpts.systemPrompt = opts.system;
    }
    let response;
    try {
      response = await provider.sendMessage(opts.prompt, sendOpts);
    } catch (err) {
      const message = err instanceof Error ? err.message : 'AI provider call failed';
      throw new AIHostError('internal', message);
    }
    this.audit(call.pluginId, opts.prompt.length, response.content.length, response.model);
    return response.content;
  }

  private audit(pluginId: string, promptLength: number, responseLength: number, model: string): void {
    this.auditService.append({
      type: 'plugin_executed',
      timestamp: new Date().toISOString(),
      payload: {
        id: pluginId,
        command: `ai.invoke(${model}) prompt=${String(promptLength)} response=${String(responseLength)}`,
        durationMs: 0,
      },
    });
  }
}

function parseInvokeOptions(value: unknown): PluginAIInvokeOptions {
  if (!value || typeof value !== 'object') {
    throw new AIHostError('invalid-args', 'ai.invoke requires an options object');
  }
  const opts = value as { prompt?: unknown; system?: unknown };
  if (typeof opts.prompt !== 'string' || opts.prompt.length === 0) {
    throw new AIHostError('invalid-args', 'ai.invoke prompt must be a non-empty string');
  }
  if (opts.system !== undefined && typeof opts.system !== 'string') {
    throw new AIHostError('invalid-args', 'ai.invoke system must be a string when provided');
  }
  const out: PluginAIInvokeOptions = { prompt: opts.prompt };
  if (typeof opts.system === 'string') {
    out.system = opts.system;
  }
  return out;
}
