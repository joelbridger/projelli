/**
 * Egress logic — the single source of truth for "where does the next AI
 * request go?"
 *
 * This is deliberately a pure, dependency-free module so the egress indicator
 * (composer + status bar), the data map, and the test suite all derive the
 * SAME answer from the SAME inputs. If the destination story is ever wrong,
 * it is wrong in exactly one place.
 *
 * ACCURACY CONTRACT (verified against the real architecture, June 2026):
 *
 *   - Desktop app, cloud provider (Anthropic / OpenAI / Google): the request
 *     goes DIRECTLY from the user's machine to that provider's API using the
 *     user's own key (BYOK). Keepance has no server in this path. The provider
 *     receives the prompt and may retain it for a limited window for abuse
 *     monitoring, and training opt-out (where offered) is configured in the
 *     user's own provider console — not in Keepance. See
 *     `src/modules/models/fetchUtils.ts` (production base URLs point straight
 *     at api.anthropic.com / api.openai.com / generativelanguage.googleapis.com)
 *     and `src/modules/models/providerFactory.ts`.
 *
 *   - Local model (Ollama, 127.0.0.1:11434): inference runs on the user's own
 *     machine. Nothing leaves the device. See `src/modules/models/OllamaProvider.ts`.
 *
 *   - Browser demo build ONLY (never the desktop app): when no personal key is
 *     pasted, requests are relayed through a shared Keepance proxy
 *     (`/api/demo-chat`). This path must NOT be used with confidential client
 *     data. With a personal key pasted into the demo, it instead goes direct to
 *     the provider, same as the desktop BYOK path. See
 *     `src/web-demo/demoAIProvider.ts`.
 */

/**
 * Provider id a chat can carry. The chat file stores this loosely as a string
 * (see `AIChatFile.provider` and `aiChatStore`), and the known values are
 * 'anthropic' | 'openai' | 'google' | 'ollama'. We accept any string so an
 * unrecognised id degrades gracefully (treated as a cloud provider) rather than
 * throwing — the indicator must never crash the composer.
 */
export type EgressProvider = string;

/**
 * Confidentiality mode (the visible "spectrum" the user can choose).
 *
 *   - 'local-only'  Only local models (Ollama) are usable; cloud providers are
 *                   disabled. Nothing leaves the machine.
 *   - 'direct'      Default. The user's own key talks directly to their chosen
 *                   provider. The provider sees the prompt.
 *   - 'assured'     Reserved / coming soon: a future zero-retention relay.
 *                   Shown so the spectrum is visible, but not selectable yet.
 */
export type ConfidentialityMode = 'local-only' | 'direct' | 'assured';

export const CONFIDENTIALITY_MODES: ConfidentialityMode[] = [
  'local-only',
  'direct',
  'assured',
];

/** Default mode. Matches today's shipping behaviour: your key, direct to provider. */
export const DEFAULT_CONFIDENTIALITY_MODE: ConfidentialityMode = 'direct';

/** Settings key the confidentiality mode is persisted under. */
export const CONFIDENTIALITY_MODE_SETTING_KEY = 'confidentialityMode';

/**
 * Severity drives the indicator colour, never just decoration:
 *   - 'safe'   nothing leaves the machine (local model).
 *   - 'direct' leaves to the chosen provider, with the user's key (expected,
 *              honest — not an error, but the user must understand it).
 *   - 'warn'   a shared/relayed path that is NOT for confidential data
 *              (the browser-demo proxy).
 */
export type EgressSeverity = 'safe' | 'direct' | 'warn';

/** What kind of destination the next request resolves to. */
export type EgressDestination =
  | 'local' // on-machine (Ollama)
  | 'provider-direct' // direct to Anthropic/OpenAI/Google with the user's key
  | 'demo-proxy'; // shared Keepance demo relay (web demo, no personal key)

export interface EgressInfo {
  destination: EgressDestination;
  severity: EgressSeverity;
  /** Short label for the chip, e.g. "Direct to Anthropic (your account)". */
  label: string;
  /** One honest sentence under the chip. Empty string when none is needed. */
  note: string;
  /** True only when literally nothing leaves the device. */
  dataLeaves: boolean;
  /** The provider this resolves to (normalised). */
  provider: EgressProvider;
}

/** Human label for a cloud provider id. */
export function providerDisplayName(provider: EgressProvider): string {
  switch (provider) {
    case 'anthropic':
      return 'Anthropic';
    case 'openai':
      return 'OpenAI';
    case 'google':
      return 'Google';
    case 'ollama':
      return 'Ollama';
    default:
      return provider;
  }
}

/** True when a provider id denotes a local (on-machine) model. */
export function isLocalProvider(provider: EgressProvider): boolean {
  return provider === 'ollama';
}

export interface ResolveEgressInput {
  /** The provider the NEXT send will use (from the active chat). */
  provider: EgressProvider;
  /** The active confidentiality mode. */
  mode: ConfidentialityMode;
  /** True when running as the browser demo build (never true in the desktop app). */
  isDemo?: boolean;
  /**
   * Demo only: whether the user has pasted a personal (BYOK) key. When true the
   * demo goes direct to the provider; when false it relays via the shared proxy.
   * Ignored outside demo mode.
   */
  hasDemoByokKey?: boolean;
}

/**
 * Resolve where the next AI request will actually go. Pure function — same
 * inputs always produce the same EgressInfo. The labels/notes here are the
 * canonical, audience-checked copy; the indicator renders i18n strings keyed
 * to the same facts but this stays usable on its own (and is what tests
 * assert against for accuracy).
 */
export function resolveEgress(input: ResolveEgressInput): EgressInfo {
  const { mode, isDemo = false, hasDemoByokKey = false } = input;
  const provider = input.provider || 'anthropic';

  // Local-only mode forces a local destination regardless of the chat's stored
  // provider: in this mode the UI only lets the user pick local models, so the
  // honest indicator is "nothing leaves".
  const treatAsLocal = isLocalProvider(provider) || mode === 'local-only';

  if (treatAsLocal) {
    return {
      destination: 'local',
      severity: 'safe',
      label: 'On your machine. Nothing leaves',
      note: 'This runs on a local model (Ollama). No prompt or file is sent over the network.',
      dataLeaves: false,
      provider: isLocalProvider(provider) ? provider : 'ollama',
    };
  }

  // Browser-demo build with NO personal key: requests are relayed through a
  // shared Keepance proxy. This is the one path that must never carry client data.
  if (isDemo && !hasDemoByokKey) {
    return {
      destination: 'demo-proxy',
      severity: 'warn',
      label: 'Browser demo. Do not use with client data',
      note: 'In this online demo, messages pass through a shared Keepance relay. The desktop app never does this. Do not enter confidential or client information here.',
      dataLeaves: true,
      provider,
    };
  }

  // Everything else (desktop app, or demo with a personal key) is BYOK direct.
  const name = providerDisplayName(provider);
  return {
    destination: 'provider-direct',
    severity: 'direct',
    label: `Direct to ${name} (your account)`,
    note: `Sent straight from your machine to ${name} with your own API key. Keepance is not in between. ${name} receives the prompt and may keep it briefly for abuse monitoring; control training opt-out in your ${name} account.`,
    dataLeaves: true,
    provider,
  };
}

/** True when the given mode disallows cloud providers (local models only). */
export function modeRestrictsToLocal(mode: ConfidentialityMode): boolean {
  return mode === 'local-only';
}

/** True when the mode is shown in the UI but not yet usable. */
export function modeIsComingSoon(mode: ConfidentialityMode): boolean {
  return mode === 'assured';
}
