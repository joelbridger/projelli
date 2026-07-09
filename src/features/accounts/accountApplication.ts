import type { Matter } from '@/platform/types/matter';
import type { CrmHouseholdDto } from '@/platform/utils/wealthbox-commands';
import type { TranscriptFile } from '@/platform/types/meeting';

export enum AccountType {
  Individual = 'individual',
  Joint = 'joint',
  RothIra = 'roth-ira',
  TraditionalIra = 'traditional-ira',
  RolloverIra = 'rollover-ira',
  InheritedIra = 'inherited-ira',
  LivingTrust = 'living-trust',
  Custodial = 'custodial',
}

export type AccountFieldGroup =
  | 'owner'
  | 'joint-owner'
  | 'contact'
  | 'funding'
  | 'beneficiaries'
  | 'trust'
  | 'custodial'
  | 'inherited';

export type AccountFieldStorage = 'plain' | 'redact-on-store';

export type AccountFieldKey =
  | 'ownerName'
  | 'ownerDob'
  | 'ownerSsn'
  | 'jointOwnerName'
  | 'jointOwnerDob'
  | 'jointOwnerSsn'
  | 'addressLine1'
  | 'addressLine2'
  | 'city'
  | 'state'
  | 'postalCode'
  | 'phone'
  | 'email'
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

export interface AccountFieldDefinition {
  key: AccountFieldKey;
  label: string;
  group: AccountFieldGroup;
  storage: AccountFieldStorage;
  required: boolean;
  multiline: boolean;
}

export interface AccountApplicationField extends AccountFieldDefinition {
  value: string;
  editable: true;
  source: AccountPrefillSource | null;
  redactedValue?: string;
}

export type AccountApplicationFields = Record<AccountFieldKey, AccountApplicationField>;

export interface AccountApplicationDraft {
  id: string;
  matterId: string;
  accountType: AccountType;
  templateId: string;
  templateStatus: 'placeholder';
  fieldOrder: AccountFieldKey[];
  fields: AccountApplicationFields;
  updatedAt: string;
}

export type AccountDeliveryMode = 'pdf' | 'docusign';

export interface AccountPrefillSource {
  kind: 'matter' | 'crm-household' | 'crm-contact' | 'meeting-summary' | 'meeting-transcript';
  label: string;
}

export interface AccountCrmAddress {
  address?: string;
  city?: string;
  state?: string;
  zip?: string;
  kind?: string;
  principal?: boolean;
}

export interface AccountCrmEmailAddress {
  address?: string;
  kind?: string;
  principal?: boolean;
}

export interface AccountCrmPhoneNumber {
  address?: string;
  kind?: string;
  principal?: boolean;
}

/**
 * Renderer-side subset of the normalized CRM contact model from
 * src-tauri/src/commands/crm/model.rs. Field names intentionally match the
 * existing CRM model instead of inventing account-specific names.
 */
export interface AccountCrmContact {
  id: string | number;
  type?: string;
  name?: string;
  first_name?: string;
  middle_name?: string;
  last_name?: string;
  prefix?: string;
  suffix?: string;
  company_name?: string;
  birth_date?: string | null;
  street_addresses?: AccountCrmAddress[];
  email_addresses?: AccountCrmEmailAddress[];
  phone_numbers?: AccountCrmPhoneNumber[];
}

export interface AccountCrmContext {
  household?: CrmHouseholdDto;
  contacts?: AccountCrmContact[];
}

export interface AccountMeetingSummaryShape {
  dir: string;
  folderName: string;
  meta: {
    matterId: string;
    startedAt: string;
    calendarTitle?: string;
  } | null;
  hasNotes: boolean;
  hasAudio: boolean;
  hasTranscript: boolean;
}

export interface MeetingApplicationFacts {
  fundingSource?: string;
  beneficiaries?: string;
  trusteeName?: string;
  custodianName?: string;
  minorName?: string;
}

export interface MeetingApplicationSummary {
  meeting?: AccountMeetingSummaryShape;
  notesText?: string;
  transcript?: TranscriptFile;
  structuredFacts?: MeetingApplicationFacts;
}

export interface PrefillAccountApplicationInput {
  accountType: AccountType;
  matter: Matter;
  crm?: AccountCrmContext;
  meetingSummary?: MeetingApplicationSummary;
}

