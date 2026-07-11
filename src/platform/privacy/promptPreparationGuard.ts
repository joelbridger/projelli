/**
 * Cloud adapters import this narrow boundary so they cannot mint preparation
 * proofs themselves. The proof registry and its creator live in the only
 * module allowed to prepare prompts.
 */
export {
  assertCloudPreparation,
  getPreparationEnforcementMode,
  isPreparationStamp,
  setPreparationEnforcementMode,
  type PreparationEnforcementMode,
  type PreparationStamp,
} from './promptPreparation';
