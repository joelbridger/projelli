/**
 * activeEgressProvider — THE single source of truth for "which AI engine will the
 * next request use", as the providerId the egress badge names.
 *
 * F1 (the worst UX finding): the top-bar TrustBar and Ask computed this
 * INDEPENDENTLY and could disagree on ONE screen — the top bar said
 * "No AI connected" while Ask's header said "Using local AI" at the same time.
 * Two bugs caused the drift:
 *   1. only Ask fell back to the on-device engine when no cloud key was present
 *      (the trust bar hard-returned "none"); and
 *   2. the two paths even read the user's default provider from different code.
 * A trust indicator that disagrees with itself is worse than none, so BOTH the
 * top bar (via useActiveEgressProvider) and Ask (via resolveActiveAskProviderId)
 * now resolve through the functions here. The pure `pickEgressProviderId` core is
 * unit-tested across the whole matrix, and it mirrors what the real send
 * (buildResolvedAskProvider) actually does, so the badge can never name an
 * engine the send would not use.
 *
 * The resolution, in priority order (matching the real send):
 *   1. local-only mode  -> the on-device engine (embedded when ready, else Ollama);
 *   2. web demo         -> 'anthropic' (the demo proxy / BYOK both forward to Claude);
 *   3. a usable cloud key -> the cloud provider the send would pick (settings-aware);
 *   4. no cloud key but a reachable on-device engine -> that local engine;
 *   5. otherwise         -> the 'none' sentinel ("No AI connected").
 */

import { NO_AI_PROVIDER } from '@/platform/privacy/egress';
import { IS_DEMO } from '@/web-demo/demoModeFlag';
import { KeychainService } from '@/platform/providers/KeychainService';
import { useSettingsStore } from '@/platform/settings/settingsStore';
import {
  getInvalidProviders,
  getVerifiedProviders,
} from '@/platform/providers/keyVerification';
import {
  resolveCloudSettingsDefaults,
  resolvePreferredCloudProvider,
  type CloudProviderKeyPresence,
  type PreferredCloudProviderResolution,
} from '@/platform/providers/resolvePreferredCloudProvider';
import {
  PROFESSION_MODEL_STORAGE_KEY,
  PROFESSION_PROVIDER_STORAGE_KEY,
} from '@/platform/profile/professionModel';
import {
  isEmbeddedLocalModelReady,
  resolveAvailableLocalGenerationProvider,
} from '@/platform/providers/resolveLocalProvider';

/** The concrete engine ids the badge can name, plus the 'none' sentinel. */
export type ActiveEgressProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'ollama'
  | 'lantern-local'
  | 'none';

export interface EgressProviderSelection {
  /** Local-only confidentiality mode: nothing ever leaves the machine. */
  localOnly: boolean;
  /** Browser web-demo build. */
  isDemo: boolean;
  /**
   * The cloud provider the send would pick from the user's keys + settings, or
   * null when no usable cloud key is present.
   */
  cloudProvider: ActiveEgressProviderId | null;
  /**
   * The on-device engine to name in LOCAL-ONLY mode (always a local engine:
   * 'lantern-local' when the embedded model is ready, else 'ollama').
   */
  localOnlyEngineId: 'lantern-local' | 'ollama';
  /**
   * The on-device engine ACTUALLY available right now for the no-cloud-key
   * fallback in cloud modes, or null when none is reachable.
   */
  availableLocalEngineId: 'lantern-local' | 'ollama' | null;
}

/**
 * The pure decision. Given fully-resolved inputs it returns the providerId the
 * badge should name. Deterministic and dependency-free, so it is exhaustively
 * unit-tested — the async wrappers below only gather these inputs.
 */
export function pickEgressProviderId(sel: EgressProviderSelection): ActiveEgressProviderId {
  if (sel.localOnly) return sel.localOnlyEngineId;
  if (sel.isDemo) return 'anthropic';
  if (sel.cloudProvider) return sel.cloudProvider;
  return sel.availableLocalEngineId ?? (NO_AI_PROVIDER as ActiveEgressProviderId);
}

