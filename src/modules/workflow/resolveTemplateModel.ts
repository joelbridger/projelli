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