const COMMON_OWNER_FIELDS: AccountFieldKey[] = [
  'ownerName',
  'ownerDob',
  'ownerSsn',
  'addressLine1',
  'addressLine2',
  'city',
  'state',
  'postalCode',
  'phone',
  'email',
  'fundingSource',
];

const IRA_FIELDS: AccountFieldKey[] = [
  ...COMMON_OWNER_FIELDS,
  'iraContributionYear',
  'beneficiaries',
];

export const ACCOUNT_FIELD_DEFINITIONS: AccountApplicationFields = {
  ownerName: field('ownerName', 'Owner name', 'owner', 'plain', true),
  ownerDob: field('ownerDob', 'Date of birth', 'owner', 'plain', true),
  ownerSsn: field('ownerSsn', 'Social Security number', 'owner', 'redact-on-store', true),
  jointOwnerName: field('jointOwnerName', 'Joint owner name', 'joint-owner', 'plain', true),
  jointOwnerDob: field('jointOwnerDob', 'Joint owner date of birth', 'joint-owner', 'plain', true),
  jointOwnerSsn: field('jointOwnerSsn', 'Joint owner Social Security number', 'joint-owner', 'redact-on-store', true),
  addressLine1: field('addressLine1', 'Street address', 'contact', 'plain', true),
  addressLine2: field('addressLine2', 'Apartment or suite', 'contact', 'plain'),
  city: field('city', 'City', 'contact', 'plain', true),
  state: field('state', 'State', 'contact', 'plain', true),
  postalCode: field('postalCode', 'ZIP code', 'contact', 'plain', true),
  phone: field('phone', 'Phone', 'contact', 'plain', true),
  email: field('email', 'Email', 'contact', 'plain', true),
  fundingSource: field('fundingSource', 'Funding source', 'funding', 'plain', true, true),
  beneficiaries: field('beneficiaries', 'Beneficiaries', 'beneficiaries', 'plain', false, true),
  iraContributionYear: field('iraContributionYear', 'IRA contribution year', 'funding', 'plain'),
  decedentName: field('decedentName', 'Decedent name', 'inherited', 'plain', true),
  decedentDob: field('decedentDob', 'Decedent date of birth', 'inherited', 'plain'),
  trustName: field('trustName', 'Trust name', 'trust', 'plain', true),
  trustDate: field('trustDate', 'Trust date', 'trust', 'plain'),
  trusteeName: field('trusteeName', 'Trustee name', 'trust', 'plain', true),
  trusteeEmail: field('trusteeEmail', 'Trustee email', 'trust', 'plain'),
  minorName: field('minorName', 'Minor name', 'custodial', 'plain', true),
  minorDob: field('minorDob', 'Minor date of birth', 'custodial', 'plain', true),
  custodianName: field('custodianName', 'Custodian name', 'custodial', 'plain', true),
  custodianSsn: field('custodianSsn', 'Custodian Social Security number', 'custodial', 'redact-on-store', true),
};

export const ACCOUNT_APPLICATION_FIELD_MAP: Record<AccountType, AccountFieldDefinition[]> = {
  [AccountType.Individual]: defs([...COMMON_OWNER_FIELDS, 'beneficiaries']),
  [AccountType.Joint]: defs([
    ...COMMON_OWNER_FIELDS,
    'jointOwnerName',
    'jointOwnerDob',
    'jointOwnerSsn',
    'beneficiaries',
  ]),
  [AccountType.RothIra]: defs(IRA_FIELDS),
  [AccountType.TraditionalIra]: defs(IRA_FIELDS),
  [AccountType.RolloverIra]: defs(IRA_FIELDS),
  [AccountType.InheritedIra]: defs([
    ...COMMON_OWNER_FIELDS,
    'decedentName',
    'decedentDob',
    'beneficiaries',
  ]),
  [AccountType.LivingTrust]: defs([
    'trustName',
    'trustDate',
    'trusteeName',
    'trusteeEmail',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postalCode',
    'phone',
    'email',
    'fundingSource',
    'beneficiaries',
  ]),
  [AccountType.Custodial]: defs([
    'minorName',
    'minorDob',
    'custodianName',
    'custodianSsn',
    'addressLine1',
    'addressLine2',
    'city',
    'state',
    'postalCode',
    'phone',
    'email',
    'fundingSource',
    'beneficiaries',
  ]),
};

