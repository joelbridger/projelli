/**
 * professionModel — pick a sensible default provider + model for the
 * profession a first-run user told us they do.
 *
 * The onboarding profession picker (FirstRunWizard) calls this so a lawyer who
 * just said "Legal practice" lands on a strong, dependable default model rather
 * than whatever happened to be first in the dropdown. The mapping is
 * intentionally conservative: every profession defaults to Anthropic (Claude),
 * the provider we lead with and tutorialise most thoroughly, and to a model
 * appropriate for the kind of work the profession implies.
 *
 * Behaviour contract (mirrors `src/platform/utils/defaultModel.ts`):
 *   - This only SUPPLIES a default. It never overrides a model the user has
 *     already chosen for themselves.
 *   - The chosen model id must exist in `DEFAULT_ANTHROPIC` /
 *     `DEFAULT_OPENAI` / `DEFAULT_GOOGLE` in `ModelListService.ts` so the AI
 *     pane's dropdown can render it.
 */

import {
  DEFAULT_ANTHROPIC_PAID,
  DEFAULT_ANTHROPIC_FREE,
  type Provider,
} from '@/platform/utils/defaultModel';
import { notifyEgressConfigChange } from '@/platform/hooks/useActiveEgressProvider';

export type Profession = 'legal' | 'tax' | 'consulting' | 'advisor' | 'other';

export interface ProfessionModelDefault {
  provider: Provider;
  model: string;
}

/**
 * Default provider + model per profession.
 *
 * Reasoning:
 *   - legal / tax / consulting / advisor: client-confidential, accuracy-
 *     sensitive work. Default to a strong Claude model (Sonnet 4.6), the best
 *     capability-per-dollar default we ship. These users are the paying ICP and
 *     are better served by a capable default than the cheapest one.
 *   - other: a general user who may be on the free tier. Default to the cheap,
 *     capable Claude Haiku 4.5 so they are not surprised by cost.
 *
 * Anthropic is the default provider across the board: it is the provider we
 * lead with, write the fullest "get your key" tutorial for, and the one the
 * sample/legal content references.
 */
const PROFESSION_MODEL_DEFAULTS: Record<Profession, ProfessionModelDefault> = {
  legal: { provider: 'anthropic', model: DEFAULT_ANTHROPIC_PAID },
  tax: { provider: 'anthropic', model: DEFAULT_ANTHROPIC_PAID },
  consulting: { provider: 'anthropic', model: DEFAULT_ANTHROPIC_PAID },
  advisor: { provider: 'anthropic', model: DEFAULT_ANTHROPIC_PAID },
  other: { provider: 'anthropic', model: DEFAULT_ANTHROPIC_FREE },
};

/** localStorage key the chosen default model is persisted under. */
export const PROFESSION_MODEL_STORAGE_KEY = 'keepance_default_model';
/** localStorage key the chosen default provider is persisted under. */
export const PROFESSION_PROVIDER_STORAGE_KEY = 'keepance_default_provider';

/**
 * Return the default provider + model for a profession. Unknown professions
 * fall back to the 'other' default rather than throwing.
 */
export function getModelForProfession(
  profession: string | null | undefined,
): ProfessionModelDefault {
  if (
    profession === 'legal' ||
    profession === 'tax' ||
    profession === 'consulting' ||
    profession === 'advisor' ||
    profession === 'other'
  ) {
    return PROFESSION_MODEL_DEFAULTS[profession];
  }
  return PROFESSION_MODEL_DEFAULTS.other;
}

/**
 * Persist the profession's default provider + model so the AI pane can pick it
 * up as a fallback for the user's first chat. Never overwrites a value that is
 * already set (the user, or an earlier onboarding run, takes precedence).
 */
export function persistProfessionModelDefault(
  profession: string | null | undefined,
): ProfessionModelDefault {
  const def = getModelForProfession(profession);
  try {
    if (localStorage.getItem(PROFESSION_MODEL_STORAGE_KEY) == null) {
      localStorage.setItem(PROFESSION_MODEL_STORAGE_KEY, def.model);
    }
    if (localStorage.getItem(PROFESSION_PROVIDER_STORAGE_KEY) == null) {
      localStorage.setItem(PROFESSION_PROVIDER_STORAGE_KEY, def.provider);
      // Let the always-visible egress badge re-resolve against the new default
      // provider (it only honours a default that has a key, so usually a no-op
      // until a key is added — but keeps the single reactive source honest).
      notifyEgressConfigChange();
    }
  } catch {
    // localStorage may be unavailable (strict privacy mode); the default is
    // still returned so callers can use it in-memory.
  }
  return def;
}
