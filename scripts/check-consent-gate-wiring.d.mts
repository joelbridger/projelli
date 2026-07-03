export interface ConsentGateViolation {
  kind: 'ungated-ambient' | 'unclassified' | 'stale-list-entry';
  relPath: string;
  detail: string;
}
export function findConsentGateViolations(root?: string): ConsentGateViolation[];