export const ACCOUNT_TYPE_LABELS: Record<AccountType, string> = {
  [AccountType.Individual]: 'Individual',
  [AccountType.Joint]: 'Joint',
  [AccountType.RothIra]: 'Roth IRA',
  [AccountType.TraditionalIra]: 'Traditional IRA',
  [AccountType.RolloverIra]: 'Rollover IRA',
  [AccountType.InheritedIra]: 'Inherited IRA',
  [AccountType.LivingTrust]: 'Living trust',
  [AccountType.Custodial]: 'Custodial',
};

function field(
  key: AccountFieldKey,
  label: string,
  group: AccountFieldGroup,
  storage: AccountFieldStorage,
  required = false,
  multiline = false,
): AccountApplicationField {
  return {
    key,
    label,
    group,
    storage,
    required,
    multiline,
    value: '',
    editable: true,
    source: null,
  };
}

function defs(keys: AccountFieldKey[]): AccountFieldDefinition[] {
  return keys.map((key) => {
    const def = ACCOUNT_FIELD_DEFINITIONS[key];
    return {
      key: def.key,
      label: def.label,
      group: def.group,
      storage: def.storage,
      required: def.required,
      multiline: def.multiline,
    };
  });
}

function cloneField(def: AccountApplicationField): AccountApplicationField {
  return {
    key: def.key,
    label: def.label,
    group: def.group,
    storage: def.storage,
    required: def.required,
    multiline: def.multiline,
    value: '',
    editable: true,
    source: null,
  };
}

export function buildAccountApplicationDraft(
  accountType: AccountType,
  matterId: string,
): AccountApplicationDraft {
  const fields = Object.fromEntries(
    (Object.keys(ACCOUNT_FIELD_DEFINITIONS) as AccountFieldKey[]).map((key) => [
      key,
      cloneField(ACCOUNT_FIELD_DEFINITIONS[key]),
    ]),
  ) as AccountApplicationFields;
  return {
    id: `account-application-${accountType}-${matterId}`,
    matterId,
    accountType,
    templateId: `placeholder-schwab-${accountType}`,
    templateStatus: 'placeholder',
    fieldOrder: ACCOUNT_APPLICATION_FIELD_MAP[accountType].map((f) => f.key),
    fields,
    updatedAt: new Date().toISOString(),
  };
}

export function prefillAccountApplication(
  input: PrefillAccountApplicationInput,
): AccountApplicationDraft {
  let draft = buildAccountApplicationDraft(input.accountType, input.matter.id);
  const primaryContact = pickPrimaryContact(input.crm?.contacts ?? []);
  const secondaryContact = pickSecondaryContact(input.crm?.contacts ?? [], primaryContact);
  const address = pickPrimary(primaryContact?.street_addresses ?? []);
  const email = pickPrimary(primaryContact?.email_addresses ?? []);
  const phone = pickPrimary(primaryContact?.phone_numbers ?? []);
  const meetingFacts = deriveMeetingFacts(input.meetingSummary);

  draft = setIfPresent(
    draft,
    'ownerName',
    contactName(primaryContact) || input.crm?.household?.name || input.matter.client || input.matter.name,
    source(primaryContact ? 'crm-contact' : input.crm?.household ? 'crm-household' : 'matter', input.crm?.household?.name ?? input.matter.client),
  );
  draft = setIfPresent(draft, 'ownerDob', primaryContact?.birth_date ?? '', source('crm-contact', 'CRM contact'));
  draft = setIfPresent(draft, 'addressLine1', address?.address ?? '', source('crm-contact', 'CRM address'));
  draft = setIfPresent(draft, 'city', address?.city ?? '', source('crm-contact', 'CRM address'));
  draft = setIfPresent(draft, 'state', address?.state ?? '', source('crm-contact', 'CRM address'));
  draft = setIfPresent(draft, 'postalCode', address?.zip ?? '', source('crm-contact', 'CRM address'));
  draft = setIfPresent(draft, 'email', email?.address ?? '', source('crm-contact', 'CRM email'));
  draft = setIfPresent(draft, 'phone', phone?.address ?? '', source('crm-contact', 'CRM phone'));
  draft = setIfPresent(draft, 'fundingSource', meetingFacts.fundingSource ?? '', source('meeting-summary', 'Meeting summary'));
  draft = setIfPresent(draft, 'beneficiaries', meetingFacts.beneficiaries ?? '', source('meeting-summary', 'Meeting summary'));
  draft = setIfPresent(draft, 'trusteeName', meetingFacts.trusteeName ?? '', source('meeting-summary', 'Meeting summary'));
  draft = setIfPresent(draft, 'minorName', meetingFacts.minorName ?? '', source('meeting-summary', 'Meeting summary'));
  draft = setIfPresent(draft, 'custodianName', meetingFacts.custodianName ?? '', source('meeting-summary', 'Meeting summary'));

  if (secondaryContact) {
    draft = setIfPresent(draft, 'jointOwnerName', contactName(secondaryContact), source('crm-contact', 'CRM contact'));
    draft = setIfPresent(draft, 'jointOwnerDob', secondaryContact.birth_date ?? '', source('crm-contact', 'CRM contact'));
  }

  return draft;
}

