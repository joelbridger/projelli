import { describe, expect, it } from 'vitest';
import { getMatterSyncSocketUrl } from './firmConfig';

describe('v2 firm sync socket URL', () => {
  it('has a fixed path and only the ticket query parameter', () => {
    const url = new URL(getMatterSyncSocketUrl('one-time-ticket'));
    // Dev may add its fixed `/api/firm` proxy mount; neither local identifier is present.
    expect(url.pathname).toMatch(/\/v2\/firm\/sync$/);
    expect([...url.searchParams.entries()]).toEqual([['ticket', 'one-time-ticket']]);
  });
});
