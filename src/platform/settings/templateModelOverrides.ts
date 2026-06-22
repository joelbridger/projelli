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

export function sanitizeTemplateModelOverrides(
  value: unknown,
): Record<string, TemplateModelOverride> | undefined {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    return undefined;
  }

  const cleaned: Record<string, TemplateModelOverride> = {};
  for (const [templateId, override] of Object.entries(value)) {
    if (
      typeof templateId === 'string' &&
      templateId.length > 0 &&
      typeof override === 'object' &&
      override !== null &&
      !Array.isArray(override) &&
      typeof (override as { provider?: unknown }).provider === 'string' &&
      typeof (override as { model?: unknown }).model === 'string' &&
      (override as { model: string }).model.length > 0
    ) {
      cleaned[templateId] = override as TemplateModelOverride;
    }
  }

  return Object.keys(cleaned).length > 0 ? cleaned : undefined;
}
