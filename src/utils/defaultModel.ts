/**
 * Default-model resolution helper (Q9 — Wave 1.5).
 *
 * Keepance ships as "bring your own key" + free tier. Free-tier founders
 * almost always want the cheapest capable model on Anthropic, which is Claude
 * Haiku 4.5. Pro / Lifetime users have made a deliberate commercial decision
 * to pay for Keepance and they're allowed to pick whichever model they want
 * on a per-provider basis.
 *
 * This helper centralizes the decision so any surface that needs to
 * pick a default (the AI pane's model dropdown, the provider constructor,
 * the first-run wizard, etc.) resolves to the same answer.
 *
 * Behavior contract:
 *  - Never changes a user's already-configured model.
 *  - Only supplies a fallback when no model has been selected.
 *  - For free-tier users, defaults to the cheapest capable model on each
 *    provider.
 *  - For pro / lifetime, defaults to the same model they were defaulting to
 *    before Q9 (Claude Sonnet 4.6 on Anthropic), since these users already
 *    pay for the app and are more likely to want a higher-capability default.
 */

import type { LicenseTier } from '@/hooks/useLicense';

export type Provider = 'anthropic' | 'openai' | 'google';

/** Claude Haiku 4.5 — cheapest Anthropic model in 2026. */
export const DEFAULT_ANTHROPIC_FREE = 'claude-haiku-4-5-20251001';
/** Claude Sonnet 4.6 — highest capability-per-dollar for paying users. */
export const DEFAULT_ANTHROPIC_PAID = 'claude-sonnet-4-6';

export const DEFAULT_OPENAI_FREE = 'gpt-4o-mini';
export const DEFAULT_OPENAI_PAID = 'gpt-4o';

export const DEFAULT_GOOGLE_FREE = 'gemini-2.5-flash';
export const DEFAULT_GOOGLE_PAID = 'gemini-1.5-pro';

/**
 * Return the default model ID for a given provider and license tier.
 *
 * Use this any time you need a fallback — do NOT override an existing
 * user selection.
 */
export function getDefaultModelForTier(
  provider: Provider,
  tier: LicenseTier = 'free'
): string {
  const isPaid = tier === 'pro' || tier === 'lifetime';
  switch (provider) {
    case 'anthropic':
      return isPaid ? DEFAULT_ANTHROPIC_PAID : DEFAULT_ANTHROPIC_FREE;
    case 'openai':
      return isPaid ? DEFAULT_OPENAI_PAID : DEFAULT_OPENAI_FREE;
    case 'google':
      return isPaid ? DEFAULT_GOOGLE_PAID : DEFAULT_GOOGLE_FREE;
    default:
      return DEFAULT_ANTHROPIC_FREE;
  }
}

/**
 * Return defaults for every supported provider keyed by provider name.
 * Convenient shape for initializing the AI pane's `selectedModels` state.
 */
export function getDefaultModelsForTier(
  tier: LicenseTier = 'free'
): Record<Provider, string> {
  return {
    anthropic: getDefaultModelForTier('anthropic', tier),
    openai: getDefaultModelForTier('openai', tier),
    google: getDefaultModelForTier('google', tier),
  };
}
