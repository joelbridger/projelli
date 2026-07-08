import type { AssuredRoute } from '@/platform/firm/assuredInference';
import { resolveAssuredRoute } from '@/platform/firm/resolveAssuredRoute';
import { getInvalidProviders, getVerifiedProviders } from '@/platform/providers/keyVerification';
import { KeychainService, type KeyProvider } from '@/platform/providers/KeychainService';
import { createProvider, type ChatProviderId } from '@/platform/providers/providerFactory';
import { resolveAvailableLocalGenerationProvider } from '@/platform/providers/resolveLocalProvider';
import {
  CLOUD_PROVIDER_ORDER,
  cloudKeyPresenceFromValues,
  getDefaultModelForCloudProvider,
  modelBelongsToCloudProvider,
  resolveCloudSettingsDefaults,
  resolvePreferredCloudProvider,
  type CloudProvider,
  type CloudProviderKeyValues,
} from '@/platform/providers/resolvePreferredCloudProvider';
import {
  PROFESSION_MODEL_STORAGE_KEY,
  PROFESSION_PROVIDER_STORAGE_KEY,
} from '@/platform/profile/professionModel';
import type { EgressDestination } from '@/platform/privacy/egress';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import type { Provider } from './Provider';

export type ActiveGenerationProviderId = ChatProviderId | 'none' | 'local-pending';

export type ActiveGenerationRouteSource =
  | 'local-only'
  | 'demo'
  | 'assured'
  | 'preferred-key'
  | 'fallback-key'
  | 'local-fallback'
  | 'none'
  | 'local-pending';

export interface ActiveGenerationRoute {
  providerId: ActiveGenerationProviderId;
  model: string | undefined;
  assuredAvailable: boolean;
  assuredRoute?: AssuredRoute;
  resolvedProvider?: Provider;
  destination: EgressDestination | 'none' | 'local-pending';
  source: ActiveGenerationRouteSource;
  apiKey?: string;
}

export interface ResolvedActiveGenerationProvider extends ActiveGenerationRoute {
  provider: Provider;
  providerId: ChatProviderId;
  destination: EgressDestination;
}

export interface ResolveActiveGenerationRouteInput {
  mode: string;
  preferredProvider?: ChatProviderId | null;
  preferredModel?: string;
  stream: boolean;
  /** When true, a missing preferred personal key may use another personal key. */
  allowCloudFallback?: boolean;
  /** A pinned local model is a promise; never replace it with cloud. */
  preservePinnedLocal?: boolean;
  /** Optional AI rules to prepend when a caller asks this helper to build. */
  aiRules?: string;
  /** Optional already-validated key values from a caller that owns live key state. */
  cloudKeys?: CloudProviderKeyValues;
}

const KEY_PROVIDERS: readonly KeyProvider[] = ['anthropic', 'openai', 'google'];

function isCloudProvider(provider: string | null | undefined): provider is CloudProvider {
  return provider === 'anthropic' || provider === 'openai' || provider === 'google';
}

function isLocalProvider(provider: string | null | undefined): provider is 'ollama' | 'lantern-local' {
  return provider === 'ollama' || provider === 'lantern-local';
}

function readCloudDefaults() {
  const settings = useSettingsStore.getState();
  return resolveCloudSettingsDefaults(
    settings.getSetting('defaultProvider'),
    settings.getSetting('defaultModel'),
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(PROFESSION_PROVIDER_STORAGE_KEY)
      : null,
    typeof localStorage !== 'undefined'
      ? localStorage.getItem(PROFESSION_MODEL_STORAGE_KEY)
      : null,
  );
}

function modelForProvider(provider: CloudProvider, preferredModel?: string): string {
  return preferredModel && modelBelongsToCloudProvider(provider, preferredModel)
    ? preferredModel
    : getDefaultModelForCloudProvider(provider);
}

function assuredProviderOrder(preferredProvider: CloudProvider | null): CloudProvider[] {
  const order = [...CLOUD_PROVIDER_ORDER];
  if (!preferredProvider) return order;
  return [preferredProvider, ...order.filter((provider) => provider !== preferredProvider)];
}

function resolveAssuredFirstRoute(input: ResolveActiveGenerationRouteInput): ActiveGenerationRoute | null {
  if (input.mode !== 'assured') return null;
  const preferredCloud = isCloudProvider(input.preferredProvider) ? input.preferredProvider : null;

  for (const provider of assuredProviderOrder(preferredCloud)) {
    const model = provider === preferredCloud
      ? modelForProvider(provider, input.preferredModel)
      : getDefaultModelForCloudProvider(provider);
    const assuredRoute = resolveAssuredRoute(provider, model, input.stream);
    if (!assuredRoute) continue;
    return {
      providerId: provider,
      model,
      assuredAvailable: true,
      assuredRoute,
      destination: 'assured-proxy',
      source: 'assured',
    };
  }

  return null;
}

