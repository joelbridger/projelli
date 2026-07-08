// Shared provider factory.
//
// The AI chat (AIChatViewer) and the AI redliner (DocxEditor) both need to
// instantiate the right Provider from a `(provider, model, apiKey)` triple.
// This centralizes that switch so the two surfaces can't drift on construction.
// BYOK is honored exactly as the rest of the app does it: the key is the user's
// own, and each provider talks DIRECTLY to its vendor API (no Lantern server).

import type { Provider } from './Provider';
import { ClaudeProvider } from './ClaudeProvider';
import { OpenAIProvider } from './OpenAIProvider';
import { GeminiProvider } from './GeminiProvider';
import { OllamaProvider, OLLAMA_DEFAULT_MODEL } from './OllamaProvider';
import { AppLocalProvider, LANTERN_LOCAL_DEFAULT_MODEL } from './AppLocalProvider';
import {
  getDefaultModelForTier,
  type Provider as CloudProviderId,
} from '@/platform/utils/defaultModel';
import type { AssuredRoute } from '@/platform/firm/assuredInference';

/**
 * The provider ids the chat surfaces use.
 *
 * `'lantern-local'` (the embedded llama.cpp engine) and `'ollama'` (a user-run
 * Ollama daemon at 127.0.0.1:11434) are the LOCAL providers — inference runs on
 * the user's own machine, nothing leaves the device, and they need no API key.
 * The other three are cloud providers reached BYOK (the user's own key, direct
 * to the vendor). Keeping them in one union here means every surface (chat,
 * redline) constructs the same provider for the same id and they can never
 * drift on which selection is local vs cloud.
 */
export type ChatProviderId = CloudProviderId | 'ollama' | 'lantern-local'; // 'anthropic' | 'openai' | 'google' | 'ollama' | 'lantern-local'

/** Default model for the embedded Lantern Local AI engine — defined in
 *  AppLocalProvider and re-exported here so factory callers/tests can
 *  import it from one place (mirrors OLLAMA_DEFAULT_MODEL). */
export { LANTERN_LOCAL_DEFAULT_MODEL };

/**
 * True when a provider id denotes a LOCAL (on-machine) model — either the
 * embedded Lantern Local AI engine (`'lantern-local'`) or a user-run Ollama
 * daemon (`'ollama'`). Both run inference on the user's machine; nothing leaves.
 */
export function isLocalProviderId(provider: ChatProviderId): boolean {
  return provider === 'ollama' || provider === 'lantern-local';
}

export interface CreateProviderOptions {
  provider: ChatProviderId;
  /**
   * The BYOK key for cloud providers. NOT required for `'ollama'` (local,
   * keyless) — pass `''` or omit. A cloud provider with an empty key will fail
   * at call time exactly as before.
   */
  apiKey?: string;
  /** Model id; falls back to the provider's default. */
  model?: string;
  /** Optional AI rules to prepend (chat surfaces pass workspace ai-rules.md). */
  aiRules?: string;
  /**
   * Firm "Assured" routing. When provided (assured mode active + a managed key
   * configured), the cloud provider routes through the firm zero-retention
   * proxy instead of BYOK-direct. Ignored for the local ('ollama') provider,
   * which never reaches the network. Undefined => BYOK-direct (default).
   */
  assured?: AssuredRoute;
}

/**
 * Construct a Provider for the given selection. Mirrors the switch in
 * AIChatViewer so all surfaces build providers identically. Throws on an
 * unsupported provider id rather than silently defaulting, so a typo is loud.
 *
 * CONFIDENTIALITY: `'ollama'` constructs the local provider — it can never
 * reach a cloud branch. There is no fallthrough from a local selection to a
 * cloud provider here.
 */
export function createProvider(opts: CreateProviderOptions): Provider {
  const rulesOpt = opts.aiRules ? { aiRules: opts.aiRules } : {};
  // Assured routing only applies to cloud providers; never to the local one.
  const assuredOpt = opts.assured ? { assured: opts.assured } : {};
  switch (opts.provider) {
    case 'ollama': {
      // Local, keyless. Talks to 127.0.0.1:11434. $0. Never assured-routed.
      const model = opts.model ?? OLLAMA_DEFAULT_MODEL;
      return new OllamaProvider({ model, ...rulesOpt });
    }
    case 'lantern-local': {
      // Embedded llama.cpp engine ("Lantern Local AI"). Local, keyless, $0,
      // never assured-routed. The Rust side owns the model download + sidecar
      // lifecycle; the provider streams from the local sidecar endpoint.
      const model = opts.model ?? LANTERN_LOCAL_DEFAULT_MODEL;
      return new AppLocalProvider({ model, ...rulesOpt });
    }
    case 'openai': {
      const model = opts.model ?? getDefaultModelForTier('openai', 'free');
      return new OpenAIProvider({ apiKey: opts.apiKey ?? '', model, ...rulesOpt, ...assuredOpt });
    }
    case 'google': {
      const model = opts.model ?? getDefaultModelForTier('google', 'free');
      return new GeminiProvider({ apiKey: opts.apiKey ?? '', model, ...rulesOpt, ...assuredOpt });
    }
    case 'anthropic': {
      const model = opts.model ?? getDefaultModelForTier('anthropic', 'free');
      return new ClaudeProvider({ apiKey: opts.apiKey ?? '', model, ...rulesOpt, ...assuredOpt });
    }
    default: {
      // Exhaustiveness guard — if a new provider id is added to the union,
      // TypeScript flags this as a compile error.
      const never: never = opts.provider;
      throw new Error(`Unsupported provider: ${String(never)}`);
    }
  }
}
