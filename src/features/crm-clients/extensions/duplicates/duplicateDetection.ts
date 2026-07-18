import type { HouseholdDirectoryEntry } from '@/features/crm-clients';

export interface DuplicateHouseholdRecord {
  readonly id: string;
  readonly name: string;
}

export interface DuplicateHouseholdMatch {
  readonly normalizedName: string;
  readonly explanation: 'same-normalized-household-name';
  readonly records: readonly [
    DuplicateHouseholdRecord,
    DuplicateHouseholdRecord,
  ];
}

/**
 * The sole matching rule is intentionally narrow and reproducible. It cannot
 * infer identity from partial names, contact details, or hidden record data.
 */
export function normalizeDuplicateHouseholdName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

/** Returns stable, explainable candidate pairs without changing their source records. */
export function findLikelyDuplicateHouseholds(
  households: readonly HouseholdDirectoryEntry[]
): readonly DuplicateHouseholdMatch[] {
  const grouped = new Map<string, DuplicateHouseholdRecord[]>();
  for (const household of households) {
    const normalizedName = normalizeDuplicateHouseholdName(household.name);
    if (!normalizedName) continue;
    const matches = grouped.get(normalizedName) ?? [];
    matches.push({ id: household.id, name: household.name });
    grouped.set(normalizedName, matches);
  }

  return [...grouped.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([normalizedName, records]) =>
      records
        .slice()
        .sort((left, right) => left.id.localeCompare(right.id))
        .flatMap((left, index, sorted) =>
          sorted.slice(index + 1).map((right) => ({
            normalizedName,
            explanation: 'same-normalized-household-name' as const,
            records: [left, right] as const,
          }))
        )
    );
}
