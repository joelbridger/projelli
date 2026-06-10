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

import type { TemplateProviderId, WorkflowTemplate } from '@/types/workflow';

export interface TemplateModelOverride {
  provider: TemplateProviderId;
  model: string;
}

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
  if (
    override &&
    typeof override.provider === 'string' &&
    typeof override.model === 'string' &&
    override.model.length > 0
  ) {
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

/**
 * Settings-store key used to persist the map of per-template overrides.
 *
 * Shape on disk:
 *   `{ [templateId]: { provider: 'claude', model: 'claude-sonnet-4-6' } }`
 */
export const TEMPLATE_MODEL_OVERRIDES_KEY = 'templateModelOverrides';

// ---------------------------------------------------------------------------
// F-106 / F-107 — Workflow provider resolution (pure function)
// ---------------------------------------------------------------------------

/**
 * Discriminated union for the result of resolveWorkflowProvider.
 *
 *   'ollama'           — run locally on Ollama (reachable, confirmed by caller)
 *   'cloud'            — run on a cloud provider (key present)
 *   'mock'             — run MockProvider (only in IS_TEST_MODE)
 *   'needs-provider'   — no key and not testMode; surface the blocking UI
 *   'ollama-unreachable' — template pinned to Ollama but ollamaReachable=false;
 *                          NEVER fall back to cloud
 */
export type WorkflowProviderResolution =
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
}

/**
 * Pure, synchronous workflow-provider resolution.
 *
 * The caller (handleStartWorkflow in App.tsx) is responsible for:
 *   1. Calling resolveTemplateModel() to get pickedProvider + pickedModel.
 *   2. Calling detectOllama() when pickedProvider === 'ollama' and passing
 *      the result as ollamaReachable.
 *   3. Acting on the returned discriminated union.
 *
 * Safety invariants (see test suite for regression coverage):
 *   • ollama + !ollamaReachable  → 'ollama-unreachable'   (NEVER 'cloud')
 *   • no key + !isTestMode       → 'needs-provider'        (NEVER 'mock')
 *   • no key + isTestMode        → 'mock'
 *   • cloud pin / default        → 'cloud'
 */
export function resolveWorkflowProvider(
  input: ResolveWorkflowProviderInput,
): WorkflowProviderResolution {
  const { pickedProvider, pickedModel, anthropicKey, openaiKey, googleKey, ollamaReachable, isTestMode } = input;

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
  // Fallback: picked provider had no key, try any available cloud key.
  if (anthropicKey) {
    return { kind: 'cloud', provider: 'claude', model: pickedModel, key: anthropicKey };
  }
  if (openaiKey) {
    return { kind: 'cloud', provider: 'openai', model: pickedModel, key: openaiKey };
  }
  if (googleKey) {
    return { kind: 'cloud', provider: 'gemini', model: pickedModel, key: googleKey };
  }

  // No cloud key available.
  if (isTestMode) {
    // MockProvider is ONLY permitted under testMode so E2E / sweep suites work.
    return { kind: 'mock' };
  }

  // No usable provider at all — surface the blocking "needs-provider" UI.
  return { kind: 'needs-provider' };
}
