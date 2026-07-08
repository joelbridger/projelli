import { createKeychainService } from '@/platform/providers/KeychainService';
import { createProvider } from '@/platform/providers/providerFactory';
import { OPENAI_DEFAULT_MODEL } from '@/platform/providers/OpenAIProvider';
import { resolveAvailableLocalGenerationProvider } from '@/platform/providers/resolveLocalProvider';
import { isLocalOnlyMode, assertCloudGenerationAllowed } from '@/platform/privacy/localOnlyGuard';
import type { Provider } from '@/platform/providers/Provider';
import { resolveAssuredRoute } from '@/platform/firm/resolveAssuredRoute';

/**
 * Honest, actionable failures shown when no usable local engine is available
 * (fix round 2, item 4). "Draft with AI" now uses the SAME strict reachability
 * probe as Ask / the egress badge (`resolveAvailableLocalGenerationProvider`),
 * so it fails fast with a real message instead of building a guaranteed-broken
 * Ollama provider that would error deep inside the send. Email's catch surfaces
 * `error.message` to the user, so these are the exact strings they see.
 */
export const EMAIL_LOCAL_AI_NOT_READY_MESSAGE =
  'Lantern Local AI is still downloading or setting up. Check its progress in Settings, then try again.';
export const EMAIL_NO_PROVIDER_MESSAGE =
  'No AI provider is connected. Add an API key in Settings, or set up Lantern Local AI to draft on your computer.';

// ── buildProviderAsync — mirrors Ask.tsx pattern ─────────────────

export interface ResolvedEmailProvider {
  provider: Provider;
  /** 'anthropic' | 'openai' | 'google' | 'ollama' | 'lantern-local' — always
   *  accurate, unlike `provider.getMetadata().providerId`, which only the
   *  local providers set (a cloud provider's metadata leaves it undefined). */
  providerId: string;
  /** True when this resolved to a REAL assured (firm zero-retention proxy)
   *  route — i.e. `resolveAssuredRoute` found a live firm session AND a
   *  managed key for this provider, the same check Chat/redline use. Feed
   *  this to `resolveEgress()` so the audit log records what actually
   *  happened, not just the app's confidentiality-mode SETTING: mode can read
   *  'assured' while this is still false (no managed key configured yet),
   *  and the honest destination is BYOK-direct. */
  assuredAvailable: boolean;
}

/**
 * Resolve the provider for "Draft with AI", including the providerId it
 * actually resolved to (needed for the local-only race guard and for the
 * audit log — see handleDraftWithAI). `buildProviderAsync` below is a thin
 * wrapper kept for existing callers that only need the `Provider`.
 */
