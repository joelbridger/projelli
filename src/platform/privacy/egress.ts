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
 *     `src/platform/providers/fetchUtils.ts` (production base URLs point straight
 *     at api.anthropic.com / api.openai.com / generativelanguage.googleapis.com)
 *     and `src/platform/providers/providerFactory.ts`.
 *
 *   - Local model (Ollama, 127.0.0.1:11434): inference runs on the user's own
 *     machine. Nothing leaves the device. See `src/platform/providers/OllamaProvider.ts`.
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
 *   - 'assured'     The FIRM zero-retention path: cloud inference routed through
 *                   the Keepance proxy, which attaches the firm's MANAGED key
 *                   server-side and retains nothing (a DPA + provider ZDR back
 *                   it). Selectable only when the firm has a managed key
 *                   configured for the active provider; otherwise it falls back
 *                   to the default and the picker explains why.
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
 *   - 'assured' leaves via the Keepance zero-retention proxy to the provider
 *              under the firm's managed key + DPA (honest, contractually
 *              no-logging on our side; the provider still sees the prompt).
 *   - 'warn'   a shared/relayed path that is NOT for confidential data
 *              (the browser-demo proxy).
 */
export type EgressSeverity = 'safe' | 'direct' | 'assured' | 'warn';

/** What kind of destination the next request resolves to. */
export type EgressDestination =
  | 'local' // on-machine (Ollama)
  | 'provider-direct' // direct to Anthropic/OpenAI/Google with the user's key
  | 'assured-proxy' // firm zero-retention proxy -> provider (managed key + DPA)
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
    case 'keepance-local':
      return 'Keepance Local AI';
    default:
      return provider;
  }
}

/**
 * True when a provider id denotes a local (on-machine) model: the embedded
 * Keepance Local AI engine ('keepance-local') or a user-run Ollama daemon
 * ('ollama'). Both keep all inference on the device.
 */
export function isLocalProvider(provider: EgressProvider): boolean {
  return provider === 'ollama' || provider === 'keepance-local';
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
  /**
   * Assured mode only: whether the firm has a MANAGED key configured for this
   * provider server-side. When the mode is 'assured' AND this is true, the
   * request routes through the zero-retention proxy. When 'assured' is selected
   * but no managed key exists, we fall back to the honest BYOK-direct story
   * (the proxy can't run without a managed key).
   */
  assuredAvailable?: boolean;
}

/**
 * Resolve where the next AI request will actually go. Pure function — same
 * inputs always produce the same EgressInfo. The labels/notes here are the
 * canonical, audience-checked copy; the indicator renders i18n strings keyed
 * to the same facts but this stays usable on its own (and is what tests
 * assert against for accuracy).
 */
export function resolveEgress(input: ResolveEgressInput): EgressInfo {
  const { mode, isDemo = false, hasDemoByokKey = false, assuredAvailable = false } = input;
  const provider = input.provider || 'anthropic';

  // Local-only mode forces a local destination regardless of the chat's stored
  // provider: in this mode the UI only lets the user pick local models, so the
  // honest indicator is "nothing leaves".
  const treatAsLocal = isLocalProvider(provider) || mode === 'local-only';

  if (treatAsLocal) {
    // Preserve the actual local provider id (keepance-local vs ollama) so the
    // note names the right engine; fall back to ollama only when local-only mode
    // forced locality on a non-local stored provider.
    const localProvider = isLocalProvider(provider) ? provider : 'ollama';
    return {
      destination: 'local',
      severity: 'safe',
      label: 'On your machine. Nothing leaves',
      note: `This runs on a local model (${providerDisplayName(localProvider)}). No prompt or file is sent over the network.`,
      dataLeaves: false,
      provider: localProvider,
    };
  }

  // Assured mode with a managed key configured for this provider: route through
  // the Keepance zero-retention proxy. We retain nothing (DPA + provider ZDR);
  // the provider still receives the prompt, which the note states honestly.
  if (mode === 'assured' && assuredAvailable && !isDemo) {
    const name = providerDisplayName(provider);
    return {
      destination: 'assured-proxy',
      severity: 'assured',
      label: `Assured: via Keepance zero-retention proxy to ${name}`,
      note: `Sent through the Keepance proxy using your firm's managed ${name} key. Keepance retains nothing (no prompt, no completion) and stamps each response no-retention. ${name} still receives the prompt under your firm's DPA and zero-retention settings.`,
      dataLeaves: true,
      provider,
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
    label: `Sent to your ${name} account`,
    note: `Sent straight from your machine to ${name} with your own API key. Keepance is not in between. ${name} receives the prompt and may keep it briefly for abuse monitoring; control training opt-out in your ${name} account.`,
    dataLeaves: true,
    provider,
  };
}

/** True when the given mode disallows cloud providers (local models only). */
export function modeRestrictsToLocal(mode: ConfidentialityMode): boolean {
  return mode === 'local-only';
}

/**
 * True when the mode is shown in the UI but cannot be USED yet because the firm
 * has no managed key configured for the active provider. Assured is a real
 * path; it becomes selectable once the firm admin sets a managed key. The
 * picker passes `assuredAvailable` so the card can explain when it is not yet
 * selectable.
 */
export function modeNeedsManagedKey(
  mode: ConfidentialityMode,
  assuredAvailable = false,
): boolean {
  return mode === 'assured' && !assuredAvailable;
}
