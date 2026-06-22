import type { ConfidentialityMode } from './egress';

/** Settings key recording that a personal user made an explicit confidentiality choice. */
export const CONFIDENTIALITY_CHOICE_MADE_KEY = 'confidentialityChoiceMade';

export interface EgressResolutionInput {
  isFirm: boolean;
  storedMode: ConfidentialityMode | undefined;
  choiceMade: boolean;
}

export interface EgressResolution {
  effectiveMode: ConfidentialityMode;
  allowCloudGeneration: boolean;
  needsChoice: boolean;
}

/**
 * Safe-by-default: a PERSONAL install never permits cloud answer generation
 * until the user has made an explicit, informed choice. Retrieval is always
 * local and unaffected. Firm installs keep their stored mode untouched.
 */
export function resolveEffectiveEgress(input: EgressResolutionInput): EgressResolution {
  if (input.isFirm) {
    const mode = input.storedMode ?? 'direct';
    return { effectiveMode: mode, allowCloudGeneration: mode !== 'local-only', needsChoice: false };
  }
  if (!input.choiceMade) {
    return { effectiveMode: 'local-only', allowCloudGeneration: false, needsChoice: true };
  }
  const mode = input.storedMode ?? 'local-only';
  return { effectiveMode: mode, allowCloudGeneration: mode !== 'local-only', needsChoice: false };
}
