import { getDefaultModels } from '@/platform/providers/ModelListService';
import type { ProviderType } from '@/platform/providers/fetchUtils';
import type { TemplateProviderId } from '@/platform/types/workflow';

export type CloudProvider = ProviderType;

export type CloudProviderKeyPresence = Record<CloudProvider, boolean>;

export type CloudProviderKeyValues = Partial<Record<CloudProvider, string | null | undefined>>;

export interface CloudProviderSettingsDefaults {
  defaultProvider?: string;
  defaultModel?: string;
}

export interface PreferredCloudProviderResolution {
  provider: CloudProvider;
  model: string;
}

export interface ResolvePreferredCloudProviderInput {
  availableKeys: CloudProviderKeyPresence;
  settings?: CloudProviderSettingsDefaults;
  verifiedProviders?: Set<string>;
  invalidProviders?: Set<string>;
  providerOrder?: readonly CloudProvider[];
}

export const CLOUD_PROVIDER_ORDER: readonly CloudProvider[] = [
  'anthropic',
  'openai',
  'google',
];

const FALLBACK_CLOUD_MODEL: Record<CloudProvider, string> = {
  anthropic: 'claude-sonnet-4-6',
  openai: 'gpt-4o-mini',
  google: 'gemini-1.5-flash',
};

export function cloudKeyPresenceFromValues(
  values: CloudProviderKeyValues,
): CloudProviderKeyPresence {
  return {
    anthropic: Boolean(values.anthropic?.trim()),
    openai: Boolean(values.openai?.trim()),
    google: Boolean(values.google?.trim()),
  };
}

export function resolveCloudSettingsDefaults(
  storeProvider: unknown,
  storeModel: unknown,
  legacyProvider: unknown,
  legacyModel: unknown,
): CloudProviderSettingsDefaults {
  const clean = (value: unknown): string =>
    typeof value === 'string' ? value.trim() : '';
  return {
    defaultProvider: clean(storeProvider) || clean(legacyProvider),
    defaultModel: clean(storeModel) || clean(legacyModel),
  };
}

export function normalizeCloudProvider(value: string | undefined): CloudProvider | null {
  const provider = value?.trim();
  switch (provider) {
    case 'anthropic':
    case 'openai':
    case 'google':
      return provider;
    case 'claude':
      return 'anthropic';
    case 'gemini':
      return 'google';
    default:
      return null;
  }
}

export function toTemplateProviderId(provider: CloudProvider): TemplateProviderId {
  switch (provider) {
    case 'anthropic':
      return 'claude';
    case 'openai':
      return 'openai';
    case 'google':
      return 'gemini';
  }
}

export function getDefaultModelForCloudProvider(provider: CloudProvider): string {
  return getDefaultModels(provider)[0]?.id ?? FALLBACK_CLOUD_MODEL[provider];
}

export function modelBelongsToCloudProvider(
  provider: CloudProvider,
  model: string | undefined,
): boolean {
  const id = model?.trim();
  if (!id) return false;

  if (getDefaultModels(provider).some((m) => m.id === id)) {
    return true;
  }

  for (const other of CLOUD_PROVIDER_ORDER) {
    if (other !== provider && getDefaultModels(other).some((m) => m.id === id)) {
      return false;
    }
  }

  const lower = id.toLowerCase();
  switch (provider) {
    case 'anthropic':
      return lower.startsWith('claude');
    case 'openai':
      return (
        lower.startsWith('gpt-') ||
        lower.startsWith('chatgpt-') ||
        /^o\d/.test(lower)
      );
    case 'google':
      return lower.startsWith('gemini');
  }
}

export function resolvePreferredCloudProvider(
  input: ResolvePreferredCloudProviderInput,
): PreferredCloudProviderResolution | null {
  const order = input.providerOrder ?? CLOUD_PROVIDER_ORDER;
  const eligible = order.filter(
    (provider) =>
      input.availableKeys[provider] &&
      !(input.invalidProviders?.has(provider) ?? false),
  );

  if (eligible.length === 0) return null;

  const verifiedEligible =
    input.verifiedProviders && input.verifiedProviders.size > 0
      ? eligible.filter((provider) => input.verifiedProviders?.has(provider))
      : [];
  const pool = verifiedEligible.length > 0 ? verifiedEligible : eligible;
  const first = pool[0];
  if (!first) return null;

  const settingsProvider = normalizeCloudProvider(input.settings?.defaultProvider);
  const provider =
    settingsProvider && pool.includes(settingsProvider) ? settingsProvider : first;

  const settingsModel = input.settings?.defaultModel?.trim();
  const model =
    settingsModel && modelBelongsToCloudProvider(provider, settingsModel)
      ? settingsModel
      : getDefaultModelForCloudProvider(provider);

  return { provider, model };
}
