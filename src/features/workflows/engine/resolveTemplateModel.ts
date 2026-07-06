/**
 * Q8 — Per-template model resolution.
 *
 * Given a template plus the user's global default plus the settings-store
 * override map, pick the provider+model that should run the workflow.
 *
 * Priority order (highest first):
 *   1. Per-template override from settings (`templateModelOverrides[templateId]`)
 *   2. Template's own `defaultProvider` + `defaultModel`
 *   3. Global fallback supplied by the caller (user's chat default)
 *
 * The user can still override at run time via the existing model picker --
 * that override happens upstream of this helper, so this code path is only
 * consulted when no explicit run-time pick exists.
 */

import type { TemplateProviderId, WorkflowTemplate } from '@/platform/types/workflow';
export {
  TEMPLATE_MODEL_OVERRIDES_KEY,
  type TemplateModelOverride,
} from '@/platform/settings/templateModelOverrides';
import {
  isTemplateModelOverride,
  type TemplateModelOverride,
} from '@/platform/settings/templateModelOverrides';

export interface TemplateModelResolution {
  provider: TemplateProviderId;
  model: string;
  /** Where the decision came from -- useful for debugging/testing. */
  source: 'override' | 'template' | 'global';
}

export interface ResolveTemplateModelInput {
  /** The template about to be executed. */
  template: Pick<WorkflowTemplate, 'id' | 'defaultProvider' | 'defaultModel'>;
  /** Settings-store override map keyed by template id. */
  overrides: Record<string, TemplateModelOverride> | undefined;
  /** Fallback used when neither override nor template has values set. */
  globalDefault: TemplateModelOverride;
}

/**
 * Resolve the provider+model to use for a template.
 */
export function resolveTemplateModel(
  input: ResolveTemplateModelInput
): TemplateModelResolution {
  const { template, overrides, globalDefault } = input;

  const override = overrides?.[template.id];
  if (isTemplateModelOverride(override)) {
    return { provider: override.provider, model: override.model, source: 'override' };
  }

  if (template.defaultProvider && template.defaultModel) {
    return {
      provider: template.defaultProvider,
      model: template.defaultModel,
      source: 'template',
    };
  }

  return {
    provider: globalDefault.provider,
    model: globalDefault.model,
    source: 'global',
  };
}

// ---------------------------------------------------------------------------
// F-106 / F-107 — Workflow provider resolution (pure function)
// ---------------------------------------------------------------------------

/**
 * Discriminated union for the result of resolveWorkflowProvider.
 *
 *   'lantern-local'   — run on the embedded Advisor Prep Hero Local AI (on-device,
 *                        downloaded + ready). Preferred local engine in private
 *                        mode — needs no separate Ollama daemon.
 *   'ollama'           — run locally on Ollama (reachable, confirmed by caller)
 *   'cloud'            — run on a cloud provider (key present)
 *   'mock'             — run MockProvider (only in IS_TEST_MODE)
 *   'needs-provider'   — no key and not testMode; surface the blocking UI
 *   'ollama-unreachable' — local-only/ollama-pinned but no local engine is
 *                          available (no embedded model AND Ollama unreachable);
 *                          NEVER fall back to cloud
 */
export type WorkflowProviderResolution =
  | { kind: 'lantern-local'; model: string | undefined }
  | { kind: 'ollama'; model: string | undefined }
  | { kind: 'cloud'; provider: 'claude' | 'openai' | 'gemini'; model: string | undefined; key: string }
  | { kind: 'mock' }
  | { kind: 'needs-provider' }
  | { kind: 'ollama-unreachable' };

export interface ResolveWorkflowProviderInput {
  /** Already-resolved provider+model (output of resolveTemplateModel). */
  pickedProvider: TemplateProviderId;
  pickedModel: string | undefined;
  /** Available API keys — undefined means the user has not configured that provider. */
  anthropicKey: string | undefined;
  openaiKey: string | undefined;
  googleKey: string | undefined;
  /** Whether Ollama is currently reachable (caller does the async probe and passes result). */
  ollamaReachable: boolean;
  /** True only in test/E2E mode — permits MockProvider when no real key exists. */
  isTestMode: boolean;
  /**
   * F-502 — true when the confidentiality mode restricts inference to local
   * models (modeRestrictsToLocal). In this mode resolution NEVER yields
   * 'cloud' or 'mock', regardless of keys or testMode.
   */
  localOnly: boolean;
  /**
   * F-502 — installed Ollama tags (detectOllama().models). Used in local-only
   * mode to land a cloud pin/default on the first installed model. Empty when
   * none are installed or the probe was skipped.
   */
  installedOllamaModels: string[];
  /**
   * F-503 — true when the embedded Advisor Prep Hero Local AI model is downloaded and
   * READY (caller probes localLlmModelStatus()). In local-only mode this on-
   * device engine is preferred over Ollama — it needs no separate daemon, so a
   * machine with the embedded model but no Ollama still runs private workflows.
   * Mirrors how Ask / Chat / Client Map already resolve the local provider.
   */
  localModelReady: boolean;
}

