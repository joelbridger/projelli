import { describe, expect, it } from 'vitest';
import { suggestDropboxHousehold } from './emailDropboxMatching';

describe('suggestDropboxHousehold', () => {
  it('suggests a household only when the encrypted mail metadata gives a real clue', () => {
    expect(suggestDropboxHousehold({
      subject: 'Q2 statement ready - Webb household',
      fromAddr: 'no-reply@custodian.test',
      fromName: 'Custodian',
      snippet: 'Your statement is ready.',
    }, [
      { id: 'webb', name: 'Webb household' },
      { id: 'patel', name: 'Patel household' },
    ])).toBe('webb');
  });

  it('leaves an unrelated message for the advisor to decide', () => {
    expect(suggestDropboxHousehold({
      subject: 'Firm holiday schedule',
      fromAddr: 'office@firm.test',
      fromName: 'Office',
      snippet: 'The office will be closed Friday.',
    }, [{ id: 'webb', name: 'Webb household' }])).toBeUndefined();
  });
});
