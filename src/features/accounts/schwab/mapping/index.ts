import type { MaskedClientFact } from '@/platform/intake/factsStore';

export const schwabAccountTypes = [
  'individual',
  'joint',
  'roth-ira',
  'traditional-ira',
  'rollover-ira',
  'inherited-ira',
  'living-trust',
  'custodial',
] as const;
export type SchwabAccountType = (typeof schwabAccountTypes)[number];
export type SchwabFieldKey =
  | 'ownerName'
  | 'ownerDob'
  | 'ownerSsn'
  | 'jointOwnerName'
  | 'jointOwnerDob'
  | 'jointOwnerSsn'
  | 'address'
  | 'email'
  | 'phone'
  | 'fundingSource'
  | 'beneficiaries'
  | 'iraContributionYear'
  | 'decedentName'
  | 'decedentDob'
  | 'trustName'
  | 'trustDate'
  | 'trusteeName'
  | 'trusteeEmail'
  | 'minorName'
  | 'minorDob'
  | 'custodianName'
  | 'custodianSsn';

export interface SchwabFieldDefinition {
  key: SchwabFieldKey;
  required: boolean;
  secret?: boolean;
}
export interface SchwabCandidate {
  value: string;
  source: 'advisor-intake' | 'verified-intake' | 'crm' | 'meeting';
  sourceRef?: string;
}
export interface SchwabProposedField extends SchwabFieldDefinition {
  label: string;
  candidates: readonly SchwabCandidate[];
  value: string;
  source: SchwabCandidate['source'] | 'blank';
  conflict: boolean;
}
/** Minimal record view accepted at the feature boundary; CRM keeps its richer shape private. */
export interface SchwabHousehold {
  id: string;
  name: string;
  facts: readonly { label: string; value: string }[];
  members: readonly {
    id?: string;
    name: string;
    personType: 'person' | 'trust' | 'organization';
    roles?: readonly string[];
    relatedHouseholds?: number;
    householdRole?: string;
    addresses?: readonly {
      id?: string;
      address: string;
      city: string;
      state: string;
      zip: string;
      kind?: string;
      primary: boolean;
    }[];
    emails?: readonly {
      id?: string;
      address: string;
      kind?: string;
      primary: boolean;
    }[];
    phones?: readonly {
      id?: string;
      address: string;
      kind?: string;
      primary: boolean;
    }[];
  }[];
}
export interface SchwabReviewInput {
  household: SchwabHousehold;
  facts: readonly MaskedClientFact[];
  meetingSuggestions?: Readonly<Record<SchwabFieldKey, string>>;
}

const common: readonly SchwabFieldDefinition[] = [
  { key: 'ownerName', required: true },
  { key: 'ownerDob', required: true },
  { key: 'ownerSsn', required: true, secret: true },
  { key: 'address', required: true },
  { key: 'email', required: true },
  { key: 'phone', required: true },
  { key: 'fundingSource', required: true },
  { key: 'beneficiaries', required: false },
];
const ira: readonly SchwabFieldDefinition[] = [
  ...common,
  { key: 'iraContributionYear', required: false },
];
export const schwabFieldMaps: Readonly<
  Record<SchwabAccountType, readonly SchwabFieldDefinition[]>
> = {
  individual: common,
  joint: [
    ...common,
    { key: 'jointOwnerName', required: true },
    { key: 'jointOwnerDob', required: true },
    { key: 'jointOwnerSsn', required: true, secret: true },
  ],
  'roth-ira': ira,
  'traditional-ira': ira,
  'rollover-ira': ira,
  'inherited-ira': [
    ...ira,
    { key: 'decedentName', required: true },
    { key: 'decedentDob', required: false },
  ],
  'living-trust': [
    { key: 'trustName', required: true },
    { key: 'trustDate', required: false },
    { key: 'trusteeName', required: true },
    { key: 'trusteeEmail', required: false },
    { key: 'address', required: true },
    { key: 'phone', required: true },
    { key: 'email', required: true },
    { key: 'fundingSource', required: true },
    { key: 'beneficiaries', required: false },
  ],
  custodial: [
    { key: 'minorName', required: true },
    { key: 'minorDob', required: true },
    { key: 'custodianName', required: true },
    { key: 'custodianSsn', required: true, secret: true },
    { key: 'address', required: true },
    { key: 'phone', required: true },
    { key: 'email', required: true },
    { key: 'fundingSource', required: true },
    { key: 'beneficiaries', required: false },
  ],
};

const labels: Record<SchwabFieldKey, string> = {
  ownerName: 'ownerName',
  ownerDob: 'ownerDob',
  ownerSsn: 'ownerSsn',
  jointOwnerName: 'jointOwnerName',
  jointOwnerDob: 'jointOwnerDob',
  jointOwnerSsn: 'jointOwnerSsn',
  address: 'address',
  email: 'email',
  phone: 'phone',
  fundingSource: 'fundingSource',
  beneficiaries: 'beneficiaries',
  iraContributionYear: 'iraContributionYear',
  decedentName: 'decedentName',
  decedentDob: 'decedentDob',
  trustName: 'trustName',
  trustDate: 'trustDate',
  trusteeName: 'trusteeName',
  trusteeEmail: 'trusteeEmail',
  minorName: 'minorName',
  minorDob: 'minorDob',
  custodianName: 'custodianName',
  custodianSsn: 'custodianSsn',
};
export function schwabFieldLabel(key: SchwabFieldKey): string {
  return labels[key];
}

