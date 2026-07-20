/**
 * Stream D-web Group III · Task 3.4
 *
 * Demo-mode AI provider override.
 *
 * Two modes:
 *   1. BYOK — the user pasted their own Anthropic key into the BYOK input
 *      (Group V). We instantiate the existing ClaudeProvider directly. The
 *      key never leaves the browser; requests go straight to api.anthropic.com.
 *   2. Shared — no BYOK key. We instantiate a thin DemoProxyProvider that
 *      POSTs to `/api/demo-chat`, routed by Caddy to the on-server Bun proxy
 *      (`~/services/lantern-demo-proxy`). The proxy enforces rate limits,
 *      monthly spend caps, and uses Lantern's shared Anthropic key.
 *
 * Limit-hit detection: when the proxy returns 429 (rate-limited) or 503/502
 * (budget exhausted / upstream failure), the provider dispatches a
 * `lantern:demo-limit-hit` window event with `{ reason }`. Group IV's
 * DemoLimitGate listens for this event and opens the DemoExitModal.
 *
 * No toasts are imported from the rest of the app: the demo bundle is the
 * minimum surface and we want zero coupling to non-demo code paths beyond
 * the Provider interface contract.
 */

import { ClaudeProvider } from '@/platform/providers/ClaudeProvider';
import type {
  Provider,
  ProviderResponse,
  ProviderMetadata,
  SendOptions,
  StructuredOutputOptions,
  ProviderContentBlock,
} from '@/platform/providers/Provider';
import type { ChatAttachment } from '@/platform/types/ai';
import { getDemoSessionToken, resetDemoSessionToken } from './demoSessionToken';
import { EV_DEMO_LIMIT_HIT, EV_DEMO_MESSAGE_SENT } from '@/config/identity';
import { brandText } from '@/config/brandText';
import { BRAND } from '@/config/brand';

const BYOK_STORAGE_KEY = 'byokKey';
const DEMO_PROXY_PATH = '/api/demo-chat';
const DEMO_LIMIT_EVENT = EV_DEMO_LIMIT_HIT;
const DEMO_MESSAGE_SENT_EVENT = EV_DEMO_MESSAGE_SENT;

/** Reasons surfaced to Group IV's DemoLimitGate via the window event. */
export type DemoLimitReason =
  | 'rate-limited'
  | 'budget-exhausted'
  | 'session-quota'
  | 'proxy-error'
  | 'invalid-token';

export interface DemoLimitHitDetail {
  reason: DemoLimitReason;
  message: string;
  status?: number;
}

/**
 * Reads the BYOK key from localStorage. Returns null when no key is stored
 * or the key is empty / malformed-looking. The Group V BYOKKeyInput is
 * responsible for validating shape (`sk-ant-...`) before storing.
 */
function readByokKey(): string | null {
  try {
    const raw = localStorage.getItem(BYOK_STORAGE_KEY);
    if (!raw) return null;
    const trimmed = raw.trim();
    return trimmed.length > 0 ? trimmed : null;
  } catch {
    return null;
  }
}

/**
 * Whether the demo user has pasted a personal (BYOK) key. When true the demo
 * goes direct to Anthropic; when false it relays via the shared proxy. Exported
 * so the Ask egress audit can record the honest demo destination. Always false
 * outside demo mode (no BYOK key is ever stored there).
 */
export function hasDemoByokKey(): boolean {
  return readByokKey() !== null;
}

function emitLimitHit(detail: DemoLimitHitDetail): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent<DemoLimitHitDetail>(DEMO_LIMIT_EVENT, { detail }));
  } catch {
    // Older browsers: tolerate. The DemoExitModal is a backup; the user can
    // still see the inline error in the chat surface.
  }
}

function emitMessageSent(): void {
  if (typeof window === 'undefined') return;
  try {
    window.dispatchEvent(new CustomEvent(DEMO_MESSAGE_SENT_EVENT));
  } catch {
    // tolerate
  }
}

/**
 * Provider that forwards calls to the lantern-demo-proxy. Implements only
 * the methods AIChatViewer actually calls in the demo context: sendMessage,
 * a non-streaming structuredOutput, and the attachment shims.
 *
 * Streaming is intentionally not implemented in the demo: the proxy returns
 * non-streaming JSON to keep its surface small and to make rate-limit
 * accounting simpler. AIChatViewer falls back to the non-streaming path
 * automatically when `sendMessageStreaming` is undefined.
 */
class DemoProxyProvider implements Provider {
  private readonly proxyUrl: string;
  private readonly modelHint: string;

  constructor(opts: { proxyUrl?: string; modelHint?: string } = {}) {
    this.proxyUrl = opts.proxyUrl ?? DEMO_PROXY_PATH;
    this.modelHint = opts.modelHint ?? 'claude-sonnet-4-6';
  }

  getMetadata(): ProviderMetadata {
    return {
      name: brandText(`${BRAND.name} Demo (shared key)`),
      providerId: 'lantern-demo-proxy',
      model: this.modelHint,
      capabilities: { streaming: false, vision: false, functionCalling: false },
    };
  }

  isConfigured(): boolean {
    return true;
  }

