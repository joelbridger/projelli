import type {
  ContactDirectoryProjection,
  ContactRef,
} from '@/features/crm-contacts';
import type { HouseholdDirectoryEntry } from '@/features/crm-clients';

export interface DuplicateContactRecord {
  readonly id: string;
  readonly name: string;
  readonly ref: ContactRef;
}

export type DuplicateExplanation =
  | 'same-normalized-contact-name'
  | 'same-last-name-and-known-given-name-alias';

export interface DuplicateContactMatch {
  readonly normalizedName: string;
  readonly explanation: DuplicateExplanation;
  readonly records: readonly [DuplicateContactRecord, DuplicateContactRecord];
}

/** Kept as a narrow compatibility shape for household-only callers. */
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

const GIVEN_NAME_ALIASES: Readonly<Record<string, string>> = {
  bob: 'robert',
  bobby: 'robert',
  rob: 'robert',
  robert: 'robert',
};

/** The narrow, reproducible normalization used in every explanation. */
export function normalizeDuplicateHouseholdName(name: string): string {
  return name.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, '');
}

function normalizedNameParts(name: string): readonly string[] {
  return name.toLowerCase().match(/[\p{L}\p{N}]+/gu) ?? [];
}

function knownGivenNameAliasKey(name: string): string | null {
  const parts = normalizedNameParts(name);
  if (parts.length < 2) return null;
  const firstName = parts[0];
  const lastName = parts[parts.length - 1];
  if (!firstName || !lastName) return null;
  const alias = Object.entries(GIVEN_NAME_ALIASES).find(
    ([nickname]) => nickname === firstName
  );
  return alias ? `${alias[1]}${lastName}` : null;
}

function referenceKey(ref: ContactRef): string {
  return `${ref.kind}:${ref.matterId}:${ref.id}`;
}

function compareRecords(
  left: DuplicateContactRecord,
  right: DuplicateContactRecord
): number {
  return referenceKey(left.ref).localeCompare(referenceKey(right.ref));
}

/**
 * Finds person-contact candidates through the canonical directory projection.
 * Exact normalized names and the deliberately small, documented Robert/Bob
 * alias class are the only rules, so every result remains reproducible.
 */
export function findLikelyDuplicateContacts(
  contacts: readonly ContactDirectoryProjection[]
): readonly DuplicateContactMatch[] {
  const people = contacts
    .filter((contact) => contact.kind === 'person')
    .map(
      (contact): DuplicateContactRecord => ({
        id: contact.id,
        name: contact.displayName,
        ref: contact.ref,
      })
    )
    .filter(
      (contact) => normalizeDuplicateHouseholdName(contact.name).length > 0
    )
    .slice()
    .sort(compareRecords);
  const matches: DuplicateContactMatch[] = [];

  for (let leftIndex = 0; leftIndex < people.length; leftIndex += 1) {
    const left = people[leftIndex];
    const leftNormalizedName = normalizeDuplicateHouseholdName(left.name);
    const leftAliasKey = knownGivenNameAliasKey(left.name);
    for (const right of people.slice(leftIndex + 1)) {
      const rightNormalizedName = normalizeDuplicateHouseholdName(right.name);
      const rightAliasKey = knownGivenNameAliasKey(right.name);
      if (leftNormalizedName === rightNormalizedName) {
        matches.push({
          normalizedName: leftNormalizedName,
          explanation: 'same-normalized-contact-name',
          records: [left, right],
        });
      } else if (leftAliasKey && leftAliasKey === rightAliasKey) {
        matches.push({
          normalizedName: leftAliasKey,
          explanation: 'same-last-name-and-known-given-name-alias',
          records: [left, right],
        });
      }
    }
  }

  return matches.sort(
    (left, right) =>
      left.normalizedName.localeCompare(right.normalizedName) ||
      left.explanation.localeCompare(right.explanation) ||
      compareRecords(left.records[0], right.records[0]) ||
      compareRecords(left.records[1], right.records[1])
  );
}

/** Returns stable, explainable candidate pairs without changing their source records. */
export function findLikelyDuplicateHouseholds(
  households: readonly HouseholdDirectoryEntry[]
): readonly DuplicateHouseholdMatch[] {
  const grouped = new Map<string, DuplicateHouseholdRecord[]>();
  for (const household of households) {
    const normalizedName = normalizeDuplicateHouseholdName(household.name);
    if (!normalizedName) continue;
    const records = grouped.get(normalizedName) ?? [];
    records.push({ id: household.id, name: household.name });
    grouped.set(normalizedName, records);
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
