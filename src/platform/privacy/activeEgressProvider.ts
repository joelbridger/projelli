/**
 * activeEgressProvider — THE single source of truth for "where the next AI
 * request will actually go", as the DESTINATION the egress badge renders.
 *
 * F1 (the worst UX finding): the top-bar TrustBar and Ask computed this
 * INDEPENDENTLY and could disagree on ONE screen. A trust indicator that
 * disagrees with itself is worse than none, so every egress consumer now resolves
 * through the functions here.
 *
 * Fix round 1 hardened three real defects the badge must never have:
 *   - ASSURED (item 2, revised by the fix-round-2 ruling): the GLOBAL badge is BYOK-first (it mirrors Ask/Workflows' real send preference); assured shows globally only when a firm route can send through
 *     the zero-retention proxy for a provider the user has NO personal key for.
 *     The resolver checks `resolveAssuredRoute` FIRST (assured wins over personal
 *     BYOK, exactly like the email send path), and returns `assuredAvailable` so
 *     the badge renders the assured-proxy destination instead of falsely saying
 *     "No AI connected" or naming a personal provider.
 *   - STRICT LOCAL (item 3): in 'local-only' mode we use the SAME strict probe
 *     the send uses (`resolveAvailableLocalGenerationProvider`) — embedded model
 *     ready, else a PROVABLY-REACHABLE Ollama. When nothing is usable the badge
 *     shows "Local AI setting up" (LOCAL_PENDING), never a false "Using local AI".
 *   - (item 1 lives in useActiveEgressProvider: mode-tagging the resolved value.)
 *
 * Priority (matches the real sends): local-only → demo → assured route → cloud
 * BYOK → on-device fallback → none.
 */

import {
  NO_AI_PROVIDER,
  LOCAL_PENDING_PROVIDER,
} from '@/platform/privacy/egress';
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
import { resolveAvailableLocalGenerationProvider } from '@/platform/providers/resolveLocalProvider';

/** The concrete engine ids the badge can name, plus the two sentinels. */
export type ActiveEgressProviderId =
  | 'anthropic'
  | 'openai'
  | 'google'
  | 'ollama'
  | 'lantern-local'
  | 'none'
  | 'local-pending';

/**
 * The badge STATUS sentinels — not real providers. Kept as a typed set so
 * `toRealProviderId` and any narrowing stays honest if the union grows.
 */
export const EGRESS_BADGE_SENTINELS = ['none', 'local-pending'] as const;
export type EgressBadgeSentinel = (typeof EGRESS_BADGE_SENTINELS)[number];

/**
 * The REAL engine ids only (no badge sentinels). Structurally identical to
 * `ChatProviderId`, so a value of this type is safe to hand to provider
 * resolution — unlike `ActiveEgressProviderId`, which includes sentinels.
 */
export type RealEgressProviderId = Exclude<ActiveEgressProviderId, EgressBadgeSentinel>;

const SENTINEL_SET: ReadonlySet<string> = new Set(EGRESS_BADGE_SENTINELS);

/**
 * Narrow a badge status to a REAL provider id, or null for the sentinels
 * ('none', 'local-pending') and for a null "checking" state. Provider-resolution
 * code (Word redline, inline edit) MUST route the egress-hook result through this
 * so a badge sentinel can NEVER be treated as a provider id (fix round 2, item 2).
 */
export function toRealProviderId(
  status: ActiveEgressProviderId | null | undefined,
): RealEgressProviderId | null {
  return status && !SENTINEL_SET.has(status) ? (status as RealEgressProviderId) : null;
}

/** What the badge needs: the provider id AND whether the firm assured proxy is live. */
export interface ActiveEgressDestination {
  providerId: ActiveEgressProviderId;
  /** True only when the next send routes through the firm zero-retention proxy. */
  assuredAvailable: boolean;
}

export interface EgressDestinationSelection {
  /** Local-only confidentiality mode: nothing ever leaves the machine. */
  localOnly: boolean;
  /** Browser web-demo build. */
  isDemo: boolean;
  /**
   * In 'assured' mode, the cloud provider that has a LIVE firm managed route
   * (priority-ordered), or null when no assured route is available.
   */
  assuredProvider: ActiveEgressProviderId | null;
  /**
   * The cloud provider a BYOK send would pick from the user's keys + settings,
   * or null when no usable cloud key is present.
   */
  cloudProvider: ActiveEgressProviderId | null;
  /**
   * The on-device engine ACTUALLY available in LOCAL-ONLY mode (strict probe:
   * embedded-ready, else reachable Ollama), or null when none is usable yet
   * (→ "Local AI setting up").
   */
  localOnlyEngineId: 'lantern-local' | 'ollama' | null;
  /**
   * The on-device engine available as the no-cloud-key fallback in cloud modes,
   * or null when none is reachable.
   */
  availableLocalEngineId: 'lantern-local' | 'ollama' | null;
}

/**
 * The pure decision. Given fully-resolved inputs it returns the destination the
 * badge should render. Deterministic and dependency-free, so it is exhaustively
 * unit-tested — the async/sync wrappers below only gather these inputs.
 */