export function updateApplicationField(
  draft: AccountApplicationDraft,
  key: AccountFieldKey,
  value: string,
): AccountApplicationDraft {
  return {
    ...draft,
    fields: {
      ...draft.fields,
      [key]: {
        ...draft.fields[key],
        value,
        source: draft.fields[key].source,
      },
    },
    updatedAt: new Date().toISOString(),
  };
}

export function redactApplicationForStorage(
  draft: AccountApplicationDraft,
): AccountApplicationDraft {
  const fields = Object.fromEntries(
    (Object.keys(draft.fields) as AccountFieldKey[]).map((key) => {
      const fieldValue = draft.fields[key];
      if (fieldValue.storage !== 'redact-on-store') return [key, { ...fieldValue }];
      const redactedValue = redactSecret(fieldValue.value);
      return [
        key,
        {
          ...fieldValue,
          value: '',
          redactedValue,
        },
      ];
    }),
  ) as AccountApplicationFields;
  return { ...draft, fields };
}

export function buildAccountApplicationAuditMetadata(
  draft: AccountApplicationDraft,
  delivery: AccountDeliveryMode,
): Record<string, unknown> {
  const fieldOrder = draft.fieldOrder;
  const redactedFieldKeys = fieldOrder.filter(
    (key) => draft.fields[key].storage === 'redact-on-store',
  );
  const populatedFieldCount = fieldOrder.filter((key) => draft.fields[key].value.trim()).length;
  return {
    matterId: draft.matterId,
    accountType: draft.accountType,
    templateId: draft.templateId,
    templateStatus: draft.templateStatus,
    delivery,
    fieldCount: fieldOrder.length,
    populatedFieldCount,
    blankFieldCount: fieldOrder.length - populatedFieldCount,
    redactedFieldKeys,
  };
}

export function buildAccountApplicationMarkdown(draft: AccountApplicationDraft): string {
  const grouped = draft.fieldOrder.reduce<Record<AccountFieldGroup, AccountFieldKey[]>>(
    (acc, key) => {
      const group = draft.fields[key].group;
      acc[group].push(key);
      return acc;
    },
    {
      owner: [],
      'joint-owner': [],
      contact: [],
      funding: [],
      beneficiaries: [],
      trust: [],
      custodial: [],
      inherited: [],
    },
  );
  const lines = [
    `# Account application review`,
    '',
    `Template: Placeholder neutral account application`,
    `Account type: ${ACCOUNT_TYPE_LABELS[draft.accountType]}`,
    '',
    `This is a temporary clean layout. It is not an official Schwab form.`,
    '',
  ];
  for (const group of Object.keys(grouped) as AccountFieldGroup[]) {
    const keys = grouped[group];
    if (keys.length === 0) continue;
    lines.push(`## ${groupLabel(group)}`);
    for (const key of keys) {
      const f = draft.fields[key];
      const value = f.storage === 'redact-on-store'
        ? redactSecret(f.value) || f.redactedValue || ''
        : f.value;
      lines.push(`- ${f.label}: ${value}`);
    }
    lines.push('');
  }
  lines.push('## Advisor review');
  lines.push('- Advisor reviewed:');
  lines.push('- Client signature:');
  lines.push('- Date:');
  return lines.join('\n');
}

