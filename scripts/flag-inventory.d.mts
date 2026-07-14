export interface InventoryFlag {
  id: string;
  ownerLane: string;
  createdAt: string;
  expiresAt: string;
}
export function ageInDays(createdAt: string, now?: Date): number;
export function formatInventory(
  flags: readonly InventoryFlag[],
  now?: Date
): string;
export function main(): void;
