import type { HouseholdRecord } from '../../adapters';

export const PROFESSIONAL_CONTACTS_DATA_KEY =
  'crm.professional-contacts' as const;

export const professionalContactKinds = [
  'trusted_contact',
  'cpa',
  'estate_attorney',
  'insurance_professional',
] as const;

export type ProfessionalContactKind = (typeof professionalContactKinds)[number];

export interface ProfessionalContact {
  name: string;
  relationship: string;
  organization: string;
  email: string;
  phone: string;
  notes: string;
}

export type ProfessionalContactsData = Readonly<
  Record<ProfessionalContactKind, ProfessionalContact | null>
>;

const emptyContact = (): ProfessionalContact => ({
  name: '',
  relationship: '',
  organization: '',
  email: '',
  phone: '',
  notes: '',
});

export const emptyProfessionalContacts = (): ProfessionalContactsData => ({
  trusted_contact: null,
  cpa: null,
  estate_attorney: null,
  insurance_professional: null,
});

function isProfessionalContact(value: unknown): value is ProfessionalContact {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const contact = value as Record<string, unknown>;
  const fields = [
    'name',
    'relationship',
    'organization',
    'email',
    'phone',
    'notes',
  ];
  return (
    Object.keys(contact).length === fields.length &&
    fields.every((field) => typeof contact[field] === 'string')
  );
}

/** Reject malformed stored values before they can reach the record surface. */
export function isProfessionalContactsData(
  value: unknown
): value is ProfessionalContactsData {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const data = value as Record<string, unknown>;
  return (
    Object.keys(data).length === professionalContactKinds.length &&
    professionalContactKinds.every(
      (kind) => data[kind] === null || isProfessionalContact(data[kind])
    )
  );
}

export function professionalContactsFor(
  household: HouseholdRecord
): ProfessionalContactsData {
  const candidate = household.extensionData?.[PROFESSIONAL_CONTACTS_DATA_KEY];
  return isProfessionalContactsData(candidate)
    ? candidate
    : emptyProfessionalContacts();
}

/**
 * The extension owns its namespaced payload. This keeps new record-depth
 * features out of the shared HouseholdRecord contract.
 */
export function withProfessionalContacts(
  household: HouseholdRecord,
  data: ProfessionalContactsData
): HouseholdRecord {
  return {
    ...household,
    extensionData: {
      ...household.extensionData,
      [PROFESSIONAL_CONTACTS_DATA_KEY]: data,
    },
  };
}

export function blankProfessionalContact(): ProfessionalContact {
  return emptyContact();
}
