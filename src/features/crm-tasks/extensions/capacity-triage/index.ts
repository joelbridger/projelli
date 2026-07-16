/** Public doorway for deterministic task capacity triage. */
export { capacityTriageTaskAction } from './descriptor';
export { useCapacityTriagePreference } from './preferences';
export {
  buildCapacityTriage,
  DEFAULT_CAPACITY_TRIAGE_PREFERENCE,
} from './triage';
export type {
  CapacityTriageAssignee,
  CapacityTriageDuePressure,
  CapacityTriageInput,
  CapacityTriagePreference,
  CapacityTriagePreferenceOperation,
  CapacityTriagePriority,
  CapacityTriageResult,
} from './contract';