function source(kind: AccountPrefillSource['kind'], label: string): AccountPrefillSource {
  return { kind, label };
}

function setIfPresent(
  draft: AccountApplicationDraft,
  key: AccountFieldKey,
  value: string | null | undefined,
  valueSource: AccountPrefillSource,
): AccountApplicationDraft {
  const clean = (value ?? '').trim();
  if (!clean) return draft;
  return {
    ...draft,
    fields: {
      ...draft.fields,
      [key]: {
        ...draft.fields[key],
        value: clean,
        source: valueSource,
      },
    },
  };
}

function pickPrimary<T extends { principal?: boolean }>(items: T[]): T | undefined {
  return items.find((item) => item.principal) ?? items[0];
}

function pickPrimaryContact(contacts: AccountCrmContact[]): AccountCrmContact | undefined {
  return contacts.find((c) => (c.type ?? '').toLowerCase() === 'person') ?? contacts[0];
}

function pickSecondaryContact(
  contacts: AccountCrmContact[],
  primary: AccountCrmContact | undefined,
): AccountCrmContact | undefined {
  return contacts.find((c) => c !== primary && (c.type ?? '').toLowerCase() === 'person');
}

function contactName(contact: AccountCrmContact | undefined): string {
  if (!contact) return '';
  const parts = [
    contact.prefix,
    contact.first_name,
    contact.middle_name,
    contact.last_name,
    contact.suffix,
  ]
    .map((part) => part?.trim() ?? '')
    .filter(Boolean);
  return parts.join(' ') || contact.name?.trim() || contact.company_name?.trim() || '';
}

function deriveMeetingFacts(summary: MeetingApplicationSummary | undefined): MeetingApplicationFacts {
  if (!summary) return {};
  const textParts = [
    summary.notesText ?? '',
    ...(summary.transcript?.segments.map((s) => s.text) ?? []),
  ];
  const text = textParts.join('\n');
  const facts: MeetingApplicationFacts = {};
  const fundingSource =
    summary.structuredFacts?.fundingSource ??
    readLineValue(text, 'Funding source') ??
    readFundingFromSentence(text);
  const beneficiaries =
    summary.structuredFacts?.beneficiaries ??
    readLineValue(text, 'Beneficiaries') ??
    readLineValue(text, 'Beneficiary');
  const trusteeName =
    summary.structuredFacts?.trusteeName ??
    readLineValue(text, 'Trustee');
  const custodianName =
    summary.structuredFacts?.custodianName ??
    readLineValue(text, 'Custodian');
  const minorName =
    summary.structuredFacts?.minorName ??
    readLineValue(text, 'Minor');
  if (fundingSource) facts.fundingSource = fundingSource;
  if (beneficiaries) facts.beneficiaries = beneficiaries;
  if (trusteeName) facts.trusteeName = trusteeName;
  if (custodianName) facts.custodianName = custodianName;
  if (minorName) facts.minorName = minorName;
  return facts;
}

function readLineValue(text: string, label: string): string | undefined {
  const pattern = new RegExp(`^\\s*${escapeRegExp(label)}\\s*:\\s*(.+?)\\s*$`, 'im');
  return pattern.exec(text)?.[1]?.trim();
}

function readFundingFromSentence(text: string): string | undefined {
  const match = /\bfund(?:ing)?\b[^.\n]*\bfrom\s+([^.\n]+)/i.exec(text);
  return match?.[1]?.trim();
}

function redactSecret(value: string): string {
  const digits = value.replace(/\D/g, '');
  if (digits.length >= 4) return `***-**-${digits.slice(-4)}`;
  return value.trim() ? '***' : '';
}

function groupLabel(group: AccountFieldGroup): string {
  switch (group) {
    case 'owner':
      return 'Owner';
    case 'joint-owner':
      return 'Joint owner';
    case 'contact':
      return 'Contact';
    case 'funding':
      return 'Funding';
    case 'beneficiaries':
      return 'Beneficiaries';
    case 'trust':
      return 'Trust';
    case 'custodial':
      return 'Custodial';
    case 'inherited':
      return 'Inherited IRA';
  }
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