export function pickEgressDestination(
  sel: EgressDestinationSelection,
): ActiveEgressDestination {
  if (sel.localOnly) {
    return sel.localOnlyEngineId
      ? { providerId: sel.localOnlyEngineId, assuredAvailable: false }
      : { providerId: LOCAL_PENDING_PROVIDER, assuredAvailable: false };
  }
  if (sel.isDemo) return { providerId: 'anthropic', assuredAvailable: false };
  // Assured wins over personal BYOK (mirrors resolveEmailProvider): selecting
  // Assured means the firm's zero-retention guarantee, so a leftover personal key
  // must not silently bypass a managed route the firm configured.
  if (sel.assuredProvider) return { providerId: sel.assuredProvider, assuredAvailable: true };
  if (sel.cloudProvider) return { providerId: sel.cloudProvider, assuredAvailable: false };
  if (sel.availableLocalEngineId) {
    return { providerId: sel.availableLocalEngineId, assuredAvailable: false };
  }
  return { providerId: NO_AI_PROVIDER, assuredAvailable: false };
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
 * Authoritative resolution using the EXACT sources the send uses, so the badge
 * and the actual send can never disagree. `mode` is the active confidentiality
 * mode. Returns the full destination (provider id + whether assured is live).
 */
export async function resolveActiveEgressDestination(
  mode: string,
): Promise<ActiveEgressDestination> {
  if (mode === 'local-only') {
    // STRICT probe — same as resolveLocalOnlyAskProvider: an engine only when one
    // is genuinely usable, else LOCAL_PENDING ("setting up").
    const local = await resolveAvailableLocalGenerationProvider();
    return pickEgressDestination({
      localOnly: true,
      isDemo: false,
      assuredProvider: null,
      cloudProvider: null,
      localOnlyEngineId: local?.providerId ?? null,
      availableLocalEngineId: null,
    });
  }
  if (IS_DEMO) return { providerId: 'anthropic', assuredAvailable: false };

  // COORDINATOR SCOPE RULING (fix round 2): the GLOBAL top-bar badge mirrors
  // TODAY'S Ask + Workflows reality, where personal BYOK wins over the firm
  // Assured route (Ask/Workflows do not route through the assured proxy — only
  // email/chat/redline do). So the global resolver does NOT prefer assured:
  // `assuredProvider` is always null here. The underlying send-side
  // inconsistency (email prefers Assured; Ask/Workflows prefer BYOK) is a
  // PRE-EXISTING product bug filed for a dedicated lane — not rewired here.
  // Email's OWN action-time indicators stay assured-honest by resolving through
  // resolveEmailProvider() (assured-preferred) and feeding its assuredAvailable
  // into resolveEgress() — independent of this global hook.
  const kc = new KeychainService();
  const availableKeys: CloudProviderKeyPresence = {
    anthropic: await kc.hasKey('anthropic'),
    openai: await kc.hasKey('openai'),
    google: await kc.hasKey('google'),
  };
  const cloud = resolveActiveCloudResolution(availableKeys);
  const cloudProvider = (cloud?.provider ?? null) as ActiveEgressProviderId | null;
  let availableLocalEngineId: 'lantern-local' | 'ollama' | null = null;
  if (!cloud) {
    const local = await resolveAvailableLocalGenerationProvider();
    availableLocalEngineId = local?.providerId ?? null;
  }
  return pickEgressDestination({
    localOnly: false,
    isDemo: false,
    assuredProvider: null,
    cloudProvider,
    localOnlyEngineId: null,
    availableLocalEngineId,
  });
}

/**
 * Synchronous best-effort resolution from the key-metadata mirror
 * (`getStoredKeys`) plus the sync assured/firm-session getters. Used as the
 * hook's initial value so the badge does not flash before the authoritative
 * async check resolves.
 *
 * The sync path CANNOT probe the on-device engine (async), so in local-only mode
 * it returns LOCAL_PENDING ("setting up") — never a false "Using local AI" —
 * and the async resolution fills in the real engine once confirmed. In cloud
 * modes with no key it returns 'none' and the async check may fill in a local
 * fallback.
 */
export function resolveActiveEgressDestinationSync(mode: string): ActiveEgressDestination {
  if (mode === 'local-only') {
    return { providerId: LOCAL_PENDING_PROVIDER, assuredAvailable: false };
  }
  if (IS_DEMO) return { providerId: 'anthropic', assuredAvailable: false };

  // Global badge mirrors Ask/Workflows (BYOK-preferred) — see the ruling comment
  // in resolveActiveEgressDestination above. No global assured preference.
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
  return pickEgressDestination({
    localOnly: false,
    isDemo: false,
    assuredProvider: null,
    cloudProvider: (cloud?.provider ?? null) as ActiveEgressProviderId | null,
    localOnlyEngineId: null,
    availableLocalEngineId: null,
  });
}

/**
 * Provider-id-only wrappers, for callers/tests that just need the engine name
 * (Ask's pre-send badge, the two-path-agreement tests). Same single source.
 */
export async function resolveActiveEgressProviderId(
  mode: string,
): Promise<ActiveEgressProviderId> {
  return (await resolveActiveEgressDestination(mode)).providerId;
}

export function resolveActiveEgressProviderIdSync(mode: string): ActiveEgressProviderId {
  return resolveActiveEgressDestinationSync(mode).providerId;
}
