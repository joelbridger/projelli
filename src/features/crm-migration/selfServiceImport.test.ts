import { describe, expect, it } from 'vitest';
import { parseVcards, suggestedContactMapping } from './selfServiceImport';

describe('self-service contact import', () => {
  it('reads a vCard into advisor-friendly contact columns', () => {
    const parsed = parseVcards(`BEGIN:VCARD\nVERSION:3.0\nFN:Avery North\nEMAIL:avery@example.test\nTEL:555-0101\nORG:Northcrest Advisory\nUID:crm-avery-001\nEND:VCARD`);
    expect(parsed.rows).toEqual([{ Name: 'Avery North', Email: 'avery@example.test', Phone: '555-0101', Company: 'Northcrest Advisory', UID: 'crm-avery-001' }]);
    expect(suggestedContactMapping(parsed.columns)).toEqual({ name: 'Name', email: 'Email', phone: 'Phone', company: 'Company', externalId: 'UID' });
  });

  it('recognizes the common Outlook CSV column labels', () => {
    expect(suggestedContactMapping(['Full Name', 'E-mail Address', 'Business Phone', 'Company Name', 'Contact ID'])).toEqual({
      name: 'Full Name', email: 'E-mail Address', phone: 'Business Phone', company: 'Company Name', externalId: 'Contact ID',
    });
  });
});