/**
 * Pure, synchronous workflow-provider resolution.
 *
 * The caller (handleStartWorkflow in App.tsx) is responsible for:
 *   1. Calling resolveTemplateModel() to get pickedProvider + pickedModel.
 *   2. Calling detectOllama() when pickedProvider === 'ollama' OR the
 *      confidentiality mode is local-only, passing the result as
 *      ollamaReachable + installedOllamaModels.
 *   3. Acting on the returned discriminated union.
 *
 * Safety invariants (see test suite for regression coverage):
 *   • localOnly                  → 'ollama' | 'ollama-unreachable' ONLY
 *                                   (NEVER 'cloud', NEVER 'mock')
 *   • ollama + !ollamaReachable  → 'ollama-unreachable'   (NEVER 'cloud')
 *   • no key + !isTestMode       → 'needs-provider'        (NEVER 'mock')
 *   • no key + isTestMode        → 'mock'
 *   • cloud pin / default        → 'cloud'
 */
export function resolveWorkflowProvider(
  input: ResolveWorkflowProviderInput,
): WorkflowProviderResolution {
  const {
    pickedProvider,
    pickedModel,
    anthropicKey,
    openaiKey,
    googleKey,
    ollamaReachable,
    isTestMode,
    localOnly,
    installedOllamaModels,
    localModelReady,
  } = input;

  // F-502 / F-503 — Local-only confidentiality mode: workflows run ON DEVICE,
  // full stop. NEVER 'cloud' and NEVER 'mock' in this mode — the mode is a
  // confidentiality promise, not a preference.
  //
  // WHICH local engine: the embedded Advisor Prep Hero Local AI is preferred when it is
  // downloaded + ready (F-503) — it needs no separate daemon, so a machine with
  // the embedded model but no Ollama still runs private workflows. This mirrors
  // how Ask / Chat / Client Map already resolve the local provider. Only when no
  // embedded model is ready do we fall back to the user's Ollama daemon: a cloud
  // pin/default is overridden to the first installed Ollama model; an explicit
  // ollama pin keeps its model. If neither local engine is available, block
  // honestly with 'ollama-unreachable' (never cloud).
  if (localOnly) {
    if (localModelReady) {
      // Embedded model serves whichever GGUF is loaded; the model id is
      // cosmetic, so leave it undefined and let the provider use its default.
      return { kind: 'lantern-local', model: undefined };
    }
    if (!ollamaReachable) {
      return { kind: 'ollama-unreachable' };
    }
    const model =
      pickedProvider === 'ollama' && pickedModel
        ? pickedModel
        : installedOllamaModels[0];
    return { kind: 'ollama', model };
  }

  // Ollama branch — the template is pinned to local inference.
  if (pickedProvider === 'ollama') {
    if (!ollamaReachable) {
      // SAFETY INVARIANT: never fall back to a cloud key for a locally-pinned
      // template. Surface the unreachable error instead.
      return { kind: 'ollama-unreachable' };
    }
    return { kind: 'ollama', model: pickedModel };
  }

  // Cloud provider assignment — prefer the pinned provider's key, then fall
  // back to any available key, mirroring the pre-3.0 behaviour exactly.
  if (pickedProvider === 'claude' && anthropicKey) {
    return { kind: 'cloud', provider: 'claude', model: pickedModel, key: anthropicKey };
  }
  if (pickedProvider === 'openai' && openaiKey) {
    return { kind: 'cloud', provider: 'openai', model: pickedModel, key: openaiKey };
  }
  if (pickedProvider === 'gemini' && googleKey) {
    return { kind: 'cloud', provider: 'gemini', model: pickedModel, key: googleKey };
  }
  // Fallback: the picked provider has no key — use any available cloud key, but
  // DROP `pickedModel` (BUG-025). The picked model belongs to the pinned
  // provider (e.g. "gemini-1.5-pro"); carrying it onto a different provider
  // (Claude/OpenAI) sends a model that provider doesn't have and fails or routes
  // wrong. `undefined` lets the fallback provider use its own default model.
  // (Whether an explicit pin should instead BLOCK with needs-provider is a
  // product decision flagged for review; this fix stops the broken send.)
  if (anthropicKey) {
    return { kind: 'cloud', provider: 'claude', model: undefined, key: anthropicKey };
  }
  if (openaiKey) {
    return { kind: 'cloud', provider: 'openai', model: undefined, key: openaiKey };
  }
  if (googleKey) {
    return { kind: 'cloud', provider: 'gemini', model: undefined, key: googleKey };
  }

  // No cloud key available.
  if (isTestMode) {
    // MockProvider is ONLY permitted under testMode so E2E / sweep suites work.
    return { kind: 'mock' };
  }

  // No usable provider at all — surface the blocking "needs-provider" UI.
  return { kind: 'needs-provider' };
}
