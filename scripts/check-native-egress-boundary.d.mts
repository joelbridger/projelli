export interface NativeEgressBoundaryViolation {
  relPath: string;
  line: number;
  text: string;
  rule?: string;
}

export function findNativeEgressBoundaryViolations(
  root?: string,
): NativeEgressBoundaryViolation[];
