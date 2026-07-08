/**
 * Stream A4 — per-provider, per-model context window limits.
 *
 * Rules:
 * - Claude: Sonnet 4 and 3.5 / 3 are 200K on Tier 1; 1M requires Tier 2+.
 *   We report 200K as the safe default. The model picker shows the Tier 2+
 *   label so advanced users know to upgrade.
 * - Gemini: 1.5 Pro and any 2.x model support 1M natively.
 * - OpenAI: gpt-4o and o-series models cap at 128K. o1 / o3 cap at 200K.
 * - Ollama: context is model-dependent. We use 8192 as a conservative
 *   default for unknown models and define overrides for common names.
 */

export interface ContextLimitInfo {
  /** Hard maximum for the provider + model combination. */
  maxTokens: number;
  /**
   * If set, this message is shown in the model picker below the model name
   * and in the settings inline warning. Indicates a prerequisite (e.g.
   * "Tier 2+ API key required for 1M context").
   */
  tier2Warning?: string;
}

// Provider-level fallbacks used when the exact model name is not in the map.
const PROVIDER_FALLBACKS: Record<string, number> = {
  anthropic: 200000,
  openai: 128000,
  gemini: 1000000,
  ollama: 8192,
  // Embedded Lantern Local AI engine. The Rust side pins the actual context
  // window via llama.cpp's --ctx-size; this fallback is for UI/metadata only.
  'lantern-local': 16384,
};

// Exact-match overrides. Match is attempted first; if no exact match, the
// provider fallback is used. Model IDs should be the runtime values
// (e.g. 'claude-sonnet-4-5-20250514', 'gpt-4o', 'gemini-1.5-pro').
const MODEL_OVERRIDES: Record<string, ContextLimitInfo> = {
  // Claude - Tier 1 (200K)
  'claude-3-haiku-20240307': { maxTokens: 200000 },
  'claude-3-sonnet-20240229': { maxTokens: 200000 },
  'claude-3-opus-20240229': { maxTokens: 200000 },
  'claude-3-5-sonnet-20241022': { maxTokens: 200000 },
  'claude-3-5-haiku-20241022': { maxTokens: 200000 },
  'claude-3-5-haiku-latest': { maxTokens: 200000 },
  'claude-haiku-4-5-20251001': { maxTokens: 200000 },
  'claude-sonnet-4-5-20250514': { maxTokens: 200000 },
  'claude-sonnet-4-20250514': { maxTokens: 200000 },
  'claude-opus-4-20250514': { maxTokens: 200000 },
  'claude-sonnet-4-6': { maxTokens: 200000 },
  'claude-opus-4-6': { maxTokens: 200000 },
  // Claude Sonnet Tier 2+ (1M) — shown with warning
  'claude-sonnet-4-5-20250514-1m': {
    maxTokens: 1000000,
    tier2Warning: 'Requires Anthropic API Tier 2+ for 1M context',
  },
  // Gemini - 1M native
  'gemini-1.5-pro': { maxTokens: 1000000 },
  'gemini-1.5-flash': { maxTokens: 1000000 },
  'gemini-2.0-flash': { maxTokens: 1000000 },
  'gemini-2.0-pro': { maxTokens: 1000000 },
  'gemini-2.5-flash': { maxTokens: 1000000 },
  // OpenAI - various limits
  'gpt-4': { maxTokens: 8192 },
  'gpt-4-32k': { maxTokens: 32768 },
  'gpt-4-turbo': { maxTokens: 128000 },
  'gpt-4o': { maxTokens: 128000 },
  'gpt-4o-mini': { maxTokens: 128000 },
  'gpt-3.5-turbo': { maxTokens: 16385 },
  'o1': { maxTokens: 200000 },
  'o1-mini': { maxTokens: 200000 },
  'o3': { maxTokens: 200000 },
  'o3-mini': { maxTokens: 200000 },
  // Ollama common models
  'llama3': { maxTokens: 8192 },
  'llama3:8b': { maxTokens: 8192 },
  'llama3:70b': { maxTokens: 8192 },
  'llama3.1': { maxTokens: 131072 },
  'llama3.1:8b': { maxTokens: 131072 },
  'mistral': { maxTokens: 32768 },
  'mixtral': { maxTokens: 65536 },
  'codellama': { maxTokens: 16384 },
  'phi3': { maxTokens: 131072 },
  'gemma2': { maxTokens: 8192 },
  // Newer small models on the local-model shortlist (2026 research). Values are
  // each model's trained maximum; the OllamaProvider clamps the *requested*
  // window down to a memory-safe working size, so the exact ceiling here only
  // needs to be large enough not to under-cap the RAG context window.
  'llama3.2': { maxTokens: 131072 },
  'llama3.2:1b': { maxTokens: 131072 },
  'llama3.2:3b': { maxTokens: 131072 },
  'qwen2.5': { maxTokens: 131072 },
  'qwen2.5:7b': { maxTokens: 131072 },
  'qwen2.5:3b': { maxTokens: 32768 },
  'qwen3': { maxTokens: 262144 },
  'qwen3:4b': { maxTokens: 262144 },
  'qwen3:8b': { maxTokens: 131072 },
  'granite3.2': { maxTokens: 131072 },
  'granite3.2:8b': { maxTokens: 131072 },
  'granite3.3': { maxTokens: 131072 },
  'granite3.3:8b': { maxTokens: 131072 },
  'gemma3': { maxTokens: 131072 },
  'gemma3:4b': { maxTokens: 131072 },
  'gemma3:1b': { maxTokens: 32768 },
  'phi4-mini': { maxTokens: 131072 },
  // Embedded Lantern Local AI default model (Qwen3-4B-Instruct-2507).
  'qwen3-4b-instruct-2507': { maxTokens: 262144 },
};

/**
 * Returns the maximum context-window size for a provider + model pair.
 * Falls back to the provider default if the exact model ID is not found.
 */
export function getMaxContextTokens(provider: string, model: string): number {
  return MODEL_OVERRIDES[model]?.maxTokens ?? PROVIDER_FALLBACKS[provider] ?? 8192;
}

/**
 * Returns the Tier 2+ warning string for this model, or null if none.
 * Used by the model picker to show an inline note and by the settings
 * panel inline warning.
 */
export function getTier2Warning(provider: string, model: string): string | null {
  void provider; // provider param reserved for future per-provider warnings
  return MODEL_OVERRIDES[model]?.tier2Warning ?? null;
}

/**
 * Returns true if the given context limit exceeds what the provider + model
 * can actually handle.
 */
export function isLimitExceedingCapability(
  provider: string,
  model: string,
  limitTokens: number
): boolean {
  return limitTokens > getMaxContextTokens(provider, model);
}

/**
 * Given a token count, returns the human-readable label for a context size.
 * E.g. 200000 -> "200K", 1000000 -> "1M".
 */
export function formatContextSize(tokens: number): string {
  if (tokens >= 1_000_000) return `${tokens / 1_000_000}M`;
  if (tokens >= 1_000) return `${Math.round(tokens / 1_000)}K`;
  return String(tokens);
}
