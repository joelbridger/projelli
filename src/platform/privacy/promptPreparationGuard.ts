/**
 * Tiny, dependency-free capability check used at the cloud-provider boundary.
 *
 * Keep this separate from promptPreparation.ts: cloud providers are imported by
 * many legacy callers, and warn-mode observation must not change their module
 * loading or request scheduling.
 */
declare const preparationBrand: unique symbol;
export interface PreparationStamp { readonly [preparationBrand]: 'prepared-cloud-request'; }

const validStamps = new WeakSet();

export function createPreparationStamp(): PreparationStamp {
  const stamp = {} as PreparationStamp;
  validStamps.add(stamp);
  return stamp;
}

export function isPreparationStamp(value: unknown): value is PreparationStamp {
  return typeof value === 'object' && value !== null && validStamps.has(value);
}

export type PreparationEnforcementMode = 'off' | 'warn' | 'enforce';
// Cloud requests are fail-closed by default. Observation-only mode was the
// migration bridge; callers must now explicitly opt out in a narrowly scoped
// test or diagnostic, never accidentally send an unprepared request.
let enforcementMode: PreparationEnforcementMode = 'enforce';

export function setPreparationEnforcementMode(mode: PreparationEnforcementMode): void {
  enforcementMode = mode;
}

export function getPreparationEnforcementMode(): PreparationEnforcementMode {
  return enforcementMode;
}

/** Cloud adapters call this immediately before their first network request. */
export function assertCloudPreparation(stamp: unknown, provider: string): void {
  if (isPreparationStamp(stamp) || enforcementMode === 'off') return;
  const message = `[prompt preparation] cloud ${provider} request was not prepared`;
  if (enforcementMode === 'enforce') throw new Error(message);
  // Warn mode is deliberately synchronous, side-effect-only observation.
  console.warn(message);
}