  async sendMessage(prompt: string, options?: SendOptions): Promise<ProviderResponse> {
    const sessionToken = getDemoSessionToken();
    const body = {
      session_token: sessionToken,
      messages: [{ role: 'user', content: prompt }],
      ...(options?.systemPrompt ? { system: options.systemPrompt } : {}),
    };

    let response: Response;
    try {
      response = await fetch(this.proxyUrl, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify(body),
        ...(options?.signal ? { signal: options.signal } : {}),
      });
    } catch (err) {
      const message =
        err instanceof Error ? err.message : 'Could not reach the demo service.';
      emitLimitHit({ reason: 'proxy-error', message });
      throw new Error(`Demo service unreachable: ${message}`);
    }

    if (response.status === 401) {
      // Stale or rejected token: mint a fresh one so the next message has a
      // chance to succeed without a full page reload.
      resetDemoSessionToken();
      const message = 'Your demo session expired. Try again or paste your own API key.';
      emitLimitHit({ reason: 'invalid-token', message, status: 401 });
      throw new Error(message);
    }

    if (response.status === 429) {
      const json = await safeJson(response);
      const reason: DemoLimitReason = /per-session/i.test(json?.error ?? '')
        ? 'session-quota'
        : 'rate-limited';
      const message =
        'Demo limit reached. Paste your own API key or download the desktop app for unlimited use.';
      emitLimitHit({ reason, message, status: 429 });
      throw new Error(message);
    }

    if (response.status === 503) {
      const message =
        'The shared demo budget is spent for the month. Paste your own API key or download the desktop app for unlimited use.';
      emitLimitHit({ reason: 'budget-exhausted', message, status: 503 });
      throw new Error(message);
    }

    if (!response.ok) {
      const json = await safeJson(response);
      const detail = typeof json?.error === 'string' ? json.error : `HTTP ${String(response.status)}`;
      const message = `Demo service error: ${detail}.`;
      emitLimitHit({ reason: 'proxy-error', message, status: response.status });
      throw new Error(message);
    }

    const json = await safeJson(response);
    if (!json || json.ok !== true || typeof json.text !== 'string') {
      const message = 'Demo service returned an unexpected response.';
      emitLimitHit({ reason: 'proxy-error', message, status: response.status });
      throw new Error(message);
    }

    const inputTokens = typeof json.usage?.input_tokens === 'number' ? json.usage.input_tokens : 0;
    const outputTokens = typeof json.usage?.output_tokens === 'number' ? json.usage.output_tokens : 0;

    // Notify DemoLimitGate (Group IV) so it can advance the message counter.
    // Only the proxy path counts; BYOK is unlimited by design.
    emitMessageSent();

    return {
      content: json.text,
      usage: {
        inputTokens,
        outputTokens,
        totalTokens: inputTokens + outputTokens,
      },
      cost: 0, // The demo doesn't charge the user; cost lives on the proxy.
      model: typeof json.model === 'string' ? json.model : this.modelHint,
    };
  }

  async structuredOutput<T>(prompt: string, options: StructuredOutputOptions): Promise<T> {
    const opts: SendOptions = {};
    if (options.systemPrompt !== undefined) opts.systemPrompt = options.systemPrompt;
    if (options.temperature !== undefined) opts.temperature = options.temperature;
    if (options.maxTokens !== undefined) opts.maxTokens = options.maxTokens;
    const response = await this.sendMessage(prompt, opts);
    try {
      return JSON.parse(response.content) as T;
    } catch {
      throw new Error('Demo service did not return valid JSON.');
    }
  }

  formatAttachmentForRequest(_att: ChatAttachment, _bytes: Uint8Array): ProviderContentBlock {
    // The demo proxy is text-only. Attachments are rejected upstream by the
    // demo UI's send path; this placeholder satisfies the interface and is
    // never expected to run. Returning a benign text-extract block keeps the
    // type happy without leaking provider-specific shapes.
    return { _text_extract: { text: '', pageCount: 0, fileName: '' } };
  }

  supportsAttachment(_att: ChatAttachment, _model: string): boolean | string {
    return 'Attachments are not supported in the demo. Download the desktop app for full file support.';
  }
}

async function safeJson(response: Response): Promise<{
  ok?: boolean;
  text?: string;
  error?: string;
  model?: string;
  usage?: { input_tokens?: number; output_tokens?: number };
} | null> {
  try {
    return (await response.json()) as {
      ok?: boolean;
      text?: string;
      error?: string;
      model?: string;
      usage?: { input_tokens?: number; output_tokens?: number };
    };
  } catch {
    return null;
  }
}

/**
 * Demo provider factory. Wraps the existing ClaudeProvider when a BYOK key
 * is set, otherwise returns the proxy-backed DemoProxyProvider. Callers in
 * the demo build (AIChatViewer behind `IS_DEMO`) get a Provider they can use
 * exactly like any other.
 *
 * `model` is honored only in BYOK mode. The shared demo proxy ignores the
 * model field and uses whatever the proxy is configured with on the server
 * (`MODEL` env var, default `claude-sonnet-4-6`).
 */
export function createDemoProvider(opts: { model?: string } = {}): Provider {
  const byokKey = readByokKey();
  if (byokKey) {
    return new ClaudeProvider({
      apiKey: byokKey,
      ...(opts.model ? { model: opts.model } : {}),
    });
  }
  return new DemoProxyProvider({ ...(opts.model ? { modelHint: opts.model } : {}) });
}

/** Constants Group IV needs for its DemoLimitGate event listener. */
export const DEMO_LIMIT_HIT_EVENT = DEMO_LIMIT_EVENT;
export const DEMO_MESSAGE_SENT_EVENT_NAME = DEMO_MESSAGE_SENT_EVENT;