/**
 * The settings-aware cloud pick, shared by the badge AND the real send
 * (buildResolvedAskProvider) so the two can never disagree on WHICH cloud
 * provider is chosen. Honours the user's saved default (settings store, then the
 * legacy default-provider key) and the verified/invalid sets.
 */
export function resolveActiveCloudResolution(
  availableKeys: CloudProviderKeyPresence,
): PreferredCloudProviderResolution | null {
  const settings = useSettingsStore.getState();
  return resolvePreferredCloudProvider({
    availableKeys,
    settings: resolveCloudSettingsDefaults(
      settings.getSetting('defaultProvider'),
      settings.getSetting('defaultModel'),
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(PROFESSION_PROVIDER_STORAGE_KEY)
        : null,
      typeof localStorage !== 'undefined'
        ? localStorage.getItem(PROFESSION_MODEL_STORAGE_KEY)
        : null,
    ),
    verifiedProviders: getVerifiedProviders(),
    invalidProviders: getInvalidProviders(),
  });
}

/**
 * Authoritative resolution using the EXACT key source the send uses
 * (`KeychainService.hasKey`: OS keychain on desktop + env keys), so the badge and
 * the actual send can never disagree. `mode` is the active confidentiality mode.
 */
export async function resolveActiveEgressProviderId(
  mode: string,
): Promise<ActiveEgressProviderId> {
  if (mode === 'local-only') {
    return pickEgressProviderId({
      localOnly: true,
      isDemo: false,
      cloudProvider: null,
      localOnlyEngineId: (await isEmbeddedLocalModelReady()) ? 'lantern-local' : 'ollama',
      availableLocalEngineId: null,
    });
  }
  // Web demo: Ask routes through the demo proxy / BYOK, both forwarding to Claude,
  // so the honest provider is 'anthropic'. There is no OS keychain in the demo.
  if (IS_DEMO) return 'anthropic';

  const kc = new KeychainService();
  const availableKeys: CloudProviderKeyPresence = {
    anthropic: await kc.hasKey('anthropic'),
    openai: await kc.hasKey('openai'),
    google: await kc.hasKey('google'),
  };
  const cloud = resolveActiveCloudResolution(availableKeys);
  let availableLocalEngineId: 'lantern-local' | 'ollama' | null = null;
  if (!cloud) {
    const local = await resolveAvailableLocalGenerationProvider();
    availableLocalEngineId = local?.providerId ?? null;
  }
  return pickEgressProviderId({
    localOnly: false,
    isDemo: false,
    cloudProvider: (cloud?.provider ?? null) as ActiveEgressProviderId | null,
    localOnlyEngineId: 'ollama',
    availableLocalEngineId,
  });
}

/**
 * Synchronous best-effort resolution from the key-metadata mirror
 * (`getStoredKeys`, present on every platform — including desktop, where the
 * secret itself is in the OS keychain). Used as the hook's initial value so the
 * badge does not flash before the authoritative async check resolves.
 *
 * The sync path CANNOT probe the on-device engine (that is async), so it never
 * claims a local fallback: with no cloud key it returns 'none' and the async
 * resolution fills in a local engine when one is ready. This matches the
 * existing flicker-free contract.
 */
export function resolveActiveEgressProviderIdSync(mode: string): ActiveEgressProviderId {
  if (mode === 'local-only') {
    return pickEgressProviderId({
      localOnly: true,
      isDemo: false,
      cloudProvider: null,
      localOnlyEngineId: 'ollama',
      availableLocalEngineId: null,
    });
  }
  if (IS_DEMO) return 'anthropic';

  let present = new Set<string>();
  try {
    present = new Set(new KeychainService().getStoredKeys().map((k) => k.provider));
    // eslint-disable-next-line lantern-async/no-silent-failure -- best-effort sync mirror for the initial paint; the authoritative async check corrects it
  } catch {
    // KeychainService unavailable — fall through to "no provider".
  }
  const cloud = resolveActiveCloudResolution({
    anthropic: present.has('anthropic'),
    openai: present.has('openai'),
    google: present.has('google'),
  });
  return pickEgressProviderId({
    localOnly: false,
    isDemo: false,
    cloudProvider: (cloud?.provider ?? null) as ActiveEgressProviderId | null,
    localOnlyEngineId: 'ollama',
    availableLocalEngineId: null,
  });
}
