import type { HouseholdRecord } from '../../adapters';

/** The namespaced bag keeps advisor-entered values separate from firm definitions. */
export const CUSTOM_FIELD_VALUES_DATA_KEY = 'custom-fields.advisor';

/**
 * Values are keyed by the firm catalog's stable field id, never its display
 * name. A renamed or retired definition therefore cannot rewrite client data.
 */
export type CustomFieldValue = string | number | boolean | readonly string[];
export type CustomFieldValues = Readonly<Record<string, CustomFieldValue>>;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isValue(value: unknown): value is CustomFieldValue {
  return (
    typeof value === 'string' ||
    typeof value === 'boolean' ||
    (typeof value === 'number' && Number.isFinite(value)) ||
    (Array.isArray(value) && value.every((item) => typeof item === 'string'))
  );
}

export function isCustomFieldValues(
  value: unknown
): value is CustomFieldValues {
  return isRecord(value) && Object.values(value).every(isValue);
}

function copyValues(values: CustomFieldValues): CustomFieldValues {
  const copied: Record<string, CustomFieldValue> = {};
  for (const id of Object.keys(values)) {
    const value = values[id];
    if (value === undefined) continue;
    copied[id] = Array.isArray(value)
      ? value.filter((item): item is string => typeof item === 'string')
      : value;
  }
  return copied;
}

/** Reads only this feature's bag; unrelated extension namespaces stay opaque. */
export function readCustomFieldValues(
  household: Pick<HouseholdRecord, 'extensionData'>
): CustomFieldValues {
  const candidate = household.extensionData?.[CUSTOM_FIELD_VALUES_DATA_KEY];
  return isCustomFieldValues(candidate) ? copyValues(candidate) : {};
}

/**
 * Produces a full-record save while preserving every sibling extension bag.
 * The caller supplies the complete value map so unknown/retired field ids are
 * retained instead of being silently removed by the current field catalog.
 */
export function withCustomFieldValues(
  household: HouseholdRecord,
  values: CustomFieldValues
): HouseholdRecord {
  if (!isCustomFieldValues(values)) {
    throw new Error('Custom field values contain an invalid value.');
  }
  return {
    ...household,
    extensionData: {
      ...household.extensionData,
      [CUSTOM_FIELD_VALUES_DATA_KEY]: copyValues(values),
    },
  };
}