function resolveCloudRouteFromKeys(
  input: ResolveActiveGenerationRouteInput,
  keys: CloudProviderKeyValues,
): ActiveGenerationRoute | null {
  const preferredCloud = isCloudProvider(input.preferredProvider) ? input.preferredProvider : null;

  if (preferredCloud && keys[preferredCloud]?.trim()) {
    const apiKey = keys[preferredCloud].trim();
    return {
      providerId: preferredCloud,
      model: modelForProvider(preferredCloud, input.preferredModel),
      assuredAvailable: false,
      destination: 'provider-direct',
      source: 'preferred-key',
      ...(apiKey ? { apiKey } : {}),
    };
  }

  if (input.allowCloudFallback === false) return null;

  const resolved = resolvePreferredCloudProvider({
    availableKeys: cloudKeyPresenceFromValues(keys),
    settings: readCloudDefaults(),
    verifiedProviders: getVerifiedProviders(),
    invalidProviders: getInvalidProviders(),
  });
  if (!resolved) return null;

  const fallbackApiKey = keys[resolved.provider]?.trim();
  return {
    providerId: resolved.provider,
    model: resolved.model,
    assuredAvailable: false,
    destination: 'provider-direct',
    source: preferredCloud ? 'fallback-key' : 'preferred-key',
    ...(fallbackApiKey ? { apiKey: fallbackApiKey } : {}),
  };
}

async function readCloudKeys(kc: KeychainService): Promise<CloudProviderKeyValues> {
  const entries = await Promise.all(
    KEY_PROVIDERS.map(async (provider) => [provider, (await kc.getKey(provider))?.trim()] as const),
  );
  return Object.fromEntries(entries) as CloudProviderKeyValues;
}

function readStoredKeyPresence(kc: KeychainService): CloudProviderKeyValues {
  const present = new Set(kc.getStoredKeys().map((key) => key.provider));
  return {
    anthropic: present.has('anthropic') ? '__present__' : null,
    openai: present.has('openai') ? '__present__' : null,
    google: present.has('google') ? '__present__' : null,
  };
}

export async function resolveActiveGenerationRoute(
  input: ResolveActiveGenerationRouteInput,
): Promise<ActiveGenerationRoute> {
  if (input.mode === 'local-only') {
    const local = await resolveAvailableLocalGenerationProvider();
    return local
      ? {
          providerId: local.providerId,
          model: local.model,
          assuredAvailable: false,
          resolvedProvider: local.provider,
          destination: 'local',
          source: 'local-only',
        }
      : {
          providerId: 'local-pending',
          model: undefined,
          assuredAvailable: false,
          destination: 'local-pending',
          source: 'local-pending',
        };
  }

  if (IS_DEMO) {
    return {
      providerId: 'anthropic',
      model: getDefaultModelForCloudProvider('anthropic'),
      assuredAvailable: false,
      destination: 'provider-direct',
      source: 'demo',
    };
  }

  if (input.preservePinnedLocal && isLocalProvider(input.preferredProvider)) {
    return {
      providerId: input.preferredProvider,
      model: input.preferredModel,
      assuredAvailable: false,
      destination: 'local',
      source: 'local-only',
    };
  }

  const assured = resolveAssuredFirstRoute(input);
  if (assured) return assured;

  const cloud = resolveCloudRouteFromKeys(
    input,
    input.cloudKeys ?? await readCloudKeys(new KeychainService()),
  );
  if (cloud) return cloud;

  const local = await resolveAvailableLocalGenerationProvider();
  if (local) {
    return {
      providerId: local.providerId,
      model: local.model,
      assuredAvailable: false,
      resolvedProvider: local.provider,
      destination: 'local',
      source: 'local-fallback',
    };
  }

  return {
    providerId: 'none',
    model: undefined,
    assuredAvailable: false,
    destination: 'none',
    source: 'none',
  };
}

export function resolveActiveGenerationRouteSync(
  input: ResolveActiveGenerationRouteInput,
): ActiveGenerationRoute {
  if (input.mode === 'local-only') {
    return {
      providerId: 'local-pending',
      model: undefined,
      assuredAvailable: false,
      destination: 'local-pending',
      source: 'local-pending',
    };
  }

  if (IS_DEMO) {
    return {
      providerId: 'anthropic',
      model: getDefaultModelForCloudProvider('anthropic'),
      assuredAvailable: false,
      destination: 'provider-direct',
      source: 'demo',
    };
  }

  if (input.preservePinnedLocal && isLocalProvider(input.preferredProvider)) {
    return {
      providerId: input.preferredProvider,
      model: input.preferredModel,
      assuredAvailable: false,
      destination: 'local',
      source: 'local-only',
    };
  }

  const assured = resolveAssuredFirstRoute(input);
  if (assured) return assured;

  try {
    const cloud = resolveCloudRouteFromKeys(input, readStoredKeyPresence(new KeychainService()));
    if (cloud) return cloud;
    // eslint-disable-next-line lantern-async/no-silent-failure -- sync badge seed only; async resolution corrects it.
  } catch {
    // Keychain metadata can be unavailable during early boot.
  }

  return {
    providerId: 'none',
    model: undefined,
    assuredAvailable: false,
    destination: 'none',
    source: 'none',
  };
}

export async function resolveActiveGenerationProvider(
  input: ResolveActiveGenerationRouteInput,
): Promise<ResolvedActiveGenerationProvider | null> {
  const route = await resolveActiveGenerationRoute(input);
  if (route.providerId === 'none' || route.providerId === 'local-pending') return null;
  return {
    ...route,
    providerId: route.providerId,
    destination: route.destination as EgressDestination,
    provider: route.resolvedProvider ?? createProvider({
      provider: route.providerId,
      apiKey: route.apiKey ?? '',
      ...(route.model ? { model: route.model } : {}),
      ...(route.assuredRoute ? { assured: route.assuredRoute } : {}),
      ...(input.aiRules ? { aiRules: input.aiRules } : {}),
    }),
  };
}
