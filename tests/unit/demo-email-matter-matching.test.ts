import { describe, expect, it } from 'vitest';
import { matchMatterIdForSender, nameTokens } from '../../scripts/demo/email-matter-matching.mjs';

describe('demo email matter matching', () => {
  const beaconRidgeMatters = [
    { id: 'hendersons', name: 'The Hendersons', client: '' },
    { id: 'alvarez', name: 'Maria & Luis Alvarez', client: '' },
    { id: 'nair', name: 'Dr. Priya Nair', client: '' },
  ];

  it('matches the three Beacon Ridge demo families from email sender names', () => {
    expect(matchMatterIdForSender('Robert Henderson', beaconRidgeMatters)).toBe('hendersons');
    expect(matchMatterIdForSender('Linda Henderson', beaconRidgeMatters)).toBe('hendersons');
    expect(matchMatterIdForSender('Maria Alvarez', beaconRidgeMatters)).toBe('alvarez');
    expect(matchMatterIdForSender('Luis Alvarez', beaconRidgeMatters)).toBe('alvarez');
    expect(matchMatterIdForSender('Priya Nair', beaconRidgeMatters)).toBe('nair');
  });

  it('normalizes demo-only words and plurals', () => {
    expect(nameTokens('The Hendersons')).toEqual(['henderson']);
    expect(nameTokens('Dr. Priya Nair')).toEqual(['priya', 'nair']);
  });
});
