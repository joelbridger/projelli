export interface ExactCaseCollision {
  files: string[];
}
export interface StemCaseCollision {
  files: string[];
}
export interface CaseCollisions {
  exact: ExactCaseCollision[];
  stems: StemCaseCollision[];
}
export function findCaseCollisions(files?: string[]): CaseCollisions;