function memberFor(subject: string, household: SchwabHousehold) {
  const normalized = subject.toLowerCase();
  if (normalized.includes('joint')) return household.members[1];
  if (normalized.includes('minor'))
    return household.members.find((member) =>
      /minor|child/i.test(member.householdRole ?? '')
    );
  if (normalized.includes('custodian'))
    return household.members.find((member) =>
      /custodian/i.test(member.householdRole ?? '')
    );
  if (normalized.includes('trust'))
    return household.members.find((member) => member.personType === 'trust');
  return household.members[0];
}
function crmValue(key: SchwabFieldKey, household: SchwabHousehold): string {
  const primary = memberFor(key, household);
  if (key === 'ownerName') return primary?.name ?? household.name;
  if (key === 'jointOwnerName') return household.members[1]?.name ?? '';
  if (key === 'minorName') return memberFor('minor', household)?.name ?? '';
  if (key === 'custodianName')
    return memberFor('custodian', household)?.name ?? '';
  if (key === 'trustName')
    return (
      household.members.find((member) => member.personType === 'trust')?.name ??
      ''
    );
  if (key === 'address') {
    const address =
      primary?.addresses?.find((item) => item.primary) ??
      primary?.addresses?.[0];
    return address
      ? [address.address, address.city, address.state, address.zip]
          .filter(Boolean)
          .join(', ')
      : '';
  }
  if (key === 'email' || key === 'trusteeEmail')
    return (
      (primary?.emails?.find((item) => item.primary) ?? primary?.emails?.[0])
        ?.address ?? ''
    );
  if (key === 'phone')
    return (
      (primary?.phones?.find((item) => item.primary) ?? primary?.phones?.[0])
        ?.address ?? ''
    );
  const fact = household.facts.find((item) =>
    item.label
      .toLowerCase()
      .replaceAll(' ', '')
      .includes(key.toLowerCase().replaceAll('owner', ''))
  );
  return fact?.value ?? '';
}
function factMatches(key: SchwabFieldKey, fact: MaskedClientFact): boolean {
  const subject = fact.subject.toLowerCase();
  const expected = key.startsWith('joint')
    ? ['joint', 'joint owner']
    : key.startsWith('decedent')
      ? ['decedent']
      : key.startsWith('minor')
        ? ['minor', 'child']
        : key.startsWith('custodian')
          ? ['custodian']
          : key.startsWith('trust') || key.startsWith('trustee')
            ? ['trust', 'trustee']
            : ['primary', 'primary owner', 'owner'];
  if (!expected.includes(subject)) return false;
  if (key.endsWith('Ssn')) return fact.kind === 'ssn';
  if (key.endsWith('Dob')) return fact.kind === 'dob';
  if (key === 'address') return fact.kind === 'address';
  if (key === 'beneficiaries') return fact.kind === 'beneficiary';
  return false;
}
function sourceForFact(fact: MaskedClientFact): SchwabCandidate['source'] {
  return fact.verification === 'advisor_confirmed'
    ? 'advisor-intake'
    : 'verified-intake';
}
const sourcePriority: Record<SchwabCandidate['source'], number> = {
  'advisor-intake': 0,
  'verified-intake': 1,
  crm: 2,
  meeting: 3,
};
export function buildSchwabProposal(
  type: SchwabAccountType,
  input: SchwabReviewInput
): readonly SchwabProposedField[] {
  return schwabFieldMaps[type].map((definition) => {
    const candidates: SchwabCandidate[] = input.facts
      .filter((fact) => factMatches(definition.key, fact))
      .map((fact) => ({
        value: fact.display_value,
        source: sourceForFact(fact),
        sourceRef: fact.fact_id,
      }));
    const crm = crmValue(definition.key, input.household);
    if (crm) candidates.push({ value: crm, source: 'crm' });
    const meeting = input.meetingSuggestions?.[definition.key];
    if (meeting) candidates.push({ value: meeting, source: 'meeting' });
    const unique = [
      ...new Map(
        candidates
          .sort(
            (left, right) =>
              sourcePriority[left.source] - sourcePriority[right.source]
          )
          .map((candidate) => [candidate.value, candidate])
      ).values(),
    ];
    const chosen = unique[0];
    return {
      ...definition,
      label: schwabFieldLabel(definition.key),
      candidates: unique,
      value: unique.length === 1 ? (chosen?.value ?? '') : '',
      source: unique.length === 1 ? (chosen?.source ?? 'blank') : 'blank',
      conflict: unique.length > 1,
    };
  });
}
