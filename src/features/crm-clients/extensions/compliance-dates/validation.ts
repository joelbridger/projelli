import {
  COMPLIANCE_DATE_FIELDS,
  EMPTY_COMPLIANCE_DATES,
  type ComplianceDateField,
  type ComplianceDatesPayload,
} from './types';

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** Returns true only for a real calendar date written as YYYY-MM-DD. */
export function isValidComplianceDate(value: unknown): value is string {
  if (typeof value !== 'string') return false;
  const match = ISO_DATE.exec(value);
  if (!match) return false;

  const year = Number(match[1]);
  const month = Number(match[2]);
  const day = Number(match[3]);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year &&
    date.getUTCMonth() === month - 1 &&
    date.getUTCDate() === day
  );
}

export function isComplianceDatesPayload(
  value: unknown
): value is ComplianceDatesPayload {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const candidate = value as Record<string, unknown>;
  return COMPLIANCE_DATE_FIELDS.every((field) => {
    const date = candidate[field];
    return date === null || isValidComplianceDate(date);
  });
}

export type ComplianceDatesValidation =
  | { valid: true; value: ComplianceDatesPayload }
  | { valid: false; field: ComplianceDateField; message: string };

/** Validates editor input without filling in a missing date. */
export function validateComplianceDates(
  value: ComplianceDatesPayload
): ComplianceDatesValidation {
  for (const field of COMPLIANCE_DATE_FIELDS) {
    const date = value[field];
    if (date !== null && !isValidComplianceDate(date)) {
      return {
        valid: false,
        field,
        message: 'Enter a real date in YYYY-MM-DD format, or leave it blank.',
      };
    }
  }
  return { valid: true, value };
}

/** Reads only valid durable data; malformed legacy data stays visibly missing. */
export function readComplianceDates(value: unknown): ComplianceDatesPayload {
  if (!isComplianceDatesPayload(value)) return { ...EMPTY_COMPLIANCE_DATES };
  return { ...value };
}
