import { describe, expect, it } from 'vitest';
import type { Matter } from '@/platform/types/matter';
import type { CrmHouseholdDto } from '@/platform/utils/wealthbox-commands';
import type { TranscriptFile } from '@/platform/types/meeting';
import {
  ACCOUNT_APPLICATION_FIELD_MAP,
  AccountType,
  buildAccountApplicationAuditMetadata,
  buildAccountApplicationDraft,
  prefillAccountApplication,
  redactApplicationForStorage,
  updateApplicationField,
  type AccountCrmContact,
  type MeetingApplicationSummary,
} from './accountApplication';

const matter: Matter = {
  id: 'matter-hendricks',
  name: 'Hendricks Household',
  client: 'Robert and Susan Hendricks',
  folderPaths: ['/ws/Clients/Hendricks Household'],
  crmHouseholdKeys: ['hh-1'],
  createdAt: '2026-07-09T00:00:00.000Z',
};

const household: CrmHouseholdDto = {
  id: 'hh-1',
  name: 'Robert and Susan Hendricks',
};

const robert: AccountCrmContact = {
  id: '100',
  type: 'person',
  first_name: 'Robert',
  middle_name: 'James',
  last_name: 'Hendricks',
  birth_date: '1960-02-14',
  email_addresses: [{ address: 'robert@example.test', kind: 'Personal', principal: true }],
  phone_numbers: [{ address: '555-0101', kind: 'Cell', principal: true }],
  street_addresses: [
    {
      address: '14 Harbor Way',
      city: 'Boulder',
      state: 'CO',
      zip: '80302',
      kind: 'Home',
      principal: true,
    },
  ],
};

const transcript: TranscriptFile = {
  meta: {
    startedAt: '2026-07-08T10:00:00.000Z',
    durationMs: 1_200_000,
    matterId: matter.id,
    consent: {
      mode: 'two-party',
      confirmedBy: 'advisor',
      confirmedAt: '2026-07-08T10:00:00.000Z',
    },
  },
  segments: [
    {
      startMs: 1000,
      endMs: 4000,
      channel: 'mic',
      speaker: 'Advisor',
      text: 'We will fund the new Roth IRA from the Schwab rollover IRA.',
    },
  ],
};

const meetingSummary: MeetingApplicationSummary = {
  meeting: {
    dir: '/ws/Clients/Hendricks Household/Meetings/2026-07-08',
    folderName: '2026-07-08',
    meta: {
      matterId: matter.id,
      startedAt: '2026-07-08T10:00:00.000Z',
      calendarTitle: 'Hendricks annual review',
    },
    hasNotes: true,
    hasAudio: true,
    hasTranscript: true,
  },
  notesText:
    'Funding source: Schwab rollover IRA\nBeneficiaries: Susan Hendricks primary; Emily Hendricks contingent.',
  transcript,
};

describe('account application field maps', () => {
  it('defines the supported Schwab account types', () => {
    expect(Object.values(AccountType)).toEqual([
      'individual',
      'joint',
      'roth-ira',
      'traditional-ira',
      'rollover-ira',
      'inherited-ira',
      'living-trust',
      'custodial',
    ]);
  });

  it('marks SSN fields as redact-on-store for every account type that uses them', () => {
    for (const fields of Object.values(ACCOUNT_APPLICATION_FIELD_MAP)) {
      const ssnFields = fields.filter((field) => field.key.toLowerCase().includes('ssn'));
      for (const field of ssnFields) {
        expect(field.storage).toBe('redact-on-store');
      }
    }
  });

  it('adds trust-only and custodial-only fields without changing the common owner fields', () => {
    expect(ACCOUNT_APPLICATION_FIELD_MAP[AccountType.LivingTrust].map((f) => f.key)).toEqual(
      expect.arrayContaining(['trustName', 'trusteeName', 'trusteeEmail']),
    );
    expect(ACCOUNT_APPLICATION_FIELD_MAP[AccountType.Custodial].map((f) => f.key)).toEqual(
      expect.arrayContaining(['minorName', 'minorDob', 'custodianName', 'custodianSsn']),
    );
    expect(ACCOUNT_APPLICATION_FIELD_MAP[AccountType.Individual].map((f) => f.key)).toEqual(
      expect.arrayContaining(['ownerName', 'ownerDob', 'ownerSsn', 'addressLine1', 'phone', 'email', 'fundingSource']),
    );
  });
});

describe('prefillAccountApplication', () => {
  it('prefills available client, CRM, and meeting facts, then leaves missing fields blank', () => {
    const draft = prefillAccountApplication({
      accountType: AccountType.RothIra,
      matter,
      crm: { household, contacts: [robert] },
      meetingSummary,
    });

    expect(draft.matterId).toBe(matter.id);
    expect(draft.fields.ownerName.value).toBe('Robert James Hendricks');
    expect(draft.fields.ownerDob.value).toBe('1960-02-14');
    expect(draft.fields.addressLine1.value).toBe('14 Harbor Way');
    expect(draft.fields.city.value).toBe('Boulder');
    expect(draft.fields.state.value).toBe('CO');
    expect(draft.fields.email.value).toBe('robert@example.test');
    expect(draft.fields.phone.value).toBe('555-0101');
    expect(draft.fields.fundingSource.value).toBe('Schwab rollover IRA');
    expect(draft.fields.beneficiaries.value).toBe(
      'Susan Hendricks primary; Emily Hendricks contingent.',
    );
    expect(draft.fields.ownerSsn.value).toBe('');
    expect(draft.fields.ownerSsn.editable).toBe(true);
  });

  it('falls back to the household/client name when no contact record is available', () => {
    const draft = prefillAccountApplication({
      accountType: AccountType.Individual,
      matter,
      crm: { household, contacts: [] },
    });

    expect(draft.fields.ownerName.value).toBe('Robert and Susan Hendricks');
    expect(draft.fields.ownerDob.value).toBe('');
    expect(draft.fields.email.value).toBe('');
  });

  it('lets the advisor edit a prefilled field', () => {
    const draft = prefillAccountApplication({
      accountType: AccountType.RothIra,
      matter,
      crm: { household, contacts: [robert] },
      meetingSummary,
    });
    const updated = updateApplicationField(draft, 'ownerName', 'Robert Hendricks');

    expect(updated.fields.ownerName.value).toBe('Robert Hendricks');
    expect(updated.fields.ownerName.source?.kind).toBe('crm-contact');
  });
});

describe('redactApplicationForStorage', () => {
  it('removes plain SSNs while preserving last-four display text', () => {
    const draft = updateApplicationField(
      buildAccountApplicationDraft(AccountType.Custodial, matter.id),
      'custodianSsn',
      '123-45-6789',
    );

    const stored = redactApplicationForStorage(draft);

    expect(stored.fields.custodianSsn.value).toBe('');
    expect(stored.fields.custodianSsn.redactedValue).toBe('***-**-6789');
    expect(JSON.stringify(stored)).not.toContain('123-45-6789');
  });

  it('builds audit metadata without leaking SSNs', () => {
    const draft = updateApplicationField(
      buildAccountApplicationDraft(AccountType.RothIra, matter.id),
      'ownerSsn',
      '987-65-4321',
    );

    const metadata = buildAccountApplicationAuditMetadata(draft, 'pdf');

    expect(metadata['matterId']).toBe(matter.id);
    expect(metadata['delivery']).toBe('pdf');
    expect(JSON.stringify(metadata)).not.toContain('987-65-4321');
  });
});
