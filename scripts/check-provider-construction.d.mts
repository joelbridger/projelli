export interface ProviderConstructionViolation {
  relPath: string;
  line: number;
  text: string;
}
export function findProviderConstructionViolations(root?: string): ProviderConstructionViolation[];
