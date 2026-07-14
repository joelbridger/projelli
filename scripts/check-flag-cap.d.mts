export const ACTIVE_FLAG_CAP: 15;
export interface FlagCapResult {
  ok: boolean;
  message: string;
}
export function checkFlagCap(
  flags: readonly unknown[],
  cap?: number
): FlagCapResult;
export function main(): number;