export async function resolveEmailProvider(): Promise<ResolvedEmailProvider> {
  // BUG-021 (privacy): "Draft with AI" sends the email body to the provider, so
  // it must honour Local-only mode — force the local model instead of picking a
  // cloud key, so an email never leaves the machine when the indicator says so.
  // F-503 — the local engine is the embedded Lantern Local AI when ready, else
  // Ollama (the same on-device resolution Ask / Chat / Client Map use).
  if (isLocalOnlyMode()) {
    const resolved = await resolveAvailableLocalGenerationProvider();
    if (!resolved) throw new Error(EMAIL_LOCAL_AI_NOT_READY_MESSAGE);
    return { provider: resolved.provider, providerId: resolved.providerId, assuredAvailable: false };
  }
  // Personal-install choice gate (Task 1.3): email draft generation is cloud generation,
  // so block it until the user has made an explicit confidentiality choice. Gate ONLY on
  // the cloud branches, after confirming a cloud key OR a firm assured route exists, so
  // a personal install with no cloud key still falls back to local Ollama (no egress).
  // Local-only mode already returned above; firm installs are a no-op inside
  // assertCloudGenerationAllowed.
  //
  // One front door (fix F2.2): build through the shared factory so the email
  // "Draft with AI" surface resolves the SAME provider mapping as Ask / redline /
  // Client Map and can never drift. Model is probed via a throwaway factory
  // call (still the front door — createProvider(), never a per-provider
  // constructor) so resolveAssuredRoute's `model` argument, and the returned
  // ResolvedEmailProvider, always reflect what the final provider actually is.
  //
  // `stream: false` (independent reviewer catch, P1) — Draft with AI always
  // calls sendMessage(), never sendMessageStreaming(), so every route below
  // must say so; otherwise the proxy sets X-Stream:1 and, for Gemini
  // especially, routes to the streaming endpoint while this code parses a
  // JSON response.
  //
  // ANY available Assured route wins over ANY personal BYOK key (independent
  // reviewer catch, P1 #2): the whole point of selecting Assured mode is the
  // firm's zero-retention guarantee, so a user's leftover/incidental personal
  // key for an earlier-priority provider must not silently bypass an assured
  // route the firm actually configured for a different provider (e.g. a
  // personal Anthropic key + a firm managed OpenAI key must use the OpenAI
  // proxy, not go BYOK-direct to Anthropic). Checking assured availability
  // needs no personal key at all, so this pass never touches the keychain —
  // no "last used" stamp on a key that ends up unused.
  const anthropicModel = createProvider({ provider: 'anthropic', apiKey: '' }).getMetadata().model;
  const anthropicAssured = resolveAssuredRoute('anthropic', anthropicModel, false);
  // Preserve the pre-F2.2 default EXACTLY: this surface never lets the user
  // pick a model, so it must keep using OPENAI_DEFAULT_MODEL ('gpt-4o'), not
  // the factory's free-tier default ('gpt-4o-mini') — passing it explicitly
  // (rather than probing) avoids the silent downgrade fix F2.2 called out.
  const openaiModel = OPENAI_DEFAULT_MODEL;
  const openaiAssured = resolveAssuredRoute('openai', openaiModel, false);
  const googleModel = createProvider({ provider: 'google', apiKey: '' }).getMetadata().model;
  const googleAssured = resolveAssuredRoute('google', googleModel, false);

  const kc = createKeychainService();

  if (anthropicAssured) {
    assertCloudGenerationAllowed();
    const apiKey = (await kc.getKey('anthropic'))?.trim() ?? '';
    return {
      provider: createProvider({ provider: 'anthropic', apiKey, model: anthropicModel, assured: anthropicAssured }),
      providerId: 'anthropic',
      assuredAvailable: true,
    };
  }
  if (openaiAssured) {
    assertCloudGenerationAllowed();
    const apiKey = (await kc.getKey('openai'))?.trim() ?? '';
    return {
      provider: createProvider({ provider: 'openai', apiKey, model: openaiModel, assured: openaiAssured }),
      providerId: 'openai',
      assuredAvailable: true,
    };
  }
  if (googleAssured) {
    assertCloudGenerationAllowed();
    const apiKey = (await kc.getKey('google'))?.trim() ?? '';
    return {
      provider: createProvider({ provider: 'google', apiKey, model: googleModel, assured: googleAssured }),
      providerId: 'google',
      assuredAvailable: true,
    };
  }

  // No assured route anywhere — fall back to personal BYOK keys, same
  // key-priority order as before (anthropic → openai → google), reading each
  // key lazily so an unused provider's key is never touched.
  const anthropicKey = (await kc.getKey('anthropic'))?.trim() ?? '';
  if (anthropicKey) {
    assertCloudGenerationAllowed();
    return {
      provider: createProvider({ provider: 'anthropic', apiKey: anthropicKey, model: anthropicModel }),
      providerId: 'anthropic',
      assuredAvailable: false,
    };
  }
  const openaiKey = (await kc.getKey('openai'))?.trim() ?? '';
  if (openaiKey) {
    assertCloudGenerationAllowed();
    return {
      provider: createProvider({ provider: 'openai', apiKey: openaiKey, model: openaiModel }),
      providerId: 'openai',
      assuredAvailable: false,
    };
  }
  const googleKey = (await kc.getKey('google'))?.trim() ?? '';
  if (googleKey) {
    assertCloudGenerationAllowed();
    return {
      provider: createProvider({ provider: 'google', apiKey: googleKey, model: googleModel }),
      providerId: 'google',
      assuredAvailable: false,
    };
  }
  // No cloud key — fall back to the on-device engine, but ONLY when one is
  // provably usable (strict probe, same as Ask / the badge). Otherwise fail fast
  // with an honest message instead of building a guaranteed-broken Ollama
  // provider that would error deep inside the send. No egress, nothing to gate.
  const resolved = await resolveAvailableLocalGenerationProvider();
  if (!resolved) throw new Error(EMAIL_NO_PROVIDER_MESSAGE);
  return { provider: resolved.provider, providerId: resolved.providerId, assuredAvailable: false };
}

export async function buildProviderAsync(): Promise<Provider> {
  return (await resolveEmailProvider()).provider;
}

export { assertLocalOnlyAllowsSend } from '@/platform/privacy/localOnlyGuard';
