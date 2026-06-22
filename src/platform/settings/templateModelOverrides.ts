import type { TemplateProviderId } from '@/platform/types/workflow';

export interface TemplateModelOverride {
  provider: TemplateProviderId;
  model: string;
}

/**
 * Settings-store key used to persist the map of per-template overrides.
 *
 * Shape on disk:
 *   `{ [templateId]: { provider: 'claude', model: 'claude-sonnet-4-6' } }`
 */
export const TEMPLATE_MODEL_OVERRIDES_KEY = 'templateModelOverrides';

const TEMPLATE_PROVIDER_IDS = ['claude', 'openai', 'gemini', 'ollama'] as const;

function isTemplateProviderId(value: unknown): value is TemplateProviderId {
  return (
    typeof value === 'string' &&
    (TEMPLATE_PROVIDER_IDS as readonly string[]).includes(value)
  );
}

export function isTemplateModelOverride(value: unknown): value is TemplateModelOverride {
  return (
    typeof value === 'object' &&
    value !== null &&
    !Array.isArray(value) &&
    isTemplateProviderId((value as { provider?: unknown }).provider) &&
    typeof (value as { model?: unknown }).model === 'string' &&
    (value as { model: string }).model.trim().length > 0
  );
}

export function sanitizeTemplateModelOverrides(
  value: unknown,
): Record<string, TemplateModelOverride> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const cleaned: Record<string, TemplateModelOverride> = {};
  for (const [templateId, override] of Object.entries(value)) {
    if (templateId.length > 0 && isTemplateModelOverride(override)) {
      cleaned[templateId] = override;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
